import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { ComponentEditor, AnnouncementEditor } from "./status-communication-editor";
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
const service = vi.hoisted(() => ({ one: vi.fn(), componentsPreview: vi.fn(), componentsApply: vi.fn(), draft: vi.fn(), deleteDraft: vi.fn(), preview: vi.fn(), publish: vi.fn() }));
vi.mock("@tanstack/react-router", async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, Link: ({ children }: { children: React.ReactNode }) => <a href="?tab=general">{children}</a> };
});
vi.mock("@/services/uptime/statusCommunicationService", () => ({ StatusCommunicationService: service }));
vi.mock("@/services/uptime/maintenanceService", () => ({ MaintenanceService: { list: async () => [] } }));
const data = { page: { id: "page", title: "Status", slug: "default", published: true, historyEnabled: false }, components: [{ componentId: "component", monitorId: "monitor", privateName: "Private API", name: "API", description: "", group: "", active: true, sortOrder: 0 }], announcements: [] };
function renderEditor(mode = "components") { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{mode === "components" ? <ComponentEditor data={data} changed={async () => {}} /> : <AnnouncementEditor data={data} schedules={[]} changed={async () => {}} />}</QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); service.one.mockResolvedValue(data); service.componentsPreview.mockImplementation(async (_page: string, components: unknown[]) => ({ components, revision: "revision", title: "Status", published: true })); service.componentsApply.mockResolvedValue({ saved: true }); });
describe("explicit public communication controls", () => {
  it("explains an empty component name with shared linked validation before preview, then clears it on repair", async () => {
    renderEditor();
    const name = screen.getByLabelText("communication.componentName");
    fireEvent.change(name, { target: { value: "   " } });
    const preview = screen.getByRole("button", { name: "communication.previewComponents" });
    expect(preview).toBeEnabled();
    await userEvent.click(preview);
    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("communication.componentName: formValidation.required");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name.getAttribute("aria-describedby")).toContain("public-name-component-validation-");
    expect(name).toHaveFocus();
    expect(service.componentsPreview).not.toHaveBeenCalled();
    await userEvent.click(within(summary).getByRole("link"));
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "Public API" } });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    await userEvent.click(preview);
    expect(await screen.findByRole("button", { name: "communication.applyComponents" })).toBeInTheDocument();
    expect(service.componentsApply).not.toHaveBeenCalled();
  });
  it("maps a structured component field failure to its field without a generic duplicate", async () => {
    service.componentsPreview.mockRejectedValueOnce({ message: "generic failure", data: { validationErrors: { fieldErrors: { "components.0.group": ["Choose a shorter group"] } } } });
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "communication.previewComponents" }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("communication.componentGroup: Choose a shorter group");
    const group = screen.getByLabelText("communication.componentGroup");
    expect(group).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(group).toHaveFocus());
    expect(screen.queryByText("generic failure")).not.toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    fireEvent.change(group, { target: { value: "API" } });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
  it("previews public names before applying and invalidates preview when the draft changes", async () => {
    renderEditor(); const input = await screen.findByLabelText("communication.componentName"); await userEvent.clear(input); await userEvent.type(input, "Public API");
    await userEvent.click(screen.getByRole("button", { name: "communication.previewComponents" })); await screen.findByRole("button", { name: "communication.applyComponents" }); expect(service.componentsApply).not.toHaveBeenCalled();
    await userEvent.type(input, " changed"); expect(screen.queryByRole("button", { name: "communication.applyComponents" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "communication.previewComponents" })); await userEvent.click(await screen.findByRole("button", { name: "communication.applyComponents" }));
    await waitFor(() => expect(service.componentsApply).toHaveBeenCalledWith("page", [{ componentId: "component", name: "Public API changed", description: "", group: "" }], "revision"));
  });
  it("saves a private draft and requires a separate preview and explicit publication", async () => {
    service.draft.mockResolvedValue({ id: "draft" }); service.preview.mockResolvedValue({ announcement: { title: "Issue", text: "Investigating", componentIds: ["component"], stage: "investigating", timezone: "UTC", kind: "incident", publishedAt: null }, components: [{ componentId: "component", name: "API" }], page: { title: "Status", published: true }, revision: "publication-revision" }); service.publish.mockResolvedValue({ published: true });
    renderEditor("announcements"); await userEvent.type(screen.getByLabelText("communication.announcementTitle"), "Issue"); await userEvent.type(screen.getByLabelText("communication.announcementText"), "Investigating"); await userEvent.click(screen.getByLabelText("communication.selectComponent"));
    await userEvent.click(screen.getByRole("button", { name: "communication.saveDraft" })); await waitFor(() => expect(service.draft).toHaveBeenCalled()); expect(service.publish).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "communication.previewAnnouncement" })); await userEvent.click(await screen.findByRole("button", { name: "communication.publish" }));
    await waitFor(() => expect(service.publish).toHaveBeenCalledWith("draft", "publication-revision"));
  });
});

describe("announcement prerequisites", () => {
  it("lists what publishing needs, links an unpublished page to General, and keeps the technical ceiling out of the ordinary bound", () => {
    render(<QueryClientProvider client={new QueryClient()}><AnnouncementEditor data={{ ...data, page: { ...data.page, published: false } }} schedules={[]} changed={async () => {}} /></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "communication.prerequisitesHeading" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "communication.publishPageFirst" })).toHaveAttribute("href", "?tab=general");
    expect(screen.getByText("communication.stateGuide")).toBeInTheDocument();
    expect(screen.queryByText(/communication\.limitNear/)).not.toBeInTheDocument();
  });
  it("shows the limit note only once the visible list is full", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: `a${index}`, title: `Update ${index}`, text: "x", stage: "investigating", componentIds: [], timezone: "UTC", publishedAt: "2026-10-09T12:00:00.000Z", updatedAt: "2026-10-09T12:00:00.000Z", previousId: null }));
    render(<QueryClientProvider client={new QueryClient()}><AnnouncementEditor data={{ ...data, announcements: rows } as never} schedules={[]} changed={async () => {}} /></QueryClientProvider>);
    expect(screen.getByText(/communication\.limitNear/)).toBeInTheDocument();
  });
});

it("publishes once however fast the button is clicked, and keeps the draft when publishing fails", async () => {
  service.draft.mockResolvedValue({ id: "draft" });
  service.preview.mockResolvedValue({ announcement: { title: "Issue", text: "Investigating", componentIds: ["component"], stage: "investigating", timezone: "UTC", kind: "incident", publishedAt: null }, components: [{ componentId: "component", name: "API" }], page: { title: "Status", published: true }, revision: "rev" });
  service.publish.mockRejectedValueOnce(new Error("publish unavailable")).mockImplementation(() => new Promise(() => {}));
  renderEditor("announcements");
  await userEvent.type(screen.getByLabelText("communication.announcementTitle"), "Issue"); await userEvent.type(screen.getByLabelText("communication.announcementText"), "Investigating"); await userEvent.click(screen.getByLabelText("communication.selectComponent"));
  await userEvent.click(screen.getByRole("button", { name: "communication.saveDraft" })); await userEvent.click(await screen.findByRole("button", { name: "communication.previewAnnouncement" }));
  await userEvent.click(await screen.findByRole("button", { name: "communication.publish" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("publish unavailable");
  expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("Issue");
  await userEvent.click(await screen.findByRole("button", { name: "communication.previewAnnouncement" }));
  await userEvent.dblClick(await screen.findByRole("button", { name: "communication.publish" }));
  expect(service.publish).toHaveBeenCalledTimes(2);
});

function announcement(id: string, title: string) {
  return { id, userId: "owner", statusPageId: "page", previousId: null, title, text: "Investigating", stage: "investigating" as const, componentIds: ["component"], timezone: "US/Eastern", kind: "incident" as const, maintenanceId: null, startsAt: null, endsAt: null, publishedAt: null, createdAt: "2026-10-13T09:00:00Z", updatedAt: "2026-10-13T09:00:00Z" };
}
function lifecycleEditor(onDirtyChange = vi.fn(), changed = vi.fn(async () => {})) {
  return { ...render(<AnnouncementEditor data={{ ...data, announcements: [announcement("a", "First draft"), announcement("b", "Second draft")] }} schedules={[]} changed={changed} onDirtyChange={onDirtyChange} />), onDirtyChange, changed };
}
function row(title: string) { return screen.getByText(title).closest("li")!; }
async function edit(title = "First draft") { await userEvent.click(within(row(title)).getByRole("button", { name: "communication.editDraft" })); }
async function chooseTimezone(zone: string) {
  await userEvent.click(screen.getByRole("combobox", { name: "communication.timezone" }));
  const search = screen.getByRole("combobox", { name: "controls.search" });
  fireEvent.change(search, { target: { value: zone } });
  await userEvent.click(screen.getByRole("option", { name: new RegExp(`^${zone.replaceAll("/", "\\/")} `) }));
}
async function decision(action: string) { await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: action })); }

describe("announcement validation and draft lifecycle", () => {
  it("defaults to the browser timezone and validates a saved invalid zone with field focus, then clears stale feedback on choosing a zone", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    service.draft.mockResolvedValue({ id: "new" });
    render(<AnnouncementEditor data={{ ...data, announcements: [{ ...announcement("invalid", "Invalid zone"), timezone: "Mars/Base" }] }} schedules={[]} changed={async () => {}} />);
    const timezone = screen.getByRole("combobox", { name: "communication.timezone" });
    expect(timezone).toHaveTextContent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    await edit("Invalid zone");
    await userEvent.type(screen.getByLabelText("communication.announcementTitle"), "Issue");
    await userEvent.type(screen.getByLabelText("communication.announcementText"), "Investigating");
    await userEvent.click(screen.getByRole("button", { name: "communication.saveDraft" }));
    expect(service.draft).not.toHaveBeenCalled();
    expect(timezone).toHaveFocus(); expect(timezone).toHaveAttribute("aria-invalid", "true");
    expect(timezone).toHaveAttribute("aria-describedby", "announcement-timezone-error");
    expect(screen.getByText("communication.timezoneError")).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("communication.timezone");
    expect(alerts[0]).not.toHaveTextContent("communication.submitError");
    expect(document.querySelector(".sticky.bottom-0")).toBeTruthy();
    expect(scroll).toHaveBeenCalled();
    await chooseTimezone("UTC");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(timezone).toHaveAttribute("aria-invalid", "false");
    await userEvent.click(screen.getByRole("button", { name: "communication.saveDraft" }));
    expect(await screen.findByText("communication.draftSaved")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("communication.announcementTitle"), " edited");
    expect(screen.queryByText("communication.draftSaved")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "communication.previewAnnouncement" })).not.toBeInTheDocument();
    scroll.mockRestore();
  });
  it("maps server timezone errors to the field and focuses the first error when multiple fields are invalid", async () => {
    service.draft.mockRejectedValue({ data: { validationErrors: { fieldErrors: { timezone: ["Localized timezone error"] } } } });
    lifecycleEditor(); await edit();
    await userEvent.click(screen.getByRole("button", { name: "communication.saveDraft" }));
    expect(await screen.findByText("Localized timezone error")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("communication.timezone")).toHaveFocus());
    await userEvent.clear(screen.getByLabelText("communication.announcementTitle"));
    fireEvent.submit(screen.getByLabelText("communication.announcementTitle").closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("communication.announcementTitle")).toHaveFocus());
  });
  it("opens saved drafts cleanly, preserves timezone, and switches only after confirmation", async () => {
    const state = lifecycleEditor(); await edit();
    expect(screen.getByLabelText("communication.timezone")).toHaveTextContent("US/Eastern");
    expect(state.onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(row("First draft")).toHaveAttribute("aria-current", "true");
    expect(within(row("First draft")).getByText("communication.activeDraft")).toBeInTheDocument();
    expect(screen.queryByText("communication.draftSaved")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("communication.announcementTitle"), " edited");
    await edit("Second draft"); await decision("actions.cancel");
    expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("First draft edited");
    expect(within(row("Second draft")).getByRole("button", { name: "communication.editDraft" })).toHaveFocus();
    await edit("Second draft"); await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("First draft edited");
    await edit("Second draft"); await decision("communication.discard");
    expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("Second draft");
    expect(state.onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(service.draft).not.toHaveBeenCalled();
  });
  it("tracks timezone-only edits and edit/revert, saves cleanly and starts a new announcement without enabling clean Cancel", async () => {
    service.draft.mockResolvedValue({ id: "a" });
    const state = { onDirtyChange: vi.fn() };
    render(<AnnouncementEditor data={{ ...data, announcements: [{ ...announcement("a", "First draft"), timezone: "America/New_York" }] }} schedules={[]} changed={async () => {}} onDirtyChange={state.onDirtyChange} />);
    await edit();
    await chooseTimezone("UTC");
    expect(state.onDirtyChange).toHaveBeenLastCalledWith(true);
    await chooseTimezone("America/New_York");
    expect(state.onDirtyChange).toHaveBeenLastCalledWith(false);
    await userEvent.type(screen.getByLabelText("communication.announcementTitle"), " updated");
    await userEvent.click(screen.getByRole("button", { name: "communication.saveDraft" }));
    await screen.findByText("communication.draftSaved");
    expect(state.onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(service.draft).toHaveBeenCalledWith(expect.objectContaining({ id: "a", timezone: "America/New_York" }));
    expect(screen.getByRole("button", { name: "common:actions.cancel" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "communication.newAnnouncement" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByText("communication.activeDraft")).not.toBeInTheDocument();
    expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("");
    expect(screen.getByLabelText("communication.timezone")).toHaveTextContent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(screen.queryByText("communication.draftSaved")).not.toBeInTheDocument();
  });
  it("confirms dirty Cancel and New announcement, and resets even a timezone-only new draft", async () => {
    const state = lifecycleEditor(); await edit();
    await userEvent.type(screen.getByLabelText("communication.announcementTitle"), " edit");
    await userEvent.click(screen.getByRole("button", { name: "common:actions.cancel" })); await decision("actions.cancel");
    expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("First draft edit");
    await userEvent.click(screen.getByRole("button", { name: "common:actions.cancel" })); await decision("communication.discard");
    expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("");
    await chooseTimezone("Asia/Tokyo");
    await userEvent.click(screen.getByRole("button", { name: "common:actions.cancel" }));
    await decision("communication.discard");
    expect(state.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it("confirms deletion, preserves the editor on failure, resets an active deleted draft, and invalidates cached data", async () => {
    const state = lifecycleEditor(); await edit();
    await userEvent.type(screen.getByLabelText("communication.announcementTitle"), " unsaved");
    await userEvent.click(within(row("First draft")).getByRole("button", { name: "communication.deleteDraft" })); await decision("actions.cancel");
    expect(service.deleteDraft).not.toHaveBeenCalled();
    service.deleteDraft.mockRejectedValueOnce(new Error("Delete unavailable"));
    await userEvent.click(within(row("First draft")).getByRole("button", { name: "communication.deleteDraft" })); await decision("communication.deleteDraft");
    expect(await screen.findByRole("alert")).toHaveTextContent("Delete unavailable");
    expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("First draft unsaved");
    service.deleteDraft.mockResolvedValueOnce({ deleted: true });
    await userEvent.click(within(row("First draft")).getByRole("button", { name: "communication.deleteDraft" })); await decision("communication.deleteDraft");
    await waitFor(() => expect(state.changed).toHaveBeenCalledOnce());
    expect(service.deleteDraft).toHaveBeenLastCalledWith("a");
    expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("");
    expect(screen.queryByText("communication.activeDraft")).not.toBeInTheDocument();
    expect(state.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});

it("preserves a saved maintenance timezone and occurrence while schedules load, without making it dirty", async () => {
  const onDirtyChange = vi.fn();
  const startsAt = "2026-10-14T09:00:00.000Z", endsAt = "2026-10-14T10:00:00.000Z";
  const saved = { ...announcement("maintenance-draft", "Maintenance draft"), maintenanceId: "schedule", kind: "maintenance" as const, startsAt, endsAt, timezone: "Europe/Berlin" };
  const props = { data: { ...data, announcements: [saved] }, changed: async () => {}, onDirtyChange };
  const view = render(<AnnouncementEditor {...props} schedules={[]} />);
  await edit("Maintenance draft"); expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  view.rerender(<AnnouncementEditor {...props} schedules={[{ id: "schedule", name: "Maintenance", enabled: true, kind: "maintenance", monitorIds: ["monitor"], timezone: "Europe/Berlin", occurrences: [{ startsAt: "2026-10-13T09:00:00.000Z", endsAt: "2026-10-13T10:00:00.000Z" }, { startsAt, endsAt }] } as never]} />);
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByLabelText("communication.timezone")).toHaveTextContent("Europe/Berlin");
  expect(screen.getByLabelText("communication.occurrence")).toHaveTextContent("Oct 14, 2026");
});

it("keeps the current draft when another draft is deleted and prevents duplicate deletions while pending", async () => {
  let complete!: (value: { deleted: boolean }) => void;
  service.deleteDraft.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const state = lifecycleEditor(); await edit();
  await userEvent.click(within(row("Second draft")).getByRole("button", { name: "communication.deleteDraft" }));
  await userEvent.dblClick(within(screen.getByRole("alertdialog")).getByRole("button", { name: "communication.deleteDraft" }));
  expect(service.deleteDraft).toHaveBeenCalledTimes(1);
  expect(within(row("Second draft")).getByRole("button", { name: "communication.deleting" })).toBeDisabled();
  expect(screen.getByLabelText("communication.announcementTitle")).toHaveValue("First draft");
  complete({ deleted: true });
  await waitFor(() => expect(state.changed).toHaveBeenCalledOnce());
  expect(row("First draft")).toHaveAttribute("aria-current", "true");
});

it("previews and applies an explicit component reorder", async () => {
  const second = { ...data.components[0]!, componentId: "dns", monitorId: "dns-monitor", privateName: "DNS", name: "DNS", sortOrder: 1 };
  render(<ComponentEditor data={{ ...data, components: [...data.components, second] }} changed={async () => {}} />);
  const move = screen.getAllByRole("button", { name: "communication.moveUp" });
  expect(move[0]).toBeDisabled();
  fireEvent.click(move[1]!);
  fireEvent.click(screen.getByRole("button", { name: "communication.previewComponents" }));
  await screen.findByRole("button", { name: "communication.applyComponents" });
  expect(screen.getAllByRole("listitem").map(item => item.textContent)).toEqual(["DNS", "API"]);
  fireEvent.click(screen.getByRole("button", { name: "communication.applyComponents" }));
  await waitFor(() => expect(service.componentsApply).toHaveBeenCalledWith("page", [
    { componentId: "dns", name: "DNS", description: "", group: "" },
    { componentId: "component", name: "API", description: "", group: "" },
  ], "revision"));
});

it("uses a bordered transparent, keyboard-operable checkbox for affected components", async () => {
  renderEditor("announcements");
  const checkbox = screen.getByRole("checkbox", { name: "communication.selectComponent" });
  expect(checkbox).toHaveAttribute("data-state", "unchecked");
  expect(checkbox).toHaveClass("border", "border-primary", "bg-transparent", "disabled:bg-muted", "focus-visible:ring-2");
  checkbox.focus();
  await userEvent.keyboard(" ");
  expect(checkbox).toHaveAttribute("data-state", "checked");
  expect(checkbox).toHaveFocus();
  await userEvent.type(screen.getByLabelText("communication.announcementTitle"), "Notice");
  await userEvent.type(screen.getByLabelText("communication.announcementText"), "Investigating");
  let finish!: (value: { id: string }) => void;
  service.draft.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await userEvent.click(screen.getByRole("button", { name: "communication.saveDraft" }));
  expect(checkbox).toBeDisabled();
  expect(checkbox).toHaveAttribute("data-state", "checked");
  finish({ id: "saved" });
  await waitFor(() => expect(checkbox).toBeEnabled());
});

it("guides an empty component list without redundant announcement actions or a fictitious history count", async () => {
  render(<QueryClientProvider client={new QueryClient()}><AnnouncementEditor data={{ ...data, components: [], announcements: [] }} schedules={[]} changed={async () => {}} /></QueryClientProvider>);
  expect(screen.queryByRole("button", { name: "communication.newAnnouncement" })).not.toBeInTheDocument();
  expect(screen.getByText("communication.emptyComponentsAction")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "statusUX.membership" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "communication.saveDraft" })).toBeDisabled();
  expect(screen.queryByText("communication.historyBound")).not.toBeInTheDocument();
  expect(screen.getByLabelText("communication.announcementTitle")).toBeRequired();
  expect(screen.getByLabelText("communication.announcementText")).toBeRequired();
  await chooseTimezone("Africa/Tunis");
  expect(screen.getByRole("combobox", { name: "communication.timezone" })).toHaveTextContent("Africa/Tunis");
});


it("shows a read-only announcement type when incident is the only option", () => {
  renderEditor("announcements");
  expect(screen.queryByRole("combobox", { name: "communication.noticeType" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("communication.noticeType")).toHaveTextContent("communication.incident");
});

it("keeps schedule selection, occurrence, and timezone together in a maintenance draft", async () => {
  const startsAt = "2026-10-14T09:00:00.000Z", endsAt = "2026-10-14T10:00:00.000Z";
  const maintenance = { id: "schedule", name: "Database maintenance", enabled: true, kind: "maintenance", monitorIds: ["monitor"], timezone: "Europe/Berlin", occurrences: [{ startsAt, endsAt }] };
  service.draft.mockResolvedValue({ id: "saved-maintenance" });
  render(<AnnouncementEditor data={data} schedules={[maintenance as never]} changed={async () => {}} />);
  await userEvent.click(screen.getByRole("combobox", { name: "communication.noticeType" }));
  await userEvent.click(screen.getByRole("option", { name: /Database maintenance/ }));
  expect(screen.getByRole("combobox", { name: "communication.timezone" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "communication.timezone" })).toHaveTextContent("Europe/Berlin");
  expect(screen.getByRole("combobox", { name: "communication.occurrence" })).toHaveTextContent("Oct 14, 2026");
  await userEvent.type(screen.getByLabelText("communication.announcementTitle"), "Maintenance");
  await userEvent.type(screen.getByLabelText("communication.announcementText"), "Planned work");
  await userEvent.click(screen.getByLabelText("communication.selectComponent"));
  await userEvent.click(screen.getByRole("button", { name: "communication.saveDraft" }));
  await waitFor(() => expect(service.draft).toHaveBeenCalledWith(expect.objectContaining({ timezone: "Europe/Berlin", maintenance: { id: "schedule", startsAt, endsAt }, componentIds: ["component"] })));
});

it("uses keyboard-operable drag handles and icon ordering controls without publishing before preview", async () => {
  const second = { ...data.components[0]!, componentId: "dns", monitorId: "dns-monitor", privateName: "DNS", name: "DNS", sortOrder: 1 };
  render(<ComponentEditor data={{ ...data, components: [...data.components, second] }} changed={async () => {}} />);
  expect(screen.getByRole("heading", { name: "communication.components" })).toHaveClass("text-base");
  const handle = screen.getByRole("button", { name: "Reorder DNS" });
  expect(handle).toHaveAttribute("draggable", "true");
  handle.focus(); await userEvent.keyboard("{ArrowUp}");
  expect(screen.getAllByRole("group").map(group => group.querySelector("legend")?.textContent)).toEqual(["DNS", "Private API"]);
  expect(handle).toHaveFocus();
  expect(screen.getAllByRole("button", { name: "communication.moveUp" })[0]).toBeDisabled();
  expect(screen.getAllByRole("button", { name: "communication.moveDown" })[1]).toBeDisabled();
  expect(service.componentsApply).not.toHaveBeenCalled();
  const preview = screen.getByRole("button", { name: "communication.previewComponents" });
  expect(preview).toHaveClass("w-full", "sm:w-auto", "sm:justify-self-start");
  await userEvent.click(preview);
  await screen.findByRole("button", { name: "communication.applyComponents" });
  await userEvent.click(screen.getByRole("button", { name: "communication.applyComponents" }));
  await waitFor(() => expect(service.componentsApply).toHaveBeenCalledWith("page", [expect.objectContaining({ componentId: "dns" }), expect.objectContaining({ componentId: "component" })], "revision"));
});
it("uses one end-aligned announcement footer with Cancel enabled only for unsaved changes", async () => {
  renderEditor("announcements");
  const cancel = screen.getByRole("button", { name: "common:actions.cancel" });
  const save = screen.getByRole("button", { name: "communication.saveDraft" });
  expect(cancel).toBeDisabled();
  expect(cancel.parentElement).toBe(save.parentElement);
  expect(cancel.parentElement).toHaveClass("sm:justify-end");
  expect(cancel).toHaveClass("bg-secondary");
  fireEvent.change(screen.getByLabelText("communication.announcementTitle"), { target: { value: "Investigating" } });
  expect(cancel).toBeEnabled();
});

it("inserts a dragged component at its destination while preserving the intervening order", async () => {
  const extra = ["DNS", "TCP"].map((name, index) => ({ ...data.components[0]!, componentId: name, monitorId: name, privateName: name, name, sortOrder: index + 1 }));
  render(<ComponentEditor data={{ ...data, components: [...data.components, ...extra] }} changed={async () => {}} />);
  const transfer = { setData: vi.fn(), effectAllowed: "" };
  fireEvent.dragStart(screen.getByRole("button", { name: "Reorder API" }), { dataTransfer: transfer });
  fireEvent.dragOver(screen.getByRole("group", { name: "TCP" }));
  fireEvent.drop(screen.getByRole("group", { name: "TCP" }));
  expect(screen.getAllByRole("group").map(group => group.querySelector("legend")?.textContent)).toEqual(["DNS", "TCP", "Private API"]);
  expect(service.componentsApply).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "communication.previewComponents" }));
  await screen.findByRole("button", { name: "communication.applyComponents" });
  expect(service.componentsPreview).toHaveBeenCalledWith("page", [expect.objectContaining({ componentId: "DNS" }), expect.objectContaining({ componentId: "TCP" }), expect.objectContaining({ componentId: "component" })]);
});

it("summarizes an empty private draft with human labels and reserves the sticky footer", async () => {
  render(<AnnouncementEditor data={data} schedules={[]} changed={async () => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "communication.saveDraft" }));
  const summary = screen.getByRole("link", { name: /communication.affected:/ }).closest('[role="alert"]');
  expect(summary).not.toHaveTextContent("announcement-componentIds");
  expect(summary).not.toHaveTextContent("*");
  expect(summary).not.toHaveTextContent("communication.submitError");
  expect(screen.getByRole("link", { name: /communication.affected:/ })).toBeInTheDocument();
  expect(screen.getByLabelText("communication.announcementTitle")).toHaveFocus();
  expect(document.querySelector("form [data-sticky-form-footer]")).toBeInTheDocument();
});
