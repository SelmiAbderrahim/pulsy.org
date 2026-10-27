import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogTrigger, AlertDialogCancel } from "./alert-dialog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));

describe("modal backdrop stack", () => {
  it("dims only the newest overlay and restores its parent when a nested modal closes", async () => {
    render(<Sheet><SheetTrigger>Open sheet</SheetTrigger><SheetContent aria-describedby={undefined}><SheetTitle>Sheet</SheetTitle>
      <Dialog><DialogTrigger>Open editor</DialogTrigger><DialogContent aria-describedby={undefined}><DialogTitle>Editor</DialogTitle>
        <AlertDialog><AlertDialogTrigger>Confirm</AlertDialogTrigger><AlertDialogContent aria-describedby={undefined}><AlertDialogTitle>Confirmation</AlertDialogTitle><AlertDialogCancel>Cancel confirmation</AlertDialogCancel></AlertDialogContent></AlertDialog>
      </DialogContent></Dialog>
    </SheetContent></Sheet>);
    const assertStack = (count: number) => {
      const layers = [...document.querySelectorAll("[data-modal-backdrop]")];
      expect(layers).toHaveLength(count);
      expect(layers.filter(layer => layer.getAttribute("data-dimmed") === "true")).toEqual([layers.at(-1)]);
      for (const layer of layers.slice(0, -1)) expect(layer).toHaveAttribute("data-dimmed", "false");
    };
    await userEvent.click(screen.getByRole("button", { name: "Open sheet" })); assertStack(1);
    await userEvent.click(screen.getByRole("button", { name: "Open editor" })); assertStack(2);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" })); assertStack(3);
    await userEvent.click(screen.getByRole("button", { name: "Cancel confirmation" })); await waitFor(() => assertStack(2));
    await userEvent.keyboard("{Escape}"); await waitFor(() => assertStack(1));
    await userEvent.keyboard("{Escape}"); await waitFor(() => expect(document.querySelectorAll("[data-modal-backdrop]")).toHaveLength(0));
  });
});
