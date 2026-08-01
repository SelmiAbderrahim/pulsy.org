import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import {
	useCreateUptimeEmailProvider,
	useDeleteUptimeEmailProvider,
	useTestUptimeEmailProvider,
	useUpdateUptimeEmailProvider,
	useUptimeEmailProviders,
} from "./useUptimeEmailProviders";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		listEmailProviders: vi.fn(),
		createEmailProvider: vi.fn(),
		updateEmailProvider: vi.fn(),
		deleteEmailProvider: vi.fn(),
		testEmailProvider: vi.fn(),
	},
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useUptimeEmailProviders", () => {
	it("fetches the provider list", async () => {
		svc.listEmailProviders.mockResolvedValue([] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeEmailProviders(), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listEmailProviders).toHaveBeenCalled();
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeEmailProviders({ enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});

describe("useCreateUptimeEmailProvider", () => {
	it("creates and invalidates the list", async () => {
		svc.createEmailProvider.mockResolvedValue({} as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCreateUptimeEmailProvider(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({ provider: "resend" } as never);
		});
		expect(svc.createEmailProvider).toHaveBeenCalledWith({ provider: "resend" });
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.emailProviders.lists(),
		});
	});
});

describe("useUpdateUptimeEmailProvider", () => {
	it("updates and invalidates detail + list on settle", async () => {
		svc.updateEmailProvider.mockResolvedValue({} as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useUpdateUptimeEmailProvider(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({ emailProviderId: "e1" } as never);
		});
		expect(svc.updateEmailProvider).toHaveBeenCalledWith({
			emailProviderId: "e1",
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.emailProviders.detail("e1"),
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.emailProviders.lists(),
		});
	});

	it("still invalidates on error (onSettled)", async () => {
		svc.updateEmailProvider.mockRejectedValue(new Error("fail"));
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useUpdateUptimeEmailProvider(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current
				.mutateAsync({ emailProviderId: "e1" } as never)
				.catch(() => undefined);
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.emailProviders.detail("e1"),
		});
	});
});

describe("useDeleteUptimeEmailProvider", () => {
	it("removes detail and invalidates list on success", async () => {
		svc.deleteEmailProvider.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const removeSpy = vi.spyOn(client, "removeQueries");
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useDeleteUptimeEmailProvider(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync("e1");
		});
		expect(svc.deleteEmailProvider).toHaveBeenCalledWith("e1");
		expect(removeSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.emailProviders.detail("e1"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.emailProviders.lists(),
		});
	});
});

describe("useTestUptimeEmailProvider", () => {
	it("calls the test service", async () => {
		svc.testEmailProvider.mockResolvedValue(undefined as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useTestUptimeEmailProvider(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync("e1");
		});
		expect(svc.testEmailProvider).toHaveBeenCalledWith("e1");
	});
});
