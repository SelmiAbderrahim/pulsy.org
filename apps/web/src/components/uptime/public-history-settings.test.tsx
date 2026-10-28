import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PublicHistorySettings } from "./public-history-settings";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/docs-help-link", () => ({ DocsHelpLink: () => null }));
const service = vi.hoisted(() => ({ historyPreview: vi.fn(), historyApply: vi.fn() }));
vi.mock("@/services/uptime/statusCommunicationService", () => ({ StatusCommunicationService: service }));
describe("public history deliberate settings", () => {
  it("changing the opt-in switch only prepares a preview; applying must be explicit and invalidates edited previews", async () => {
    service.historyPreview.mockResolvedValue({ enabled: true, revision: "one", page: { title: "Customer", published: true }, components: [{ componentId: "one", name: "Public API" }], from: "2026-10-02T00:00:00.000Z", to: "2026-10-09T00:00:00.000Z" });
    const changed = vi.fn(); render(<PublicHistorySettings pageId="page" enabled={false} changed={changed} />);
    await userEvent.click(screen.getByRole("switch")); expect(service.historyApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("reliability.previewHistory")); await screen.findByText("Public API"); expect(service.historyApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("switch")); expect(screen.queryByText("reliability.applyHistory")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch")); await userEvent.click(screen.getByText("reliability.previewHistory")); await userEvent.click(await screen.findByText("reliability.applyHistory"));
    await waitFor(() => expect(service.historyApply).toHaveBeenCalledWith("page", true, "one")); expect(changed).toHaveBeenCalled();
  });
});
