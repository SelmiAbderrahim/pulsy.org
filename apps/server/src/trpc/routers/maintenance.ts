import { db, uptimeMaintenance, uptimeDeferredAlert, uptimeMonitor, apiMaintenanceConfig, apiCreateMaintenance, apiSnoozeMonitors } from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import type { Translator } from "../../lib/i18n";
import { effectiveSuppression, loadMaintenance, previewMaintenance, saveMaintenance, updateMaintenance } from "../../services/uptime/maintenance-service";

async function ownedMonitors(userId: string, ids: string[], t: Translator): Promise<void> {
	const owned = await db.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), inArray(uptimeMonitor.uptimeMonitorId, ids)));
	if (owned.length !== ids.length) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
}

const localizedMaintenanceProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const result = await next();
	if (!result.ok && result.error.cause instanceof z.ZodError) {
		const issue = result.error.cause.issues.find(value => value.message.startsWith("errors.maintenance"));
		if (issue) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t(issue.message), cause: result.error.cause });
	}
	return result;
});

export const maintenanceRouter = router({
	update: localizedMaintenanceProcedure.input(z.object({ id: z.string().min(1).max(64), config: apiMaintenanceConfig, expected: apiMaintenanceConfig }).strict()).mutation(({ input, ctx }) => updateMaintenance(input.id, ctx.user.id, input.config, input.expected, ctx.t)),
	preview: localizedMaintenanceProcedure.input(apiMaintenanceConfig).query(({ input }) => previewMaintenance(input)),
	list: protectedProcedure.query(async ({ ctx }) => {
		const windows = await loadMaintenance(ctx.user.id);
		return windows.map(window => ({ ...window, occurrences: previewMaintenance(window), suppression: window.monitorIds.length ? effectiveSuppression([window], window.monitorIds[0]!) : null }));
	}),
	create: localizedMaintenanceProcedure.input(apiCreateMaintenance).mutation(async ({ input, ctx }) => {
		await ownedMonitors(ctx.user.id, input.monitorIds, ctx.t);
		if (input.config.recurrence === "once" && Date.parse(input.config.endsAt) <= Date.now()) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.invalidInput") });
		const saved = await saveMaintenance({ ...input.config, monitorIds: input.monitorIds, userId: ctx.user.id }, ctx.t("errors.maintenanceLimit"));
		return saved!;
	}),
	snooze: protectedProcedure.input(apiSnoozeMonitors).mutation(async ({ input, ctx }) => {
		await ownedMonitors(ctx.user.id, input.monitorIds, ctx.t);
		const until = Date.parse(input.endsAt);
		if (until <= Date.now() || until - Date.now() > 30 * 86400_000) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.invalidInput") });
		const saved = await saveMaintenance({
			userId: ctx.user.id, monitorIds: input.monitorIds, name: "snooze", kind: "snooze", startsAt: new Date().toISOString(), endsAt: input.endsAt, reason: input.reason, timezone: "UTC", recurrence: "once",
		}, ctx.t("errors.maintenanceLimit"));
		return saved!;
	}),
	cancel: protectedProcedure.input(z.object({ id: z.string().min(1).max(64) })).mutation(async ({ input, ctx }) => {
		const [updated] = await db.update(uptimeMaintenance).set({ enabled: false }).where(and(eq(uptimeMaintenance.id, input.id), eq(uptimeMaintenance.userId, ctx.user.id))).returning({ id: uptimeMaintenance.id });
		if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.notFound", { resource: "maintenance" }) });
		await db.update(uptimeDeferredAlert).set({ dueAt: new Date().toISOString() }).where(and(eq(uptimeDeferredAlert.userId, ctx.user.id), eq(uptimeDeferredAlert.state, "pending")));
		return updated;
	}),
	resumeSnooze: protectedProcedure.input(apiSnoozeMonitors.pick({ monitorIds: true })).mutation(async ({ input, ctx }) => {
		await ownedMonitors(ctx.user.id, input.monitorIds, ctx.t);
		return db.transaction(async tx => {
			const windows = await tx.select().from(uptimeMaintenance).where(and(eq(uptimeMaintenance.userId, ctx.user.id), eq(uptimeMaintenance.kind, "snooze"), eq(uptimeMaintenance.enabled, true))).for("update");
			for (const window of windows) {
				const remaining = window.monitorIds.filter(id => !input.monitorIds.includes(id));
				if (remaining.length !== window.monitorIds.length) await tx.update(uptimeMaintenance).set({ monitorIds: remaining, enabled: remaining.length > 0 }).where(and(eq(uptimeMaintenance.id, window.id), eq(uptimeMaintenance.userId, ctx.user.id)));
			}
			await tx.update(uptimeDeferredAlert).set({ dueAt: new Date().toISOString() }).where(and(eq(uptimeDeferredAlert.userId, ctx.user.id), inArray(uptimeDeferredAlert.monitorId, input.monitorIds), eq(uptimeDeferredAlert.state, "pending")));
			return { success: true };
		});
	}),
	deliveries: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.query.uptimeDeferredAlert.findMany({ where: eq(uptimeDeferredAlert.userId, ctx.user.id), orderBy: desc(uptimeDeferredAlert.createdAt), limit: 100 });
    return rows.map(row => {
      const snapshot = { ...row.snapshot };
      delete snapshot.webhookBodies;
      return { ...row, snapshot };
    });
  }),
});
