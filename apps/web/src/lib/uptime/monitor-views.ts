export function decodeViewTags(value: unknown): string[] {
  let values: unknown = value;
  // The router already parses JSON once. Older links may still contain a JSON
  // string of an array; accept both legacy layers, without interpreting commas
  // inside JSON tags as separators. Invalid JSON must not become phantom tags.
  for (let depth = 0; typeof values === "string" && depth < 2; depth++) {
    if (values.length > 4096) return [];
    const text = values.trim();
    if (!text) return [];
    if (text.startsWith("[") || text.startsWith('"') || text.startsWith("{")) {
      try { values = JSON.parse(text); }
      catch { return []; }
    } else {
      values = text.split(",");
    }
  }
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((tag): tag is string => typeof tag === "string").map(tag => tag.trim()).filter(tag => tag.length > 0 && tag.length <= 64))].slice(0, 50);
}
/** Leave serialization to TanStack Router; never pass it stringified JSON. */
export const encodeViewTags = (tags: string[]): string[] | undefined => {
  const values = decodeViewTags(tags);
  return values.length ? values : undefined;
};
export function matchesViewTags(monitor: { tags?: string[] | null }, selected: string[], mode: "any" | "all"): boolean {
  if (!selected.length) return true;
  const matches = (tag: string) => monitor.tags?.includes(tag) ?? false;
  return mode === "all" ? selected.every(matches) : selected.some(matches);
}
export function groupViewMonitors<T extends { uptimeMonitorId: string; tags?: string[] | null }>(monitors: T[], mode: "none" | "tag" | "environment"): Array<{ tag: string | null; monitors: T[] }> {
  if (mode === "none") return [{ tag: null, monitors }];
  const groups = new Map<string | null, T[]>();
  for (const monitor of monitors) {
    const tags = [...new Set((monitor.tags ?? []).filter(tag => mode === "tag" || tag.startsWith("env:") && tag.length > 4))];
    for (const tag of tags.length ? tags : [null]) {
      const group = groups.get(tag) ?? []; group.push(monitor); groups.set(tag, group);
    }
  }
  return [...groups].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : a.localeCompare(b)).map(([tag, monitors]) => ({ tag, monitors }));
}

/** Compare meaning, not PostgreSQL JSON object key order or commutative tag order. */
export function sameViewFilters(left: import("@/types/monitor-views").MonitorViewFilters, right: import("@/types/monitor-views").MonitorViewFilters): boolean {
  const canonical = (value: typeof left) => [value.search, [...new Set(value.tags)].sort(), value.tagMode, value.health, value.sort, value.direction, value.density, value.group];
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
