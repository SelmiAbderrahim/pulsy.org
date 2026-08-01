import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorCreateDialog } from "./monitor-create-dialog";

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

async function fillRequired() {
	await userEvent.type(screen.getByLabelText("Name"), "My API");
	await userEvent.type(screen.getByLabelText("URL"), "https://api.example.com");
}

describe("MonitorCreateDialog submit", () => {
	it("creates a monitor with parsed numeric fields and no tags", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m1" });
		const onOpenChange = vi.fn();
		render(<MonitorCreateDialog open onOpenChange={onOpenChange} />);
		await fillRequired();
		await userEvent.click(
			screen.getByRole("button", { name: "New Monitor" }),
		);
		await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
		expect(mutateAsync).toHaveBeenCalledWith({
			name: "My API",
			url: "https://api.example.com",
			method: "GET",
			interval: 300,
			expectedStatus: 200,
			timeout: 10000,
			failureThreshold: 3,
			tags: undefined,
		});
		expect(toastSuccess).toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("includes tags when present and supports the toast navigate action", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m2" });
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		await fillRequired();
		const tagInput = screen.getByPlaceholderText("Add a tag...");
		await userEvent.type(tagInput, "prod{Enter}");
		await userEvent.type(tagInput, "api{Enter}");
		await userEvent.click(
			screen.getByRole("button", { name: "New Monitor" }),
		);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ tags: ["prod", "api"] }),
			),
		);
			const successCall = toastSuccess.mock.calls[0];
			if (!successCall) throw new Error("Success toast was not called");
			const opts = successCall[1] as {
				action: { onClick: () => void };
			};
		opts.action.onClick();
		expect(navigate).toHaveBeenCalledWith({
			to: "/dashboard/uptime/$monitorId",
			params: { monitorId: "m2" },
			search: { tab: "notifications" },
		});
	});

	it("shows an error toast on failure", async () => {
		mutateAsync.mockRejectedValue(new Error("nope"));
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		await fillRequired();
		await userEvent.click(
			screen.getByRole("button", { name: "New Monitor" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("nope"));
	});
});

describe("MonitorCreateDialog tags", () => {
	it("ignores blank, duplicate, and over-limit tags", async () => {
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		const tagInput = screen.getByPlaceholderText("Add a tag...");

		// Blank tag (just whitespace) is ignored
		await userEvent.type(tagInput, "   {Enter}");
		expect(screen.queryByRole("button", { name: "" })).not.toBeInTheDocument();

		// Add one, then attempt a duplicate
		await userEvent.type(tagInput, "dup{Enter}");
		await userEvent.type(tagInput, "dup{Enter}");
		expect(screen.getAllByText("dup")).toHaveLength(1);

		// Fill up to 10 tags total; input becomes disabled
		for (let i = 0; i < 9; i++) {
			await userEvent.type(tagInput, `t${i}{Enter}`);
		}
		expect(tagInput).toBeDisabled();
	});

	it("adds a tag on blur", async () => {
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		const tagInput = screen.getByPlaceholderText("Add a tag...");
		await userEvent.type(tagInput, "viablur");
		fireEvent.blur(tagInput);
		expect(screen.getByText("viablur")).toBeInTheDocument();
	});

	it("removes a tag via its remove button", async () => {
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		const tagInput = screen.getByPlaceholderText("Add a tag...");
		await userEvent.type(tagInput, "removeme{Enter}");
		expect(screen.getByText("removeme")).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "Remove removeme" }),
		);
		expect(screen.queryByText("removeme")).not.toBeInTheDocument();
	});
});

describe("MonitorCreateDialog controls", () => {
	it("changes the HTTP method via the select", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m3" });
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		await fillRequired();
			const [methodTrigger] = screen.getAllByRole("combobox");
			if (!methodTrigger) throw new Error("Method select not found");
			await userEvent.click(methodTrigger);
		await userEvent.click(screen.getByRole("option", { name: "HEAD" }));
		await userEvent.click(
			screen.getByRole("button", { name: "New Monitor" }),
		);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ method: "HEAD" }),
			),
		);
	});

	it("edits the numeric fields (expected status, timeout, threshold)", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m5" });
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		await fillRequired();
		const [expected, timeout, threshold] =
			screen.getAllByRole("spinbutton");
		if (!expected || !timeout || !threshold) {
			throw new Error("Create numeric fields not found");
		}
		await userEvent.clear(expected);
		await userEvent.type(expected, "201");
		await userEvent.clear(timeout);
		await userEvent.type(timeout, "5000");
		await userEvent.clear(threshold);
		await userEvent.type(threshold, "5");
		await userEvent.click(
			screen.getByRole("button", { name: "New Monitor" }),
		);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					expectedStatus: 201,
					timeout: 5000,
					failureThreshold: 5,
				}),
			),
		);
	});

	it("changes the check interval via the select", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m4" });
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		await fillRequired();
		const intervalTrigger = screen.getAllByRole("combobox")[1];
		if (!intervalTrigger) throw new Error("Interval select not found");
		await userEvent.click(intervalTrigger);
		await userEvent.click(screen.getByRole("option", { name: "1 minute" }));
		await userEvent.click(
			screen.getByRole("button", { name: "New Monitor" }),
		);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ interval: 60 }),
			),
		);
	});

	it("closes via Cancel", async () => {
		const onOpenChange = vi.fn();
		render(<MonitorCreateDialog open onOpenChange={onOpenChange} />);
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("disables the submit button while pending", () => {
		useCreateUptimeMonitor.mockReturnValue({ mutateAsync, isPending: true });
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		expect(
			screen.getByRole("button", { name: "New Monitor" }),
		).toBeDisabled();
	});
});
