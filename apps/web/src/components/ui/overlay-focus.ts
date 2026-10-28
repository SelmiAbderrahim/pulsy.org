import { useRef } from "react";

// The control a person last used outside transient menu items or confirmation controls. A dialog opened from a dropdown item
// cannot return focus to that item (it is gone once the menu closes); the menu's trigger is the
// right place, and that is the last thing used before the menu opened.
let lastOpener: HTMLElement | null = null;
const OVERLAY = '[role="menu"],[role="menuitem"],[role="alertdialog"]';
if (typeof document !== "undefined") {
  const remember = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(OVERLAY)) return;
    lastOpener = target.closest<HTMLElement>("button,a[href],summary,input,select,textarea,[tabindex]") ?? target;
  };
  document.addEventListener("pointerdown", remember, true);
  document.addEventListener("focusin", remember, true);
}

const usable = (element: HTMLElement | null): element is HTMLElement =>
  !!element && element.isConnected && element !== document.body && !element.closest('[role="menu"],[role="menuitem"]');

/** Also supports controlled overlays opened without a Radix Trigger component. */
export function useOverlayFocusReturn() {
  const previous = useRef<HTMLElement | null>(null);
  const existingOverlays = useRef(new Set<Element>());
  return {
    capture(opener?: HTMLElement | null) {
      existingOverlays.current = new Set(document.querySelectorAll('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]'));
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const candidate = opener ?? active;
      previous.current = usable(candidate) ? candidate : usable(lastOpener) ? lastOpener : null;
    },
    restore(event: Event) {
      if (event.defaultPrevented) return;
      // A menu can unmount after its item has opened a dialog. Its delayed Radix
      // cleanup must not pull focus back out of the new focus scope.
      const openedOverlay = Array.from(document.querySelectorAll('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]'))
        .some(overlay => !existingOverlays.current.has(overlay));
      if (openedOverlay) { event.preventDefault(); return; }
      let target = usable(previous.current)
        ? previous.current
        : usable(lastOpener) && !previous.current ? lastOpener : document.querySelector<HTMLElement>("#app-main");
      // A cancelled tab navigation leaves the attempted tab unselected. Focusing
      // it again would trigger Radix automatic activation and reopen the guard.
      if (target?.matches('[role="tab"][aria-selected="false"]')) {
        const selected = target.closest('[role="tablist"]')?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null;
        if (usable(selected)) target = selected;
      }
      if (target) {
        event.preventDefault();
        target.focus({ preventScroll: true });
        // A hidden opener (e.g. the mobile menu button once the desktop shell appears) cannot take focus.
        if (document.activeElement !== target) document.querySelector<HTMLElement>("#app-main")?.focus({ preventScroll: true });
      }
    },
  };
}

/** Choose content controls before the chrome close button, including links Radix skips. */
export function focusOverlayStart(event: Event) {
  const content = event.target;
  if (!(content instanceof HTMLElement)) return;
  const active = document.activeElement;
  // Keep intentional custom focus (search or navigation), but replace heading-only
  // overrides with the same control-first behavior used by every other overlay.
  if (event.defaultPrevented && !(active instanceof HTMLElement && active.matches("[data-overlay-title]"))) return;
  const candidates = Array.from(content.querySelectorAll<HTMLElement>(
    'button,input:not([type="hidden"]),select,textarea,a[href],[tabindex]',
  )).filter(element => {
    // Radix's roving tab stop is initialized by focus; the selected tab can
    // still have tabindex=-1 during the content's mount autofocus event.
    const selectedTab = element.matches('[role="tab"][aria-selected="true"]');
    if ((element.tabIndex < 0 && !selectedTab) || element.matches(':disabled,[aria-disabled="true"],[data-overlay-close]') ||
      element.closest('[hidden],[inert],[aria-hidden="true"],[data-toast-host]')) return false;
    let ancestor: HTMLElement | null = element;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !element.closest("summary")) return false;
      if (ancestor === content) break;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
  // Header chrome (help links, close buttons) is never the first stop: prefer a content
  // control, then the title, and fall back to chrome only when nothing else exists.
  const primary = candidates.filter(element => !element.closest("[data-overlay-chrome]"));
  const first = primary.find(element => element.matches('[role="tab"][aria-selected="true"]')) ?? primary.find(element => element.matches('[role="tab"]')) ?? primary[0];
  const target = first ?? content.querySelector<HTMLElement>("[data-overlay-title]") ?? candidates[0];
  if (target) {
    event.preventDefault();
    target.focus({ preventScroll: true });
  }
}
