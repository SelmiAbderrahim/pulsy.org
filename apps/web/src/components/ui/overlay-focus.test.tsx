import { useRef, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: locale }) }));

function MenuDialog() {
  const [open, setOpen] = useState(false);
  return <>
    <DropdownMenu><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent>
      <DropdownMenuItem>Refresh</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setOpen(true)}>Edit</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Edit monitor</DialogTitle><input aria-label="Name" /></DialogContent></Dialog>
    <button type="button">Next action</button>
  </>;
}

describe("shared overlay focus", () => {
  it("returns a cancelled tab confirmation to the selected tab without activating the attempted tab again", async () => {
    const attempted = vi.fn();
    function GuardedTabs() {
      const [open, setOpen] = useState(false);
      return <>
        <Tabs value="general" onValueChange={value => { attempted(value); setOpen(true); }}>
          <TabsList><TabsTrigger value="general">General</TabsTrigger><TabsTrigger value="announcements">Announcements</TabsTrigger></TabsList>
          <TabsContent value="general"><input aria-label="Title" /></TabsContent>
        </Tabs>
        <Dialog open={open} onOpenChange={setOpen}><DialogContent role="alertdialog" aria-describedby={undefined}>
          <DialogTitle>Leave without saving?</DialogTitle><button onClick={() => setOpen(false)}>Keep editing</button>
        </DialogContent></Dialog>
      </>;
    }
    render(<GuardedTabs />);
    await userEvent.click(screen.getByRole("tab", { name: "Announcements" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus());
    const attemptsBeforeClose = attempted.mock.calls.length;
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("tab", { name: "General" })).toHaveFocus());
    expect(attempted).toHaveBeenCalledTimes(attemptsBeforeClose);
  });

  it.each(["Escape", "item"])("returns menu focus after %s and supports the next first click", async close => {
    render(<MenuDialog />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await userEvent.click(trigger);
    if (close === "Escape") await userEvent.keyboard("{Escape}");
    else await userEvent.click(screen.getByRole("menuitem", { name: "Refresh" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(document.querySelector("[inert]")).toBeNull();
    await userEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("preserves outside-click focus and restores the trigger on the next Escape", async () => {
    render(<MenuDialog />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    const outside = screen.getByRole("button", { name: "Next action" });
    await userEvent.click(trigger);
    await userEvent.click(outside);
    await waitFor(() => expect(outside).toHaveFocus());
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("returns to the clicked trigger even if another control held focus on pointerdown", async () => {
    render(<MenuDialog />);
    await userEvent.click(screen.getByRole("button", { name: "Next action" }));
    const trigger = screen.getByRole("button", { name: "Actions" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps focus in a dialog opened by a menu item, then returns to the menu trigger", async () => {
    render(<MenuDialog />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(document.querySelector("[inert]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next action" }));
    expect(screen.getByRole("button", { name: "Next action" })).toHaveFocus();
  });

  it("preserves a disabled asChild trigger after readiness", () => {
    render(<DropdownMenu><DropdownMenuTrigger asChild><button disabled type="button">Unavailable</button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Action</DropdownMenuItem></DropdownMenuContent></DropdownMenu>);
    expect(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unavailable" })).not.toHaveAttribute("aria-busy");
  });

  it("focuses the selected Radix tab before controls in its panel", () => {
    render(<Sheet defaultOpen><SheetContent aria-describedby={undefined}><SheetTitle>Notifications</SheetTitle><Tabs defaultValue="channels"><TabsList><TabsTrigger value="providers">Providers</TabsTrigger><TabsTrigger value="channels">Channels</TabsTrigger></TabsList><TabsContent value="channels"><input aria-label="Search channels" /></TabsContent></Tabs></SheetContent></Sheet>);
    expect(screen.getByRole("tab", { name: "Channels" })).toHaveFocus();
  });

  it("uses the first tab instead of an explicitly focused sheet heading", async () => {
    function Panel() {
      const title = useRef<HTMLHeadingElement>(null);
      return <Sheet defaultOpen><SheetContent aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}><SheetTitle ref={title} tabIndex={-1}>Notifications</SheetTitle><div role="tablist"><button role="tab" aria-selected="true">Providers</button><button role="tab" tabIndex={-1}>Channels</button></div></SheetContent></Sheet>;
    }
    render(<Panel />);
    expect(screen.getByRole("tab", { name: "Providers" })).toHaveFocus();
  });

  it("skips disabled and hidden controls and retains intentional custom control focus", () => {
    function Panel() {
      const preferred = useRef<HTMLInputElement>(null);
      return <Dialog open><DialogContent aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); preferred.current?.focus(); }}><DialogTitle>Search</DialogTitle><input aria-label="First" /><input ref={preferred} aria-label="Preferred" /></DialogContent></Dialog>;
    }
    const first = render(<Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Form</DialogTitle><button disabled>Disabled</button><div style={{ display: "none" }}><input aria-label="Hidden" /></div><input aria-label="Visible" /></DialogContent></Dialog>);
    expect(screen.getByRole("textbox", { name: "Visible" })).toHaveFocus();
    first.unmount();
    render(<Panel />);
    expect(screen.getByRole("textbox", { name: "Preferred" })).toHaveFocus();
  });

  it("never makes header chrome such as the Help link the initial focus", () => {
    render(<Sheet defaultOpen><SheetContent aria-describedby={undefined}><header><SheetTitle>Incident</SheetTitle><a data-overlay-chrome href="/dashboard/help/incidents">Help</a><button data-overlay-chrome type="button">Close panel</button></header><textarea aria-label="Note" /></SheetContent></Sheet>);
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Help" })).not.toHaveFocus();
  });

  it("falls back to the title, not the Help link, when the panel has no other control", () => {
    render(<Sheet defaultOpen><SheetContent aria-describedby={undefined}><header><SheetTitle>Incident</SheetTitle><a data-overlay-chrome href="/dashboard/help/incidents">Help</a></header><p>Loading</p></SheetContent></Sheet>);
    expect(screen.getByRole("heading", { name: "Incident" })).toHaveFocus();
  });

  it("uses a title fallback with no outline when there are no content controls", () => {
    render(<Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Information</DialogTitle><p>Read this.</p></DialogContent></Dialog>);
    const title = screen.getByRole("heading", { name: "Information" });
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute("tabindex", "-1");
    expect(title).toHaveClass("focus:outline-hidden");
  });

  it("returns a nested dialog to its sheet without releasing the parent's modal lock", async () => {
    render(<Sheet><SheetTrigger>Open sheet</SheetTrigger><SheetContent aria-describedby={undefined}><SheetTitle>Settings</SheetTitle><Dialog><DialogTrigger>Edit setting</DialogTrigger><DialogContent aria-describedby={undefined}><DialogTitle>Editor</DialogTitle><input aria-label="Setting" /></DialogContent></Dialog></SheetContent></Sheet>);
    await userEvent.click(screen.getByRole("button", { name: "Open sheet" }));
    const innerTrigger = screen.getByRole("button", { name: "Edit setting" });
    await userEvent.click(innerTrigger);
    expect(screen.getByRole("textbox", { name: "Setting" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(innerTrigger).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "actions.close" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open sheet" })).toHaveFocus());
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(document.querySelector("[inert]")).toBeNull();
  });

});


it.each(["menu", "trigger"])("closes on Escape from %s during the first layer-registration frame", async target => {
  let pressedEscape = false;
  const onLayerRegistered = () => {
    const menu = document.querySelector('[role="menu"][data-state="open"]');
    if (!menu || pressedEscape) return;
    pressedEscape = true;
    // Radix adds its layer in an effect before its cached layer index rerenders.
    const destination = target === "menu" ? menu : screen.getByRole("button", { name: "Actions" });
    destination.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  };
  document.addEventListener("dismissableLayer.update", onLayerRegistered);
  try {
    render(<MenuDialog />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await userEvent.click(trigger);
    expect(pressedEscape).toBe(true);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  } finally {
    document.removeEventListener("dismissableLayer.update", onLayerRegistered);
  }
});

it("gives portalled menus the active locale direction and honors explicit direction", async () => {
  locale.language = "ar";
  try {
    const first = render(<MenuDialog />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menu")).toHaveAttribute("dir", "rtl");
    first.unmount();
    render(<DropdownMenu dir="ltr" defaultOpen><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Refresh</DropdownMenuItem></DropdownMenuContent></DropdownMenu>);
    expect(screen.getByRole("menu")).toHaveAttribute("dir", "ltr");
  } finally { locale.language = "en"; }
});


it("honors Escape cancellation during layer registration for controlled menus", async () => {
  const onOpenChange = vi.fn();
  const onEscapeKeyDown = vi.fn((event: KeyboardEvent) => event.preventDefault());
  let pressedEscape = false;
  const onLayerRegistered = () => {
    const menu = document.querySelector('[role="menu"][data-state="open"]');
    if (!menu || pressedEscape) return;
    pressedEscape = true;
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  };
  document.addEventListener("dismissableLayer.update", onLayerRegistered);
  try {
    render(<DropdownMenu open onOpenChange={onOpenChange}><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent onEscapeKeyDown={onEscapeKeyDown}><DropdownMenuItem>Refresh</DropdownMenuItem></DropdownMenuContent></DropdownMenu>);
    expect(pressedEscape).toBe(true);
    expect(onEscapeKeyDown).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  } finally { document.removeEventListener("dismissableLayer.update", onLayerRegistered); }
});
