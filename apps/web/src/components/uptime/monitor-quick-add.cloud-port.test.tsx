import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorQuickAdd } from "./monitor-quick-add";

vi.mock("react-i18next", () => reactI18nextMock());
const existingMonitors = vi.hoisted(() => ({ data: [] as Array<{ url: string; name: string }> }));
vi.mock("@/hooks/uptime/useUptimeMonitors", () => ({ useUptimeMonitors: () => existingMonitors }));

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
vi.mock("@/lib/toast", () => ({
	toast: {
		success: (m: unknown, opts?: unknown) => toastSuccess(m, opts),
		error: (m: unknown) => toastError(m),
	},
}));

beforeEach(() => {
	vi.clearAllMocks(); existingMonitors.data = [];
	useCreateUptimeMonitor.mockReturnValue({ mutateAsync, isPending: false });
});

describe("MonitorQuickAdd", () => {
  it("keeps required then malformed URL validation stable and allows repair after following the summary link", async () => {
    render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
    const url = screen.getByLabelText("URL");
    const submit = screen.getByRole("button", { name: "Add monitor" });
    await userEvent.click(submit);
    await userEvent.click(screen.getByRole("link", { name: "URL: formValidation.required" }));
    expect(url).toHaveFocus();
    fireEvent.input(url, { target: { value: "https://" } });
    await userEvent.click(submit);
    expect(screen.getByRole("link", { name: "URL: creation.invalidUrl" })).toBeInTheDocument();
    expect(url).toHaveValue("https://");
    expect(url).toHaveFocus();
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.input(url, { target: { value: "https://example.com/health" } });
    await waitFor(() => expect(screen.queryByRole("link", { name: "URL: creation.invalidUrl" })).not.toBeInTheDocument());
    expect(url).not.toHaveAttribute("aria-invalid", "true");
  });

	it("submits with a derived name from the URL and resets/closes", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m1" });
		const onOpenChange = vi.fn();
		render(<MonitorQuickAdd open onOpenChange={onOpenChange} />);

		await userEvent.type(
			screen.getByLabelText("URL"),
			"https://api.example.com/health",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Add monitor" }),
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
			screen.getByRole("button", { name: "Add monitor" }),
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
			screen.getByRole("button", { name: "Add monitor" }),
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
			search: { tab: "alerts" },
		});
	});

	it("shows an error toast when creation fails", async () => {
		mutateAsync.mockRejectedValue(new Error("boom"));
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		await userEvent.type(screen.getByLabelText("URL"), "https://x.com");
		await userEvent.click(
			screen.getByRole("button", { name: "Add monitor" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("boom"));
	});

	it("keeps submit available for a blank draft so the URL field can say what is missing, and creates nothing", async () => {
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		// No URL typed → autoName empty, name empty → effectiveName empty.
		const submit = screen.getByRole("button", { name: "Add monitor" });
		expect(submit).toBeEnabled();
		await userEvent.click(submit);
		expect(mutateAsync).not.toHaveBeenCalled();
	});

	it("summarizes an invalid URL even when it has no derivable hostname", () => {
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		// A malformed URL must explain why submission cannot proceed.
		const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
		fireEvent.change(urlInput, { target: { value: "not-a-url" } });
		fireEvent.submit(urlInput.closest("form") as HTMLFormElement);
    expect(screen.getByRole("alert")).toHaveTextContent("creation.invalidUrl");
    expect(urlInput).toHaveAttribute("aria-invalid", "true");
    expect(urlInput).toHaveFocus();
		expect(mutateAsync).not.toHaveBeenCalled();
	});

	it("disables the submit button while pending", () => {
		useCreateUptimeMonitor.mockReturnValue({ mutateAsync, isPending: true });
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		expect(
			screen.getByRole("button", { name: "Add monitor" }),
		).toBeDisabled();
	});

	it("closes via the Cancel button", async () => {
		const onOpenChange = vi.fn();
		render(<MonitorQuickAdd open onOpenChange={onOpenChange} />);
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});

it("hands an incomplete URL and the exact edited name to advanced without creating", async () => {
	const onAdvanced = vi.fn();
	render(<MonitorQuickAdd open onOpenChange={vi.fn()} onAdvanced={onAdvanced} />);
	await userEvent.type(screen.getByLabelText("URL"), "https://incomplete");
	await userEvent.type(screen.getByLabelText("Name"), "My retained draft");
	await userEvent.click(screen.getByRole("button", { name: "creation.continueAdvanced" }));
	expect(onAdvanced).toHaveBeenCalledWith({ url: "https://incomplete/", name: "My retained draft" });
	expect(mutateAsync).not.toHaveBeenCalled();

});

	it("validates the empty URL field on blur and again on submit", async () => {
		render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		const url = screen.getByLabelText("URL");
		url.focus();
		await userEvent.tab();
		expect(screen.getByText("nav.requiredField")).toBeInTheDocument();
		expect(url).toHaveAttribute("aria-invalid", "true");
		await userEvent.click(screen.getByRole("button", { name: "Add monitor" }));
		expect(await screen.findByRole("link", { name: "URL: formValidation.required" })).toBeInTheDocument();
		expect(mutateAsync).not.toHaveBeenCalled();
	});

	it("starts a reopened draft clean", async () => {
		const { rerender } = render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		const first = screen.getByLabelText("URL");
		await userEvent.type(first, "x");
		await userEvent.clear(first);
		await userEvent.tab();
		expect(screen.getAllByText("nav.requiredField").length).toBeGreaterThan(0);
		rerender(<MonitorQuickAdd open={false} onOpenChange={vi.fn()} />);
		rerender(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
		expect(screen.queryByText("nav.requiredField")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "URL: formValidation.required" })).not.toBeInTheDocument();
	});


describe("Quick Add structured API validation", () => {
  it("maps a rejected URL to one linked summary and inline error without a duplicate generic toast", async () => {
    mutateAsync.mockRejectedValue({ message: '[{"code":"custom","message":"secret"}]', data: { validationErrors: { fieldErrors: { url: ["Use an HTTP or HTTPS URL"] }, formErrors: [] } } });
    render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
    const input = screen.getByLabelText("URL");
    await userEvent.type(input, "https://example.com/health");
    await userEvent.click(screen.getByRole("button", { name: "Add monitor" }));
    await screen.findByRole("link", { name: "URL: Use an HTTP or HTTPS URL" });
    expect(screen.getByText("Use an HTTP or HTTPS URL")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("quick-url-validation-"); expect(input).toHaveFocus();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.queryByText("statusUX.validationError")).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("alert")).getByRole("link"));
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "https://example.com/fixed" } });
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Use an HTTP or HTTPS URL")).not.toBeInTheDocument();
  });
});

it("normalizes a bare host and identifies an existing monitor by name", async () => {
  existingMonitors.data = [{ name: "Production API", url: "https://example.com/health" }];
  render(<MonitorQuickAdd open onOpenChange={vi.fn()} />);
  await userEvent.type(screen.getByLabelText("URL"), "example.com/health/");
  await userEvent.tab();
  expect(screen.getByLabelText("URL")).toHaveValue("https://example.com/health/");
  fireEvent.submit(screen.getByLabelText("URL").closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("creation.duplicateUrl");
  expect(mutateAsync).not.toHaveBeenCalled();
});

it("places the advanced link before the grouped submit actions and uses the standard create width", () => {
  render(<MonitorQuickAdd open onOpenChange={vi.fn()} onAdvanced={vi.fn()} />);
  expect(screen.getByRole("dialog")).toHaveClass("max-w-[var(--dialog-standard)]");
  const advanced = screen.getByRole("button", { name: "creation.continueAdvanced" });
  expect(advanced).toHaveClass("underline-offset-4");
  const cancel = screen.getByRole("button", { name: "Cancel" });
  const submit = screen.getByRole("button", { name: "Add monitor" });
  expect(cancel.parentElement).toBe(submit.parentElement);
  expect(advanced.nextElementSibling).toBe(submit.parentElement);
  expect(screen.getByLabelText("URL")).toHaveAttribute("placeholder", "Example: https://example.com/health");
  expect(screen.getByLabelText("Name")).toHaveAttribute("placeholder", "Example: Website");
});
