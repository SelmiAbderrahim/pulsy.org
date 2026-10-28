import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { registerConfirmationHandler } from "@/lib/confirmation";
import { afterEach as afterConfirmationTest } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor, UptimeMonitorStatus } from "@/types/uptime";
import { MonitorDetailHeader } from "./monitor-detail-header";

vi.mock("react-i18next", () => reactI18nextMock());

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	Link: ({ children, ...props }: { children?: unknown }) => {
		const { to, ...rest } = props as Record<string, unknown>;
		void to;
		return <a {...(rest as object)}>{children as never}</a>;
	},
}));

const deleteMutateAsync = vi.fn();
const toggleMutateAsync = vi.fn();
const checkNowMutateAsync = vi.fn();
const pending = { delete: false, toggle: false, check: false };
vi.mock("@/hooks/uptime", () => ({
 useCreateUptimeShareLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteUptimeMonitor: () => ({
		mutateAsync: deleteMutateAsync,
		isPending: pending.delete,
	}),
	useToggleUptimeMonitor: () => ({
		mutateAsync: toggleMutateAsync,
		isPending: pending.toggle,
	}),
	useCheckNow: () => ({
		mutateAsync: checkNowMutateAsync,
		isPending: pending.check,
	}),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
	toast: {
		success: (m: unknown) => toastSuccess(m),
		error: (m: unknown) => toastError(m),
	},
}));

function monitor(overrides: Partial<UptimeMonitor> = {}): UptimeMonitor {
	return {
		uptimeMonitorId: "m1",
		name: "Alpha",
		url: "https://a.com",
		status: "up",
		active: true,
		...overrides,
	} as UptimeMonitor;
}

const confirmationDecision = vi.fn().mockResolvedValue(true);
let unregisterConfirmation: (() => void) | undefined;
beforeEach(() => {
  confirmationDecision.mockResolvedValue(true);
  unregisterConfirmation = registerConfirmationHandler(confirmationDecision);
});
afterConfirmationTest(() => unregisterConfirmation?.());

beforeEach(() => {
	vi.clearAllMocks();
	pending.delete = pending.toggle = pending.check = false;
	confirmationDecision.mockResolvedValue(true);
});

describe("MonitorDetailHeader status badge", () => {
	const statusCases = [
		["up", "status.up"],
		["down", "status.down"],
		["degraded", "status.degraded"],
		["pending", "status.pending"],
	] satisfies Array<[UptimeMonitorStatus, string]>;

	it.each(statusCases)("renders the %s status badge", (status, label) => {
		render(<MonitorDetailHeader monitor={monitor({ status, lastCheckedAt: "2026-10-13T12:00:00Z" })} />);
		expect(screen.getByText(label)).toBeInTheDocument();
	});
});

describe("MonitorDetailHeader actions", () => {
	it("checks now and shows success", async () => {
		checkNowMutateAsync.mockResolvedValue(undefined);
		render(<MonitorDetailHeader monitor={monitor()} />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.checkNow" }),
		);
		await waitFor(() => expect(checkNowMutateAsync).toHaveBeenCalled());
		expect(toastSuccess).toHaveBeenCalledWith("checkNow.success");
	});

	it("disables/checks now is unavailable for inactive monitors and shows Enable", async () => {
		render(<MonitorDetailHeader monitor={monitor({ active: false })} />);
		expect(
			screen.getByRole("button", { name: "actions.checkNow" }),
		).toBeDisabled();
 await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
		expect(
			screen.getByRole("menuitem", { name: /actions.enable/ }),
		).toBeInTheDocument();
	});

	it("toggles a monitor and shows the disable-success toast when active", async () => {
		toggleMutateAsync.mockResolvedValue(undefined);
		render(<MonitorDetailHeader monitor={monitor({ active: true })} />);
		await menuAction(/actions.disable/);
		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith("toggle.disableSuccess"),
		);
	});

	it("toggles a monitor and shows the enable-success toast when inactive", async () => {
		toggleMutateAsync.mockResolvedValue(undefined);
		render(<MonitorDetailHeader monitor={monitor({ active: false })} />);
		await menuAction(/actions.enable/);
		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith("toggle.enableSuccess"),
		);
	});

	it("deletes and navigates home on confirm", async () => {
		deleteMutateAsync.mockResolvedValue(undefined);
		render(<MonitorDetailHeader monitor={monitor()} />);
		await menuAction("Delete monitor");
		await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalled());
		expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" });
		expect(toastSuccess).toHaveBeenCalledWith("delete.success");
	});

	it("aborts delete when confirm is declined", async () => {
		confirmationDecision.mockResolvedValue(false);
		render(<MonitorDetailHeader monitor={monitor()} />);
		await menuAction("Delete monitor");
		expect(deleteMutateAsync).not.toHaveBeenCalled();
	});

	it("surfaces errors from each action", async () => {
		checkNowMutateAsync.mockRejectedValue(new Error("check fail"));
		toggleMutateAsync.mockRejectedValue(new Error("toggle fail"));
		deleteMutateAsync.mockRejectedValue(new Error("delete fail"));
		render(<MonitorDetailHeader monitor={monitor()} />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.checkNow" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("check fail"));
		await menuAction(/actions.disable/);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("toggle fail"));
		await menuAction("Delete monitor");
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("delete fail"));
	});

	it("shows a spinner while a check is pending", () => {
		pending.check = true;
		const { container } = render(<MonitorDetailHeader monitor={monitor()} />);
		expect(container.querySelector(".animate-spin")).toBeInTheDocument();
	});
});

vi.mock("../monitor-reuse-controls", () => ({ MonitorReuseActions: ({ children }: { children: (actions: { duplicate: () => void; saveTemplate: () => void; busy: boolean }) => unknown }) => children({ duplicate: vi.fn(), saveTemplate: vi.fn(), busy: false }) }));

async function menuAction(name: string | RegExp) { await userEvent.click(screen.getByRole("button", { name: "detailUX.more" })); await userEvent.click(screen.getByRole("menuitem", { name })); }
