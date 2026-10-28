import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { UptimeOnboardingHint } from "./uptime-onboarding-hint";

vi.mock("react-i18next", () => reactI18nextMock());

const STORAGE_KEY = "uptime_onboarding_dismissed";

beforeEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});

afterEach(() => {
	localStorage.clear();
});

describe("UptimeOnboardingHint", () => {
	it("renders when not previously dismissed", () => {
		render(<UptimeOnboardingHint onGetStarted={vi.fn()} />);
		expect(screen.getByText("New: uptime monitoring")).toBeInTheDocument();
	});

	it("does not render when localStorage has the dismissed flag", () => {
		localStorage.setItem(STORAGE_KEY, "true");
		const { container } = render(
			<UptimeOnboardingHint onGetStarted={vi.fn()} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("treats a localStorage read error as not dismissed", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		render(<UptimeOnboardingHint onGetStarted={vi.fn()} />);
		expect(screen.getByText("New: uptime monitoring")).toBeInTheDocument();
	});

	it("calls onGetStarted when Get Started is clicked", async () => {
		const onGetStarted = vi.fn();
		render(<UptimeOnboardingHint onGetStarted={onGetStarted} />);
		await userEvent.click(
			screen.getByRole("button", { name: "Get started" }),
		);
		expect(onGetStarted).toHaveBeenCalledOnce();
	});

	it("dismisses and persists the flag when Dismiss is clicked", async () => {
		render(<UptimeOnboardingHint onGetStarted={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
		expect(
			screen.queryByText("New: uptime monitoring"),
		).not.toBeInTheDocument();
		expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
	});

	it("dismisses even when localStorage.setItem throws", async () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		render(<UptimeOnboardingHint onGetStarted={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
		expect(
			screen.queryByText("New: uptime monitoring"),
		).not.toBeInTheDocument();
	});
});
