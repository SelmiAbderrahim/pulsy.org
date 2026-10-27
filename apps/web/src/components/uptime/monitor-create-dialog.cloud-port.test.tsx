import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorCreateDialog } from "./monitor-create-dialog";

vi.mock("react-i18next", () => reactI18nextMock());
const existingMonitors = vi.hoisted(() => ({ data: [] as Array<{ url: string; name: string }> }));
vi.mock("@/hooks/uptime/useUptimeMonitors", () => ({ useUptimeMonitors: () => existingMonitors }));

const saveTemplate = vi.fn();
vi.mock("@/services/uptime/monitorTemplatesService", () => ({ MonitorTemplatesService: { save: (...args: unknown[]) => saveTemplate(...args) } }));
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

async function fillRequired() {
	await userEvent.type(screen.getByLabelText("Name"), "My API");
	await userEvent.type(screen.getByLabelText("URL"), "https://api.example.com");
}

it("clears a confirmed discarded create draft before reopening and restores automatic naming", async () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(<MonitorCreateDialog open onOpenChange={onOpenChange} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Discarded monitor" } });
  fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://discarded.example.com" } });
  fireEvent.change(screen.getByLabelText("Timeout"), { target: { value: "5000" } });
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "actions.discard" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  rerender(<MonitorCreateDialog open={false} onOpenChange={onOpenChange} />);
  rerender(<MonitorCreateDialog open onOpenChange={onOpenChange} />);
  expect(screen.getByLabelText("URL")).toHaveValue("");
  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(screen.getByLabelText("Timeout")).toHaveValue(10000);
  fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://fresh.example.com" } });
  expect(screen.getByLabelText("Name")).toHaveValue("fresh.example.com");
  await userEvent.click(screen.getByLabelText("Name"));
  await userEvent.keyboard("qa-exact-name");
  expect(screen.getByLabelText("Name")).toHaveValue("qa-exact-name");
  fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://another.example.com" } });
  expect(screen.getByLabelText("Name")).toHaveValue("qa-exact-name");
});

it("lists required and malformed status errors together on the first submit", async () => {
  render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Expected Status"), { target: { value: "bad" } });
  await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
  expect(screen.getByRole("link", { name: /^URL:/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^Expected Status:/ })).toBeInTheDocument();
  expect(screen.getByLabelText("URL")).toHaveFocus();
  expect(mutateAsync).not.toHaveBeenCalled();
});

describe("MonitorCreateDialog submit", () => {
	it("names the HTTP method and interval independently of their selected values", () => {
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		expect(screen.getByRole("combobox", { name: "HTTP Method" })).toHaveTextContent("GET");
		expect(screen.getByRole("combobox", { name: "Check Interval" })).toHaveTextContent("5 minutes");
		for (const native of document.querySelectorAll('select[tabindex="-1"]')) {
			expect(native).toHaveAttribute("aria-hidden", "true");
		}
	});
	it("creates a monitor with parsed numeric fields and no tags", async () => {
		mutateAsync.mockResolvedValue({ uptimeMonitorId: "m1" });
		const onOpenChange = vi.fn();
		render(<MonitorCreateDialog open onOpenChange={onOpenChange} />);
		await fillRequired();
		await userEvent.click(
			screen.getByRole("button", { name: "Create monitor" }),
		);
		await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
		expect(mutateAsync).toHaveBeenCalledWith({
			name: "My API",
			url: "https://api.example.com/",
			method: "GET",
			interval: 300,
			expectedStatus: 200,
				expectedStatuses: null,
				tlsMonitoringEnabled: true,
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
		const tagInput = screen.getByPlaceholderText("Example: production");
		await userEvent.type(tagInput, "prod{Enter}");
		await userEvent.type(tagInput, "api{Enter}");
		await userEvent.click(
			screen.getByRole("button", { name: "Create monitor" }),
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
			search: { tab: "alerts" },
		});
	});

	it("keeps actionable server failure feedback in the form body", async () => {
		mutateAsync.mockRejectedValue(new Error("nope"));
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		await fillRequired();
		await userEvent.click(
			screen.getByRole("button", { name: "Create monitor" }),
		);
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("nope"));
    expect(screen.getByRole("button", { name: "Create monitor" })).toBeEnabled();
    expect(toastError).not.toHaveBeenCalled();
	});
});

describe("MonitorCreateDialog tags", () => {
	it("ignores blank, duplicate, and over-limit tags", async () => {
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		const tagInput = screen.getByPlaceholderText("Example: production");

		// Blank tag (just whitespace) is ignored
		await userEvent.type(tagInput, "   {Enter}");
		expect(screen.queryByRole("button", { name: "" })).not.toBeInTheDocument();

		// Add one, then attempt a duplicate
		await userEvent.type(tagInput, "dup{Enter}");
		await userEvent.type(tagInput, "dup{Enter}");
		expect(screen.getAllByText("dup")).toHaveLength(1);
    expect(tagInput).toHaveValue("");
    const feedback = screen.getByText("tags.duplicate");
    expect(feedback).toHaveAttribute("role", "status");
    expect(tagInput).toHaveAttribute("aria-describedby", feedback.id);
    expect(mutateAsync).not.toHaveBeenCalled();

		// Fill up to 10 tags total; input becomes disabled
		for (let i = 0; i < 9; i++) {
			await userEvent.type(tagInput, `t${i}{Enter}`);
		}
		expect(tagInput).toBeDisabled();
	});

	it("adds a tag on blur", async () => {
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		const tagInput = screen.getByPlaceholderText("Example: production");
		await userEvent.type(tagInput, "viablur");
		fireEvent.blur(tagInput);
		expect(screen.getByText("viablur")).toBeInTheDocument();
	});

	it("removes a tag via its remove button", async () => {
		render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
		const tagInput = screen.getByPlaceholderText("Example: production");
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
			screen.getByRole("button", { name: "Create monitor" }),
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
		const expected = screen.getByLabelText("Expected Status");
		const [timeout, threshold] = screen.getAllByRole("spinbutton");
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
			screen.getByRole("button", { name: "Create monitor" }),
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
			screen.getByRole("button", { name: "Create monitor" }),
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
			screen.getByRole("button", { name: "Create monitor" }),
		).toBeDisabled();
	});
});


describe("safe reuse drafts", () => {
  it("uses the create-from-template title and leaves the name empty until a URL is entered", () => {
    render(<MonitorCreateDialog open fromTemplate initial={{ name: "Saved template", needsRequestValues: false, configuration: { method: "GET", expectedStatus: 200, timeout: 10000, interval: 300, failureThreshold: 3, tags: [] } }} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "templates.createTitle" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("starts with non-secret defaults, requires a new URL and explicitly creates an independent monitor", async () => {
    mutateAsync.mockResolvedValue({ uptimeMonitorId: "new" });
    render(<MonitorCreateDialog open onOpenChange={vi.fn()} initial={{ name: "Health copy", needsRequestValues: true, configuration: { method: "POST", expectedStatus: 201, timeout: 12000, interval: 600, failureThreshold: 2, tags: ["prod"], httpAssertions: [{ type: "json", path: "$.ready", op: "equals", value: true }], channelIds: ["owned-channel"] } }} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Health copy");
    expect(screen.getByLabelText("URL")).toHaveValue("");
    expect(screen.getByText("templates.reentry")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("URL"), "https://new.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: "Health copy", url: "https://new.invalid/", method: "POST", expectedStatus: 201, timeout: 12000, interval: 600, failureThreshold: 2, tags: ["prod"], channelIds: ["owned-channel"], httpAssertions: [{ type: "json", path: "$.ready", op: "equals", value: true }] })));
    expect(mutateAsync.mock.calls[0]?.[0]).not.toHaveProperty("requestConfig");
  });
});


describe("template editor creates no checks", () => {
  it("retains an edited template when save fails, then saves the same input on retry", async () => {
    const onOpenChange = vi.fn(); const onSaved = vi.fn();
    const draft = { name: "Existing", needsRequestValues: false, configuration: { method: "GET" as const, expectedStatus: 200,
				expectedStatuses: null,
				tlsMonitoringEnabled: true, timeout: 10000, interval: 300, failureThreshold: 3, tags: ["kept"] } };
    saveTemplate.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...draft, id: "saved", name: "Edited" });
    render(<MonitorCreateDialog open onOpenChange={onOpenChange} templateMode templateId="saved" initial={draft} onTemplateSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Edited" } });
    await userEvent.click(screen.getByRole("button", { name: "templates.save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
    expect(onOpenChange).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("Edited");
    await userEvent.click(screen.getByRole("button", { name: "templates.save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveTemplate.mock.calls[1]?.[0]).toEqual(saveTemplate.mock.calls[0]?.[0]);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
  it("saves only allowed configuration without a destination and without creating a monitor", async () => {
    const draft = { name: "Saved API", needsRequestValues: true, configuration: { method: "POST" as const, expectedStatus: 201, timeout: 12000, interval: 600, failureThreshold: 2, tags: ["prod"], httpAssertions: [{ type: "json" as const, path: "$.ready", op: "equals" as const, value: true }], channelIds: ["owned-channel"] } };
    const onSaved = vi.fn(); saveTemplate.mockResolvedValue({ ...draft, id: "saved" });
    render(<MonitorCreateDialog open onOpenChange={vi.fn()} templateMode templateId="saved" initial={draft} onTemplateSaved={onSaved} />);
    expect(screen.queryByLabelText("URL")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "http.test" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "templates.save" }));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: "saved", name: "Saved API", needsRequestValues: true, configuration: expect.objectContaining({ method: "POST", channelIds: ["owned-channel"] }) })));
    expect(saveTemplate.mock.calls[0]?.[0].configuration).not.toHaveProperty("url");
    expect(saveTemplate.mock.calls[0]?.[0].configuration).not.toHaveProperty("requestConfig");
    expect(mutateAsync).not.toHaveBeenCalled(); expect(onSaved).toHaveBeenCalled();
  });
});

it("preserves the Quick Add draft and never replaces an edited name as the URL changes", async () => {
	render(<MonitorCreateDialog open onOpenChange={vi.fn()} quickDraft={{ url: "https://first.invalid", name: "Kept name" }} />);
	expect(screen.getByLabelText("Name")).toHaveValue("Kept name");
	fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://second.invalid" } });
	expect(screen.getByLabelText("Name")).toHaveValue("Kept name");
});

it("suggests the hostname until the name is edited, including an intentional empty draft", async () => {
	render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
	fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://first.invalid" } });
	expect(screen.getByLabelText("Name")).toHaveValue("first.invalid");
	fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
	fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://second.invalid" } });
	expect(screen.getByLabelText("Name")).toHaveValue("");
});

it("keeps millisecond timeout precision and rejects missing required numeric values", async () => {
	mutateAsync.mockResolvedValue({ uptimeMonitorId: "precision" });
	render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
	await fillRequired();
	fireEvent.change(screen.getByLabelText("Timeout"), { target: { value: "1234" } });
	await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
	expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ timeout: 1234 }));
	mutateAsync.mockClear();
	await fillRequired();
	fireEvent.change(screen.getByLabelText("Expected Status"), { target: { value: "" } });
	await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
	expect(mutateAsync).not.toHaveBeenCalled();
});


it.each(["", "not a url"])("keeps invalid URL %j inline and uses the shared summary focus path", async value => {
  render(<MonitorCreateDialog open onOpenChange={vi.fn()} />);
  const url = screen.getByLabelText("URL");
  const scroll = vi.spyOn(url, "scrollIntoView");
  if (value) await userEvent.type(url, value);
  await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
  await waitFor(() => expect(url).toHaveFocus());
  expect(url).toHaveAttribute("aria-invalid", "true");
  expect(url).toHaveClass("aria-invalid:border-destructive");
  const inline = url.parentElement!.querySelector("p[role=alert]");
  expect(inline).toHaveTextContent(value ? "creation.invalidUrl" : "nav.requiredField");
  expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  expect(url.getAttribute("aria-describedby")?.split(" ")).toContain(inline!.id);
  const summaryLink = screen.getByRole("link", { name: /^URL:/ });
  await userEvent.click(screen.getByLabelText("Name"));
  await userEvent.click(summaryLink);
  expect(url).toHaveFocus();
  expect(mutateAsync).not.toHaveBeenCalled();
});

it("shows safe channel destinations with identifiers only in tooltips", () => {
  render(<MonitorCreateDialog open onOpenChange={vi.fn()} templateMode channelOptions={[{ id: "private-row-id", type: "webhook", monitorId: null, destination: "hooks.example.com" }]} />);
  const choice = screen.getByRole("checkbox", { name: /hooks.example.com/ });
  expect(choice.closest("label")).not.toHaveTextContent("private-row-id");
  expect(screen.getByTitle("private-row-id")).toHaveTextContent("hooks.example.com");
});
