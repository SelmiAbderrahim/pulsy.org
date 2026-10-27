import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SessionQueryBoundary } from "./session-query-boundary";
const state = vi.hoisted(() => ({ data: { user: { id: "owner-a" } } as { user: { id: string } } | null, isPending: false, error: null as { status: number } | null }));
let visibleClient: QueryClient;
vi.mock("@/lib/auth-client", () => ({ useSession: () => state }));
function PrivateDraft() {
  const [value, setValue] = useState("");
  const client = useQueryClient();
  visibleClient = client;
  return <><input aria-label="Private draft" value={value} onChange={event => setValue(event.target.value)} /><p>{client.getQueryData<string>(["private-monitor"]) ?? "No cached monitor"}</p></>;
}
describe("confirmed session ownership", () => {
  it("renders the router on an initial session outage instead of leaving public routes blank", () => {
    Object.assign(state,{data:null,isPending:false,error:{status:503}});
    const client=new QueryClient();
    render(<QueryClientProvider client={client}><SessionQueryBoundary><p>Public route</p></SessionQueryBoundary></QueryClientProvider>);
    expect(screen.getByText("Public route")).toBeInTheDocument();
  });
  it("retains drafts/cache on temporary failure and clears both before another owner renders", () => {
    Object.assign(state, { data: { user: { id: "owner-a" } }, isPending: false, error: null });
    const client = new QueryClient();
    const app = <QueryClientProvider client={client}><SessionQueryBoundary><PrivateDraft /></SessionQueryBoundary></QueryClientProvider>;
    const view = render(app);
    fireEvent.change(screen.getByLabelText("Private draft"), { target: { value: "Owner A private draft" } });
    client.setQueryData(["private-monitor"], "Owner A private monitor");
    Object.assign(state, { data: null, error: { status: 503 } });
    view.rerender(<QueryClientProvider client={client}><SessionQueryBoundary><PrivateDraft /></SessionQueryBoundary></QueryClientProvider>);
    expect(screen.getByLabelText("Private draft")).toHaveValue("Owner A private draft");
    expect(client.getQueryData(["private-monitor"])).toBe("Owner A private monitor");
    Object.assign(state, { data: { user: { id: "owner-b" } }, error: null });
    view.rerender(<QueryClientProvider client={client}><SessionQueryBoundary><PrivateDraft /></SessionQueryBoundary></QueryClientProvider>);
    expect(screen.getByLabelText("Private draft")).toHaveValue("");
    expect(screen.queryByText("Owner A private monitor")).not.toBeInTheDocument();
    expect(client.getQueryData(["private-monitor"])).toBeUndefined();
    const ownerBClient = visibleClient;
    ownerBClient.setQueryData(["private-monitor"], "Owner B private monitor");
    Object.assign(state, { data: null, error: { status: 401 } });
    view.rerender(<QueryClientProvider client={client}><SessionQueryBoundary><PrivateDraft /></SessionQueryBoundary></QueryClientProvider>);
    expect(ownerBClient.getQueryData(["private-monitor"])).toBeUndefined();
  });
});
