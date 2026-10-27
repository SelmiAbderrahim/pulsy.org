import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { SlaReport, SlaReportSubscription } from "@/types/uptime";
import { SlaReportTab } from "./sla-report-tab";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("./email-providers-section", () => ({ EmailProvidersSection: () => <div>Provider setup</div> }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
	toast: {
		success: (...a: unknown[]) => toastSuccess(...a),
		error: (...a: unknown[]) => toastError(...a),
	},
}));

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		slaReportPdfUrl: (id: string, days: number) =>
			`/api/reports/sla/${id}.pdf?days=${days}`,
	},
}));


const downloadMutate = vi.fn();
const downloadState: { isSuccess?: boolean; data?: { report: { periodLabel: string } } } = {};
const useUptimeSlaReport = vi.fn();
const useUptimeSlaReportSubscriptions = vi.fn();
const useUptimeEmailProviders = vi.fn();
const upsertMutate = vi.fn();
const removeMutate = vi.fn();
const sendNowMutate = vi.fn();
const useUpsert = vi.fn();
const useRemove = vi.fn();
const useSendNow = vi.fn();

vi.mock("@/hooks/uptime", () => ({
	useDownloadUptimeSlaReport: () => ({ mutate: downloadMutate, isPending: false, ...downloadState }),
	useUptimeSlaReport: (id: string, days: number) => useUptimeSlaReport(id, days),
	useUptimeSlaReportSubscriptions: () => useUptimeSlaReportSubscriptions(),
	useUptimeEmailProviders: () => useUptimeEmailProviders(),
	useUpsertUptimeSlaReportSubscription: () => useUpsert(),
	useRemoveUptimeSlaReportSubscription: () => useRemove(),
	useSendUptimeSlaReportNow: () => useSendNow(),
}));

function report(overrides: Partial<SlaReport> = {}): SlaReport {
	return {
		uptimeMonitorId: "m1",
		monitorName: "Acme",
		url: "https://example.com",
		windowFrom: "2026-05-16T00:00:00.000Z",
		windowTo: "2026-06-15T00:00:00.000Z",
		windowDays: 30,
		periodLabel: "30d",
		generatedAt: "2026-06-15T00:00:00.000Z",
		stats: {
			totalChecks: 100,
			successfulChecks: 99,
			failedChecks: 1,
			degradedChecks: 0,
			avgResponseTime: 120,
			minResponseTime: 80,
			maxResponseTime: 400,
			p95ResponseTime: 350,
			uptimePercentage: 99,
		},
		incidents: { count: 2, totalDowntimeSeconds: 300, longestIncidentSeconds: 200 },
		dailyUptime: [],
		...overrides,
	};
}

function sub(overrides: Partial<SlaReportSubscription> = {}): SlaReportSubscription {
	return {
		slaReportSubscriptionId: "s1",
		uptimeMonitorId: "m1",
		monitorName: "Acme",
		recipientAddresses: ["ops@x.test"],
		emailProviderId: "p1",
		active: true,
		lastSentAt: null,
		createdAt: "2026-06-01T00:00:00.000Z",
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	delete downloadState.isSuccess; delete downloadState.data;
	useUptimeSlaReport.mockReturnValue({ data: report(), isLoading: false });
	useUptimeSlaReportSubscriptions.mockReturnValue({
		data: [],
		isLoading: false,
	});
	useUptimeEmailProviders.mockReturnValue({
		data: [{ emailProviderId: "p1", name: "Resend Prod", verified: true }],
	});
	upsertMutate.mockImplementation((_input, opts) => opts?.onSuccess?.());
	removeMutate.mockImplementation((_id, opts) => opts?.onSuccess?.());
	sendNowMutate.mockImplementation((_id, opts) => opts?.onSuccess?.({ skipped: false, monitorsReported: 1, emailsSent: 1 }));
	useUpsert.mockReturnValue({ mutate: upsertMutate, isPending: false });
	useRemove.mockReturnValue({ mutate: removeMutate, isPending: false });
	useSendNow.mockReturnValue({ mutate: sendNowMutate, isPending: false });
});


describe("SlaReportTab — content", () => {
	it("shows a loader while the report loads", () => {
		useUptimeSlaReport.mockReturnValue({ data: undefined, isLoading: true });
		const { container } = render(<SlaReportTab monitorId="m1" />);
		expect(container.querySelector(".animate-spin")).toBeTruthy();
	});

	it("shows a loader while subscriptions load", () => {
		useUptimeSlaReportSubscriptions.mockReturnValue({
			data: undefined,
			isLoading: true,
		});
		const { container } = render(<SlaReportTab monitorId="m1" />);
		expect(container.querySelector(".animate-spin")).toBeTruthy();
	});

	it("shows the empty state when there is no report", () => {
		useUptimeSlaReport.mockReturnValue({ data: undefined, isLoading: false });
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getByText("slaReport.empty")).toBeInTheDocument();
	});

	it("renders stats and requests a consistent PDF snapshot", () => {
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getByText("99.00%")).toBeInTheDocument();
		expect(screen.getByText("120 ms")).toBeInTheDocument(); // avg
		expect(screen.getByText("350 ms")).toBeInTheDocument(); // p95
		const link = screen.getByTestId("sla-download");
		fireEvent.click(link);
		expect(downloadMutate).toHaveBeenCalledOnce();
	});

	it("tolerates undefined subscriptions and providers", () => {
		useUptimeSlaReportSubscriptions.mockReturnValue({
			data: undefined,
			isLoading: false,
		});
		useUptimeEmailProviders.mockReturnValue({ data: undefined });
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getByText("slaReport.title")).toBeInTheDocument();
		expect(screen.getByText("slaReport.email.noProviders")).toBeInTheDocument();
	});

	it("renders an em dash for null response-time metrics", () => {
		useUptimeSlaReport.mockReturnValue({
			data: report({
				stats: {
					totalChecks: 0,
					successfulChecks: 0,
					failedChecks: 0,
					degradedChecks: 0,
					avgResponseTime: null,
					minResponseTime: null,
					maxResponseTime: null,
					p95ResponseTime: null,
					uptimePercentage: null,
				},
			}),
			isLoading: false,
		});
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText("No data")).toBeInTheDocument();
	});
});

describe("SlaReportTab — email subscription", () => {
	it.each([{ skipped: true, monitorsReported: 0, emailsSent: 0 }, { skipped: false, monitorsReported: 1, emailsSent: 0 }])("does not claim delivery for a skipped or failed local attempt", (result) => {
		useUptimeSlaReportSubscriptions.mockReturnValue({ data: [sub()], isLoading: false });
		sendNowMutate.mockImplementation((_id, opts) => opts?.onSuccess?.(result));
		render(<SlaReportTab monitorId="m1" />);
		fireEvent.click(screen.getByText("slaReport.email.sendNow"));
		expect(toastSuccess).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toHaveTextContent("slaReport.email.sendError");
	});

	it("prompts to add a provider when none exist", () => {
		useUptimeEmailProviders.mockReturnValue({ data: [] });
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getByText("slaReport.email.noProviders")).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("slaReport.email.notScheduled");
		expect(screen.getByText("slaReport.email.draftHelp")).toBeInTheDocument();
	});

	it("shows a validation hint for an invalid recipient", () => {
		render(<SlaReportTab monitorId="m1" />);
		fireEvent.change(screen.getByLabelText("slaReport.email.recipients"), {
			target: { value: "not-an-email" },
		});
		expect(
			screen.getByText("slaReport.email.invalidRecipients"),
		).toBeInTheDocument();
		expect(
			screen.getByText("slaReport.email.save").closest("button"),
		).toBeDisabled();
	});

	it("disables save without a provider even with valid recipients", () => {
		render(<SlaReportTab monitorId="m1" />);
		fireEvent.change(screen.getByLabelText("slaReport.email.recipients"), {
			target: { value: "valid@x.test" },
		});
		// No existing subscription → emailProviderId is empty → save disabled.
		expect(
			screen.getByText("slaReport.email.save").closest("button"),
		).toBeDisabled();
	});

	it("saves an existing subscription and shows the manage actions", () => {
		useUptimeSlaReportSubscriptions.mockReturnValue({
			data: [sub()],
			isLoading: false,
		});
		render(<SlaReportTab monitorId="m1" />);

		const saveBtn = screen
			.getByText("slaReport.email.save")
			.closest("button") as HTMLButtonElement;
		expect(saveBtn).not.toBeDisabled();
		fireEvent.click(saveBtn);
		expect(upsertMutate).toHaveBeenCalled();
		expect(toastSuccess).toHaveBeenCalledWith("slaReport.email.saved");

		fireEvent.click(screen.getByText("slaReport.email.sendNow"));
		expect(sendNowMutate).toHaveBeenCalledWith("s1", expect.anything());
		expect(toastSuccess).toHaveBeenCalledWith("slaReport.email.sent");

		fireEvent.click(screen.getByText("slaReport.email.remove"));
		expect(removeMutate).toHaveBeenCalledWith("s1", expect.anything());
		expect(toastSuccess).toHaveBeenCalledWith("slaReport.email.removed");
	});

	it("surfaces error toasts when mutations fail", () => {
		upsertMutate.mockImplementation((_input, opts) => opts?.onError?.());
		removeMutate.mockImplementation((_id, opts) => opts?.onError?.());
		sendNowMutate.mockImplementation((_id, opts) => opts?.onError?.());
		useUptimeSlaReportSubscriptions.mockReturnValue({
			data: [sub()],
			isLoading: false,
		});
		render(<SlaReportTab monitorId="m1" />);

		fireEvent.click(screen.getByText("slaReport.email.save"));
		expect(toastError).toHaveBeenCalledWith("slaReport.email.saveError");
		fireEvent.click(screen.getByText("slaReport.email.sendNow"));
		expect(toastError).toHaveBeenCalledWith("slaReport.email.sendError");
		fireEvent.click(screen.getByText("slaReport.email.remove"));
		expect(toastError).toHaveBeenCalledWith("slaReport.email.removeError");
	});

	it("shows a spinner and disables save while the upsert is pending", () => {
		useUpsert.mockReturnValue({ mutate: upsertMutate, isPending: true });
		useUptimeSlaReportSubscriptions.mockReturnValue({
			data: [sub()],
			isLoading: false,
		});
		const { container } = render(<SlaReportTab monitorId="m1" />);
		expect(
			screen.getByText("slaReport.email.save").closest("button"),
		).toBeDisabled();
		expect(container.querySelector(".animate-spin")).toBeTruthy();
	});
});

describe("snapshot, refresh and monthly-email clarity", () => {
	it("states the window and snapshot time zone, and shows a refreshing state that disables a second refresh", () => {
		useUptimeSlaReport.mockReturnValue({ data: report(), isLoading: false, isFetching: true });
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getByText(/slaReport\.window/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "slaReport.refreshing" })).toBeDisabled();
	});

	it("reports a generated PDF by file name only after the download actually produced one", () => {
		const { rerender } = render(<SlaReportTab monitorId="m1" />);
		expect(screen.queryByText("slaReport.downloaded")).not.toBeInTheDocument();
		downloadState.isSuccess = true; downloadState.data = { report: { periodLabel: "30d" } };
		rerender(<SlaReportTab monitorId="m1" />);
		expect(screen.getByText("slaReport.downloaded")).toBeInTheDocument();
	});

	it("names why Save is unavailable and marks unsaved preferences without changing delivery", () => {
		useUptimeSlaReportSubscriptions.mockReturnValue({ data: [sub()], isLoading: false });
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.queryByText("slaReport.email.unsaved")).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("slaReport.email.recipients"), { target: { value: "" } });
		expect(screen.getByText("slaReport.email.unsaved")).toBeInTheDocument();
		expect(screen.getByText("slaReport.email.sendNowSaved")).toBeInTheDocument();
		const save = screen.getByRole("button", { name: "slaReport.email.save" });
		expect(save).toBeDisabled();
		expect(save.getAttribute("aria-describedby")).toBe("sla-save-blocked");
		expect(screen.getByText("slaReport.email.blockedRecipients")).toBeInTheDocument();
		expect(upsertMutate).not.toHaveBeenCalled();
		expect(screen.getByText("slaReport.email.scheduled")).toBeInTheDocument();
	});
});


describe("monthly provider readiness and report layout", () => {
  it.each([{ providers: [] }, { providers: [{ emailProviderId: "p1", name: "Untested", verified: false }] }])("keeps monthly delivery off and disabled without a verified provider", ({ providers }) => {
    useUptimeEmailProviders.mockReturnValue({ data: providers });
    useUptimeSlaReportSubscriptions.mockReturnValue({ data: [sub()], isLoading: false });
    render(<SlaReportTab monitorId="m1" />);
    const toggle = screen.getByRole("switch", { name: "slaReport.email.active" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("slaReport.email.scheduled")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "slaReport.email.setupProvider" })).toHaveAttribute("href", "#sla-email-provider-setup");
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it("saves the displayed off state for an existing unverified provider", () => {
    useUptimeEmailProviders.mockReturnValue({ data: [{ emailProviderId: "p1", name: "Untested", verified: false }] });
    useUptimeSlaReportSubscriptions.mockReturnValue({ data: [sub()], isLoading: false });
    render(<SlaReportTab monitorId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: "slaReport.email.save" }));
    expect(upsertMutate).toHaveBeenCalledWith(expect.objectContaining({ active: false }), expect.anything());
  });

  it("uses shared timezone names and eight statistics in four desktop columns", () => {
    const { container } = render(<SlaReportTab monitorId="m1" />);
    // Window computed in UTC, displayed in the account zone; one explicit label says both.
    expect(screen.getByText(/slaReport.window/)).toHaveTextContent("slaReport.timezoneBasis");
    expect(screen.getByTestId("sla-download-csv")).toHaveTextContent("slaReport.downloadCsv");
    expect(screen.getByTestId("sla-download-json")).toHaveTextContent("slaReport.downloadJson");
    const grid = container.querySelector('[data-report-stats]');
    expect(grid).toHaveClass("lg:grid-cols-4");
    expect(grid?.children).toHaveLength(8);
    expect(screen.getByText("slaReport.successfulChecks")).toBeInTheDocument();
  });
});


it("keeps the saved off preference after the provider becomes verified", () => {
  useUptimeEmailProviders.mockReturnValue({ data: [{ emailProviderId: "p1", name: "Untested", verified: false }] });
  useUptimeSlaReportSubscriptions.mockReturnValue({ data: [sub()], isLoading: false });
  const { rerender } = render(<SlaReportTab monitorId="m1" />);
  fireEvent.click(screen.getByRole("button", { name: "slaReport.email.save" }));
  useUptimeEmailProviders.mockReturnValue({ data: [{ emailProviderId: "p1", name: "Verified", verified: true }] });
  useUptimeSlaReportSubscriptions.mockReturnValue({ data: [sub({ active: false })], isLoading: false });
  rerender(<SlaReportTab monitorId="m1" />);
  expect(screen.getByRole("switch", { name: "slaReport.email.active" })).toHaveAttribute("aria-checked", "false");
  expect(screen.queryByText("slaReport.email.unsaved")).not.toBeInTheDocument();
});

it.each([false, true])("ignores monthly report save callbacks after session retirement (failure=%s)", async failure => {
  const { retireSessionClient } = await import("@/lib/session-query-client");
  let callbacks: { onSuccess: () => void; onError: (error: Error) => void } | undefined;
  useUptimeSlaReportSubscriptions.mockReturnValue({ data: [sub()], isLoading: false });
  upsertMutate.mockImplementation((_input, options) => { callbacks = options; });
  const view = render(<SlaReportTab monitorId="m1" />);
  fireEvent.click(screen.getByRole("button", { name: "slaReport.email.save" }));
  expect(callbacks).toBeDefined(); retireSessionClient(view.client);
  await act(async () => { if (failure) callbacks!.onError(new Error("Old account")); else callbacks!.onSuccess(); });
  expect(toastSuccess).not.toHaveBeenCalled(); expect(toastError).not.toHaveBeenCalled();
});

it("protects and reverts a monthly delivery draft and freezes submitted controls", async () => {
  const { hasRegisteredDraft } = await import("@/lib/draft-guards");
  useUptimeSlaReportSubscriptions.mockReturnValue({ data: [sub()], isLoading: false });
  const view = render(<SlaReportTab monitorId="m1" />);
  const input = screen.getByLabelText("slaReport.email.recipients");
  expect(hasRegisteredDraft()).toBe(false);
  fireEvent.change(input, { target: { value: "changed@x.test" } });
  expect(hasRegisteredDraft()).toBe(true);
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.change(input, { target: { value: "ops@x.test" } });
  expect(hasRegisteredDraft()).toBe(false);
  useUpsert.mockReturnValue({ mutate: upsertMutate, isPending: true });
  view.rerender(<SlaReportTab monitorId="m1" />);
  expect(input).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "slaReport.email.provider" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "slaReport.email.active" })).toBeDisabled();
});
