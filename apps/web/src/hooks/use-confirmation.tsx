import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useOverlayFocusReturn } from "@/components/ui/overlay-focus";
import { isRepeatedConfirmationText } from "@/lib/confirmation-text";

type Confirmation = { title: string; description: string; action: string; destructive?: boolean; confirmationName?: string };

/** Only one decision can be pending; Escape and unmount both cancel it. */
export function useConfirmation() {
  const { t, i18n } = useTranslation("common");
  const [request, setRequest] = useState<Confirmation | null>(null);
  const [name, setName] = useState("");
  const nameId = useId();
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusReturn = useOverlayFocusReturn();
  const settle = useCallback((accepted: boolean) => {
    const pending = resolve.current;
    resolve.current = null;
    setRequest(null);
    pending?.(accepted);
  }, []);
  useEffect(() => () => { resolve.current?.(false); resolve.current = null; }, []);
  const confirm = useCallback((options: Confirmation): Promise<boolean> => {
    if (resolve.current) return Promise.resolve(false);
    if (isRepeatedConfirmationText(options.title, options.description)) return Promise.reject(new Error("Confirmations require a title distinct from their description"));
    setName("");
    setRequest(options);
    return new Promise<boolean>(done => { resolve.current = done; });
  }, []);
  const dialog = <AlertDialog open={!!request} onOpenChange={open => { if (!open) settle(false); }}>
    <AlertDialogContent role="alertdialog" onKeyDownCapture={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); settle(false); } }} onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); settle(false); }} dir={(i18n?.language ?? "en").startsWith("ar") ? "rtl" : "ltr"} onOpenAutoFocus={event => { focusReturn.capture(); event.preventDefault(); cancelRef.current?.focus(); }} onCloseAutoFocus={focusReturn.restore} onPointerDownOutside={event => event.preventDefault()}>
      <AlertDialogHeader><AlertDialogTitle>{request?.title}</AlertDialogTitle><AlertDialogDescription className="break-words">{request?.description}</AlertDialogDescription></AlertDialogHeader>
      {request?.confirmationName && <label htmlFor={nameId} className="grid gap-2 text-sm">{t("actions.confirmName", {name:request.confirmationName})}<Input id={nameId} value={name} onChange={event => setName(event.target.value)} autoComplete="off" /></label>}
      <AlertDialogFooter>
        <AlertDialogCancel ref={cancelRef} className="min-h-11" onClick={() => settle(false)}>{t("actions.cancel")}</AlertDialogCancel>
        <AlertDialogAction disabled={!!request?.confirmationName && name !== request.confirmationName} className={request?.destructive ? "min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" : "min-h-11"} onClick={() => settle(true)}>{request?.action}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
  return { confirm, dialog };
}
