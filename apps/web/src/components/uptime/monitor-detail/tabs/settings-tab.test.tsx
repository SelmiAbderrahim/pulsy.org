import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { render as renderUI, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { SettingsTab } from "./settings-tab";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/services/uptime/maintenanceService", () => ({ MaintenanceService: { list: async () => [] } }));
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUI(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

const mutateAsync = vi.fn();
const useUpdateUptimeMonitor = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useUpdateUptimeMonitor: () => useUpdateUptimeMonitor(),
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
		method: "GET",
		interval: 300,
		expectedStatus: 200,
		timeout: 10000,
		failureThreshold: 3,
		isPublic: false,
		...overrides,
	} as UptimeMonitor;
}

beforeEach(() => {
	vi.clearAllMocks();
	useUpdateUptimeMonitor.mockReturnValue({ mutateAsync, isPending: false });
});

describe("SettingsTab", () => {
	it("prefills fields from the monitor", () => {
		render(<SettingsTab monitor={monitor()} />);
		expect(screen.getByLabelText("create.fields.name")).toHaveValue("Alpha");
		expect(screen.getByLabelText("create.fields.url")).toHaveValue(
			"https://a.com",
		);
	});

	it("saves edited values and shows success", async () => {
		mutateAsync.mockResolvedValue(undefined);
		render(<SettingsTab monitor={monitor()} />);
		const nameInput = screen.getByLabelText("create.fields.name");
		await userEvent.clear(nameInput);
		await userEvent.type(nameInput, "Renamed");
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
		expect(mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				uptimeMonitorId: "m1",
				name: "Renamed",
				method: "GET",
				interval: 300,
				expectedStatus: 200,
				timeout: 10000,
				failureThreshold: 3,
			}),
		);
		expect(toastSuccess).toHaveBeenCalled();
	});

	it("shows an error toast when the update fails", async () => {
		mutateAsync.mockRejectedValue(new Error("save fail"));
		render(<SettingsTab monitor={monitor()} />);
    await userEvent.type(screen.getByLabelText("create.fields.name"), " changed");
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("save fail"));
	});

	it("changes the method via the select", async () => {
		mutateAsync.mockResolvedValue(undefined);
		render(<SettingsTab monitor={monitor()} />);
		const [methodTrigger] = screen.getAllByRole("combobox");
		if (!methodTrigger) throw new Error("Method select not found");
		await userEvent.click(methodTrigger);
		await userEvent.click(screen.getByRole("option", { name: "POST" }));
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ method: "POST" }),
			),
		);
	});

	it("changes the check interval via the select", async () => {
		mutateAsync.mockResolvedValue(undefined);
		render(<SettingsTab monitor={monitor()} />);
		const intervalTrigger = screen.getAllByRole("combobox")[1];
		if (!intervalTrigger) throw new Error("Interval select not found");
		await userEvent.click(intervalTrigger);
		await userEvent.click(screen.getByRole("option", { name: "1 minute" }));
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ interval: 60 }),
			),
		);
	});

	it("edits the URL and numeric fields", async () => {
		mutateAsync.mockResolvedValue(undefined);
		render(<SettingsTab monitor={monitor()} />);
		const urlInput = screen.getByLabelText("create.fields.url");
		await userEvent.clear(urlInput);
		await userEvent.type(urlInput, "https://b.com");
		const expected = screen.getByLabelText("create.fields.expectedStatus");
    const timeout = screen.getByLabelText("create.fields.timeout");
    const threshold = screen.getByLabelText("create.fields.failureThreshold");
		if (!expected || !timeout || !threshold) {
			throw new Error("Settings numeric fields not found");
		}
		await userEvent.clear(expected);
		await userEvent.type(expected, "202");
		await userEvent.clear(timeout);
		await userEvent.type(timeout, "9000");
		await userEvent.clear(threshold);
		await userEvent.type(threshold, "6");
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					url: "https://b.com",
					expectedStatus: 202,
					timeout: 9000,
					failureThreshold: 6,
				}),
			),
		);
	});

	it("re-syncs local state when the monitor prop changes", () => {
		const { rerender } = render(<SettingsTab monitor={monitor()} />);
		rerender(<SettingsTab monitor={monitor({ name: "Updated" })} />);
		expect(screen.getByLabelText("create.fields.name")).toHaveValue("Updated");
	});

	it("disables the save button while pending", () => {
		useUpdateUptimeMonitor.mockReturnValue({ mutateAsync, isPending: true });
		render(<SettingsTab monitor={monitor()} />);
		expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
	});
});
