import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { retireSessionClient } from "@/lib/session-query-client";
import { RotateWebhookSecret, WebhookSecretDialog } from "./webhook-secret-dialog";
const mocks = vi.hoisted(() => ({ rotate: vi.fn(), error: vi.fn() }));
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
vi.mock("@/services/uptime/uptimeService", () => ({ UptimeService: { rotateChannelSecret: mocks.rotate } }));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.error } }));
beforeEach(() => vi.clearAllMocks());
it("shows the owner-issued secret only while the explicit result is open", async () => {
 const close = vi.fn(); const view = render(<WebhookSecretDialog secret="owner-only-secret" onClose={close} />);
 expect(screen.getByText("owner-only-secret")).toBeVisible();
 await userEvent.click(screen.getByRole("button", { name: "notificationUX.secretSaved" })); expect(close).toHaveBeenCalled();
 view.rerender(<WebhookSecretDialog secret={null} onClose={close} />); expect(screen.queryByText("owner-only-secret")).not.toBeInTheDocument();
});
it.each([false, true])("ignores a retired owner's pending rotation (failure=%s)", async failure => {
 let finish!: (value: { signingSecret: string }) => void, fail!: (error: Error) => void;
 mocks.rotate.mockImplementation(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
 const receive = vi.fn(), view = render(<RotateWebhookSecret channelId="owned-channel" onSecret={receive} />);
 await userEvent.click(screen.getByRole("button", { name: "notificationUX.rotateSecret" })); expect(mocks.rotate).toHaveBeenCalledWith("owned-channel");
 retireSessionClient(view.client);
 await act(async () => { if (failure) fail(new Error("old owner failure")); else finish({ signingSecret: "old-owner-secret" }); });
 expect(receive).not.toHaveBeenCalled(); expect(mocks.error).not.toHaveBeenCalled();
});
