import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import {
	useCreateUptimeDefaultChannel,
	useCreateUptimeNotificationChannel,
	useDeleteUptimeNotificationChannel,
	useTestUptimeNotificationChannel,
	useUpdateUptimeNotificationChannel,
	useUptimeDefaultChannels,
	useUptimeNotificationChannels,
} from "./useUptimeNotificationChannels";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		listChannels: vi.fn(),
		listDefaultChannels: vi.fn(),
		createChannel: vi.fn(),
		createDefaultChannel: vi.fn(),
		updateChannel: vi.fn(),
		deleteChannel: vi.fn(),
		testChannel: vi.fn(),
	},
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useUptimeNotificationChannels", () => {
	it("fetches channels for a monitor", async () => {
		svc.listChannels.mockResolvedValue([] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeNotificationChannels("m1"), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listChannels).toHaveBeenCalledWith("m1");
	});

	it("is disabled with empty monitor id", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeNotificationChannels(""), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeNotificationChannels("m1", { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});

describe("useUptimeDefaultChannels", () => {
	it("fetches the account-level default channels", async () => {
		svc.listDefaultChannels.mockResolvedValue([] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeDefaultChannels(), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listDefaultChannels).toHaveBeenCalled();
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeDefaultChannels({ enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});

describe("useCreateUptimeDefaultChannel", () => {
	it("creates and invalidates the defaults list", async () => {
		svc.createDefaultChannel.mockResolvedValue({} as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCreateUptimeDefaultChannel(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({ channelType: "webhook" } as never);
		});
		expect(svc.createDefaultChannel).toHaveBeenCalled();
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.channels.defaults(),
		});
	});
});

describe("useCreateUptimeNotificationChannel", () => {
	it("creates and invalidates channel list + monitor detail", async () => {
		svc.createChannel.mockResolvedValue({} as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCreateUptimeNotificationChannel(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({
				uptimeMonitorId: "m1",
				type: "webhook",
			} as never);
		});
		expect(svc.createChannel).toHaveBeenCalled();
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.channels.list("m1"),
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
	});
});

describe("useUpdateUptimeNotificationChannel", () => {
	it("updates and invalidates on settle", async () => {
		svc.updateChannel.mockResolvedValue({} as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useUpdateUptimeNotificationChannel(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({
				channelId: "c1",
				uptimeMonitorId: "m1",
			} as never);
		});
		expect(svc.updateChannel).toHaveBeenCalled();
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.channels.list("m1"),
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
	});

	it("invalidates the defaults list for a default channel (null monitor)", async () => {
		svc.updateChannel.mockResolvedValue({} as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useUpdateUptimeNotificationChannel(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({
				channelId: "c1",
				uptimeMonitorId: null,
			} as never);
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.channels.defaults(),
		});
		expect(spy).not.toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
	});

	it("invalidates even on error", async () => {
		svc.updateChannel.mockRejectedValue(new Error("fail"));
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useUpdateUptimeNotificationChannel(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current
				.mutateAsync({ channelId: "c1", uptimeMonitorId: "m1" } as never)
				.catch(() => undefined);
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.channels.list("m1"),
		});
	});
});

describe("useDeleteUptimeNotificationChannel", () => {
	it("deletes and invalidates on success", async () => {
		svc.deleteChannel.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useDeleteUptimeNotificationChannel(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({
				channelId: "c1",
				uptimeMonitorId: "m1",
			});
		});
		expect(svc.deleteChannel).toHaveBeenCalledWith("c1");
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.channels.list("m1"),
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
	});

	it("invalidates the defaults list for a default channel (null monitor)", async () => {
		svc.deleteChannel.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useDeleteUptimeNotificationChannel(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({
				channelId: "c1",
				uptimeMonitorId: null,
			});
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.channels.defaults(),
		});
	});
});

describe("useTestUptimeNotificationChannel", () => {
	it("calls the test service", async () => {
		svc.testChannel.mockResolvedValue(undefined as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useTestUptimeNotificationChannel(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync("c1");
		});
		expect(svc.testChannel).toHaveBeenCalledWith("c1");
	});
});
