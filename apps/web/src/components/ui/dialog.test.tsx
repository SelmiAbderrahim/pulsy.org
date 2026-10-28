import { useEffect, useState } from "react";
import { fireEvent, render as baseRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { ConfirmationHost } from "./confirmation-host";
import { Switch } from "./switch";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import type { ReactNode } from "react";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
const render = (children: ReactNode) => baseRender(<><ConfirmationHost />{children}</>);
afterEach(() => vi.restoreAllMocks());
function Draft() {
  const [open, setOpen] = useState(true);
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Draft</DialogTitle><form onSubmit={event => { event.preventDefault(); setOpen(false); }}><input aria-label="Name" defaultValue="" /><button type="button" data-dialog-discard onClick={() => setOpen(false)}>Cancel</button><button type="submit">Save</button></form></DialogContent></Dialog>;
}
describe("dialog draft dismissal", () => {
  it("protects changed Radix switches and selects while allowing a reverted draft", async () => {
    function Controls() {
      const [open, setOpen] = useState(true), [enabled, setEnabled] = useState(false), [type, setType] = useState("email");
      return <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Channel</DialogTitle><form>
        <Switch aria-label="Enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Select value={type} onValueChange={setType}><SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="webhook">Webhook</SelectItem></SelectContent></Select>
        <button type="button" data-dialog-discard onClick={() => setOpen(false)}>Cancel</button>
      </form></DialogContent></Dialog>;
    }
    render(<Controls />);
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "actions.cancel" }));
    expect(screen.getByRole("switch")).toBeChecked();
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: "Webhook" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "actions.cancel" }));
    expect(screen.getByRole("combobox")).toHaveTextContent("Webhook");
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: "Email" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 15_000);
  it("restores a connected external button when the controlled root unmounts", async () => {
    function ConditionalDialog() {
      const [open, setOpen] = useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>Add monitor</button>{open && <Dialog open onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Create</DialogTitle></DialogContent></Dialog>}</>;
    }
    render(<ConditionalDialog />);
    const trigger = screen.getByRole("button", { name: "Add monitor" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "actions.close" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("returns focus to the application when a routed trigger has unmounted", async () => {
    function RoutedDialog() {
      const [open, setOpen] = useState(false);
      return <><main id="app-main" tabIndex={-1}>Workspace</main>{!open && <button type="button" onClick={() => setOpen(true)}>Open manager</button>}<Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Manager</DialogTitle></DialogContent></Dialog></>;
    }
    render(<RoutedDialog />);
    await userEvent.click(screen.getByRole("button", { name: "Open manager" }));
    await userEvent.click(screen.getByRole("button", { name: "actions.close" }));
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  });
  it("summarizes invalid fields and focuses the first invalid control without clearing entered values", async () => {
    const save = vi.fn();
    render(<Dialog open><DialogContent aria-describedby={undefined}><form onSubmit={save}><DialogHeader><DialogTitle>Validation</DialogTitle></DialogHeader><label htmlFor="required-name">Name</label><input id="required-name" required /><label htmlFor="bounded">Interval</label><input id="bounded" type="number" min="30" max="3600" defaultValue="12" /><button type="submit">Save</button></form></DialogContent></Dialog>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Name: nav.requiredField");
    expect(screen.getByRole("alert").closest(".dialog-header")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Interval: nav.fieldRange");
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.getByRole("spinbutton")).toHaveValue(12);
    await userEvent.type(screen.getByRole("textbox"), "Kept draft");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Name:");
  });
  it("keeps the draft on rejected Escape and Cancel, then allows explicit dismissal", async () => {
    render(<Draft />);
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Unsaved");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("nav.discard");
    await userEvent.click(screen.getByRole("button", { name: "actions.cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.getByRole("textbox")).toHaveValue("Unsaved");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("textbox")).toHaveValue("Unsaved");
    await userEvent.click(screen.getByRole("button", { name: "actions.close" }));
    await userEvent.click(screen.getByRole("button", { name: "actions.discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("does not warn when an edit is reverted to what it was, but still warns for a real change", async () => {
    render(<Draft />);
    const name = screen.getByRole("textbox", { name: "Name" });
    await userEvent.type(name, "Temporary");
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("counts a field from the value it had when first touched, so data loaded after opening is not an edit", async () => {
    function LateLoad() {
      const [open, setOpen] = useState(true);
      const [value, setValue] = useState("");
      useEffect(() => { const timer = setTimeout(() => setValue("Loaded name"), 20); return () => clearTimeout(timer); }, []);
      return <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Edit</DialogTitle><form><input aria-label="Name" value={value} onChange={event => setValue(event.target.value)} /><button type="button" data-dialog-discard onClick={() => setOpen(false)}>Cancel</button></form></DialogContent></Dialog>;
    }
    render(<LateLoad />);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Loaded name"));
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("treats checkboxes, selects and non-form inputs sensibly", async () => {
    function Mixed() {
      const [open, setOpen] = useState(true);
      return <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Mixed</DialogTitle><input aria-label="Search" /><form><input type="checkbox" aria-label="Enabled" /><select aria-label="Mode" defaultValue="a"><option value="a">A</option><option value="b">B</option></select><button type="button" data-dialog-discard onClick={() => setOpen(false)}>Cancel</button></form></DialogContent></Dialog>;
    }
    render(<Mixed />);
    await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "free text outside a form");
    await userEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Enabled" })); // toggled back
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Mode" }), "b");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Mode" }), "a"); // back
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("asks before a click on the backdrop discards a real draft, and not when nothing was entered", async () => {
    render(<Draft />);
    const overlay = () => document.querySelector<HTMLElement>("[data-state=open][aria-hidden=true].fixed.inset-0")!;
    await userEvent.click(overlay());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull(); // nothing entered: dismissed freely
    render(<Draft />);
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Unsaved");
    await userEvent.click(overlay());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "actions.cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.getByRole("textbox")).toHaveValue("Unsaved");
  });
  it("warns before the tab is reloaded or closed while a real draft is open, and not otherwise", async () => {
    render(<Draft />);
    const fire = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
    expect(fire()).toBe(false);
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Unsaved");
    expect(fire()).toBe(true);
    await userEvent.clear(screen.getByRole("textbox", { name: "Name" }));
    expect(fire()).toBe(false);
  });
  it("lets a successful explicit save close without a discard prompt", async () => {
    render(<Draft />);
    await userEvent.type(screen.getByRole("textbox"), "Saved");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

it("opens nested collapsed sections before focusing an invalid advanced field", async () => {
  render(<Dialog open><DialogContent aria-describedby={undefined}><form><DialogHeader><DialogTitle>Advanced</DialogTitle></DialogHeader><details><summary>Rules</summary><details><summary>Rule one</summary><label htmlFor="rule-value">Expected value</label><input id="rule-value" required /></details></details><button type="submit">Save</button></form></DialogContent></Dialog>);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(document.getElementById("rule-value")).toHaveFocus());
  expect([...document.querySelectorAll("details")].every(detail => detail.open)).toBe(true);
});

describe("focus return when a dialog is opened from a menu item", () => {
  it("returns to the menu's trigger, not to the page body, once the item is gone", async () => {
    function FromMenu() {
      const [menu, setMenu] = useState(false);
      const [open, setOpen] = useState(false);
      return <>
        <button type="button" onClick={() => setMenu(value => !value)}>Add monitor</button>
        {menu && <div role="menu"><button role="menuitem" type="button" onClick={() => { setMenu(false); setOpen(true); }}>Quick add</button></div>}
        {open && <Dialog open onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Quick</DialogTitle></DialogContent></Dialog>}
      </>;
    }
    render(<FromMenu />);
    const trigger = screen.getByRole("button", { name: "Add monitor" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("menuitem", { name: "Quick add" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "actions.close" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

it("reveals shared collapsed sections for native invalid fields and summary focus links", async () => {
  render(<Dialog open><DialogContent aria-describedby={undefined}><form>
    <DialogHeader><DialogTitle>Advanced configuration</DialogTitle></DialogHeader>
    <Collapsible><CollapsibleTrigger>Advanced</CollapsibleTrigger><CollapsibleContent>
      <Collapsible><CollapsibleTrigger>Rule</CollapsibleTrigger><CollapsibleContent>
        <label htmlFor="collapsed-rule">Expected value</label><input id="collapsed-rule" required />
      </CollapsibleContent></Collapsible>
    </CollapsibleContent></Collapsible><button type="submit">Save</button>
  </form></DialogContent></Dialog>);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByLabelText("Expected value")).toHaveFocus());
  expect(screen.getByLabelText("Expected value")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
  expect(screen.getByLabelText("Expected value")).not.toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Expected value: nav.requiredField" }));
  await waitFor(() => expect(screen.getByLabelText("Expected value")).toHaveFocus());
  expect(screen.getByLabelText("Expected value")).toBeVisible();
});
