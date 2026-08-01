import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { NotificationLogTable } from "./notification-log-table";
import type { UptimeNotificationLog } from "@/types/uptime";

vi.mock("react-i18next", () => reactI18nextMock());

const useUptimeNotificationLogs = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useUptimeNotificationLogs: (id: string | undefined, opts: unknown) =>
		useUptimeNotificationLogs(id, opts),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

function row(overrides: Partial<UptimeNotificationLog> = {}): UptimeNotificationLog {
	return {
		notificationLogId: "l1",
		uptimeMonitorId: "m1",
		channelId: "c1",
		channelType: "email",
		target: "ops@pulsy.test",
		event: "down",
		statusChangeId: "sc1",
		outcome: "sent",
		attempts: 1,
		providerMessageId: null,
		error: null,
		createdAt: "2026-01-01T10:00:00Z",
		...overrides,
	};
}

describe("NotificationLogTable", () => {
	it("shows the empty state when there are no rows and not fetching", () => {
		useUptimeNotificationLogs.mockReturnValue({
			data: { data: [], total: 0 },
			isFetching: false,
		});
		render(<NotificationLogTable monitorId="m1" />);
		expect(
			screen.getByText("notifications.history.empty"),
		).toBeInTheDocument();
		expect(useUptimeNotificationLogs).toHaveBeenCalledWith("m1", {
			limit: 25,
			offset: 0,
		});
	});

	it("renders the table (not the empty state) while fetching with no data yet", () => {
		useUptimeNotificationLogs.mockReturnValue({
			data: undefined,
			isFetching: true,
		});
		render(<NotificationLogTable monitorId="m1" />);
		expect(
			screen.queryByText("notifications.history.empty"),
		).not.toBeInTheDocument();
		expect(
			screen.getByText("notifications.history.columns.time"),
		).toBeInTheDocument();
	});

	it("renders sent, failed-with-error, and failed-without-error rows", () => {
		useUptimeNotificationLogs.mockReturnValue({
			data: {
				data: [
					row({
						notificationLogId: "sent",
						outcome: "sent",
						providerMessageId: "re_123",
					}),
					row({
						notificationLogId: "failed",
						channelType: "webhook",
						target: "hooks.example.com",
						outcome: "failed",
						error: "Webhook returned 500",
						attempts: 4,
					}),
					row({
						notificationLogId: "failed-noerr",
						outcome: "failed",
						error: null,
					}),
				],
				total: 3,
			},
			isFetching: false,
		});
		render(<NotificationLogTable monitorId="m1" />);
		expect(
			screen.getAllByText("notifications.history.outcome.sent"),
		).toHaveLength(1);
		expect(
			screen.getAllByText("notifications.history.outcome.failed"),
		).toHaveLength(2);
		// providerMessageId is surfaced on the sent row.
		expect(
			screen.getByText("notifications.history.messageId"),
		).toBeInTheDocument();
		expect(screen.getByText("hooks.example.com")).toBeInTheDocument();
	});

	it("paginates: prev disabled on the first page, next advances the offset", () => {
		useUptimeNotificationLogs.mockReturnValue({
			data: { data: [row()], total: 30 },
			isFetching: false,
		});
		render(<NotificationLogTable monitorId="m1" />);

		const buttons = screen.getAllByRole("button");
		const [prev, next] = buttons;
		expect(prev).toBeDisabled();
		expect(next).not.toBeDisabled();

		fireEvent.click(next as HTMLElement);
		// Page 2 → offset 25; with total 30 there is no further page.
		expect(useUptimeNotificationLogs).toHaveBeenLastCalledWith("m1", {
			limit: 25,
			offset: 25,
		});
		const afterButtons = screen.getAllByRole("button");
		expect(afterButtons[0]).not.toBeDisabled(); // prev now enabled
		expect(afterButtons[1]).toBeDisabled(); // next now disabled

		fireEvent.click(afterButtons[0] as HTMLElement);
		expect(useUptimeNotificationLogs).toHaveBeenLastCalledWith("m1", {
			limit: 25,
			offset: 0,
		});
	});

	it("does not render the pager when the total fits on one page", () => {
		useUptimeNotificationLogs.mockReturnValue({
			data: { data: [row()], total: 3 },
			isFetching: false,
		});
		render(<NotificationLogTable monitorId="m1" />);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});
});
