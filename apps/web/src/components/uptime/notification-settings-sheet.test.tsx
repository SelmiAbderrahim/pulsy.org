import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { NotificationSettingsSheet } from "./notification-settings-sheet";

vi.mock("react-i18next", () => reactI18nextMock());

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: { children?: unknown }) => {
		const { to, params, search, ...rest } = props as Record<string, unknown>;
		void to;
		void params;
		void search;
		return <a {...(rest as object)}>{children as never}</a>;
	},
}));

vi.mock(
	"@/components/uptime/monitor-detail/tabs/email-providers-section",
	() => ({
		EmailProvidersSection: () => <div data-testid="email-providers" />,
	}),
);

vi.mock("@/components/uptime/default-channels-section", () => ({
	DefaultChannelsSection: () => <div data-testid="default-channels" />,
}));

function monitor(overrides: Partial<UptimeMonitor> = {}): UptimeMonitor {
	return {
		uptimeMonitorId: "m1",
		name: "Alpha",
		url: "https://a.com",
		...overrides,
	} as UptimeMonitor;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("NotificationSettingsSheet", () => {
	it("renders the email providers section and an empty monitor state", async () => {
		render(
			<NotificationSettingsSheet open onOpenChange={vi.fn()} monitors={[]} />,
		);
		expect(screen.getByTestId("email-providers")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("tab", { name: "notificationSettings.defaults.title" }));
 expect(screen.getByTestId("default-channels")).toBeInTheDocument();
 await userEvent.click(screen.getByRole("tab", { name: "notificationUX.overrides" }));
		expect(
			screen.getByText("Create a monitor first to configure alerts."),
		).toBeInTheDocument();
	});

	it("lists each monitor with a configure link", async () => {
		render(
			<NotificationSettingsSheet
				open
				onOpenChange={vi.fn()}
				monitors={[
					monitor({ uptimeMonitorId: "m1", name: "Alpha" }),
					monitor({ uptimeMonitorId: "m2", name: "Beta" }),
				]}
			/>,
		);
 await userEvent.click(screen.getByRole("tab", { name: "notificationUX.overrides" }));
		expect(screen.getByText("Alpha")).toBeInTheDocument();
		expect(screen.getByText("Beta")).toBeInTheDocument();
		expect(
			screen.getAllByText("notificationSettings.openAlerts"),
		).toHaveLength(2);
	});

	it("closes the sheet when a configure link is clicked", async () => {
		const onOpenChange = vi.fn();
		render(
			<NotificationSettingsSheet
				open
				onOpenChange={onOpenChange}
				monitors={[monitor()]}
			/>,
		);
 await userEvent.click(screen.getByRole("tab", { name: "notificationUX.overrides" }));
		await userEvent.click(
			screen.getByText("notificationSettings.openAlerts"),
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
