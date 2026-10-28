export type Theme = "light" | "dark";
const STORAGE_KEY = "pulsy-theme";
const listeners = new Set<() => void>();
let current: Theme = "light";
let explicit: Theme | null = null;
let observers = 0;
let stop: (() => void) | undefined;

function storedTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch { return null; }
}
function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function apply(theme: Theme) {
  current = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  for (const listener of listeners) listener();
}

/** One observer serves the app initializer and every mounted toggle. */
export function initializeTheme(): () => void {
  if (observers++ === 0) {
    explicit = storedTheme();
    apply(explicit ?? systemTheme());
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const systemChanged = () => { if (!explicit) apply(systemTheme()); };
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      // Storage events fire after the other tab has updated localStorage.
      explicit = storedTheme();
      apply(explicit ?? systemTheme());
    };
    media?.addEventListener("change", systemChanged);
    window.addEventListener("storage", storageChanged);
    stop = () => { media?.removeEventListener("change", systemChanged); window.removeEventListener("storage", storageChanged); };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--observers === 0) { stop?.(); stop = undefined; explicit = null; }
  };
}

export function subscribeTheme(listener: () => void): () => void {
  const release = initializeTheme();
  listeners.add(listener);
  return () => { listeners.delete(listener); release(); };
}
export function getTheme(): Theme {
  return observers ? current : storedTheme() ?? systemTheme();
}
export function chooseTheme(theme: Theme) {
  explicit = theme;
  // Keep the explicit choice for this session even when persistence is blocked.
  try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage blocked */ }
  apply(theme);
}
