import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { SectionCard } from "./section-card";
import { FormField } from "./form-field";
import { FormFooter } from "./form-footer";
import { NavItem } from "./nav-item";
import { layoutTokens } from "./layout-tokens";

describe("layout primitives", () => {
  it("toggles a named disclosure with Enter and Space without submitting its form", async () => {
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><Collapsible><CollapsibleTrigger>Advanced</CollapsibleTrigger><CollapsibleContent>Advanced fields</CollapsibleContent></Collapsible></form>);
    const trigger = screen.getByRole("button", { name: "Advanced" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Advanced fields")).not.toBeVisible();
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toHaveTextContent("Advanced fields");
    expect(screen.getByText("Advanced fields")).toBeVisible();
    expect(screen.getByText("Advanced fields")).toHaveClass("p-4");
    await userEvent.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(submit).not.toHaveBeenCalled();
  });
  it("supports default-open, controlled state and disabled triggers", async () => {
    function Controlled() {
      const [open, setOpen] = useState(true);
      return <Collapsible open={open} onOpenChange={setOpen}><CollapsibleTrigger>Controlled</CollapsibleTrigger><CollapsibleContent>Controlled content</CollapsibleContent></Collapsible>;
    }
    render(<><Controlled /><Collapsible defaultOpen disabled><CollapsibleTrigger>Disabled</CollapsibleTrigger><CollapsibleContent>Default content</CollapsibleContent></Collapsible></>);
    expect(screen.getByText("Default content")).toBeVisible();
    expect(screen.getByRole("button", { name: "Disabled" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Controlled" }));
    expect(screen.getByText("Controlled content")).not.toBeVisible();
  });
  it("gives sections a title, description and header action", () => {
    render(<SectionCard title="Notifications" description="Delivery settings" headerEnd={<a href="/help">Learn more</a>}><p>Fields</p></SectionCard>);
    expect(screen.getByRole("heading", { name: "Notifications", level: 2 })).toHaveClass("text-base", "font-semibold");
    expect(screen.getByRole("region", { name: "Notifications" })).toHaveClass("p-4", "sm:p-6");
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "/help");
  });
  it("connects field labels, existing descriptions, helper and error to the control", () => {
    render(<><p id="external">Existing description</p><FormField label="Name" helper="Visible name" error="Name is required" control={<input id="name" aria-describedby="external" />} /></>);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveAccessibleDescription("Existing description Visible name Name is required");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Visible name").parentElement).toHaveClass("mt-1.5");
  });
  it("provides responsive action width and an opt-in sticky footer", () => {
    const { rerender } = render(<FormFooter><button>Save</button></FormFooter>);
    expect(screen.getByRole("button").parentElement).toHaveClass("sm:justify-end", "[&>*]:w-full", "sm:[&>*]:w-auto");
    expect(screen.getByRole("button").parentElement).not.toHaveClass("sticky");
    rerender(<FormFooter sticky><button>Save</button></FormFooter>);
    expect(screen.getByRole("button").parentElement).toHaveClass("sticky", "bottom-0", "bg-background");
  });
  it("uses the same navigation item for links and buttons, with current-page semantics", async () => {
    const click = vi.fn();
    render(<><NavItem asChild active><a href="/dashboard">Monitors</a></NavItem><NavItem onClick={click}>Preferences</NavItem></>);
    const link = screen.getByRole("link", { name: "Monitors" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveAttribute("href", "/dashboard");
    await userEvent.click(screen.getByRole("button", { name: "Preferences" }));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
    expect(layoutTokens).toEqual({ listDrawer: "sm:max-w-[var(--management-drawer-width)]", complexDrawer: "sm:max-w-[var(--management-drawer-width)]", createDialog: "max-w-[var(--dialog-standard)]", touchTarget: "min-h-11 min-w-11 shrink-0" });
  });
});
