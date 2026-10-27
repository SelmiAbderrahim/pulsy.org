import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorBulkAddDialog } from "./monitor-bulk-add-dialog";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/hooks/uptime/useUptimeMonitors", () => ({ useUptimeMonitors: () => ({ data: [] }) }));

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
	vi.clearAllMocks();
	useCreateUptimeMonitorsBulk.mockReturnValue({ mutateAsync, isPending: false });
});

function typeUrls(text: string) {
	const textarea = screen.getByLabelText("URLs");
	// Use fireEvent to set the multi-line value in one shot.
	fireEvent.change(textarea, { target: { value: text } });
}

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

	it("accepts space-separated URLs in one paste", () => {
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		typeUrls("https://space-a.com https://space-b.com");
		expect(screen.getByText("2 valid, 0 skipped")).toBeInTheDocument();
	});

	it("keeps all invalid lines inspectable in the bounded preview", () => {
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
			screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ }),
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
			screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ }),
		);
		await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
		expect(mutateAsync).toHaveBeenCalledWith([
			expect.objectContaining({ name: "a.com", url: "https://a.com/", method: "GET", tags: undefined }),
			expect.objectContaining({ name: "b.com", url: "https://b.com/" }),
		]);
		expect(toastSuccess).toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("includes shared tags in every monitor", async () => {
		mutateAsync.mockResolvedValue([]);
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		typeUrls("https://a.com");
		await userEvent.type(screen.getByLabelText("Tags"), "prod{Enter}");
		await userEvent.click(
			screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ }),
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
			screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("bulk fail"));
	});

	it("does not submit when there are zero valid URLs", () => {
		render(<MonitorBulkAddDialog open onOpenChange={vi.fn()} />);
		expect(
			screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ }),
		).toBeDisabled();
		// Submitting directly hits the `validCount === 0` early return.
		const submitButton = screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ });
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
		const submitButton = screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ });
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
			screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ }),
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
			screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ }),
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
    const timeout = screen.getByLabelText("Timeout");
    const threshold = screen.getByLabelText("Threshold");
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
			screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ }),
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

	it("closes via Cancel and disables submit while pending", async () => {
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
		expect(
			screen.getByRole("button", { name: /^Add(?: \d+)? monitors?$/ }),
		).toBeDisabled();
	});
});
