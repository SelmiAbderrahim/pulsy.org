import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { createWrapper } from "@/test/query-wrapper";
import { reactI18nextMock } from "@/test/i18n-mock";
import { PreferencesDialog } from "./preferences-dialog";
import { retireSessionClient } from "@/lib/session-query-client";
const mocks = vi.hoisted(() => ({ config: { timezone: "UTC", requireEmailVerification: true } as { timezone: string | null; requireEmailVerification: boolean }, mutate: vi.fn(), language: vi.fn(), confirm: vi.fn() }));
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/hooks/useConfig", () => ({ useConfig: () => ({ data: mocks.config, isPending: false, refetch: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
vi.mock("@/lib/api/trpc", () => ({ trpcMutation: mocks.mutate }));
vi.mock("@/lib/confirmation", () => ({ requestConfirmation: mocks.confirm }));
beforeEach(() => { vi.clearAllMocks(); mocks.config = { timezone: "UTC", requireEmailVerification: true }; mocks.mutate.mockResolvedValue({ timezone: "Africa/Tunis" }); mocks.language.mockResolvedValue(undefined); mocks.confirm.mockResolvedValue(false); });
async function choose(field: string, search: string, option: RegExp) {
  await userEvent.click(screen.getByRole("combobox", { name: field }));
  await userEvent.type(screen.getByRole("combobox", { name: "controls.search" }), search);
  await userEvent.click(screen.getByRole("option", { name: option }));
}
it("does not apply an old session's language or navigation after its timezone write settles", async () => {
  let resolve!: (value: unknown) => void;
  mocks.mutate.mockImplementation(() => new Promise(done => { resolve = done; }));
  const { Wrapper, client } = createWrapper(); const close = vi.fn();
  render(<PreferencesDialog open onOpenChange={close} onLanguageChange={mocks.language} />, { wrapper: Wrapper });
  await choose("nav.language", "fr", /Français/);
  await choose("nav.timezone", "Tunis", /Africa\/Tunis/);
  await userEvent.click(screen.getByRole("button", { name: "actions.save" }));
  expect(mocks.mutate).toHaveBeenCalledOnce();
  retireSessionClient(client);
  await act(async () => { resolve({ timezone: "Africa/Tunis" }); });
  expect(mocks.language).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
it("stages language/timezone and saves only to the account cache before closing", async () => {
  const { Wrapper, client } = createWrapper(); const onOpenChange = vi.fn();
  client.setQueryData(["config", "owner"], mocks.config);
  render(<PreferencesDialog open onOpenChange={onOpenChange} onLanguageChange={mocks.language} />, { wrapper: Wrapper });
  expect(screen.getByRole("button", { name: "actions.save" })).toBeDisabled();
  await choose("nav.language", "fr", /Français/);
  await choose("nav.timezone", "Tunis", /Africa\/Tunis/);
  expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.language).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "actions.save" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(mocks.mutate).toHaveBeenCalledWith("config", "setTimezone", { timezone: "Africa/Tunis" });
  expect(mocks.language).toHaveBeenCalledWith("fr");
  expect(client.getQueryData(["config", "owner"])).toEqual({ timezone: "Africa/Tunis", requireEmailVerification: true });
});
it("retains the draft on server failure and does not change language or close", async () => {
  mocks.mutate.mockRejectedValueOnce(new Error("unavailable"));
  const { Wrapper } = createWrapper(); const onOpenChange = vi.fn();
  render(<PreferencesDialog open onOpenChange={onOpenChange} onLanguageChange={mocks.language} />, { wrapper: Wrapper });
  await choose("nav.language", "fr", /Français/);
  await choose("nav.timezone", "Tunis", /Africa\/Tunis/);
  await userEvent.click(screen.getByRole("button", { name: "actions.save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("preferences.saveError");
  expect(screen.getByRole("combobox", { name: "nav.timezone" })).toHaveTextContent("Africa/Tunis");
  expect(mocks.language).not.toHaveBeenCalled(); expect(onOpenChange).not.toHaveBeenCalled();
});
it("can restore the browser timezone without saving it as a fixed account timezone", async () => {
  const { Wrapper } = createWrapper();
  render(<PreferencesDialog open onOpenChange={vi.fn()} onLanguageChange={mocks.language} />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("checkbox", { name: "preferences.useBrowserTimezone" }));
  await userEvent.click(screen.getByRole("button", { name: "actions.save" }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith("config", "setTimezone", { timezone: null }));
});
it("rejects invalid stored zones and prevents duplicate submissions", async () => {
  mocks.config.timezone = "Mars/Base";
  const { Wrapper } = createWrapper(); const mounted = render(<PreferencesDialog open onOpenChange={vi.fn()} onLanguageChange={mocks.language} />, { wrapper: Wrapper });
  expect(screen.getByRole("combobox", { name: "nav.timezone" })).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "actions.save" })).toBeDisabled();
  await choose("nav.timezone", "Tunis", /Africa\/Tunis/);
  mocks.mutate.mockImplementation(() => new Promise(() => {}));
  fireEvent.submit(screen.getByRole("button", { name: "actions.save" }).closest("form")!);
  fireEvent.submit(screen.getByRole("button", { name: "actions.save" }).closest("form")!);
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  mounted.unmount();
});

it("saves a language-only change without rewriting the account timezone", async () => {
  const { Wrapper } = createWrapper(); const onOpenChange = vi.fn();
  render(<PreferencesDialog open onOpenChange={onOpenChange} onLanguageChange={mocks.language} />, { wrapper: Wrapper });
  await choose("nav.language", "fr", /Français/);
  await userEvent.click(screen.getByRole("button", { name: "actions.save" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(mocks.language).toHaveBeenCalledWith("fr");
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it.each(["Escape", "Cancel"])("confirms %s when following the browser changes to the same explicit timezone", async dismissal => {
  mocks.config.timezone = null;
  const { Wrapper } = createWrapper(); const onOpenChange = vi.fn();
  render(<PreferencesDialog open onOpenChange={onOpenChange} onLanguageChange={mocks.language} />, { wrapper: Wrapper });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await choose("nav.timezone", zone, new RegExp(`^${zone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`));
  expect(screen.getByRole("checkbox", { name: "preferences.useBrowserTimezone" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "actions.save" })).toBeEnabled();
  if (dismissal === "Escape") await userEvent.keyboard("{Escape}");
  else await userEvent.click(screen.getByRole("button", { name: "actions.cancel" }));
  const confirmation = await screen.findByRole("alertdialog");
  await userEvent.click(within(confirmation).getByRole("button", { name: "actions.cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(onOpenChange).not.toHaveBeenCalled();
});
it.each(["Escape", "Cancel"])("does not confirm %s after restoring the saved browser preference", async dismissal => {
  mocks.config.timezone = null;
  const { Wrapper } = createWrapper(); const onOpenChange = vi.fn();
  render(<PreferencesDialog open onOpenChange={onOpenChange} onLanguageChange={mocks.language} />, { wrapper: Wrapper });
  await choose("nav.timezone", "Tunis", /Africa\/Tunis/);
  await userEvent.click(screen.getByRole("checkbox", { name: "preferences.useBrowserTimezone" }));
  expect(screen.getByRole("button", { name: "actions.save" })).toBeDisabled();
  if (dismissal === "Escape") await userEvent.keyboard("{Escape}");
  else await userEvent.click(screen.getByRole("button", { name: "actions.cancel" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(mocks.confirm).not.toHaveBeenCalled();
});
