import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { useUptimeMonitors } from "./useUptimeMonitors";

vi.mock("@/services/uptime/uptimeService", () => ({ UptimeService: { listMonitors: vi.fn() } }));
const svc = vi.mocked(UptimeService);
const settle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => { vi.useFakeTimers(); svc.listMonitors.mockResolvedValue([]); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("polling does not multiply", () => {
	it("several observers of the same list share one request per interval", async () => {
		const { Wrapper } = createWrapper();
		const a = renderHook(() => useUptimeMonitors(), { wrapper: Wrapper });
		await settle(0);
		const base = svc.listMonitors.mock.calls.length;
		expect(base).toBe(1);
		await settle(60_000);
		expect(svc.listMonitors.mock.calls.length).toBe(base + 1);
		a.unmount();
	});
	it("leaving the page stops its polling, and coming back does not leave a second timer running", async () => {
		const { Wrapper } = createWrapper();
		for (let visit = 0; visit < 5; visit++) { const view = renderHook(() => useUptimeMonitors(), { wrapper: Wrapper }); await settle(0); view.unmount(); }
		svc.listMonitors.mockClear();
		await settle(10 * 60_000);
		expect(svc.listMonitors).not.toHaveBeenCalled();
		const again = renderHook(() => useUptimeMonitors(), { wrapper: Wrapper }); await settle(0);
		const afterMount = svc.listMonitors.mock.calls.length;
		await settle(3 * 60_000);
		expect(svc.listMonitors.mock.calls.length - afterMount).toBe(3);
		again.unmount();
	});
	it("a hidden tab does not poll", async () => {
		const { Wrapper } = createWrapper();
		const view = renderHook(() => useUptimeMonitors(), { wrapper: Wrapper }); await settle(0);
		const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
		document.dispatchEvent(new Event("visibilitychange"));
		svc.listMonitors.mockClear();
		await settle(5 * 60_000);
		expect(svc.listMonitors).not.toHaveBeenCalled();
		visibility.mockRestore(); hidden.mockRestore(); view.unmount();
	});
});
