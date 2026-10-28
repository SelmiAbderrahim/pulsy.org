import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => {
	const fn = (kind: string) => vi.fn((_message: unknown, _options?: Record<string, unknown>) => kind);
	return { success: fn("success"), info: fn("info"), warning: fn("warning"), error: fn("error"), message: fn("message"), dismiss: vi.fn() };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), sonner) }));

import { mountToastPolicy, pauseToasts, toast } from "./toast";

let unmount: () => void;
const visible = () => sonner.success.mock.calls.length + sonner.info.mock.calls.length + sonner.warning.mock.calls.length + sonner.error.mock.calls.length + sonner.message.mock.calls.length - sonner.dismiss.mock.calls.length;

beforeEach(() => {
	vi.useFakeTimers();
	for (const spy of Object.values(sonner)) spy.mockClear();
	unmount = mountToastPolicy();
});
afterEach(() => { unmount(); vi.useRealTimers(); });

describe("toast policy", () => {
	it("shows at most three toasts and releases a queued one when a visible one finishes", () => {
		for (const kind of ["success", "info", "warning", "error"] as const) toast[kind](`${kind} message`);
		expect(sonner.success).toHaveBeenCalledTimes(1);
		expect(sonner.info).toHaveBeenCalledTimes(1);
		expect(sonner.warning).toHaveBeenCalledTimes(1);
		expect(sonner.error).not.toHaveBeenCalled();
		vi.advanceTimersByTime(5000);
		expect(sonner.error).toHaveBeenCalledTimes(1);
	});

	it("keeps six rapid toasts at three visible at any time", () => {
		for (let index = 0; index < 6; index += 1) toast.success(`Saved ${index}`);
		expect(sonner.success).toHaveBeenCalledTimes(3);
		let peak = 0;
		for (let second = 0; second < 40; second += 1) {
			vi.advanceTimersByTime(1000);
			peak = Math.max(peak, visible());
		}
		expect(sonner.success).toHaveBeenCalledTimes(6);
		expect(peak).toBeLessThanOrEqual(3);
	});

	it.each([["success", 5000], ["info", 6000], ["warning", 8000], ["error", 10000]] as const)("dismisses a %s toast after its finite duration of %d ms", (kind, duration) => {
		toast[kind]("Finite");
		expect(sonner[kind].mock.calls[0]![1]).toMatchObject({ duration: Infinity, closeButton: true, dismissible: true });
		vi.advanceTimersByTime(duration - 1);
		expect(sonner.dismiss).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(sonner.dismiss).toHaveBeenCalledTimes(1);
	});

	it("gives a toast with an action the longer 10 s duration", () => {
		toast.success("Monitor added", { action: { label: "View monitor", onClick: vi.fn() } });
		vi.advanceTimersByTime(9999);
		expect(sonner.dismiss).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(sonner.dismiss).toHaveBeenCalledTimes(1);
	});

	it("pauses the clock while hovered or focused and resumes with the remaining time", () => {
		toast.success("Paused");
		vi.advanceTimersByTime(3000);
		pauseToasts(true);
		vi.advanceTimersByTime(60_000);
		expect(sonner.dismiss).not.toHaveBeenCalled();
		pauseToasts(false);
		vi.advanceTimersByTime(1999);
		expect(sonner.dismiss).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(sonner.dismiss).toHaveBeenCalledTimes(1);
	});

	it("collapses an identical visible or queued toast into the first one", () => {
		const first = toast.error("Same");
		expect(toast.error("Same")).toBe(first);
		expect(sonner.error).toHaveBeenCalledTimes(1);
	});

	it("falls back to the same finite policy when no host is mounted", () => {
		unmount();
		toast.warning("Standalone");
		expect(sonner.warning).toHaveBeenCalledWith("Standalone", expect.objectContaining({ duration: 8000, closeButton: true }));
		unmount = mountToastPolicy();
	});
});
