import { z } from "zod";
/** Bounded, non-executable status grammar shared by forms, persistence and probes. */
export function parseExpectedStatuses(value: string | number): number[] | null {
  const text = String(value).trim().toLowerCase().replace(/[–—]/g, "-");
  if (!text || text.length > 128) return null;
  const codes = new Set<number>();
  for (const item of text.split(",")) {
    const token = item.trim();
    let first: number, last: number;
    if (/^[1-5]\d{2}$/.test(token)) first = last = Number(token);
    else if (/^[1-5]xx$/.test(token)) { first = Number(token[0]) * 100; last = first + 99; }
    else {
      const range = /^([1-5]\d{2})\s*-\s*([1-5]\d{2})$/.exec(token);
      if (!range) return null;
      first = Number(range[1]); last = Number(range[2]);
      if (first > last) return null;
    }
    for (let code = first; code <= last; code++) codes.add(code);
  }
  return [...codes].sort((a,b) => a-b);
}
export const normalizeExpectedStatuses = (value: string) => value
  .toLowerCase()
  .replace(/[–—]/g, "-")
  // Trim each delimiter-separated piece in linear time, including malformed input.
  .split(/([,-])/)
  .map(part => part.trim())
  .join("");
export const apiExpectedStatuses = z.string().max(128).refine(value => parseExpectedStatuses(value) !== null).transform(normalizeExpectedStatuses);
export function matchesExpectedStatus(status: number, monitor: { expectedStatus: number; expectedStatuses?: string | null }): boolean {
  return (parseExpectedStatuses(monitor.expectedStatuses ?? monitor.expectedStatus) ?? []).includes(status);
}
export function expectedStatusFields(value: string): { expectedStatus: number; expectedStatuses: string | null } | null {
  const codes = parseExpectedStatuses(value);
  if (!codes?.length) return null;
  return { expectedStatus: codes[0]!, expectedStatuses: codes.length === 1 ? null : normalizeExpectedStatuses(value) };
}
