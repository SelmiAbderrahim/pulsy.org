import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorBulkAddDialog, parseUrls } from "./monitor-bulk-add-dialog";

vi.mock("react-i18next", () => reactI18nextMock());
const existingMonitors = vi.hoisted(() => ({ data: [] as Array<{ url: string; name: string }> }));
vi.mock("@/hooks/uptime/useUptimeMonitors", () => ({ useUptimeMonitors: () => existingMonitors }));

const mutateAsync = vi.fn();
const useCreateUptimeMonitorsBulk = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useCreateUptimeMonitorsBulk: () => useCreateUptimeMonitorsBulk(),
}));



const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
	toast: {
		success: (m: unknown) => toastSuccess(m),
		error: (m: unknown) => toastError(m),
	},
}));

beforeEach(() => {
	vi.clearAllMocks(); existingMonitors.data = [];
	useCreateUptimeMonitorsBulk.mockReturnValue({ mutateAsync, isPending: false });
});

function typeUrls(text: string) {
	const textarea = screen.getByLabelText("URLs");
	// Use fireEvent to set the multi-line value in one shot.
	fireEvent.change(textarea, { target: { value: text } });
}

it("clears confirmed discarded URLs and settings before reopening", async () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(<MonitorBulkAddDialog open onOpenChange={onOpenChange} />);
  typeUrls("https://discarded.example.com");
  fireEvent.change(screen.getByLabelText("Timeout"), { target: { value: "5000" } });
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "actions.discard" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  rerender(<MonitorBulkAddDialog open={false} onOpenChange={onOpenChange} />);
  rerender(<MonitorBulkAddDialog open onOpenChange={onOpenChange} />);
  expect(screen.getByLabelText("URLs")).toHaveValue("");
  expect(screen.getByLabelText("Timeout")).toHaveValue(10000);
  expect(screen.getByRole("button", { name: "Add monitors" })).toBeDisabled();
  
});

it("links malformed statuses and missing numeric fields in the same validation summary", async () => {
  render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
  typeUrls("https://valid.example.com");
  const status = screen.getByLabelText("Expected Status"), timeout = screen.getByLabelText("Timeout");
  fireEvent.change(status, { target: { value: "bad" } });
  fireEvent.change(timeout, { target: { value: "" } });
  await userEvent.click(screen.getByRole("button", { name: "Add 1 monitor" }));
  expect(screen.getByRole("link", { name: /^Expected Status:/ })).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /^Timeout:/ });
  expect(status).toHaveFocus();
  await userEvent.click(link); expect(timeout).toHaveFocus();
  expect(mutateAsync).not.toHaveBeenCalled();
});

describe("MonitorBulkAddDialog URL parsing", () => {
	it("parses valid URLs, collapses duplicates, and flags invalid lines", () => {
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		typeUrls(
			[
				"https://a.com",
				"https://a.com", // duplicate
				"  ", // blank → ignored
				"notaurl", // invalid
				"https://b.com/health",
			].join("\n"),
		);
		// 2 valid, 2 skipped (1 dup + 1 invalid)
		expect(screen.getByText("2 valid, 2 skipped")).toBeInTheDocument();
		expect(screen.getAllByText(/bulkUX.invalid/)).toHaveLength(1);
		expect(screen.getByText("notaurl")).toBeInTheDocument();
	});

	it("preserves OSS space-separated paste support with a preview entry for each URL", () => {
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		typeUrls("https://space-a.com https://space-b.com");
		expect(screen.getByText("2 valid, 0 skipped")).toBeInTheDocument();
	});

	it("reports duplicate-of-line separately from an existing monitor", () => {
		existingMonitors.data = [{ url: "https://existing.example/", name: "Existing" }];
		const parsed = parseUrls("https://new.example\nhttps://new.example\nhttps://existing.example", existingMonitors.data);
		expect(parsed.entries).toEqual(expect.arrayContaining([
			expect.objectContaining({ line: 2, state: "duplicate", duplicateLine: 1 }),
			expect.objectContaining({ line: 3, state: "duplicate", duplicateName: "Existing", duplicateLine: undefined }),
		]));
	});

	it("keeps every invalid input inspectable in the bounded preview", () => {
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		const invalids = Array.from({ length: 10 }, (_v, i) => `bad${i}`);
		typeUrls(invalids.join("\n"));
		for (const value of invalids) expect(screen.getByText(value)).toBeInTheDocument();
	});

	it("disables submit and shows a tooMany warning beyond the cap", () => {
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		const many = Array.from(
			{ length: 51 },
			(_v, i) => `https://host${i}.com`,
		).join("\n");
		typeUrls(many);
		expect(screen.getByText("Maximum 50 URLs at once")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Add 51 monitors/ }),
		).toBeDisabled();
	});
});

describe("MonitorBulkAddDialog submit", () => {
	it("creates monitors derived from the URLs and closes", async () => {
		mutateAsync.mockResolvedValue([{ uptimeMonitorId: "1" }]);
		const onOpenChange = vi.fn();
		render(<MonitorBulkAddDialog open onOpenChange={onOpenChange} />);
		typeUrls("https://a.com\nhttps://b.com");
		await userEvent.click(
			screen.getByRole("button", { name: /Add 2 monitors/ }),
		);
		await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
		expect(mutateAsync).toHaveBeenCalledWith([
			expect.objectContaining({ name: "a.com", url: "https://a.com/", method: "GET", tags: undefined }),
			expect.objectContaining({ name: "b.com", url: "https://b.com/" }),
		]);
		expect(toastSuccess).toHaveBeenCalled();
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});

	it("includes shared tags in every monitor", async () => {
		mutateAsync.mockResolvedValue([]);
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		typeUrls("https://a.com");
		await userEvent.type(screen.getByLabelText("Tags"), "prod{Enter}");
		await userEvent.click(
			screen.getByRole("button", { name: /Add 1 monitor/ }),
		);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith([
				expect.objectContaining({ tags: ["prod"] }),
			]),
		);
	});

	it("shows an error toast on failure", async () => {
		mutateAsync.mockRejectedValue(new Error("bulk fail"));
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		typeUrls("https://a.com");
		await userEvent.click(
			screen.getByRole("button", { name: /Add 1 monitor/ }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("bulk fail"));
	});

	it("does not submit when there are zero valid URLs", () => {
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		expect(
			screen.getByRole("button", { name: /Add monitors/ }),
		).toBeDisabled();
		// Submitting directly hits the `validCount === 0` early return.
		const submitButton = screen.getByRole("button", { name: /Add monitors/ });
		const form = submitButton.closest("form");
		if (!form) throw new Error("Bulk add form not found");
		fireEvent.submit(form);
		expect(mutateAsync).not.toHaveBeenCalled();
	});

	it("does not submit when the URL count exceeds the cap", () => {
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		typeUrls(
			Array.from({ length: 51 }, (_v, i) => `https://host${i}.com`).join("\n"),
		);
		// Submitting directly hits the `tooMany` early return.
		const submitButton = screen.getByRole("button", { name: /Add 51 monitors/ });
		const form = submitButton.closest("form");
		if (!form) throw new Error("Bulk add form not found");
		fireEvent.submit(form);
		expect(mutateAsync).not.toHaveBeenCalled();
	});
});

describe("MonitorBulkAddDialog tags & controls", () => {
	it("removes a tag via its remove button", async () => {
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		await userEvent.type(screen.getByLabelText("Tags"), "gone{Enter}");
		expect(screen.getByText("gone")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Remove gone" }));
		expect(screen.queryByText("gone")).not.toBeInTheDocument();
	});

	it("changes the interval via the select", async () => {
		mutateAsync.mockResolvedValue([]);
			render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
			typeUrls("https://a.com");
			const comboboxes = screen.getAllByRole("combobox");
			const intervalSelect = comboboxes[1];
			if (!intervalSelect) throw new Error("Interval select not found");
			await userEvent.click(intervalSelect);
		await userEvent.click(screen.getByRole("option", { name: "1 minute" }));
		await userEvent.click(
			screen.getByRole("button", { name: /Add 1 monitor/ }),
		);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith([
				expect.objectContaining({ interval: 60 }),
			]),
		);
	});

	it("changes the HTTP method via the select", async () => {
		mutateAsync.mockResolvedValue([]);
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		typeUrls("https://a.com");
		const [methodSelect] = screen.getAllByRole("combobox");
		if (!methodSelect) throw new Error("Method select not found");
		await userEvent.click(methodSelect);
		await userEvent.click(screen.getByRole("option", { name: "HEAD" }));
		await userEvent.click(
			screen.getByRole("button", { name: /Add 1 monitor/ }),
		);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith([
				expect.objectContaining({ method: "HEAD" }),
			]),
		);
	});

	it("edits the numeric fields", async () => {
		mutateAsync.mockResolvedValue([]);
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		typeUrls("https://a.com");
		const expected = screen.getByLabelText("Expected Status");
		const [timeout, threshold] = screen.getAllByRole("spinbutton");
		if (!expected || !timeout || !threshold) {
			throw new Error("Bulk add numeric fields not found");
		}
		await userEvent.clear(expected);
		await userEvent.type(expected, "204");
		await userEvent.clear(timeout);
		await userEvent.type(timeout, "8000");
		await userEvent.clear(threshold);
		await userEvent.type(threshold, "4");
		await userEvent.click(
			screen.getByRole("button", { name: /Add 1 monitor/ }),
		);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith([
				expect.objectContaining({
					expectedStatus: 204,
					timeout: 8000,
					failureThreshold: 4,
				}),
			]),
		);
	});

	it("confirms Cancel with a draft and disables submit while pending", async () => {
		useCreateUptimeMonitorsBulk.mockReturnValue({
			mutateAsync,
			isPending: true,
		});
		const onOpenChange = vi.fn();
		render(<MonitorBulkAddDialog open onOpenChange={onOpenChange} />);
		typeUrls("https://a.com");
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "actions.discard" }));
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    
		expect(screen.getByRole("button", { name: "Add monitors" })).toBeDisabled();
	});
});

it("matches the probed HTTP boundary and preserves line numbers and duplicate normalization", () => {
  const parsed = parseUrls("https://valid.invalid\n\nhttps://valid.invalid/ ftp://unsupported.invalid\nhttp://user:password@private.invalid\nnot-a-url");
  expect(parsed.valid).toEqual([{ url: "https://valid.invalid/", name: "valid.invalid" }]);
  expect(parsed.entries.map(({ line, state }) => ({ line, state }))).toEqual([{ line: 1, state: "valid" }, { line: 3, state: "duplicate" }, { line: 3, state: "unsupported" }, { line: 4, state: "invalid" }, { line: 5, state: "invalid" }]);
  expect(parsed.lineCount).toBe(5);

});

	it("does not ask to confirm when the entered URLs were removed again", async () => {
		const onOpenChange = vi.fn();
		render(<MonitorBulkAddDialog open onOpenChange={onOpenChange} />);
		typeUrls("https://a.com\nhttps://b.com");
		typeUrls("");
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		
	});

	it("still confirms when a different set of URLs remains", () => {
		const onOpenChange = vi.fn();
		render(<MonitorBulkAddDialog open onOpenChange={onOpenChange} />);
		typeUrls("https://a.com");
		typeUrls("https://b.com");
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
		expect(onOpenChange).not.toHaveBeenCalled();
		
	});

it("normalizes bare domains and reports named duplicates from the account and the batch", () => {
  const result = parseUrls("example.com/api/\nnew.example.com\nhttps://new.example.com/", [{ url: "https://example.com/api", name: "Production API" }]);
  expect(result.valid).toEqual([{ url: "https://new.example.com/", name: "new.example.com" }]);
  expect(result.entries[0]).toMatchObject({ state: "duplicate", duplicateName: "Production API" });
  expect(result.entries[2]).toMatchObject({ state: "duplicate", duplicateName: "new.example.com" });
});

it("updates the disabled empty label to singular and plural submit labels", () => {
  render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
  expect(screen.getByRole("dialog")).toHaveClass("max-w-[var(--dialog-standard)]");
  expect(screen.getByRole("button", { name: "Add monitors" })).toBeDisabled();
  typeUrls("https://one.example.com");
  expect(screen.getByRole("button", { name: "Add 1 monitor" })).toBeEnabled();
  typeUrls("https://one.example.com\nhttps://two.example.com\nhttps://three.example.com");
  expect(screen.getByRole("button", { name: "Add 3 monitors" })).toBeEnabled();
  expect(screen.getByLabelText("URLs").getAttribute("placeholder")).toMatch(/^Example: /);
  expect(screen.getByLabelText("Tags")).toHaveAttribute("placeholder", "Example: production");
});
