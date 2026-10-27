/** Only application destinations may survive a session interruption. */
export function safeAuthReturn(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return;
  try {
    const url = new URL(value, "https://pulsy.invalid");
    if (url.origin !== "https://pulsy.invalid" || !/^\/(dashboard|superadmin)(\/|$)/.test(url.pathname)) return;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return; }
}
