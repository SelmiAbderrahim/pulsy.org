/** Shared browser/API normalization. Fragments are not sent in HTTP requests. */
export function normalizeMonitorUrl(value: string): string | null {
  const input = value.trim();
  if (!input || input.length > 2048 || /\s/.test(input)) return null;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
    if (!hasScheme && !input.split("/")[0]?.includes(".") && !/^localhost(?::\d+)?(?:\/|$)/i.test(input)) return null;
    const url = new URL(hasScheme ? input : `https://${input}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.hash = "";
    return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}
export function canonicalMonitorUrl(value: string): string | null {
  const normalized = normalizeMonitorUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}
export function duplicateMonitor<T extends { url: string; name: string }>(value: string, monitors: ReadonlyArray<T>): T | undefined {
  const canonical = canonicalMonitorUrl(value);
  return canonical ? monitors.find(monitor => canonicalMonitorUrl(monitor.url) === canonical) : undefined;
}
