import { z } from "zod";

/** Validate with the runtime's timezone database, including UTC and aliases. */
export function isValidTimezone(value: string): boolean {
  if (!value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch { return false; }
}

export const timezoneSchema = z.string().refine(isValidTimezone);

export function browserTimezone(): string {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(value) ? value : "UTC";
  } catch { return "UTC"; }
}

/** "Africa/Tunis (UTC+01:00)": zone name plus its offset at `at`; invalid zones read as UTC. */
export function timezoneLabel(timezone: string, at: Date | number = Date.now()): string {
  const zone = isValidTimezone(timezone) ? timezone : "UTC";
  const offset = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(at).find(part => part.type === "timeZoneName")?.value ?? "GMT";
  return `${zone} (${offset === "GMT" ? "UTC+00:00" : offset.replace("GMT", "UTC")})`;
}
