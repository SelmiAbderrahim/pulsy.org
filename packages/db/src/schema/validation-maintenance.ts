import { z } from "zod";

const monitorIds = z.array(z.string().min(1).max(64)).min(1).max(200).transform(ids => [...new Set(ids)]);
const timezone = z.string().max(100).refine(value => {
	try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "errors.maintenanceTimezone");
export const apiMaintenanceConfig = z.object({
	name: z.string().trim().min(1).max(100),
	reason: z.string().max(1000).default(""),
	startsAt: z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString()),
	endsAt: z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString()),
	timezone: timezone.default("UTC"),
	recurrence: z.enum(["once", "daily", "weekly"]).default("once"),
}).refine(value => {
	const duration = Date.parse(value.endsAt) - Date.parse(value.startsAt);
	return duration > 0 && duration <= (value.recurrence === "once" ? 30 * 86400_000 : 86400_000);
}, "errors.maintenanceDuration");
export const apiCreateMaintenance = z.object({ monitorIds, config: apiMaintenanceConfig });
export const apiSnoozeMonitors = z.object({
	monitorIds, endsAt: z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString()), reason: z.string().max(1000).default(""),
});
