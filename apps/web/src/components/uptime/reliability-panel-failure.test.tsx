import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReliabilityPanel } from "./reliability-panel";
const mocks = vi.hoisted(() => ({ read: vi.fn(), configure: vi.fn(), annotate: vi.fn(), annotations: vi.fn(), incidents: vi.fn(), policies: vi.fn() }));
vi.mock("@/services/uptime/reliabilityService", () => ({ ReliabilityService: mocks }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owned" } } }) }));
vi.mock("@/components/ui/docs-help-link", () => ({ DocsHelpLink: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.policies.mockResolvedValue({ data: [], nextVersion: null }); mocks.incidents.mockResolvedValue({ data: [], nextCursor: null }); mocks.annotations.mockResolvedValue({ data: [], nextCursor: null }); });
describe("a failed History load", () => {
  it("replaces the loading state with the error instead of leaving a dependent query spinning forever", async () => {
    // The annotations/incidents queries wait for the main window; when it fails they stay disabled,
    // and a disabled query with no data still reports isPending.
    mocks.read.mockRejectedValue(new Error("server down"));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReliabilityPanel monitorId="one" monitorType="http" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("server down"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
