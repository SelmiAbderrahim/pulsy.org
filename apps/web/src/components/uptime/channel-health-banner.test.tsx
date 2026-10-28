import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { ChannelHealthBanner } from "./channel-health-banner";
import type { UptimeChannelHealth } from "@/types/uptime";

vi.mock("react-i18next", () => reactI18nextMock());

const useUptimeChannelHealth = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useUptimeChannelHealth: () => useUptimeChannelHealth(),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

function health(
	overrides: Partial<UptimeChannelHealth> = {},
): UptimeChannelHealth {
	return {
		channelId: "c1",
		channelType: "webhook",
		uptimeMonitorId: null,
		target: "https://hooks.example.test/••••",
		consecutiveFailures: 0,
		lastError: null,
		lastAttemptAt: "2026-01-01T10:00:00Z",
		lastSuccessAt: "2026-01-01T09:00:00Z",
		...overrides,
	};
}

describe("ChannelHealthBanner", () => {
	it("renders nothing while every channel is delivering", () => {
		useUptimeChannelHealth.mockReturnValue({
			data: [health({ consecutiveFailures: 0 })],
		});
		const { container } = render(
			<ChannelHealthBanner onManageChannels={vi.fn()} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("stays quiet below the threshold so a single blip is not alarming", () => {
		useUptimeChannelHealth.mockReturnValue({
			data: [health({ consecutiveFailures: 2 })],
		});
		const { container } = render(
			<ChannelHealthBanner onManageChannels={vi.fn()} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("surfaces a channel that has failed the threshold in a row", () => {
		useUptimeChannelHealth.mockReturnValue({
			data: [
				health({
					consecutiveFailures: 34,
					lastError: "Webhook delivery is unavailable",
				}),
			],
		});
		render(<ChannelHealthBanner onManageChannels={vi.fn()} />);

		expect(screen.getByText("channelHealth.title")).toBeInTheDocument();
		expect(
			screen.getByText(/Webhook delivery is unavailable/),
		).toBeInTheDocument();
	});

	it("opens channel management from the banner action", () => {
		const onManageChannels = vi.fn();
		useUptimeChannelHealth.mockReturnValue({
			data: [health({ consecutiveFailures: 5 })],
		});
		render(<ChannelHealthBanner onManageChannels={onManageChannels} />);

		fireEvent.click(screen.getByRole("button"));
		expect(onManageChannels).toHaveBeenCalledTimes(1);
	});

	it("tolerates the query still loading", () => {
		useUptimeChannelHealth.mockReturnValue({ data: undefined });
		const { container } = render(
			<ChannelHealthBanner onManageChannels={vi.fn()} />,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
