import { useState } from "react";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "@/lib/toast";
import { ConfirmationHost } from "./confirmation-host";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Toaster } from "./sonner";

afterEach(() => { toast.dismiss(); cleanup(); vi.unstubAllGlobals(); });

function Draft() {
	const [open, setOpen] = useState(true);
	return <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Draft</DialogTitle>
		<form><input aria-label="Name" defaultValue="" /><button type="button" data-dialog-discard onClick={() => setOpen(false)}>Cancel</button></form>
	</DialogContent></Dialog>;
}

it("keeps toasts clickable inside an open modal and a toast click never triggers the discard guard", async () => {
	vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
	const i18n = i18next.createInstance();
	await i18n.init({ lng: "en", resources: { en: { common: { actions: { close: "Close", cancel: "Cancel", discard: "Discard" }, nav: { notifications: "Notifications", discard: "Discard changes?" } } } }, defaultNS: "common" });
	render(<I18nextProvider i18n={i18n}><ConfirmationHost /><Draft /><Toaster /></I18nextProvider>);
	await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Unsaved");
	act(() => { toast.success("Saved elsewhere"); toast.info("Second"); });
	const message = await screen.findByText("Saved elsewhere");
	const host = document.querySelector<HTMLElement>("[data-toast-host]")!;
	// The host moves inside the modal so the focus scope and pointer-events lock do not swallow its controls.
	await waitFor(() => expect(host.closest('[role="dialog"]')).not.toBeNull());
	const closeButton = message.closest("[data-sonner-toast]")!.querySelector<HTMLElement>("[data-close-button]")!;
	expect(closeButton).toBeTruthy();
	expect(getComputedStyle(closeButton).pointerEvents).not.toBe("none");
	expect(getComputedStyle(host).pointerEvents).not.toBe("none");
	await userEvent.click(closeButton);
	await waitFor(() => expect(screen.queryByText("Saved elsewhere")).toBeNull());
	expect(message).not.toBeInTheDocument();
	expect(screen.queryByRole("alertdialog")).toBeNull();
	expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Unsaved");
	// A click on toast text (outside the dialog content bounds) is also not treated as a dismissal.
	await userEvent.click(screen.getByText("Second"));
	expect(screen.queryByRole("alertdialog")).toBeNull();
});
