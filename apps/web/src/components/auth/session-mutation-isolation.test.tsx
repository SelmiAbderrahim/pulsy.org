import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionQueryBoundary } from "./session-query-boundary";
import { useCreateUptimeMonitor, useDeleteUptimeMonitor } from "@/hooks/uptime/useUptimeMonitors";
import { useDownloadUptimeSlaReport } from "@/hooks/uptime/useUptimeSlaReport";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import type { UptimeMonitor } from "@/types/uptime";

const mocks = vi.hoisted(() => ({
  session: { data: { user: { id: "owner-a" } } as { user: { id: string } } | null, isPending: false, error: null as { status: number } | null },
  create: vi.fn(), remove: vi.fn(), download: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => mocks.session }));
vi.mock("@/services/uptime/uptimeService", () => ({ UptimeService: { createMonitor: mocks.create, deleteMonitor: mocks.remove, downloadSlaReport: mocks.download } }));

let activeClient: QueryClient;
function Controls() {
  activeClient = useQueryClient();
  const create = useCreateUptimeMonitor();
  const remove = useDeleteUptimeMonitor();
  const download = useDownloadUptimeSlaReport("a", 30);
  return <>
    <button onClick={() => create.mutate({ name: "Owner A", url: "https://a.example.com" })}>Create</button>
    <button onClick={() => remove.mutate({ uptimeMonitorId: "a" })}>Delete</button>
    <button onClick={() => download.mutate()}>Download</button>
    <p>{mocks.session.data?.user.id ?? "Anonymous"}</p>
  </>;
}
const row = (id: string) => ({ uptimeMonitorId: id, name: id, active: true, status: "pending", responseTime: null, uptimePercentage: null }) as UptimeMonitor;
function application(parent: QueryClient) {
  return <QueryClientProvider client={parent}><SessionQueryBoundary><Controls /></SessionQueryBoundary></QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.session, { data: { user: { id: "owner-a" } }, isPending: false, error: null });
});

describe("late mutation results after a confirmed session transition", () => {
  it("does not insert an old owner's late creation into the new owner's loaded collection", async () => {
    let resolve!: (value: UptimeMonitor) => void;
    mocks.create.mockImplementation(() => new Promise<UptimeMonitor>(done => { resolve = done; }));
    const parent = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const view = render(application(parent));
    activeClient.setQueryData(uptimeKeys.monitors.lists(), [row("a-existing")]);
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    Object.assign(mocks.session, { data: { user: { id: "owner-b" } } });
    view.rerender(application(parent));
    expect(screen.getByText("owner-b")).toBeInTheDocument();
    activeClient.setQueryData(uptimeKeys.monitors.lists(), [row("b")]);
    await act(async () => { resolve(row("a-created")); });
    expect(activeClient.getQueryData(uptimeKeys.monitors.lists())).toEqual([row("b")]);
    expect(activeClient.getDefaultOptions().queries?.retry).toBe(false);
  });

  it("does not restore an old owner's failed deletion into the next session", async () => {
    let reject!: (error: Error) => void;
    mocks.remove.mockImplementation(() => new Promise<void>((_done, fail) => { reject = fail; }));
    const parent = new QueryClient();
    const view = render(application(parent));
    activeClient.setQueryData(uptimeKeys.monitors.lists(), [row("a")]);
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    Object.assign(mocks.session, { data: { user: { id: "owner-b" } } });
    view.rerender(application(parent));
    activeClient.setQueryData(uptimeKeys.monitors.lists(), [row("b")]);
    await act(async () => { reject(new Error("Old request failed")); });
    expect(activeClient.getQueryData(uptimeKeys.monitors.lists())).toEqual([row("b")]);
  });

  it.each([401, 403])("clears the confirmed owner when a terminal %i retains stale session data", status => {
    const parent = new QueryClient();
    const view = render(application(parent));
    const retired = activeClient;
    retired.setQueryData(uptimeKeys.monitors.lists(), [row("a")]);
    mocks.session.error = { status };
    view.rerender(application(parent));
    expect(activeClient.getQueryData(uptimeKeys.monitors.lists())).toBeUndefined();
    expect(retired.getQueryData(uptimeKeys.monitors.lists())).toBeUndefined();
  });

  it("does not start an old owner's late PDF download in the new session", async () => {
    let resolve!: (value: { report: { periodLabel: string }; pdf: string }) => void;
    mocks.download.mockImplementation(() => new Promise(done => { resolve = done; }));
    const createUrl = vi.fn(() => "blob:private-report");
    const timers = vi.spyOn(globalThis, "setTimeout");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const previous = URL.createObjectURL;
    URL.createObjectURL = createUrl;
    try {
      const parent = new QueryClient();
      const view = render(application(parent));
      fireEvent.click(screen.getByText("Download"));
      await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
      Object.assign(mocks.session, { data: { user: { id: "owner-b" } } });
      view.rerender(application(parent));
      await act(async () => { resolve({ report: { periodLabel: "Owner A" }, pdf: btoa("private report") }); });
      expect(createUrl).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    } finally {
      timers.mock.calls.forEach((call, index) => { if (call[1] === 60_000) clearTimeout(timers.mock.results[index]?.value); });
      timers.mockRestore(); URL.createObjectURL = previous; click.mockRestore();
    }
  });
});
