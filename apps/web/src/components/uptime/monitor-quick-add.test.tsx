import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorQuickAdd } from "./monitor-quick-add";

vi.mock("react-i18next", () => reactI18nextMock());

const mutateAsync = vi.fn();
const useCreateUptimeMonitor = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useCreateUptimeMonitor: () => useCreateUptimeMonitor(),
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
	toast: {
		success: (m: unknown, opts?: unknown) => toastSuccess(m, opts),
		error: (m: unknown) => toastError(m),
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
	useCreateUptimeMonitor.mockReturnValue({ mutateAsync, isPending: false });
});

describe("MonitorQuickAdd", () => {
	it("submits with a derived name from the URL and resets/closes", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m1" });
		const onOpenChange = vi.fn();
		render(<MonitorQuickAdd open onOpenChange={onOpenChange} />);

		await userEvent.type(
			screen.getByLabelText("URL"),
			"https://api.example.com/health",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Add Monitor" }),
		);

		await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
		expect(mutateAsync).toHaveBeenCalledWith({
			name: "api.example.com",
			url: "https://api.example.com/health",
			method: "GET",
			expectedStatus: 200,
			timeout: 10000,
			interval: 300,
			failureThreshold: 3,
		});
		expect(toastSuccess).toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("prefers an explicit name over the derived one", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m2" });
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		await userEvent.type(screen.getByLabelText("URL"), "https://x.com");
		await userEvent.type(screen.getByLabelText("Name"), "My API");
		await userEvent.click(
			screen.getByRole("button", { name: "Add Monitor" }),
		);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ name: "My API" }),
			),
		);
	});

	it("navigates to the notifications tab from the success toast action", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m3" });
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		await userEvent.type(screen.getByLabelText("URL"), "https://x.com");
		await userEvent.click(
			screen.getByRole("button", { name: "Add Monitor" }),
			);
			await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
			const successCall = toastSuccess.mock.calls[0];
			if (!successCall) throw new Error("Success toast was not called");
			const opts = successCall[1] as {
				action: { onClick: () => void };
			};
		opts.action.onClick();
		expect(navigate).toHaveBeenCalledWith({
			to: "/dashboard/uptime/$monitorId",
			params: { monitorId: "m3" },
			search: { tab: "notifications" },
		});
	});

	it("shows an error toast when creation fails", async () => {
		mutateAsync.mockRejectedValue(new Error("boom"));
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		await userEvent.type(screen.getByLabelText("URL"), "https://x.com");
		await userEvent.click(
			screen.getByRole("button", { name: "Add Monitor" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("boom"));
	});

	it("disables submit and skips mutation when no effective name is available", () => {
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		// No URL typed → autoName empty, name empty → effectiveName empty.
		expect(
			screen.getByRole("button", { name: "Add Monitor" }),
		).toBeDisabled();
		expect(mutateAsync).not.toHaveBeenCalled();
	});

	it("submits-guards when the URL has no derivable hostname", () => {
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		// A non-empty but unparseable URL satisfies the `required` constraint yet
		// yields an empty hostname, so effectiveName is empty and handleSubmit's
		// `if (!effectiveName) return` guard fires.
		const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
		fireEvent.change(urlInput, { target: { value: "not-a-url" } });
		fireEvent.submit(urlInput.closest("form") as HTMLFormElement);
		expect(mutateAsync).not.toHaveBeenCalled();
	});

	it("disables the submit button while pending", () => {
		useCreateUptimeMonitor.mockReturnValue({ mutateAsync, isPending: true });
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		expect(
			screen.getByRole("button", { name: "Add Monitor" }),
		).toBeDisabled();
	});

	it("closes via the Cancel button", async () => {
		const onOpenChange = vi.fn();
		render(<MonitorQuickAdd open onOpenChange={onOpenChange} />);
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
