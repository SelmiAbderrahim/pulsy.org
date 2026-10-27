import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationHost } from "./confirmation-host";
import { requestConfirmation } from "@/lib/confirmation";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
describe("shared destructive confirmation", () => {
  it("traps focus, requires the optional exact name, and restores the opener", async () => {
    const removed = vi.fn();
    function Fixture() {
      const [status, setStatus] = useState("ready");
      return <><ConfirmationHost /><button onClick={async () => {
        if (await requestConfirmation("Delete Production API?", { title: "Delete monitor", action: "Delete", confirmationName: "Production API" })) { removed(); setStatus("deleted"); }
      }}>Remove monitor</button><p role="status">{status}</p></>;
    }
    render(<Fixture />);
    const opener = screen.getByRole("button", { name: "Remove monitor" });
    await userEvent.click(opener);
    const cancel = screen.getByRole("button", { name: "actions.cancel" });
    expect(cancel).toHaveFocus();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "Production");
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(removed).not.toHaveBeenCalled();
    await userEvent.click(opener);
    await userEvent.type(screen.getByRole("textbox"), "Production API");
    const action = screen.getByRole("button", { name: "Delete" });
    expect(action).toHaveClass("bg-destructive");
    await userEvent.click(action);
    expect(removed).toHaveBeenCalledOnce();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
