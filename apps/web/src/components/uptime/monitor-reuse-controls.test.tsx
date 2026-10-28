import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { createWrapper } from "@/test/query-wrapper";
import { reactI18nextMock } from "@/test/i18n-mock";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import type { MonitorTemplate } from "@/types/monitor-templates";
import type { MonitorCreateDialogProps } from "./monitor-create-dialog";
import { MonitorTemplatesControls } from "./monitor-reuse-controls";
const mocks = vi.hoisted(() => ({ list: vi.fn(), channels: vi.fn(), remove: vi.fn() }));
vi.mock("@/services/uptime/monitorTemplatesService", () => ({ MonitorTemplatesService: mocks }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/components/ui/docs-help-link", () => ({ DocsHelpLink: () => <a href="/dashboard/help/saved-views">Help</a> }));
const saved: MonitorTemplate = { id: "saved", name: "Saved template", needsRequestValues: false, createdAt: "2026-10-11", updatedAt: "2026-10-11", configuration: { method: "GET", interval: 300, timeout: 1234, expectedStatus: 200, failureThreshold: 3, tags: [] } };
vi.mock("./monitor-create-dialog", () => ({ MonitorCreateDialog: (props: MonitorCreateDialogProps) => <Dialog open={props.open} onOpenChange={props.onOpenChange}><DialogContent aria-describedby={undefined}><DialogTitle>Template editor</DialogTitle><button onClick={() => { props.onTemplateSaved?.(saved); props.onOpenChange(false); }}>Save fixture template</button></DialogContent></Dialog> }));
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([]); mocks.channels.mockResolvedValue([]); });
it("selects a saved template immediately and keeps it usable through refetch", async () => {
  const { Wrapper } = createWrapper();
  render(<MonitorTemplatesControls />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "templates.title" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "templates.new" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "templates.new" }));
  mocks.list.mockResolvedValue([saved]);
  await userEvent.click(screen.getByRole("button", { name: "Save fixture template" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: /Saved template.*GET/ })).toHaveAttribute("aria-checked", "true"));
  expect(screen.getByRole("button", { name: "templates.use" })).toBeEnabled();
  await userEvent.type(screen.getByRole("searchbox"), "not found");
  expect(screen.getByText("bulkUX.noTemplates")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "templates.use" })).toBeDisabled();
});

it("guides an empty list, says what is selected in a live region, and activates with the keyboard", async () => {
  const { Wrapper } = createWrapper();
  render(<MonitorTemplatesControls />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "templates.title" }));
  expect(await screen.findByText("templates.empty")).toBeInTheDocument();
  expect(screen.getByText("templates.pickerHint")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "templates.use" })).toBeDisabled();
});

it("announces the chosen template and enables Create from template only after a deliberate keyboard choice", async () => {
  mocks.list.mockResolvedValue([saved]);
  const { Wrapper } = createWrapper();
  render(<MonitorTemplatesControls />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "templates.title" }));
  const choice = await screen.findByRole("radio", { name: /Saved template.*GET/ });
  expect(screen.getByRole("status", { name: "" })).toHaveTextContent("templates.choose");
  expect(screen.getByRole("button", { name: "templates.use" })).toBeDisabled();
  choice.focus(); await userEvent.keyboard("{Enter}");
  expect(choice).toHaveAttribute("aria-checked", "true");
  expect(screen.getAllByRole("status").some(node => /templates\.selected.*Saved template/.test(node.textContent ?? ""))).toBe(true);
  expect(screen.getByRole("button", { name: "templates.use" })).toBeEnabled();
});

it("moves radio selection with arrow keys and highlights the selected template", async () => {
  mocks.list.mockResolvedValue([saved, { ...saved, id: "second", name: "Second template" }]);
  const { Wrapper } = createWrapper(); render(<MonitorTemplatesControls />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "templates.title" }));
  const first = await screen.findByRole("radio", { name: /Saved template.*GET/ }); first.focus();
  await userEvent.keyboard("{ArrowDown}");
  const second = screen.getByRole("radio", { name: /Second template.*GET/ });
  expect(second).toHaveFocus(); expect(second).toHaveAttribute("aria-checked", "true"); expect(second.closest("[data-template-card]")).toHaveClass("border-primary");
  await userEvent.keyboard("{Home}"); expect(first).toHaveFocus(); expect(first).toHaveAttribute("aria-checked", "true");
});


it("keeps the Templates drawer, search, selection and focus when its editor is dismissed", async () => {
  mocks.list.mockResolvedValue([saved]);
  const { Wrapper } = createWrapper(); render(<MonitorTemplatesControls />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "templates.title" }));
  const drawer = await screen.findByRole("dialog", { name: "templates.title" });
  await userEvent.type(screen.getByRole("searchbox"), "Saved");
  await userEvent.click(await screen.findByRole("radio", { name: /Saved template.*GET/ }));
  const opener = screen.getByRole("button", { name: "templates.new" });
  await userEvent.click(opener);
  expect(screen.getByRole("dialog", { name: "Template editor" })).toBeInTheDocument();
  expect(drawer).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Template editor" })).not.toBeInTheDocument());
  expect(screen.getByRole("dialog", { name: "templates.title" })).toBe(drawer);
  expect(screen.getByRole("searchbox")).toHaveValue("Saved");
  expect(screen.getByRole("radio", { name: /Saved template.*GET/ })).toHaveAttribute("aria-checked", "true");
  await waitFor(() => expect(opener).toHaveFocus());
});

it("keeps an accessible radio indicator and two-line selected summary inside its hovered card", async () => {
  mocks.list.mockResolvedValue([saved]);
  const { Wrapper } = createWrapper(); render(<MonitorTemplatesControls />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "templates.title" }));
  const radio = await screen.findByRole("radio", { name: /Saved template.*GET/ });
  const group = screen.getByRole("radiogroup");
  expect(group.tagName).toBe("DIV");
  expect(group.querySelector("li")).not.toBeInTheDocument();
  expect(radio.querySelector("[data-radio-indicator]")).toHaveAttribute("aria-hidden", "true");
  const card = radio.closest("[data-template-card]")!;
  expect(card).toHaveClass("hover:bg-accent");
  await userEvent.click(radio);
  const summary = within(card as HTMLElement).getByRole("status");
  expect(summary.children).toHaveLength(2);
  expect(summary).toHaveTextContent("templates.selected");
  expect(summary).toHaveTextContent("templates.rulesCount_other");
  expect(screen.getByRole("heading", { name: "templates.title" }).parentElement).toContainElement(screen.getByRole("link", { name: "Help" }));
});

it("cannot create from a selected template hidden by search and restores the choice when visible again", async () => {
  mocks.list.mockResolvedValue([saved, { ...saved, id: "second", name: "Second template" }]);
  const { Wrapper } = createWrapper(); render(<MonitorTemplatesControls />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "templates.title" }));
  await userEvent.click(await screen.findByRole("radio", { name: /Saved template.*GET/ }));
  await userEvent.type(screen.getByRole("searchbox"), "Second");
  expect(screen.getByRole("radio", { name: /Second template.*GET/ })).toHaveAttribute("aria-checked", "false");
  expect(screen.queryByRole("radio", { name: /Saved template.*GET/ })).not.toBeInTheDocument();
  const create = screen.getByRole("button", { name: "templates.use" });
  expect(create).toBeDisabled();
  await userEvent.click(create);
  expect(screen.queryByRole("dialog", { name: "Template editor" })).not.toBeInTheDocument();
  await userEvent.clear(screen.getByRole("searchbox"));
  expect(screen.getByRole("radio", { name: /Saved template.*GET/ })).toHaveAttribute("aria-checked", "true");
  expect(create).toBeEnabled();
});
