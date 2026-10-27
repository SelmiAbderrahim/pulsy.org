import { readFileSync } from "node:fs";
import i18next from "i18next";
import type { ReactElement } from "react";
import { render as renderWithTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWrapper } from "@/test/query-wrapper";
import type { UptimeMonitor } from "@/types/uptime";
import { MonitorList } from "./monitor-list";

// Real English resources: the constraint warning must state concrete counts and consequences.
const i18n = i18next.createInstance();
await i18n.init({
	lng: "en", fallbackLng: false, defaultNS: "common", ns: ["common", "uptimeMonitor"],
	resources: { en: { common: JSON.parse(readFileSync("public/locales/en/common.json", "utf8")), uptimeMonitor: JSON.parse(readFileSync("public/locales/en/uptimeMonitor.json", "utf8")) } },
});
vi.mock("react-i18next", () => ({
	useTranslation: (ns?: string) => ({ t: i18n.getFixedT("en", ns ?? "common"), i18n }),
	Trans: ({ children }: { children?: unknown }) => children ?? null,
	initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
vi.mock("@tanstack/react-router", async () => {
	const { forwardRef } = await import("react");
	return {
		Link: forwardRef<HTMLAnchorElement, { children?: unknown }>(({ children, ...props }, ref) => {
			const { to, params, search, ...rest } = props as Record<string, unknown>;
			void to; void params; void search;
			return <a ref={ref} {...rest}>{children as never}</a>;
		}),
		useNavigate: () => vi.fn(),
	};
});
const deleteMultiple = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useDeleteUptimeMonitor: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useToggleUptimeMonitor: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCheckNow: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useBulkUptimeActions: () => ({ deleteMultiple, setActiveMultiple: vi.fn(), isProcessing: false }),
	useCreateUptimeShareLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useBulkUpdateUptimeSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const render = (ui: ReactElement) => renderWithTestingLibrary(ui, { wrapper: createWrapper().Wrapper });
const monitor = (overrides: Partial<UptimeMonitor>): UptimeMonitor => ({
	uptimeMonitorId: "m1", name: "Alpha", url: "https://a.example", status: "up", active: true, interval: 300,
	responseTime: 120, uptimePercentage: 99.5, lastCheckedAt: "2024-01-01T00:00:00Z", tags: [], ...overrides,
} as UptimeMonitor);
beforeEach(() => vi.clearAllMocks());

describe("bulk selection scoped by filters", () => {
	it("selects exactly the filtered monitors and labels the count", async () => {
		render(<MonitorList searchQuery="alp" monitors={[
			monitor({ uptimeMonitorId: "1", name: "Alpha", url: "https://alpha.example" }),
			monitor({ uptimeMonitorId: "2", name: "Alpine", url: "https://alpine.example" }),
			monitor({ uptimeMonitorId: "3", name: "Beta", url: "https://beta.example" }),
		]} />);
		await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
		expect(screen.getByRole("toolbar")).toHaveTextContent("2 selected");
		expect(screen.queryByRole("checkbox", { name: "Beta" })).toBeNull();
	});
});

describe("bulk delete dialog", () => {
	it("lists every selected name and states each constraint with its count and consequence", async () => {
		const monitors = [
			monitor({ uptimeMonitorId: "1", name: "Alpha", statusPageCount: 1 }),
			monitor({ uptimeMonitorId: "2", name: "Beta", isPublic: true }),
			monitor({ uptimeMonitorId: "3", name: "Gamma", overrideChannelCount: 2 }),
			monitor({ uptimeMonitorId: "4", name: "Delta" }),
		];
		render(<MonitorList monitors={monitors} />);
		await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
		await userEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: /^More/ }));
		await userEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
		const dialog = await screen.findByRole("dialog");
		for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) expect(within(dialog).getByText(name)).toBeInTheDocument();
		expect(dialog).toHaveTextContent("2 monitors are shown on status pages; they will be removed from those pages.");
		expect(dialog).toHaveTextContent("1 monitor has its own alert channels; those channels and links are removed with it.");
		expect(dialog).not.toHaveTextContent(/have constraints that may require manual cleanup/);
		await waitFor(() => expect(deleteMultiple).not.toHaveBeenCalled());
	});

	it("shows no constraint banner when nothing selected is attached to a page or channel", async () => {
		render(<MonitorList monitors={[monitor({ uptimeMonitorId: "1", name: "Alpha" })]} />);
		await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
		await userEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: /^More/ }));
		await userEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
		const dialog = await screen.findByRole("dialog");
		expect(dialog).not.toHaveTextContent(/status page/i);
		expect(dialog).not.toHaveTextContent(/alert channels/i);
	});
});
