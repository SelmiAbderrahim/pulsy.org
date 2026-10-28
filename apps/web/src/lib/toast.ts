import { toast as sonner, type ExternalToast } from "sonner";

type Kind = "success" | "info" | "warning" | "error" | "message";
type Entry = { id: string | number; kind: Kind; message: Parameters<typeof sonner>[0]; options: ExternalToast; remaining: number; started: number; timer?: ReturnType<typeof setTimeout> };
const durations: Record<Kind, number> = { success: 5000, info: 6000, message: 6000, warning: 8000, error: 10000 };
const pending: Entry[] = [];
const active = new Map<string | number, Entry>();
let mounted = false;
let paused = false;
let serial = 0;

function finish(id: string | number) {
  const entry = active.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  active.delete(id);
  pump();
}
function start(entry: Entry) {
  if (paused) return;
  entry.started = Date.now();
  entry.timer = setTimeout(() => {
    sonner.dismiss(entry.id);
    finish(entry.id);
  }, entry.remaining);
}
function pump() {
  while (mounted && active.size < 3 && pending.length) {
    const entry = pending.shift()!;
    active.set(entry.id, entry);
    const action = entry.options.action;
    sonner[entry.kind](entry.message, {
      ...entry.options, id: entry.id,
      // This policy owns the clock so queued notifications get their full duration.
      duration: Infinity, closeButton: true, dismissible: true,
      action: action && typeof action === "object" && "onClick" in action ? { ...action, onClick: event => { action.onClick(event); if (!event.defaultPrevented) { sonner.dismiss(entry.id); finish(entry.id); } } } : action,
      onDismiss: value => { entry.options.onDismiss?.(value); finish(entry.id); },
    });
    start(entry);
  }
}
export function pauseToasts(next: boolean) {
  if (paused === next) return;
  paused = next;
  for (const entry of active.values()) {
    if (next) { clearTimeout(entry.timer); entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.started)); }
    else start(entry);
  }
}
export function mountToastPolicy() {
  mounted = true; pump();
  return () => { mounted = false; for (const entry of active.values()) clearTimeout(entry.timer); active.clear(); pending.length = 0; paused = false; };
}
function notify(kind: Kind, message: Parameters<typeof sonner>[0], options: ExternalToast = {}) {
  const duration = options.action ? 10000 : durations[kind];
  if ((kind === "error" || kind === "success") && typeof message === "string" && typeof document !== "undefined") {
    const modal = [...document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]')].at(-1);
    modal?.dispatchEvent(new CustomEvent("pulsy:modal-error", { detail: kind === "error" ? message : "" }));
  }
  // Standalone consumers/tests without a host still get the same finite policy.
  if (!mounted) return sonner[kind](message, { ...options, duration, closeButton: true });
  const duplicate = [...active.values(), ...pending].find(entry => entry.kind === kind && entry.message === message && entry.options.description === options.description);
  if (duplicate) return duplicate.id;
  const id = options.id ?? `pulsy-toast-${++serial}`;
  pending.push({ id, kind, message, options, remaining: duration, started: 0 }); pump();
  return id;
}
export const toast = {
  success: (message: Parameters<typeof sonner>[0], options?: ExternalToast) => notify("success", message, options),
  info: (message: Parameters<typeof sonner>[0], options?: ExternalToast) => notify("info", message, options),
  warning: (message: Parameters<typeof sonner>[0], options?: ExternalToast) => notify("warning", message, options),
  error: (message: Parameters<typeof sonner>[0], options?: ExternalToast) => notify("error", message, options),
  message: (message: Parameters<typeof sonner>[0], options?: ExternalToast) => notify("message", message, options),
  dismiss: (id?: string | number) => {
    if (id === undefined) { pending.length = 0; for (const entry of active.values()) clearTimeout(entry.timer); active.clear(); }
    else { const index = pending.findIndex(entry => entry.id === id); if (index >= 0) pending.splice(index, 1); finish(id); }
    return sonner.dismiss(id);
  },
};
