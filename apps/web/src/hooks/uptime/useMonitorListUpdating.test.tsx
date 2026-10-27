import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import { useMonitorListUpdating } from "./useUptimeMonitors";

// The dashboard card derives from the list. While a mutation has made the list
// provisional and the reconciling refetch is in flight it says "Updating…";
// routine background polling never does, so numbers never flicker or contradict.

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => { resolve = r; });
	return { promise, resolve };
}

describe("useMonitorListUpdating", () => {
	it("is true only while an invalidated list is refetching", async () => {
		const { Wrapper, client } = createWrapper();
		await client.fetchQuery({ queryKey: uptimeKeys.monitors.lists(), queryFn: async () => [{ uptimeMonitorId: "a" }] });
		const { result } = renderHook(() => useMonitorListUpdating(), { wrapper: Wrapper });
		expect(result.current).toBe(false);

		const gate = deferred<unknown[]>();
		await act(async () => {
			await client.invalidateQueries({ queryKey: uptimeKeys.monitors.lists(), refetchType: "none" });
		});
		const refetch = client.fetchQuery({ queryKey: uptimeKeys.monitors.lists(), queryFn: () => gate.promise, staleTime: 0 });
		await waitFor(() => expect(result.current).toBe(true));
		gate.resolve([]);
		await act(async () => { await refetch; });
		await waitFor(() => expect(result.current).toBe(false));
	});

	it("stays false for a routine background refetch of a non-invalidated list", async () => {
		const { Wrapper, client } = createWrapper();
		await client.fetchQuery({ queryKey: uptimeKeys.monitors.lists(), queryFn: async () => [] });
		const { result } = renderHook(() => useMonitorListUpdating(), { wrapper: Wrapper });
		const gate = deferred<unknown[]>();
		const refetch = client.fetchQuery({ queryKey: uptimeKeys.monitors.lists(), queryFn: () => gate.promise, staleTime: 0 });
		await Promise.resolve();
		expect(client.isFetching({ queryKey: uptimeKeys.monitors.lists() })).toBe(1);
		expect(result.current).toBe(false);
		gate.resolve([]);
		await act(async () => { await refetch; });
	});
});
