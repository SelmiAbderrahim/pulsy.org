import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { SlaReport, SlaReportSubscription } from "@/types/uptime";
import { SlaReportTab } from "./sla-report-tab";

vi.mock("react-i18next", () => reactI18nextMock());

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
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
	useUptimeSlaReport.mockReturnValue({ data: report(), isLoading: false });
	useUptimeSlaReportSubscriptions.mockReturnValue({
		data: [],
		isLoading: false,
	});
	useUptimeEmailProviders.mockReturnValue({
		data: [{ emailProviderId: "p1", name: "Resend Prod" }],
	});
	upsertMutate.mockImplementation((_input, opts) => opts?.onSuccess?.());
	removeMutate.mockImplementation((_id, opts) => opts?.onSuccess?.());
	sendNowMutate.mockImplementation((_id, opts) => opts?.onSuccess?.());
	useUpsert.mockReturnValue({ mutate: upsertMutate, isPending: false });
	useRemove.mockReturnValue({ mutate: removeMutate, isPending: false });
	useSendNow.mockReturnValue({ mutate: sendNowMutate, isPending: false });
});

describe("SlaReportTab — gating", () => {
	it("renders the report for every account (no tiers)", () => {
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getByText("slaReport.title")).toBeInTheDocument();
	});
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

	it("renders stats and the PDF download link", () => {
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getByText("99%")).toBeInTheDocument();
		expect(screen.getByText("120 ms")).toBeInTheDocument(); // avg
		expect(screen.getByText("350 ms")).toBeInTheDocument(); // p95
		const link = screen.getByTestId("sla-download");
		expect(link).toHaveAttribute("href", "/api/reports/sla/m1.pdf?days=30");
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
					avgResponseTime: null,
					minResponseTime: null,
					maxResponseTime: null,
					p95ResponseTime: null,
					uptimePercentage: 100,
				},
			}),
			isLoading: false,
		});
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
	});
});

describe("SlaReportTab — email subscription", () => {
	it("prompts to add a provider when none exist", () => {
		useUptimeEmailProviders.mockReturnValue({ data: [] });
		render(<SlaReportTab monitorId="m1" />);
		expect(screen.getByText("slaReport.email.noProviders")).toBeInTheDocument();
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
