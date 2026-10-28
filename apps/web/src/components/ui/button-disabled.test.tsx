import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Button, DisabledReason } from "./button";

it.each(["default", "destructive", "outline", "secondary", "ghost", "link"] as const)("preserves the %s variant when disabled", variant => {
  const action = vi.fn();
  render(<Button variant={variant} disabled onClick={action}>Save</Button>);
	const button = screen.getByRole("button", { name: "Save" });
	expect(button).toHaveClass("disabled:opacity-50", "disabled:cursor-not-allowed");
	expect(button).not.toHaveClass("disabled:[opacity:1]");
	expect(button).toHaveClass("disabled:text-muted-foreground");
	if (variant !== "link") expect(button).toHaveClass("disabled:bg-muted");
  fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
});

it("makes a disabled reason keyboard reachable without enabling the action", () => {
  render(<DisabledReason reason="No older checks"><Button disabled>Older</Button></DisabledReason>);
  const wrapper = screen.getByRole("group", { name: "No older checks" });
  expect(wrapper).toHaveAttribute("tabindex", "0");
  wrapper.focus();
  expect(wrapper).toHaveFocus();
  expect(screen.getByRole("button", { name: "Older" })).toBeDisabled();
  expect(wrapper).not.toHaveClass("pointer-events-none");
});
