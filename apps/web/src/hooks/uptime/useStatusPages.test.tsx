import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import {
  useAttachStatusPageDomain,
  useCreateStatusPage,
  useDeleteStatusPage,
  useDetachStatusPageDomain,
  usePublicStatusPageByDomain,
  usePublicStatusPageBySlug,
  useSetStatusPageMonitors,
  useStatusPage,
  useStatusPages,
  useUpdateStatusPage,
  useVerifyStatusPageDomain,
} from "./useStatusPages";

vi.mock("@/services/uptime/uptimeService", () => ({
  UptimeService: {
    listStatusPages: vi.fn(),
    getStatusPage: vi.fn(),
    createStatusPage: vi.fn(),
    updateStatusPage: vi.fn(),
    deleteStatusPage: vi.fn(),
    setStatusPageMonitors: vi.fn(),
    attachStatusPageDomain: vi.fn(),
    verifyStatusPageDomain: vi.fn(),
    detachStatusPageDomain: vi.fn(),
    getStatusPageBySlug: vi.fn(),
    getStatusPageByDomain: vi.fn(),
  },
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useStatusPages", () => {
  it("fetches the page list", async () => {
    svc.listStatusPages.mockResolvedValue([{ statusPageId: "p1" }] as never);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStatusPages(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(svc.listStatusPages).toHaveBeenCalledTimes(1);
  });

  it("is disabled when enabled is false", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStatusPages({ enabled: false }), {
      wrapper: Wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(svc.listStatusPages).not.toHaveBeenCalled();
  });
});

describe("useStatusPage", () => {
  it("fetches one page", async () => {
    svc.getStatusPage.mockResolvedValue({ statusPageId: "p1" } as never);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStatusPage("p1"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(svc.getStatusPage).toHaveBeenCalledWith("p1");
  });

  it("is disabled with an empty id", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStatusPage(""), {
      wrapper: Wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(svc.getStatusPage).not.toHaveBeenCalled();
  });

  it("is disabled when enabled is false even with an id", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStatusPage("p1", { enabled: false }),
      { wrapper: Wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(svc.getStatusPage).not.toHaveBeenCalled();
  });
});

describe("useCreateStatusPage", () => {
  it("creates and invalidates the list", async () => {
    svc.createStatusPage.mockResolvedValue({ statusPageId: "p1" } as never);
    const { Wrapper, client } = createWrapper();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateStatusPage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ slug: "s", title: "t" });
    });
    expect(svc.createStatusPage).toHaveBeenCalledWith({ slug: "s", title: "t" });
    expect(spy).toHaveBeenCalledWith({
      queryKey: uptimeKeys.statusPages.lists(),
    });
  });

  it("surfaces errors", async () => {
    svc.createStatusPage.mockRejectedValue(new Error("boom"));
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateStatusPage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ slug: "s", title: "t" }),
      ).rejects.toThrow("boom");
    });
  });
});

describe("useUpdateStatusPage", () => {
  it("updates and invalidates list + detail", async () => {
    svc.updateStatusPage.mockResolvedValue({ statusPageId: "p1" } as never);
    const { Wrapper, client } = createWrapper();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateStatusPage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ statusPageId: "p1", title: "t" });
    });
    // The collection prefix includes both list and detail observers.
    expect(spy).toHaveBeenCalledWith({ queryKey: uptimeKeys.statusPages.all() });
  });
});

describe("useDeleteStatusPage", () => {
  it("deletes and invalidates the list", async () => {
    svc.deleteStatusPage.mockResolvedValue({ success: true } as never);
    const { Wrapper, client } = createWrapper();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteStatusPage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ statusPageId: "p1" });
    });
    expect(svc.deleteStatusPage).toHaveBeenCalledWith("p1");
    expect(spy).toHaveBeenCalledWith({
      queryKey: uptimeKeys.statusPages.lists(),
    });
  });
});

describe("useSetStatusPageMonitors", () => {
  it("sets monitors and invalidates the page detail", async () => {
    svc.setStatusPageMonitors.mockResolvedValue({
      success: true,
      count: 1,
    } as never);
    const { Wrapper, client } = createWrapper();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetStatusPageMonitors(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        statusPageId: "p1",
        uptimeMonitorIds: ["m1"],
      });
    });
    expect(svc.setStatusPageMonitors).toHaveBeenCalledWith("p1", ["m1"]);
    expect(spy).toHaveBeenCalledWith({
      queryKey: uptimeKeys.statusPages.detail("p1"),
    });
  });
});

describe("useAttachStatusPageDomain", () => {
  it("attaches and invalidates detail + list", async () => {
    svc.attachStatusPageDomain.mockResolvedValue({
      recordValue: "v",
    } as never);
    const { Wrapper, client } = createWrapper();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAttachStatusPageDomain(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        statusPageId: "p1",
        customDomain: "status.example.com",
      });
    });
    expect(svc.attachStatusPageDomain).toHaveBeenCalledWith(
      "p1",
      "status.example.com",
    );
    expect(spy).toHaveBeenCalledWith({
      queryKey: uptimeKeys.statusPages.detail("p1"),
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: uptimeKeys.statusPages.lists(),
    });
  });
});

describe("useVerifyStatusPageDomain", () => {
  it("verifies and invalidates detail + list", async () => {
    svc.verifyStatusPageDomain.mockResolvedValue({
      domainVerified: true,
    } as never);
    const { Wrapper, client } = createWrapper();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useVerifyStatusPageDomain(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ statusPageId: "p1" });
    });
    expect(svc.verifyStatusPageDomain).toHaveBeenCalledWith("p1");
    expect(spy).toHaveBeenCalledWith({
      queryKey: uptimeKeys.statusPages.detail("p1"),
    });
  });
});

describe("useDetachStatusPageDomain", () => {
  it("detaches and invalidates detail + list", async () => {
    svc.detachStatusPageDomain.mockResolvedValue({ success: true } as never);
    const { Wrapper, client } = createWrapper();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDetachStatusPageDomain(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ statusPageId: "p1" });
    });
    expect(svc.detachStatusPageDomain).toHaveBeenCalledWith("p1");
    expect(spy).toHaveBeenCalledWith({
      queryKey: uptimeKeys.statusPages.detail("p1"),
    });
  });
});

describe("usePublicStatusPageBySlug", () => {
  it("resolves by slug", async () => {
    svc.getStatusPageBySlug.mockResolvedValue({ monitors: [] } as never);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => usePublicStatusPageBySlug("u1", "api"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(svc.getStatusPageBySlug).toHaveBeenCalledWith("u1", "api");
  });

  it("is disabled with an empty slug", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => usePublicStatusPageBySlug("u1", ""), {
      wrapper: Wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(svc.getStatusPageBySlug).not.toHaveBeenCalled();
  });

  it("is disabled when enabled is false", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => usePublicStatusPageBySlug("u1", "api", { enabled: false }),
      { wrapper: Wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(svc.getStatusPageBySlug).not.toHaveBeenCalled();
  });
});

describe("usePublicStatusPageByDomain", () => {
  it("resolves by host", async () => {
    svc.getStatusPageByDomain.mockResolvedValue({ monitors: [] } as never);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => usePublicStatusPageByDomain("status.acme.com"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(svc.getStatusPageByDomain).toHaveBeenCalledWith("status.acme.com");
  });

  it("is disabled with an empty host", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => usePublicStatusPageByDomain(""), {
      wrapper: Wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(svc.getStatusPageByDomain).not.toHaveBeenCalled();
  });

  it("is disabled when enabled is false", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => usePublicStatusPageByDomain("status.acme.com", { enabled: false }),
      { wrapper: Wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(svc.getStatusPageByDomain).not.toHaveBeenCalled();
  });
});
