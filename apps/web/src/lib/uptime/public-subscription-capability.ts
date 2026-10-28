export type SubscriptionCapability = { action: "confirm" | "unsubscribe"; token: string; pageKey?: string; path: string };
let capability: SubscriptionCapability | null = null;
/** Run before router initialization. Never persist or display the token. */
export function captureSubscriptionCapability() {
  if (typeof window === "undefined" || !window.location.hash.startsWith("#subscription=")) return;
  let value = ""; try { value = decodeURIComponent(window.location.hash.slice("#subscription=".length)); } catch { /* Still strip malformed capability fragments. */ }
  const match = /^(confirm|unsubscribe):([A-Za-z0-9_-]{43})(?::([A-Za-z0-9_-]{1,64}))?$/.exec(value);
  capability = match ? { action: match[1] as "confirm" | "unsubscribe", token: match[2]!, ...(match[3] ? { pageKey: match[3] } : {}), path: window.location.pathname } : null;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  window.dispatchEvent(new Event("pulsy-subscription-capability"));
}
export function readSubscriptionCapability(): SubscriptionCapability | null {
  return typeof window !== "undefined" && capability?.path === window.location.pathname ? { ...capability } : null;
}
export function clearSubscriptionCapability() { capability = null; }
