import { act, fireEvent, render as renderUI, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
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
  it("lists required and malformed fields together, focuses the first, and links errors above the sticky Save", async () => {
    render(<SettingsTab monitor={monitor()} />);
    const name = screen.getByLabelText("create.fields.name");
    const timeout = screen.getByLabelText("create.fields.timeout");
    fireEvent.change(name, { target: { value: "" } });
    fireEvent.change(timeout, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("create.fields.expectedStatus"), { target: { value: "bad" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("link", { name: /^create.fields.name:/ })).toHaveAttribute("href", "#settings-name");
    expect(screen.getByRole("link", { name: /^create.fields.expectedStatus:/ })).toHaveAttribute("href", "#settings-expected");
    await userEvent.click(screen.getByRole("link", { name: /^create.fields.timeout:/ }));
    expect(timeout).toHaveFocus();
    expect(timeout.getAttribute("aria-describedby")).toContain("settings-timeout-validation-");
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("maps server field failures to their setting without a generic toast", async () => {
    mutateAsync.mockRejectedValue({ message: "Generic rejected input", data: { validationErrors: { fieldErrors: { url: ["Use an allowed HTTP destination"] } } } });
    render(<SettingsTab monitor={monitor()} />);
    const url = screen.getByLabelText("create.fields.url");
    fireEvent.change(url, { target: { value: "https://new.example.com" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(url).toHaveAttribute("aria-invalid", "true"));
    await waitFor(() => expect(url).toHaveFocus());
    expect(screen.getByRole("link", { name: /Use an allowed HTTP destination/ })).toHaveAttribute("href", "#settings-url");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("disables Save and releases the leave guard when edits are reverted", async () => {
    render(<SettingsTab monitor={monitor()} />);
    const name = screen.getByLabelText("create.fields.name");
    await userEvent.type(name, " draft");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await userEvent.clear(name);
    await userEvent.type(name, "Alpha");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

	it("prefills fields from the monitor", () => {
		render(<SettingsTab monitor={monitor()} />);
		expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
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
		const [timeout, threshold] = screen.getAllByRole("spinbutton");
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

it("retains an edited draft through polling, failed saves and subsequent refreshes", async () => {
	mutateAsync.mockRejectedValue(new Error("Try again"));
	const { rerender } = render(<SettingsTab monitor={monitor()} />);
	await userEvent.clear(screen.getByLabelText("create.fields.name"));
	await userEvent.type(screen.getByLabelText("create.fields.name"), "Unsaved work");
	rerender(<SettingsTab monitor={monitor({ name: "Server value", lastCheckedAt: new Date().toISOString() })} />);
	expect(screen.getByLabelText("create.fields.name")).toHaveValue("Unsaved work");
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(toastError).toHaveBeenCalledWith("Try again"));
	rerender(<SettingsTab monitor={monitor({ name: "Later server value" })} />);
	expect(screen.getByLabelText("create.fields.name")).toHaveValue("Unsaved work");
	rerender(<SettingsTab monitor={monitor({ uptimeMonitorId: "m2", name: "Other monitor" })} />);
	expect(screen.getByLabelText("create.fields.name")).toHaveValue("Other monitor");
});

it("keeps numeric help associated with its own field after the shared layout migration", () => {
  render(<SettingsTab monitor={monitor()} />);
  expect(screen.getByLabelText("create.fields.expectedStatus")).toHaveAccessibleDescription("Examples: 200,204 2xx 200–299");
  expect(screen.getByLabelText("create.fields.timeout")).toHaveAccessibleDescription("create.fields.timeoutDescription");
  expect(screen.getByLabelText("create.fields.failureThreshold")).toHaveAccessibleDescription("create.fields.failureThresholdDescription");
});


it("protects submitted HTTP values from edits while Save is pending", async () => {
  let release!: () => void;
  mutateAsync.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  render(<SettingsTab monitor={monitor()} />);
  await userEvent.click(screen.getByRole("button", { name: "http.title" }));
  await userEvent.click(screen.getByRole("combobox", { name: "http.requestValues" }));
  await userEvent.click(screen.getByRole("option", { name: "http.replace" }));
  await userEvent.click(screen.getByRole("button", { name: "http.addHeader" }));
  fireEvent.change(screen.getByLabelText("http.headerName"), { target: { value: "X-Private" } });
  const value = screen.getByLabelText("http.headerValue");
  fireEvent.change(value, { target: { value: "submitted-value" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(value).toBeDisabled();
  expect(screen.getByLabelText("create.fields.url")).toBeDisabled();
  await userEvent.type(value, "newer-unsaved-value");
  expect(value).toHaveValue("submitted-value");
  await act(async () => release());
  expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ requestConfig: { headers: [{ name: "X-Private", value: "submitted-value" }] } }));
});
