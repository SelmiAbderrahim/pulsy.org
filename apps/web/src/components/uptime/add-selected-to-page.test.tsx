import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { AddSelectedToPage } from "./add-selected-to-page";
vi.mock("react-i18next", () => reactI18nextMock());
const mocks = vi.hoisted(() => ({ listStatusPages: vi.fn(), previewAddToStatusPage: vi.fn(), applyAddToStatusPage: vi.fn() }));
vi.mock("@/services/uptime/uptimeService", () => ({ UptimeService: mocks }));
const preview = { statusPageId: "page", title: "Public", slug: "status", isPublished: true, currentCount: 1, resultingCount: 2, added: [{ id: "one", publicName: "API display" }], alreadySelected: [], revision: "r" };
beforeEach(() => { vi.clearAllMocks(); mocks.listStatusPages.mockResolvedValue([{ statusPageId: "page", title: "Public", slug: "status", isPublished: true }]); mocks.previewAddToStatusPage.mockResolvedValue(preview); mocks.applyAddToStatusPage.mockResolvedValue({ count: 2 }); });
async function choose() { await userEvent.click(screen.getByRole("button", { name: "pageSelection.button" })); await waitFor(() => expect(screen.getByRole("combobox", { name: "pageSelection.page" })).toBeEnabled()); await userEvent.click(screen.getByRole("combobox", { name: "pageSelection.page" })); await userEvent.click(await screen.findByRole("option", { name: /Public/ })); await userEvent.click(screen.getByRole("button", { name: "pageSelection.preview" })); await screen.findByText("API display"); }
describe("explicit selection disclosure", () => {
  it("previews without applying and submits only the exact IDs/revision after deliberate action", async () => {
    const onApplied = vi.fn(); render(<AddSelectedToPage monitorIds={["one"]} onApplied={onApplied} />); await choose();
    expect(screen.getByText("pageSelection.liveWarning")).toBeInTheDocument(); expect(mocks.applyAddToStatusPage).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "pageSelection.apply" }));
    await waitFor(() => expect(mocks.applyAddToStatusPage).toHaveBeenCalledWith("page", ["one"], "r")); expect(onApplied).toHaveBeenCalled();
  });
  it("discards stale previews after a rejection and requires another preview", async () => {
    mocks.applyAddToStatusPage.mockRejectedValue(new Error("Page changed")); render(<AddSelectedToPage monitorIds={["one"]} onApplied={vi.fn()} />); await choose();
    await userEvent.click(screen.getByRole("button", { name: "pageSelection.apply" })); await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "pageSelection.apply" })).not.toBeInTheDocument();
  });
  it("closes a preview when explicit selected IDs change", async () => {
    const { rerender } = render(<AddSelectedToPage monitorIds={["one"]} onApplied={vi.fn()} />); await choose();
    rerender(<AddSelectedToPage monitorIds={["other"]} onApplied={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

it("does not show an old in-flight preview in a reopened selection", async () => {
  let resolvePreview!: (value: typeof preview) => void;
  mocks.previewAddToStatusPage.mockImplementationOnce(() => new Promise(resolve => { resolvePreview = resolve; }));
  const view = render(<AddSelectedToPage monitorIds={["one"]} onApplied={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "pageSelection.button" })); await waitFor(() => expect(screen.getByRole("combobox", { name: "pageSelection.page" })).toBeEnabled());
  await userEvent.click(screen.getByRole("combobox", { name: "pageSelection.page" })); await userEvent.click(await screen.findByRole("option", { name: /Public/ }));
  await userEvent.click(screen.getByRole("button", { name: "pageSelection.preview" }));
  view.rerender(<AddSelectedToPage monitorIds={["other"]} onApplied={vi.fn()} />);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "pageSelection.button" })); await waitFor(() => expect(screen.getByRole("combobox", { name: "pageSelection.page" })).toBeEnabled());
  await act(async () => { resolvePreview(preview); await Promise.resolve(); });
  await waitFor(() => expect(screen.queryByText("API display")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "pageSelection.apply" })).not.toBeInTheDocument();
});

it("invalidates membership caches after an accepted apply, even when the dialog was closed", async () => {
  let release!: (result: { count: number }) => void;
  mocks.applyAddToStatusPage.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const onApplied = vi.fn();
  const { client } = render(<AddSelectedToPage monitorIds={["one"]} onApplied={onApplied} />);
  const key = uptimeKeys.statusPages.detail("page");
  client.setQueryData(key, { monitorIds: ["before"] });
  await choose();
  await userEvent.click(screen.getByRole("button", { name: "pageSelection.apply" }));
  await waitFor(() => expect(mocks.applyAddToStatusPage).toHaveBeenCalledOnce());
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await act(async () => release({ count: 2 }));
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(onApplied).not.toHaveBeenCalled();
});
