import { db, user, uptimeMonitor, uptimeMonitorChannelBinding, type NetworkMonitorInput } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Translator } from "../../lib/i18n";
import { assertOwnedMonitorChannels } from "./monitor-operations";
import { countersForPolicyChange } from "./latency-policy";
import { assertMonitorHostAllowed } from "./egress-input";
import { firstCheckAt } from "./first-check";
export async function createNetworkMonitor(input: NetworkMonitorInput, userId: string, t: Translator) {
  await assertMonitorHostAllowed(input.configuration.hostname, input.configuration.type, t);
  return db.transaction(async tx => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    await assertOwnedMonitorChannels(tx, userId, input.channelIds ?? [], t);
    const [created] = await tx.insert(uptimeMonitor).values({ userId, name: input.name, monitorType: input.configuration.type, networkConfig: input.configuration,
      url: "", interval: input.interval, timeout: input.timeout, failureThreshold: input.failureThreshold, active: input.active, tags: input.tags,
      latencyPolicy: input.latencyPolicy ?? null, nextCheckAt: input.active ? firstCheckAt() : null }).returning();
    if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: t("errors.internal") });
    const ids = [...new Set(input.channelIds ?? [])];
    if (ids.length) await tx.insert(uptimeMonitorChannelBinding).values(ids.map(channelId => ({ userId, monitorId: created.uptimeMonitorId, channelId })));
    return created;
  });
}
export async function updateNetworkMonitor(input: NetworkMonitorInput & { monitorId: string }, userId: string, t: Translator) {
  await assertMonitorHostAllowed(input.configuration.hostname, input.configuration.type, t);
  return db.transaction(async tx => {
    const scope = and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, input.monitorId));
    const [current] = await tx.select().from(uptimeMonitor).where(scope).for("update");
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
    if (current.monitorType !== input.configuration.type) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.monitorTypeAction") });
    await assertOwnedMonitorChannels(tx, userId, input.channelIds ?? [], t);
    const [updated] = await tx.update(uptimeMonitor).set({ name: input.name, networkConfig: input.configuration, interval: input.interval, timeout: input.timeout,
      failureThreshold: input.failureThreshold, active: input.active, tags: input.tags,
      ...(input.latencyPolicy !== undefined ? { latencyPolicy: input.latencyPolicy, ...countersForPolicyChange(current.latencyPolicy, input.latencyPolicy) } : {}),
      // Resume or a changed target/interval checks now; other edits keep the cadence.
      nextCheckAt: !input.active ? null : !current.active || current.interval !== input.interval || JSON.stringify(current.networkConfig) !== JSON.stringify(input.configuration) ? firstCheckAt() : current.nextCheckAt ?? new Date(Date.now() + input.interval * 1000).toISOString() }).where(scope).returning();
    if (input.channelIds !== undefined) {
      await tx.delete(uptimeMonitorChannelBinding).where(and(eq(uptimeMonitorChannelBinding.userId, userId), eq(uptimeMonitorChannelBinding.monitorId, input.monitorId)));
      const ids = [...new Set(input.channelIds)]; if (ids.length) await tx.insert(uptimeMonitorChannelBinding).values(ids.map(channelId => ({ userId, monitorId: input.monitorId, channelId })));
    }
    if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: t("errors.internal") });
    return updated;
  });
}
