import { UptimeService } from "@/services/uptime/uptimeService";
import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { registerConfirmationHandler } from "@/lib/confirmation";
import { afterEach as afterConfirmationTest } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { MonitorList } from "./monitor-list";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: { children?: unknown }) => {
		const { to, params, ...rest } = props as Record<string, unknown>;
		void to;
		void params;
		return <a {...(rest as object)}>{children as never}</a>;
	},
	useNavigate: () => navigateMock,
}));

const deleteMutateAsync = vi.fn();
const toggleMutateAsync = vi.fn();
const checkNowMutateAsync = vi.fn();
const deleteMultiple = vi.fn();
const setActiveMultiple = vi.fn();
const bulkState = { isProcessing: false };

const createShareLinkMutateAsync = vi.fn();
const bulkUpdateSettingsMutateAsync = vi.fn();

vi.mock("@/hooks/uptime", () => ({
	useDeleteUptimeMonitor: () => ({
		mutateAsync: deleteMutateAsync,
		isPending: false,
	}),
	useToggleUptimeMonitor: () => ({
		mutateAsync: toggleMutateAsync,
		isPending: false,
	}),
	useCheckNow: () => ({ mutateAsync: checkNowMutateAsync, isPending: false }),
	useBulkUptimeActions: () => ({
		deleteMultiple,
		setActiveMultiple,
		isProcessing: bulkState.isProcessing,
	}),
	// Used by the ShareMonitorsDialog rendered inside MonitorList.
	useCreateUptimeShareLink: () => ({
		mutateAsync: createShareLinkMutateAsync,
		isPending: false,
	}),
	// Used by the BulkEditSettingsDialog rendered inside MonitorList.
	useBulkUpdateUptimeSettings: () => ({
		mutateAsync: bulkUpdateSettingsMutateAsync,
		isPending: false,
	}),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("@/lib/toast", () => ({
	toast: {
		success: (m: unknown) => toastSuccess(m),
		error: (m: unknown) => toastError(m),
		warning: (m: unknown) => toastWarning(m),
	},
}));

function monitor(overrides: Partial<UptimeMonitor> = {}): UptimeMonitor {
	return {
		uptimeMonitorId: "m1",
		name: "Alpha",
		url: "https://a.com",
		status: "up",
		active: true,
		interval: 300,
		responseTime: 120,
		uptimePercentage: 99.5,
		lastCheckedAt: "2024-01-01T00:00:00Z",
		tags: [],
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
  vi.spyOn(UptimeService, "previewShareLink").mockImplementation(async ids => ids.map(id => ({ uptimeMonitorId: id, name: id, url: "https://example.invalid/", method: "GET", expectedStatus: 200, timeout: 10000, interval: 300, failureThreshold: 3, tags: [] })));
	bulkState.isProcessing = false;
	confirmationDecision.mockResolvedValue(true);
});

describe("MonitorList rendering", () => {
	it("shows the empty state with no monitors", () => {
		const onCreate = vi.fn();
		render(<MonitorList monitors={[]} onCreateMonitor={onCreate} />);
		expect(
			screen.getByText("Start monitoring your services"),
		).toBeInTheDocument();
	});

	it("uses a no-op create handler when none is provided", async () => {
		// Exercises the `onCreateMonitor ?? (() => {})` fallback.
		render(<MonitorList monitors={[]} />);
		await userEvent.click(
			screen.getByRole("button", { name: "Add your first monitor" }),
		);
		// No throw → the fallback handler ran.
		expect(
			screen.getByText("Start monitoring your services"),
		).toBeInTheDocument();
	});

	it("renders a row per monitor with status badges and formatted cells", () => {
		render(
			<MonitorList
				monitors={[
					monitor({ uptimeMonitorId: "1", name: "Up", status: "up" }),
					monitor({
						uptimeMonitorId: "2",
						name: "Down",
						status: "down",
						responseTime: null,
						uptimePercentage: null,
						lastCheckedAt: null,
						active: false,
					}),
					monitor({
						uptimeMonitorId: "3",
						name: "Degraded",
						status: "degraded",
					}),
						monitor({
							uptimeMonitorId: "4",
							name: "Pending",
							status: "queued" as unknown as UptimeMonitor["status"],
						}),
				]}
			/>,
		);
		// Status badge labels (rendered inside <div> badges, distinct from the
		// monitor name links/cells).
		for (const badge of screen.getAllByText("Up", { selector: "div.inline-flex" })) expect(badge).toBeInTheDocument();
		for (const badge of screen.getAllByText("Degraded", { selector: "div.inline-flex" })) expect(badge).toBeInTheDocument();
		for (const badge of screen.getAllByText("Pending", { selector: "div.inline-flex" })) expect(badge).toBeInTheDocument();
		// An inactive monitor displays Paused even when its last observation was Down.
		expect(screen.getByText("Down")).toBeInTheDocument();
 for (const badge of screen.getAllByText("status.paused")) expect(badge).toBeInTheDocument();
		// dash fallbacks for the down monitor
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
	});

	it("adds a tag to the multi-select filter", async () => {
		const onTagsChange = vi.fn();
		render(
			<MonitorList
				monitors={[
					monitor({ uptimeMonitorId: "1", name: "A", tags: ["prod"] }),
					monitor({ uptimeMonitorId: "2", name: "B", tags: ["staging"] }),
				]}
				selectedTags={["staging"]}
				onTagsChange={onTagsChange}
			/>,
		);
		const filterBar = screen.getByText("Filter by tag:")
			.parentElement as HTMLElement;
		await userEvent.click(within(filterBar).getByText("prod"));
		// Union add — staging kept, prod appended.
		expect(onTagsChange).toHaveBeenCalledWith(["staging", "prod"]);
	});

	it("filters by any selected tag (union) and removes/clears tags", async () => {
		const onTagsChange = vi.fn();
		render(
			<MonitorList
				monitors={[
					monitor({ uptimeMonitorId: "1", name: "A", tags: ["prod"] }),
					monitor({ uptimeMonitorId: "2", name: "B", tags: ["staging"] }),
					monitor({ uptimeMonitorId: "3", name: "C", tags: ["other"] }),
				]}
				selectedTags={["prod", "staging"]}
				onTagsChange={onTagsChange}
			/>,
		);
		// Union: A and B shown, C hidden.
		expect(screen.getByText("A")).toBeInTheDocument();
		expect(screen.getByText("B")).toBeInTheDocument();
		expect(screen.queryByText("C")).not.toBeInTheDocument();
		// Clicking an active tag removes just that tag.
		const filterBar = screen.getByText("Filter by tag:")
			.parentElement as HTMLElement;
		await userEvent.click(within(filterBar).getByText("prod"));
		expect(onTagsChange).toHaveBeenCalledWith(["staging"]);
		// Clear-filter empties the whole selection.
		await userEvent.click(screen.getByRole("button", { name: /Clear filter/ }));
		expect(onTagsChange).toHaveBeenCalledWith([]);
	});

	it("filters rows by the search query", () => {
		render(
			<MonitorList
				monitors={[
					monitor({ uptimeMonitorId: "1", name: "Alpha", url: "https://a.com" }),
					monitor({ uptimeMonitorId: "2", name: "Beta", url: "https://b.com" }),
				]}
				searchQuery="alpha"
			/>,
		);
		expect(screen.getByText("Alpha")).toBeInTheDocument();
		expect(screen.queryByText("Beta")).not.toBeInTheDocument();
	});

	it("shows a no-match message when the search excludes every monitor", () => {
		render(
			<MonitorList
				monitors={[monitor({ uptimeMonitorId: "1", name: "Alpha" })]}
				searchQuery="zzz"
			/>,
		);
		expect(
			screen.getByText("No monitors match your filters."),
		).toBeInTheDocument();
		expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
	});
});

describe("MonitorList sorting, density, and navigation", () => {
	it("cycles the sort when a column header is clicked", async () => {
		const onSortChange = vi.fn();
		render(<MonitorList monitors={[monitor()]} onSortChange={onSortChange} />);
		await userEvent.click(
			screen.getByRole("button", { name: "Sort by Status" }),
		);
		expect(onSortChange).toHaveBeenCalledWith("status");
	});

	it("marks a descending sorted column with aria-sort", () => {
		render(
			<MonitorList
				monitors={[monitor()]}
				sort="response"
				dir="desc"
				onSortChange={vi.fn()}
			/>,
		);
		const header = screen.getByRole("columnheader", { name: /Last response/ });
		expect(header).toHaveAttribute("aria-sort", "descending");
	});

	it("marks an ascending sorted column with aria-sort (up chevron)", () => {
		render(
			<MonitorList
				monitors={[monitor()]}
				sort="name"
				dir="asc"
				onSortChange={vi.fn()}
			/>,
		);
		const header = screen.getByRole("columnheader", { name: /Name/ });
		expect(header).toHaveAttribute("aria-sort", "ascending");
	});

	it("shows the active status-filter banner and clears it", async () => {
		const onStatusChange = vi.fn();
		render(
			<MonitorList
				monitors={[
					monitor({ uptimeMonitorId: "1", name: "DownOne", status: "down" }),
					monitor({ uptimeMonitorId: "2", name: "UpOne", status: "up" }),
				]}
				selectedStatus="down"
				onStatusChange={onStatusChange}
			/>,
		);
		expect(screen.getByText("Filter by status:")).toBeInTheDocument();
		// Only the down monitor passes the status filter.
		expect(screen.getByText("DownOne")).toBeInTheDocument();
		expect(screen.queryByText("UpOne")).not.toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "Clear status filter" }),
		);
		expect(onStatusChange).toHaveBeenCalledWith(undefined);
	});

	it("renders plain (non-button) headers when sorting is unavailable", () => {
		render(<MonitorList monitors={[monitor()]} />);
		expect(
			screen.queryByRole("button", { name: "Sort by Name" }),
		).not.toBeInTheDocument();
	});

	it("shows a collecting placeholder when uptime has no data yet", () => {
		render(<MonitorList monitors={[monitor({ uptimePercentage: null })]} />);
		expect(screen.getByText("metrics.noData")).toBeInTheDocument();
	});

	it("hides the url in compact density", () => {
		render(
			<MonitorList
				monitors={[monitor({ url: "https://hidden.example" })]}
				dense
			/>,
		);
		expect(
			screen.queryByText("https://hidden.example"),
		).not.toBeInTheDocument();
	});

	it("navigates to the detail page when a non-interactive cell is clicked", async () => {
		render(
			<MonitorList
				monitors={[monitor({ uptimeMonitorId: "m9", name: "Zed" })]}
			/>,
		);
		await userEvent.click(screen.getAllByText("Up", { selector: "div.inline-flex" })[0]!);
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/dashboard/uptime/$monitorId",
			params: { monitorId: "m9" },
		});
	});

	it("does not navigate when a row action button is clicked", async () => {
		checkNowMutateAsync.mockResolvedValue(undefined);
		render(<MonitorList monitors={[monitor()]} />);
		await userEvent.click(screen.getByRole("button", { name: "Check now — Alpha" }));
		expect(navigateMock).not.toHaveBeenCalled();
	});
});

describe("MonitorList row actions", () => {
	it("checks now, toggles, and deletes a monitor with success toasts", async () => {
		deleteMutateAsync.mockResolvedValue(undefined);
		toggleMutateAsync.mockResolvedValue(undefined);
		checkNowMutateAsync.mockResolvedValue(undefined);
		render(<MonitorList monitors={[monitor()]} />);

		await userEvent.click(screen.getByRole("button", { name: "Check now — Alpha" }));
		await waitFor(() => expect(checkNowMutateAsync).toHaveBeenCalled());

		await rowAction("Disable");
		await waitFor(() => expect(toggleMutateAsync).toHaveBeenCalled());

		await rowAction("Delete monitor");
		await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalled());
		expect(toastSuccess).toHaveBeenCalled();
	});

	it("aborts delete when confirm is declined", async () => {
		confirmationDecision.mockResolvedValue(false);
		render(<MonitorList monitors={[monitor()]} />);
		await rowAction("Delete monitor");
		expect(deleteMutateAsync).not.toHaveBeenCalled();
	});

	it("shows the Enable label and toggles an inactive monitor", async () => {
		toggleMutateAsync.mockResolvedValue(undefined);
		render(<MonitorList monitors={[monitor({ active: false })]} />);
		await rowAction("Enable");
		await waitFor(() => expect(toggleMutateAsync).toHaveBeenCalled());
		expect(toastSuccess).toHaveBeenCalled();
	});

	it("surfaces errors from each row action", async () => {
		checkNowMutateAsync.mockRejectedValue(new Error("check fail"));
		toggleMutateAsync.mockRejectedValue(new Error("toggle fail"));
		deleteMutateAsync.mockRejectedValue(new Error("delete fail"));
		render(<MonitorList monitors={[monitor()]} />);
		await userEvent.click(screen.getByRole("button", { name: "Check now — Alpha" }));
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("check fail"),
		);
		await rowAction("Disable");
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("toggle fail"),
		);
		await rowAction("Delete monitor");
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("delete fail"),
		);
	});
});

describe("MonitorList bulk selection", () => {
	async function selectFirstRow() {
		// The first row checkbox carries the monitor name as its label.
		const rowCheckbox = screen.getByRole("checkbox", { name: "Alpha" });
		await userEvent.click(rowCheckbox);
	}

	it("toggles all via the header checkbox and shows the toolbar", async () => {
		render(
			<MonitorList
				monitors={[
					monitor({ uptimeMonitorId: "1", name: "Alpha" }),
					monitor({ uptimeMonitorId: "2", name: "Beta" }),
				]}
			/>,
		);
		await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
		expect(screen.getByRole("toolbar")).toBeInTheDocument();
		expect(screen.getByText("2 selected")).toBeInTheDocument();
	});

	it("bulk deletes selected monitors (all succeed)", async () => {
		deleteMultiple.mockResolvedValue({ successful: ["m1"], failed: [] });
		render(<MonitorList monitors={[monitor()]} />);
		await selectFirstRow();
		await toolbarAction(/Delete \(1\)/);
		// Confirm dialog: type DELETE 1
		const input = await screen.findByPlaceholderText("DELETE 1");
		await userEvent.type(input, "DELETE 1");
		await userEvent.click(
			screen.getByRole("button", { name: "Delete 1 monitor" }),
		);
		await waitFor(() => expect(deleteMultiple).toHaveBeenCalledWith(["m1"]));
		expect(toastSuccess).toHaveBeenCalled();
	});

	it("reports a partial bulk delete with a warning toast", async () => {
		deleteMultiple.mockResolvedValue({
			successful: ["m1"],
			failed: [{ id: "m2", error: new Error("x") }],
		});
		render(
			<MonitorList
				monitors={[
					monitor({ uptimeMonitorId: "m1", name: "Alpha", status: "down" }),
					monitor({ uptimeMonitorId: "m2", name: "Beta", status: "down" }),
				]}
			/>,
		);
		await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
		await toolbarAction(/Delete \(2\)/);
		const input = await screen.findByPlaceholderText("DELETE 2");
		await userEvent.type(input, "DELETE 2");
		await userEvent.click(
			screen.getByRole("button", { name: "Delete 2 monitors" }),
		);
		await waitFor(() => expect(toastWarning).toHaveBeenCalled());
	});

	it("reports a fully failed bulk delete with an error toast", async () => {
		deleteMultiple.mockResolvedValue({
			successful: [],
			failed: [{ id: "m1", error: new Error("x") }],
		});
		render(<MonitorList monitors={[monitor({ status: "down" })]} />);
		await selectFirstRow();
		await toolbarAction(/Delete \(1\)/);
		const input = await screen.findByPlaceholderText("DELETE 1");
		await userEvent.type(input, "DELETE 1");
		await userEvent.click(
			screen.getByRole("button", { name: "Delete 1 monitor" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalled());
	});

	it("bulk pauses selected active monitors", async () => {
		setActiveMultiple.mockResolvedValueOnce({ successful: ["m1"], failed: [] });
		render(<MonitorList monitors={[monitor()]} />);
		await selectFirstRow();
		const toolbar = screen.getByRole("toolbar");
		await userEvent.click(within(toolbar).getByRole("button", { name: /Pause/ }));
		await waitFor(() =>
			expect(setActiveMultiple).toHaveBeenCalledWith(
				[expect.objectContaining({ uptimeMonitorId: "m1", active: true })],
				false,
			),
		);
		expect(toastSuccess).toHaveBeenCalled();
	});

	it("bulk resumes selected inactive monitors", async () => {
		setActiveMultiple.mockResolvedValueOnce({ successful: ["m1"], failed: [] });
		render(<MonitorList monitors={[monitor({ active: false })]} />);
		await selectFirstRow();
		const toolbar = screen.getByRole("toolbar");
		await userEvent.click(
			within(toolbar).getByRole("button", { name: /Resume/ }),
		);
		await waitFor(() =>
			expect(setActiveMultiple).toHaveBeenCalledWith(
				[expect.objectContaining({ uptimeMonitorId: "m1", active: false })],
				true,
			),
		);
		expect(toastSuccess).toHaveBeenCalled();
	});

	it("reports a failed bulk pause with an error toast", async () => {
		setActiveMultiple.mockResolvedValue({
			successful: [],
			failed: [{ id: "m1", error: new Error("x") }],
		});
		render(<MonitorList monitors={[monitor()]} />);
		await selectFirstRow();
		const toolbar = screen.getByRole("toolbar");
		await userEvent.click(within(toolbar).getByRole("button", { name: /Pause/ }));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
	});

	it("reports a failed bulk resume with an error toast", async () => {
		setActiveMultiple.mockResolvedValue({
			successful: [],
			failed: [{ id: "m1", error: new Error("x") }],
		});
		render(<MonitorList monitors={[monitor({ active: false })]} />);
		await selectFirstRow();
		const toolbar = screen.getByRole("toolbar");
		await userEvent.click(
			within(toolbar).getByRole("button", { name: /Resume/ }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalled());
	});

	it("clears the selection from the toolbar", async () => {
		render(<MonitorList monitors={[monitor()]} />);
		await selectFirstRow();
		const toolbar = screen.getByRole("toolbar");
		await userEvent.click(
			within(toolbar).getByRole("button", { name: /Clear/ }),
		);
		await waitFor(() =>
			expect(screen.queryByRole("toolbar")).not.toBeInTheDocument(),
		);
	});

	it("shows spinners and disables toolbar buttons while processing", async () => {
		bulkState.isProcessing = true;
		render(<MonitorList monitors={[monitor()]} />);
		await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
		const toolbar = screen.getByRole("toolbar");
		expect(toolbar.querySelectorAll(".animate-spin").length).toBe(1);
		expect(
			within(toolbar).getByRole("button", { name: /Pause/ }),
		).toBeDisabled();
		expect(
			within(toolbar).getByRole("button", { name: /More actions/ }),
		).toBeDisabled();
		expect(
			within(toolbar).getByRole("button", { name: /More actions/ }),
		).toBeDisabled();
	});

	it("opens the share dialog from the toolbar with the selected monitors", async () => {
		render(<MonitorList monitors={[monitor()]} />);
		await selectFirstRow();
		const toolbar = screen.getByRole("toolbar");
		await toolbarAction(/Share/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
		expect(
			await screen.findByText("Share 1 monitors"),
		).toBeInTheDocument();
	});

	it("opens the bulk edit dialog and clears the selection after a successful update", async () => {
		bulkUpdateSettingsMutateAsync.mockResolvedValue({ updated: [{}], results: [] });
		render(<MonitorList monitors={[monitor()]} />);
		await selectFirstRow();
		const toolbar = screen.getByRole("toolbar");
		await userEvent.click(
			within(toolbar).getByRole("button", { name: /Edit settings/ }),
		);
		const dialog = await screen.findByRole("dialog");
		// Enable the timeout field (4th field) and apply.
		await userEvent.click(within(dialog).getAllByRole("checkbox")[3]!);
		await userEvent.click(
			within(dialog).getByRole("button", { name: /Apply to 1 monitor/ }),
		);
		expect(bulkUpdateSettingsMutateAsync).toHaveBeenCalledWith({
			monitorIds: ["m1"],
			patch: { timeout: 10000 },
		});
		await waitFor(() =>
			expect(screen.queryByRole("toolbar")).not.toBeInTheDocument(),
		);
	});

	it("clears the selection after a share link was created and the dialog closed", async () => {
		createShareLinkMutateAsync.mockResolvedValue({
			shareLinkId: "s1",
			token: "tok_abc",
			monitorIds: ["m1"],
			createdAt: "2026-06-01T00:00:00.000Z",
			expiresAt: "2026-07-01T00:00:00.000Z",
		});
		render(<MonitorList monitors={[monitor()]} />);
		await selectFirstRow();
		const toolbar = screen.getByRole("toolbar");
		await toolbarAction(/Share/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
		await userEvent.click(
			screen.getByRole("button", { name: "Create link" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Done" }));
		await waitFor(() =>
			expect(screen.queryByRole("toolbar")).not.toBeInTheDocument(),
		);
	});
});

async function rowAction(name: string) { await userEvent.click(screen.getByRole("button", { name: /More actions —/ })); await userEvent.click(screen.getByRole("menuitem", { name })); }
async function toolbarAction(name: RegExp) { await userEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: /More actions —/ })); await userEvent.click(screen.getByRole("menuitem", { name })); }
