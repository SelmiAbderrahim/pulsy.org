import { formattingLocale } from "@/lib/formatting-locale";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";


/** Reveal mounted disclosure content before browser focus and scrolling. */
export function revealAndFocusField(field: HTMLElement | null) {
  if (!field) return;
  let ancestor = field.parentElement;
  let expanded = false;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    if (ancestor.matches('[role="region"][data-state="closed"][hidden]')) {
      const triggerId = ancestor.getAttribute("aria-labelledby");
      const trigger = triggerId ? document.getElementById(triggerId) : null;
      if (trigger instanceof HTMLButtonElement && !trigger.disabled && trigger.getAttribute("aria-controls") === ancestor.id) {
        trigger.click();
        expanded = true;
      }
    }
    ancestor = ancestor.parentElement;
  }
  const focus = () => {
    if (!field.isConnected) return;
    field.focus();
    try { field.scrollIntoView({ block: "nearest" }); } catch { /* jsdom and older WebViews */ }
  };
  // Collapsible state updates commit after the current submit/click handler.
  if (expanded) requestAnimationFrame(focus);
  else focus();
}

/** Accessible field names omit required markers and never expose schema keys. */
export function readableFieldLabel(field: HTMLElement | null, root: ParentNode = document): string {
  if (!field) return "";
  const direct = field.getAttribute("aria-label");
  if (direct) return direct.replace(/\*/g, "").trim();
  const labelled = (field.getAttribute("aria-labelledby") ?? "").split(/\s+/).map(id => document.getElementById(id)).filter(Boolean);
  const label = Array.from(root.querySelectorAll("label")).find(value => value.htmlFor === field.id) ?? field.querySelector(":scope > legend");
  return (labelled.length ? labelled : label ? [label] : []).map(value => {
    const copy = value!.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach(child => child.remove());
    return copy.textContent ?? "";
  }).join(" ").replace(/\*/g, "").replace(/\s+/g, " ").trim();
}
export type FormIssue = { id: string; message: string; label?: string; custom?: boolean };
/** Validate every rendered field in one pass and keep a link to every error. */
export function useFormValidation(customIssues?: () => FormIssue[], options?: { nonEmptyBlurOnly?: boolean }) {
  const custom = useRef(customIssues);
  custom.current = customIssues;
  const { t, i18n } = useTranslation("common");
  const formRef = useRef<HTMLFormElement>(null);
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const touched = useRef(new Set<string>());
  const submitted = useRef(false);
  const pendingFocus = useRef<string | undefined>(undefined);
  const fieldIssue = (field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): FormIssue | undefined => {
    if (!field.id || field.disabled || field.getAttribute("aria-hidden") === "true") return;
    const validity = field.validity;
    let message = "";
    if (field.required && !field.value.trim()) message = t("formValidation.required");
    else if (validity.typeMismatch) message = t(field instanceof HTMLInputElement && field.type === "email" ? "formValidation.email" : "formValidation.url");
    else if (field instanceof HTMLInputElement && (validity.rangeOverflow || validity.rangeUnderflow)) message = t("nav.fieldRange", { min: new Intl.NumberFormat(formattingLocale(i18n.language)).format(Number(field.min)), max: new Intl.NumberFormat(formattingLocale(i18n.language)).format(Number(field.max)) });
    else if (validity.customError) message = field.validationMessage;
    else if (!validity.valid) message = t("nav.invalidField");
    if (message) return { id: field.id, message, label: readableFieldLabel(field, formRef.current ?? document) };
  };
  const findField = (id: string) => Array.from(formRef.current?.querySelectorAll<HTMLElement>("[id]") ?? []).find(field => field.id === id) ?? document.getElementById(id);
  const customIssueWithLabel = (issue: FormIssue): FormIssue => ({
    ...issue, custom: true,
    label: (issue.label ?? readableFieldLabel(findField(issue.id), formRef.current ?? document)).replace(/\*/g, "").trim(),
  });
  // Listen on the form so callers keep their existing controlled onChange handlers.
  // Reattach after renders because dialog forms may mount after their owning hook.
  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form) return;
    form.dataset.sharedValidation = "true";
    const update = (event: Event) => {
      const field = event.target;
      if (!(field instanceof HTMLElement) || !field.id) return;
      if (options?.nonEmptyBlurOnly && !submitted.current) {
        if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || !field.value.trim()) return;
        if (event.type !== "blur") return;
      }
      if (event.type === "blur") touched.current.add(field.id);
      // Inserting an error summary between pointerdown and pointerup can move
      // the submit button and swallow the click. Submit validates the entire
      // form, so let that handler render errors and choose focus instead.
      const next = event instanceof FocusEvent ? event.relatedTarget : null;
      if (event.type === "blur" && next instanceof HTMLButtonElement && next.form === form && next.type === "submit") return;
      if (!submitted.current && !touched.current.has(field.id)) return;
      // Native form listeners precede React delegated onChange. For trusted
      // input events a microtask checkpoint can occur between those listeners;
      // wait a task before updating validation state so controlled values commit.
      const process = () => {
        if (!field.isConnected) return;
        const customIssue = custom.current?.().find(value => value.id === field.id);
        const issue = (customIssue ? customIssueWithLabel(customIssue) : undefined)
          ?? (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement ? fieldIssue(field) : undefined);
        setIssues(previous => {
          const index = previous.findIndex(value => value.id === field.id);
          // Native validity cannot re-check an API/operation error (for example
          // invalid imported JSON). Blurring to its summary link must not remove
          // that link before click. An actual edit or explicit validation clears it.
          if (!issue) return index < 0 || event.type === "blur" ? previous : previous.filter(value => value.id !== field.id);
          if (index < 0) return [...previous, issue];
          if (previous[index]?.message === issue.message) return previous;
          return previous.map((value, position) => position === index ? issue : value);
        });
      };
      if (event.type === "blur" || !event.isTrusted) process(); else window.setTimeout(process, 0);
    };
    if (custom.current) {
      const next = custom.current().filter(issue => submitted.current || touched.current.has(issue.id)).map(customIssueWithLabel);
      const customIds = new Set([...next.map(issue => issue.id), ...issues.filter(issue => issue.custom).map(issue => issue.id)]);
      const updated = [...issues.filter(issue => !customIds.has(issue.id)), ...next];
      // A layout-effect setter on every commit can feed a portalled focus
      // scope's callback-ref updates. Do not schedule unchanged custom errors;
      // preserve their labels so submit and live validation produce one state.
      if (JSON.stringify(issues) !== JSON.stringify(updated)) setIssues(updated);
    }
    form.addEventListener("blur", update, true);
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("blur", update, true);
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  });
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = undefined;
    const field = findField(id);
    if (!(field instanceof HTMLElement)) return;
    const frame = requestAnimationFrame(() => revealAndFocusField(field));
    return () => cancelAnimationFrame(frame);
  }, [issues]);
  const show = (next: FormIssue[]) => {
    submitted.current = true;
    const all = next.filter((issue, index) => next.findIndex(other => other.id === issue.id && other.message === issue.message) === index).map(issue => ({ ...issue, label: (issue.label ?? readableFieldLabel(findField(issue.id), formRef.current ?? document)).replace(/\*/g, "").trim() })).sort((a, b) => {
      const first = document.getElementById(a.id), second = document.getElementById(b.id);
      if (!first || !second || first === second) return 0;
      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    pendingFocus.current = all[0]?.id;
    // Move focus in the same submit turn so callers and assistive technology
    // receive immediate feedback; the effect below repeats after the error
    // summary commits and any controlled disclosure opens.
    if (all[0]) {
      revealAndFocusField(findField(all[0].id));

    }
    setIssues(all);
    return all.length === 0;
  };
  const validate = (extra: FormIssue[] = []) => {
    // A portal can mount its form after the owning hook layout effect. Mark it
    // before emitting invalid events on an untouched first submit.
    if (formRef.current) formRef.current.dataset.sharedValidation = "true";
    extra = [...(custom.current?.() ?? []).map(customIssueWithLabel), ...extra];
    const next: FormIssue[] = [];
    for (const field of formRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select") ?? []) {
      const issue = fieldIssue(field);
      // Notify field primitives on first submit, including untouched controls.
      if (issue) field.dispatchEvent(new Event("invalid", { cancelable: true }));
      if (issue && !extra.some(extraIssue => extraIssue.id === field.id)) next.push(issue);
    }
    return show([...next, ...extra]);
  };
  const field = (id: string, description?: string) => ({
    "aria-invalid": issues.some(issue => issue.id === id) || undefined,
    "aria-describedby": [description, ...issues.flatMap((issue, index) => issue.id === id ? [`${id}-validation-${index}`] : [])].filter(Boolean).join(" ") || undefined,
  });
  const server = (error: unknown, mapping: Record<string, string>) => {
    const value = error as { data?: { validationErrors?: { fieldErrors?: Record<string, unknown>; formErrors?: unknown[] } } };
    const next: FormIssue[] = [];
    for (const [path, messages] of Object.entries(value?.data?.validationErrors?.fieldErrors ?? {})) {
      const id = mapping[path] ?? mapping[path.split(".")[0]!] ?? formRef.current?.querySelector<HTMLElement>("input:not([disabled]),textarea:not([disabled])")?.id;
      if (!id) continue;
      for (const message of Array.isArray(messages) ? messages : []) if (typeof message === "string" && message.length <= 500 && !/^\s*[[{]/.test(message)) next.push({ id, message });
    }
    const firstId = formRef.current?.querySelector<HTMLElement>("input:not([disabled]),textarea:not([disabled]),[role=combobox]")?.id;
    if (firstId && !next.length) for (const message of value?.data?.validationErrors?.formErrors ?? []) if (typeof message === "string" && message.length <= 500 && !/^\s*[[{]/.test(message)) next.push({ id: firstId, message });
    if (next.length) show(next);
    return next.length > 0;
  };
  const clear = (id?: string) => {
    if (!id) { touched.current.clear(); submitted.current = false; }
    setIssues(previous => id ? previous.filter(issue => issue.id !== id) : []);
  };
  return { formRef, issues, validate, field, server, show, clear };
}
export function FormErrorSummary({ issues }: { issues: FormIssue[] }) {
  const { t } = useTranslation("common");
  if (!issues.length) return null;
  return <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
    <p className="font-medium">{t("formValidation.summary")}</p>
    <ul className="mt-2 grid gap-1">{issues.map((issue, index) => <li key={`${issue.id}-${index}`}><a id={`${issue.id}-validation-${index}`} href={`#${issue.id}`} className="inline-block py-1 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={event => { event.preventDefault(); const target = document.getElementById(issue.id); revealAndFocusField(target); queueMicrotask(() => revealAndFocusField(target)); window.setTimeout(() => revealAndFocusField(target), 0); }}>{issue.label ? `${issue.label}: ` : ""}{issue.message}</a></li>)}</ul>
  </div>;
}
