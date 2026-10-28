import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatePicker } from "./date-picker";
import { FileDropzone } from "./file-dropzone";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));

function DateDraft() {
  const [open, setOpen] = useState(true);
  const [date, setDate] = useState<string | undefined>("2026-10-14");
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Date draft</DialogTitle><form>
    <DatePicker aria-label="Expiry" value={date} onValueChange={setDate} min="2026-10-10" max="2026-10-20" />
  </form></DialogContent></Dialog>;
}
function FileDraft({ initial = null }: { initial?: File | null }) {
  const [open, setOpen] = useState(true);
  const [file, setFile] = useState<File | null>(initial);
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>File draft</DialogTitle><form>
    <FileDropzone aria-label="Import" accept=".json" value={file} onChange={setFile} />
  </form></DialogContent></Dialog>;
}
const json = (name = "monitors.json", modified = 1) => new File(["{}"], name, { type: "application/json", lastModified: modified });
const hiddenFileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const escape = () => userEvent.keyboard("{Escape}");

describe("composite controls in dialog drafts", () => {
  it("keeps a changed date after cancelling dismissal, then permits explicit discard", async () => {
    render(<DateDraft />);
    await userEvent.click(screen.getByRole("button", { name: "Expiry" }));
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(screen.getByRole("button", { name: "Expiry" })).toHaveTextContent("Oct 15, 2026");
    await escape();
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "actions.cancel" }));
    expect(screen.getByRole("button", { name: "Expiry" })).toHaveTextContent("Oct 15, 2026");
    await escape();
    await userEvent.click(screen.getByRole("button", { name: "actions.discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("allows a date changed back to its original value to close freely", async () => {
    render(<DateDraft />);
    await userEvent.click(screen.getByRole("button", { name: "Expiry" }));
    await userEvent.keyboard("{ArrowRight}{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Expiry" }));
    await userEvent.keyboard("{ArrowLeft}{Enter}");
    await escape();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["upload", "drop"])("protects a file selected by %s from dismissal", async method => {
    render(<FileDraft />);
    if (method === "upload") await userEvent.upload(hiddenFileInput(), json());
    else fireEvent.drop(screen.getByRole("button", { name: "Import" }), { dataTransfer: { files: [json()] } });
    expect(screen.getByText("monitors.json")).toBeVisible();
    await escape();
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "actions.cancel" }));
    expect(screen.getByText("monitors.json")).toBeVisible();
  });

  it("protects removing an existing file, while a new file removed again is unchanged", async () => {
    const existing = render(<FileDraft initial={json()} />);
    await userEvent.click(screen.getByRole("button", { name: "controls.removeFile" }));
    await escape();
    expect(screen.getByRole("alertdialog")).toBeVisible();
    existing.unmount();
    render(<FileDraft />);
    await userEvent.upload(hiddenFileInput(), json());
    await userEvent.click(screen.getByRole("button", { name: "controls.removeFile" }));
    await escape();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("detects replacement by a same-name, same-size file modified at another time", async () => {
    render(<FileDraft initial={json()} />);
    fireEvent.drop(screen.getByRole("button", { name: "Import" }), { dataTransfer: { files: [json("monitors.json", 2)] } });
    await userEvent.click(document.querySelector<HTMLElement>("[data-modal-backdrop]")!);
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });
});
