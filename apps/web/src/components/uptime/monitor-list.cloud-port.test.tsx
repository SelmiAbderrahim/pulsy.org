import * as confirmations from "@/lib/confirmation";
import { UptimeService } from "@/services/uptime/uptimeService";
import type { ReactElement } from "react";
import { createWrapper } from "@/test/query-wrapper";
import { act, render as renderWithTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { MONITOR_LIST_PAGE_SIZE, MonitorList } from "./monitor-list";

const render = (ui: ReactElement) => renderWithTestingLibrary(ui, { wrapper: createWrapper().Wrapper });
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));

vi.mock("react-i18next", () => reactI18nextMock());

async function rowAction(name: string) {
  await userEvent.click(screen.getByRole("button", { name: /More actions —/ }));
  await userEvent.click(screen.getByRole("menuitem", { name }));
}
async function toolbarAction(name: RegExp) {
  await userEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: /More actions —/ }));
  await userEvent.click(screen.getByRole("menuitem", { name }));
}
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async () => {
  const { forwardRef } = await import("react");
  return {
    Link: forwardRef<HTMLAnchorElement, { children?: unknown }>(({ children, ...props }, ref) => {
      const { to, params, search, ...rest } = props as Record<string, unknown>;
      void to; void params; void search;
      return <a ref={ref} {...rest}>{children as never}</a>;
    }),
    useNavigate: () => navigateMock,
  };
});

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

beforeEach(() => {
  vi.spyOn(UptimeService, "previewShareLink").mockImplementation(async ids => ids.map(id => ({ uptimeMonitorId: id, name: id, url: "https://example.invalid/", method: "GET", expectedStatus: 200, timeout: 10000, interval: 300, failureThreshold: 3, tags: [] })));
	vi.clearAllMocks();
	bulkState.isProcessing = false;
	vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
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

	it("shows no latency, and the no-response text, for a Down monitor that still carries a time-to-failure", () => {
		const { container } = render(<MonitorList monitors={[monitor({ uptimeMonitorId: "d1", name: "Failing", status: "down", responseTime: 4321, httpStatus: null } as Partial<UptimeMonitor>)]} />);
		expect(container.textContent).not.toMatch(/4[.,\u00a0\u202f ]?321|4[.,]3\d?\s?s\b/);
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
		expect(container.querySelector(".text-success")?.textContent ?? "").not.toMatch(/\d\s?ms/);
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
		for (const badge of screen.getAllByText("Up", { selector: "div" })) expect(badge).toBeInTheDocument();
		for (const badge of screen.getAllByText("Degraded", { selector: "div" })) expect(badge).toBeInTheDocument();
		for (const badge of screen.getAllByText("Pending", { selector: "div" })) expect(badge).toBeInTheDocument();
		// A paused monitor keeps its name but displays Paused in both responsive presentations.
		expect(screen.getAllByText("Down")).toHaveLength(1);
		expect(screen.getAllByText("status.paused").length).toBeGreaterThan(0);
		// dash fallbacks for the down monitor
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
	});

	it("keeps heartbeat arrival facts out of the Response time and check-success cells", () => {
		const heartbeat = (lastReceivedAt: string | null) => ({ lastReceivedAt, expectedAt: "2026-10-10T13:00:00Z", deadlineAt: "2026-10-10T13:01:00Z" });
		render(
			<MonitorList
				monitors={[
					monitor({ uptimeMonitorId: "hb1", name: "Nightly job", monitorType: "heartbeat", url: "", responseTime: null, uptimePercentage: null, heartbeat: heartbeat("2026-10-10T12:00:00Z") } as never),
					monitor({ uptimeMonitorId: "hb2", name: "Never ran", monitorType: "heartbeat", url: "", responseTime: null, uptimePercentage: 50, heartbeat: heartbeat(null) } as never),
				]}
			/>,
		);
		const cellsOf = (name: RegExp) => within(screen.getByRole("row", { name })).getAllByRole("cell");
		const [, identity, , response, success] = cellsOf(/Nightly job/);
		// Arrival facts are labelled identity/status facts…
		expect(identity).toHaveTextContent("heartbeat.received");
		expect(identity).toHaveTextContent("heartbeat.finalDeadline");
		// …never a date under Response time, and never a date where a percentage belongs.
		expect(response).toHaveTextContent("list.notApplicable");
		expect(response).not.toHaveTextContent("heartbeat.");
		expect(success).toHaveTextContent("metrics.noData");
		expect(success).not.toHaveTextContent("heartbeat.");
		expect(success).not.toHaveTextContent(/\d{4}|AM|PM/);
		// A heartbeat that never reported says so instead of an empty value, and a real ratio stays a percentage.
		const [, neverIdentity, , neverResponse, neverSuccess] = cellsOf(/Never ran/);
		expect(neverIdentity).toHaveTextContent("heartbeat.never");
		expect(neverResponse).not.toHaveTextContent("0 ms");
		expect(neverSuccess).toHaveTextContent("50.00%");
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

describe("MonitorList large collections", () => {
	const many = (count: number) => Array.from({ length: count }, (_, i) => monitor({ uptimeMonitorId: `m${i}`, name: `Service ${String(i).padStart(3, "0")}`, url: `https://s${i}.example.invalid` }));

	it("renders six tagged monitors without a viewport height cap and retains horizontal navigation", () => {
		render(<MonitorList monitors={many(6).map((item, index) => ({ ...item, tags: index % 2 ? ["env:qa", "qa-bug"] : ["client,one", "two words"] }))} filtersInToolbar />);
		const table = screen.getByRole("table");
		expect(screen.getAllByRole("row")).toHaveLength(7);
		expect(table).toHaveClass("min-w-[720px]");
		expect(table.parentElement).toHaveAttribute("tabindex", "0");
		expect(table.parentElement).toHaveClass("overflow-auto", "scroll-pt-[var(--header-height)]");
		expect(table.parentElement!.className).not.toMatch(/max-h/);
	});

	// Three complete renders of up to 120 interactive rows need a component-test
	// budget on shared Docker hosts; all pagination and boundary assertions remain.
	it("renders one page of rows, says how many are shown, and adds a page on request", async () => {
		const { container } = render(<MonitorList monitors={many(120)} />);
    const rows = () => container.querySelectorAll("tbody tr");
		expect(rows()).toHaveLength(MONITOR_LIST_PAGE_SIZE);
		expect(screen.getByRole("status")).toHaveTextContent("uptimeMonitor:list.showing");
		await userEvent.click(screen.getByText("uptimeMonitor:list.showMore"));
		expect(rows()).toHaveLength(2 * MONITOR_LIST_PAGE_SIZE);
		await userEvent.click(screen.getByText("uptimeMonitor:list.showMore"));
		expect(rows()).toHaveLength(120);
		expect(screen.queryByText("uptimeMonitor:list.showMore")).not.toBeInTheDocument();
	}, 15_000);

	it("searches every monitor, not only the rendered page", () => {
		render(<MonitorList monitors={many(120)} searchQuery="service 119" />);
		expect(screen.getByText("Service 119")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "uptimeMonitor:list.showMore" })).not.toBeInTheDocument();
	});

	it("shows no pager for a collection that fits on one page", () => {
		render(<MonitorList monitors={many(MONITOR_LIST_PAGE_SIZE)} />);
		expect(screen.queryByRole("button", { name: "uptimeMonitor:list.showMore" })).not.toBeInTheDocument();
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

	it("explains the first-check wait when uptime has no data yet", () => {
		render(<MonitorList monitors={[monitor({ uptimePercentage: null,active:true,lastCheckedAt:null })]} />);
		expect(screen.getByText("Waiting for the first check. Check success appears after a recorded result.")).toBeInTheDocument();
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
		await userEvent.click(screen.getAllByText("Up", { selector: "div" })[0]!);
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/dashboard/uptime/$monitorId",
			params: { monitorId: "m9" },
		});
	});

	it("does not navigate when a row action button is clicked", async () => {
		checkNowMutateAsync.mockResolvedValue(undefined);
		render(<MonitorList monitors={[monitor()]} />);
		await rowAction("Check now");
		expect(navigateMock).not.toHaveBeenCalled();
	});
});

describe("MonitorList row actions", () => {
	it("checks now, toggles, and deletes a monitor with success toasts", async () => {
		deleteMutateAsync.mockResolvedValue(undefined);
		toggleMutateAsync.mockResolvedValue(undefined);
		checkNowMutateAsync.mockResolvedValue(undefined);
		render(<MonitorList monitors={[monitor()]} />);

		await rowAction("Check now");
		await waitFor(() => expect(checkNowMutateAsync).toHaveBeenCalled());

		await rowAction("Disable");
		await waitFor(() => expect(toggleMutateAsync).toHaveBeenCalled());

		await rowAction("Delete monitor");
		await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalled());
		expect(toastSuccess).toHaveBeenCalled();
	});

	it("aborts delete when confirm is declined", async () => {
		vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(false);
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
		await rowAction("Check now");
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
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Alpha" })).not.toBeChecked();
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
    expect(within(toolbar).getByRole("button", { name: /Pause/ })).toBeDisabled();
    expect(within(toolbar).getByRole("button", { name: /More actions —/ })).toBeDisabled();
    expect(within(toolbar).getByRole("button", { name: /Edit settings/ })).toBeDisabled();
	});

	it("opens the share dialog from the toolbar with the selected monitors", async () => {
		render(<MonitorList monitors={[monitor()]} />);
		await selectFirstRow();
		const toolbar = screen.getByRole("toolbar");
		await toolbarAction(/Share/);
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

describe("saved view grouping and explicit bulk IDs", () => {
  it("retains failed IDs after a partial pause and removes only successful selections", async () => {
    setActiveMultiple.mockResolvedValue({ successful: ["m1"], failed: [{ id: "m2", error: new Error("Fixture failure") }] });
    render(<MonitorList monitors={[monitor(), monitor({ uptimeMonitorId: "m2", name: "Beta" })]} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    await userEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Alpha" })).not.toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
    expect(screen.getByRole("toolbar")).toHaveTextContent("1 selected");
  });
  it("requires every selected tag in all mode and keeps case-sensitive semantics", () => {
    const monitors = [monitor({ name: "Both", tags: ["Production", "client:one"] }), monitor({ uptimeMonitorId: "m2", name: "One", tags: ["Production"] })];
    render(<MonitorList monitors={monitors} selectedTags={["Production", "client:one"]} tagMode="all" />);
    expect(screen.getByText("Both")).toBeInTheDocument(); expect(screen.queryByText("One")).not.toBeInTheDocument();
  });
  it("renders separate group memberships while select-all acts on unique monitors", async () => {
    const monitors = [monitor({ tags: ["client:one", "env:production"] }), monitor({ uptimeMonitorId: "m2", name: "Beta", tags: ["client:one"] })];
    render(<MonitorList monitors={monitors} group="tag" />);
    expect(screen.getByText("client:one (2)")).toBeInTheDocument(); expect(screen.getByText("env:production (1)")).toBeInTheDocument();
    expect(screen.getAllByText("Alpha")).toHaveLength(2);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByRole("toolbar")).toHaveTextContent("2 selected");
  });
  it("counts a monitor shown in two groups once and keeps its repeated checkboxes in step", async () => {
    const monitors = [monitor({ tags: ["client:one", "env:production"] }), monitor({ uptimeMonitorId: "m2", name: "Beta", tags: ["client:one"] })];
    render(<MonitorList monitors={monitors} group="tag" />);
    const [first, second] = screen.getAllByRole("checkbox", { name: "Alpha" });
    await userEvent.click(first!);
    expect(screen.getByRole("toolbar")).toHaveTextContent("1 selected");
    expect(first).toBeChecked(); expect(second).toBeChecked();
    await userEvent.click(second!);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(first).not.toBeChecked();
  });
  it("clears hidden selections before a new view can act on them", async () => {
    const monitors = [monitor(), monitor({ uptimeMonitorId: "m2", name: "Beta", tags: ["other"] })];
    const { rerender } = render(<MonitorList monitors={monitors} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    rerender(<MonitorList monitors={monitors} selectedTags={["other"]} />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    rerender(<MonitorList monitors={monitors} />);
    expect(screen.getByRole("checkbox", { name: "Alpha" })).not.toBeChecked();
  });
});

describe("keyboard tag filters", () => {
  it("selects a tag with a native keyboard control", async () => {
    const onTagsChange = vi.fn(); render(<MonitorList monitors={[monitor({ tags: ["Production"] })]} onTagsChange={onTagsChange} />);
    const tag = screen.getByRole("button", { name: "Production" }); tag.focus();
    await userEvent.keyboard(" "); expect(onTagsChange).toHaveBeenCalledWith(["Production"]);
  });
});

describe("combined collection filters", () => {
	const rows = () => [
		monitor({ uptimeMonitorId: "1", name: "Alpha down", status: "down", tags: ["env:prod", "team:a"] }),
		monitor({ uptimeMonitorId: "2", name: "Alpha degraded", status: "degraded", tags: ["env:prod"] }),
		monitor({ uptimeMonitorId: "3", name: "Beta pending", status: "pending", tags: ["env:stage"] }),
		monitor({ uptimeMonitorId: "4", name: "Gamma up", status: "up", tags: ["env:prod", "team:a"] }),
	];
	const names = () => screen.queryAllByRole("row").map(row => row.textContent ?? "");
	it.each([["down", "Alpha down"], ["degraded", "Alpha degraded"], ["pending", "Beta pending"]] as const)("shows only %s monitors for that health filter", (status, expected) => {
		render(<MonitorList monitors={rows()} selectedStatus={status} />);
		expect(screen.getByText(expected)).toBeInTheDocument();
		expect(screen.queryByText("Gamma up")).not.toBeInTheDocument();
	});
	it("applies search, health and tags together, and says so when nothing matches", () => {
		const { rerender } = render(<MonitorList monitors={rows()} searchQuery="alpha" selectedStatus="down" selectedTags={["env:prod"]} />);
		expect(screen.getByText("Alpha down")).toBeInTheDocument(); expect(screen.queryByText("Alpha degraded")).not.toBeInTheDocument();
		rerender(<MonitorList monitors={rows()} searchQuery="gamma" selectedStatus="down" selectedTags={["env:prod"]} />);
		expect(screen.getByText("No monitors match your filters.")).toBeInTheDocument();
	});
	it("any-tag mode is a union and all-tag mode an intersection", () => {
		const { rerender } = render(<MonitorList monitors={rows()} selectedTags={["env:stage", "team:a"]} tagMode="any" />);
		expect(screen.getByText("Beta pending")).toBeInTheDocument(); expect(screen.getByText("Gamma up")).toBeInTheDocument(); expect(screen.queryByText("Alpha degraded")).not.toBeInTheDocument();
		rerender(<MonitorList monitors={rows()} selectedTags={["env:prod", "team:a"]} tagMode="all" />);
		expect(screen.getByText("Alpha down")).toBeInTheDocument(); expect(screen.getByText("Gamma up")).toBeInTheDocument();
		expect(screen.queryByText("Alpha degraded")).not.toBeInTheDocument(); expect(screen.queryByText("Beta pending")).not.toBeInTheDocument();
	});
	it("honours sort direction by name without changing which monitors match", () => {
		const { rerender } = render(<MonitorList monitors={rows()} sort="name" dir="asc" />);
		const asc = names().filter(text => /Alpha|Beta|Gamma/.test(text));
		rerender(<MonitorList monitors={rows()} sort="name" dir="desc" />);
		const desc = names().filter(text => /Alpha|Beta|Gamma/.test(text));
		expect(desc).toHaveLength(asc.length);
		expect(desc[0]).toContain("Gamma"); expect(asc[0]).toContain("Alpha");
	});
});

describe("responsive list geometry", () => {
  it("keeps one recheck slot per row and uses conditional sticky action cells", () => {
    render(<MonitorList monitors={[
      monitor({ name: "HTTP", uptimeMonitorId: "http" }),
      monitor({ name: "Heartbeat", uptimeMonitorId: "heartbeat", monitorType: "heartbeat" }),
      monitor({ name: "Server", uptimeMonitorId: "server", monitorType: "server", status: "pending" }),
    ]} />);
    expect(screen.getByRole("columnheader", { name: "Last checked" })).toHaveClass("xl:table-cell");
    for (const name of ["HTTP", "Heartbeat", "Server"]) {
      const row = screen.getByRole("row", { name: new RegExp(name) });
      const button = within(row).getByRole("button", { name: `Check now — ${name}` });
      expect(button.closest("td")).toHaveAttribute("data-sticky", "end");
      if (name !== "HTTP") expect(button).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Check now — Heartbeat" })).toHaveAccessibleDescription("list.checkNowUnavailableHeartbeat");
    expect(screen.getByRole("button", { name: "Check now — Server" })).toHaveAccessibleDescription("list.checkNowUnavailableServer");
  });

  it("keeps disabled recheck reasons visible in mobile cards", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    try {
      render(<MonitorList monitors={[monitor({ name: "Heartbeat", uptimeMonitorId: "heartbeat", monitorType: "heartbeat" }), monitor({ name: "Server", uptimeMonitorId: "server", monitorType: "server", status: "pending" })]} />);
      for (const name of ["Heartbeat", "Server"]) {
        const button = screen.getByRole("button", { name: `Check now — ${name}` });
        expect(button).toBeDisabled();
      }
      expect(screen.getByRole("button", { name: "Check now — Heartbeat" })).toHaveAccessibleDescription("list.checkNowUnavailableHeartbeat");
      expect(screen.getByRole("button", { name: "Check now — Server" })).toHaveAccessibleDescription("list.checkNowUnavailableServer");
    } finally { vi.unstubAllGlobals(); }
  });

  it("places selection first and all card facts in one grid with tablet columns", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    try {
      const { container } = render(<MonitorList monitors={[monitor({ tags: ["production"] }), monitor({ uptimeMonitorId: "m2", name: "Beta" })]} />);
      const card = container.querySelector<HTMLElement>("[data-monitor-card]")!;
      expect(card.parentElement).toHaveClass("md:grid-cols-2");
      const checkbox = within(card).getByRole("checkbox", { name: "Alpha" });
      const name = within(card).getByText("Alpha");
      expect(checkbox.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const facts = card.querySelectorAll("dl");
      expect(facts).toHaveLength(1);
      expect(facts[0]).toHaveTextContent("list.columns.lastChecked");
      expect(facts[0]).toHaveTextContent("list.columns.interval");
      expect(card.querySelector('[aria-label="list.columns.status"]')).toHaveTextContent("list.columns.uptime");
      expect(within(card).getByRole("button", { name: "common:actions.details" })).toBeInTheDocument();
      expect(card.querySelector("header")).toContainElement(within(card).getByText("production"));
    } finally { vi.unstubAllGlobals(); }
  });

  it("publishes the measured wrapped toolbar height as --bulk-toolbar-height and clears it with selection", async () => {
    const observations: Array<{ callback: ResizeObserverCallback; targets: Element[] }> = [];
    vi.stubGlobal("ResizeObserver", class {
      entry: typeof observations[number];
      constructor(callback: ResizeObserverCallback) { this.entry = { callback, targets: [] }; observations.push(this.entry); }
      observe(target: Element) { this.entry.targets.push(target); }
      disconnect() {}
      unobserve() {}
    });
    try {
      const { container } = render(<MonitorList monitors={[monitor()]} />);
      await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
      const toolbar = screen.getByRole("toolbar");
      const root = container.querySelector<HTMLElement>("[data-monitor-list]")!;
      const resize = observations.find(entry => entry.targets.includes(toolbar))!;
      expect(resize).toBeDefined();
      vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({ height: 180 } as DOMRect);
      act(() => resize.callback([], {} as ResizeObserver));
      expect(root).toHaveAttribute("data-bulk-active");
      expect(document.documentElement.style.getPropertyValue("--bulk-toolbar-height")).toBe("180px");
      vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({ height: 240 } as DOMRect);
      act(() => resize.callback([], {} as ResizeObserver));
      expect(document.documentElement.style.getPropertyValue("--bulk-toolbar-height")).toBe("240px");
      await userEvent.click(within(toolbar).getByRole("button", { name: "Clear" }));
      expect(root).not.toHaveAttribute("data-bulk-active");
      expect(document.documentElement.style.getPropertyValue("--bulk-toolbar-height")).toBe("");
    } finally { vi.unstubAllGlobals(); }
  });
});

it("keeps keyboard-readable timestamps interactive without navigating their row", async () => {
  const { container } = render(<MonitorList monitors={[monitor()]} />);
  const timestamp = container.querySelector<HTMLElement>("time[tabindex='0']")!;
  expect(timestamp).toBeTruthy();
  await userEvent.click(timestamp);
  expect(navigateMock).not.toHaveBeenCalled();
  expect(timestamp).toHaveFocus();
});


it("offers clearing from filtered empty results without showing the first-run action", async () => {
  const onClearFilters = vi.fn();
  render(<MonitorList monitors={[monitor()]} searchQuery="unmatched-fixture" onClearFilters={onClearFilters} />);
  expect(screen.getByText("No monitors match your filters.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "views.clear" }));
  expect(onClearFilters).toHaveBeenCalledOnce();
  expect(screen.queryByText("Start monitoring your services")).not.toBeInTheDocument();
});

it("keeps column, pinned action and group headers opaque muted above row accents", () => {
  const { container } = render(<MonitorList monitors={[monitor({ status: "down", tags: ["production"] })]} group="tag" />);
  expect(container.querySelector("thead")).toHaveClass("bg-muted", "z-30", "[&_th]:bg-muted");
  expect(container.querySelector('thead [data-sticky="end"]')).toHaveClass("bg-muted", "z-30");
  expect(container.querySelector('th[scope="rowgroup"]')).toHaveClass("bg-muted", "z-20");
});
