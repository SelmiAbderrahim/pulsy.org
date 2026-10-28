import { isToastInteraction } from "@/lib/toast-interaction";
import { registerDraftGuard } from "@/lib/draft-guards";
import { formattingLocale } from "@/lib/formatting-locale";
import * as React from "react";
import { useModalBackdrop } from "./modal-backdrop";
import { createPortal } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { focusOverlayStart, useOverlayFocusReturn } from "./overlay-focus";
import { useReadyTriggerProps } from "./control-readiness";
import { revealAndFocusField as revealAndFocus } from "./form-validation";
import { useConfirmation } from "@/hooks/use-confirmation";

const DialogDismiss = React.createContext<(open: boolean) => void>(() => {});
function Dialog({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const change = (next: boolean) => { setInternalOpen(next); onOpenChange?.(next); };
  return <DialogDismiss.Provider value={change}><DialogPrimitive.Root {...props} open={open ?? internalOpen} onOpenChange={change} /></DialogDismiss.Provider>;
}
const DialogTrigger = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>((props, ref) => {
  const readiness = useReadyTriggerProps(props);
  return <DialogPrimitive.Trigger {...props} {...readiness} ref={ref} />;
});
DialogTrigger.displayName = DialogPrimitive.Trigger.displayName;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;
type FieldError = { field: HTMLInputElement; message: string; label: string };
const DialogErrors = React.createContext<FieldError[]>([]);


// Draft tracking: a dialog is "dirty" only while a form field differs from the value it had
// when the person first touched it. Edit-and-revert, preview toggles and tab changes are not
// edits. The baseline is taken at first interaction, not at open, because edit forms are
// populated asynchronously after the dialog mounts.
type Control = HTMLElement;
const isControl = (target: EventTarget | null): boolean =>
  (target instanceof HTMLInputElement && !["button", "submit", "reset", "hidden", "image"].includes(target.type)) ||
  target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.matches('[data-draft-control],[role="switch"],[role="checkbox"],[role="radio"],[role="combobox"]'));
function draftValue(control: Control): string {
  if (control.hasAttribute("data-draft-control")) return control.getAttribute("data-draft-value") ?? "";
  if (control instanceof HTMLInputElement) {
    if (control.type === "checkbox" || control.type === "radio") return String(control.checked);
    if (control.type === "file") return Array.from(control.files ?? []).map(file => `${file.name}:${file.size}`).join("|");
  }
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) return control.value;
  return control.getAttribute("aria-checked") ?? control.textContent ?? "";
}
/** Controls are only drafts when they live in a form; search/command inputs are not. */
const inForm = (control: Control) => control.closest("form") !== null && !control.hasAttribute("data-draft-ignore") && control.getAttribute("aria-hidden") !== "true";

const DialogOverlay = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  const backdropRef = useModalBackdrop(ref);
  return (
	<DialogPrimitive.Overlay
		ref={backdropRef}
    data-modal-backdrop=""
		className={cn(
			"fixed inset-0 z-50 bg-black/80 data-[dimmed=false]:bg-transparent data-[state=open]:animate-in data-[state=open]:fade-in-0",
			className,
		)}
		{...props}
	/>
); });
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showClose?: boolean; /** Explicit saved-value comparison for forms whose controls can display equivalent values. */ hasUnsavedChanges?: boolean }
>(({ className, children, showClose = true, hasUnsavedChanges, ...props }, ref) => {
 const { t, i18n } = useTranslation("common");
 const dismiss = React.useContext(DialogDismiss);
 const confirmation = useConfirmation();
 const baseline = React.useRef(new Map<Control, string>());
 const contentRef = React.useRef<HTMLDivElement | null>(null);
 const autofocusing = React.useRef(false);
 const returnFocus = useOverlayFocusReturn();
 const [errors, setErrors] = React.useState<FieldError[]>([]);
 const remember = (target: EventTarget | null, fallback = false) => {
   // Composite controls publish a stable value on their shared root. Their hidden
   // inputs, icons and remove buttons all belong to that same draft field.
   if (target instanceof HTMLElement) target = target.closest("[data-draft-control]") ?? target;
   if (target instanceof HTMLElement && !isControl(target)) target = target.closest('[role="switch"],[role="checkbox"],[role="radio"],[role="combobox"]');
   // Radix focuses the first field as the dialog opens, possibly before an edit form has its data.
   if (!(target instanceof HTMLElement) || !isControl(target) || !inForm(target) || baseline.current.has(target)) return;
   // No earlier gesture (programmatic edit): count from the empty/unchecked state, as before.
   baseline.current.set(target, fallback && !target.hasAttribute("data-draft-control") ? (target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio") ? "false" : "") : draftValue(target));
 };
 const isDirty = () => Boolean(contentRef.current?.isConnected) && (hasUnsavedChanges ?? (
   Boolean(contentRef.current?.querySelector('[data-draft-dirty="true"]')) ||
   Array.from(baseline.current).some(([control, initial]) => control.isConnected && !control.closest('[data-draft-dirty]') && draftValue(control) !== initial)
 ));
 const mayDismiss = () => {
   if (!isDirty()) return true;
   void confirmation.confirm({ description: t("nav.discard"), title: t("actions.discard"), action: t("actions.discard"), destructive: true }).then(accepted => {
     if (accepted) { baseline.current.clear(); dismiss(false); }
   });
   return false;
 };
 // Reloading or closing the tab with an unsaved draft asks first (in-app Back cannot be intercepted here).
 const dirtyRef = React.useRef(isDirty);
 dirtyRef.current = isDirty;
 React.useEffect(() => registerDraftGuard({ dirty: () => dirtyRef.current(), discard: () => { baseline.current.clear(); dismiss(false); } }), [dismiss]);
 React.useEffect(() => {
   const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current()) { event.preventDefault(); event.returnValue = ""; } };
   window.addEventListener("beforeunload", warn);
   return () => window.removeEventListener("beforeunload", warn);
 }, []);
 return (
  <>
	<DialogPortal>
		<DialogOverlay />
		<DialogPrimitive.Content
			ref={node => { contentRef.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }}
			className={cn(
				"dialog-panel fixed start-[50%] top-[max(1rem,5dvh)] z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-[var(--dialog-standard)] translate-x-[-50%] flex-col overflow-hidden rounded-lg border bg-card shadow-xs duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 rtl:translate-x-[50%]",
				className,
			)}
			{...props}
      onOpenAutoFocus={event => { returnFocus.capture(); baseline.current.clear(); autofocusing.current = true; setTimeout(() => { autofocusing.current = false; }, 0); setErrors([]); props.onOpenAutoFocus?.(event); focusOverlayStart(event); }}
      onFocusCapture={event => { if (!autofocusing.current) remember(event.target); props.onFocusCapture?.(event); }}
      onPointerDownCapture={event => { remember(event.target); props.onPointerDownCapture?.(event); }}
      onDropCapture={event => { remember(event.target); props.onDropCapture?.(event); }}
      onKeyDownCapture={event => { remember(event.target); props.onKeyDownCapture?.(event); }}
      onCloseAutoFocus={event => { props.onCloseAutoFocus?.(event); returnFocus.restore(event); }}
			onInvalidCapture={event => {
        props.onInvalidCapture?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        const field = event.target as HTMLInputElement;
        if (!field.validity || field.form?.dataset.sharedValidation === "true") return;
        const message = field.validity.valueMissing ? t("nav.requiredField") : field.validity.customError ? field.validationMessage : field.validity.rangeUnderflow || field.validity.rangeOverflow ? t("nav.fieldRange", { min: field.min ? new Intl.NumberFormat(formattingLocale(i18n.language)).format(Number(field.min)) : "—", max: field.max ? new Intl.NumberFormat(formattingLocale(i18n.language)).format(Number(field.max)) : "—" }) : t("nav.invalidField");
        field.setAttribute("aria-invalid", "true");
        setErrors(previous => [...previous.filter(error => error.field !== field), { field, message, label: field.labels?.[0]?.textContent ?? field.getAttribute("aria-label") ?? "" }]);
        queueMicrotask(() => {
          const first = Array.from(field.form?.elements ?? []).find(control =>
            (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) && !control.validity.valid,
          );
          if (first instanceof HTMLElement) revealAndFocus(first);
        });
      }}
			onInputCapture={event => {
        const field = event.target as HTMLInputElement;
        if (field.closest("form")?.dataset.sharedValidation !== "true") {
          field.removeAttribute("aria-invalid");
          setErrors(previous => previous.some(error => error.field === field) ? previous.filter(error => error.field !== field) : previous);
        }
        props.onInputCapture?.(event);
      }}
			onChangeCapture={event => {
        remember(event.target, true);
        props.onChangeCapture?.(event);
      }}
      onClickCapture={event => {
        if ((event.target as HTMLElement).closest("[data-dialog-discard]") && !mayDismiss()) {
          event.preventDefault(); event.stopPropagation(); return;
        }
        props.onClickCapture?.(event);
      }}
      onEscapeKeyDown={event => {
        props.onEscapeKeyDown?.(event);
        if (!event.defaultPrevented && !mayDismiss()) event.preventDefault();
      }}
      onPointerDownOutside={event => {
        if (isToastInteraction(event)) { event.preventDefault(); return; }
        props.onPointerDownOutside?.(event);
        if (!event.defaultPrevented && !mayDismiss()) event.preventDefault();
      }}
		>
			<DialogErrors.Provider value={errors}><div className="dialog-scroll">{children}</div></DialogErrors.Provider>
			{showClose && <DialogPrimitive.Close data-overlay-close data-dialog-discard className="absolute z-30 end-2 top-2 flex h-[44px] w-[44px] items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none sm:end-3 sm:top-3">
				<X className="h-4 w-4" />
				<span className="sr-only">{t("actions.close")}</span>
			</DialogPrimitive.Close>}
		</DialogPrimitive.Content>
	</DialogPortal>
    {confirmation.dialog}
  </>
); });
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const errors = React.useContext(DialogErrors);
  const { t } = useTranslation("common");
  const headerRef = React.useRef<HTMLDivElement>(null);
  const [summaryHost, setSummaryHost] = React.useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const host = document.createElement("div");
    host.className = "empty:hidden";
    host.dataset.dialogErrorSummary = "";
    const body = header.closest('[role="dialog"]')?.querySelector(".dialog-body");
    if (body) body.prepend(host);
    else header.after(host);
    setSummaryHost(host);
    return () => host.remove();
  }, []);
  return (
	<><div ref={headerRef}
		className={cn(
			"dialog-header flex flex-col gap-2 text-start",
			className,
		)}
		{...props}
	>{props.children}</div>{summaryHost && errors.length > 0 && createPortal(<div role="alert" className="grid gap-1 text-sm text-destructive"><p>{t("nav.formErrors")}</p><ul>{errors.map(error => <li key={error.field.id || error.label}><button type="button" className="min-h-11 text-start underline" onClick={() => revealAndFocus(error.field)}>{error.label}: {error.message}</button></li>)}</ul></div>, summaryHost)}</>
); };
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"dialog-footer flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
			className,
		)}
		{...props}
	/>
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title
    data-overlay-title
    tabIndex={-1}
		ref={ref}
		className={cn(
			"text-lg font-semibold leading-7 focus:outline-hidden",
			className,
		)}
		{...props}
	/>
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Description
		ref={ref}
		className={cn("text-sm text-muted-foreground", className)}
		{...props}
	/>
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
	Dialog,
	DialogPortal,
	DialogOverlay,
	DialogTrigger,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogDescription,
};
