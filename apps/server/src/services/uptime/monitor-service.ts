import { assertMonitorUrlAllowed } from "./egress-input";
import { countersForPolicyChange } from "./latency-policy";
import { assertCredentialOrigin, httpConfigPatch } from "./http-config";
import { assertOwnedMonitorChannels } from "./monitor-operations";
import { firstCheckAt } from "./first-check";
import { getTranslator, type Translator } from "../../lib/i18n";
import type { z } from "zod";
import {
	db,
	uptimeMonitor, uptimeMonitorChannelBinding,
	uptimeNotificationChannel,
	type apiUpdateUptimeMonitor,
} from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import {
	maskNotificationChannel,
	type MaskedNotificationChannel,
} from "./notification-channel-secrets";

export type UptimeMonitor = typeof uptimeMonitor.$inferSelect;

/**
 * Fetch a single monitor scoped to its owner, or `null` when it does not exist
 * or belongs to someone else. Used by the public REST API to enforce ownership
 * (mirrors the tRPC router's `findOwnedMonitorOrThrow`).
 */
export const findOwnedMonitor = async (
	uptimeMonitorId: string,
	userId: string,
): Promise<UptimeMonitor | null> => {
	const monitor = await db.query.uptimeMonitor.findFirst({
		where: and(
			eq(uptimeMonitor.uptimeMonitorId, uptimeMonitorId),
			eq(uptimeMonitor.userId, userId),
		),
	});
	return monitor ?? null;
};

/** List a user's monitors, newest first, with SQL-level limit/offset paging. */
export const listOwnedMonitors = async (
	userId: string,
	limit: number,
	offset: number,
): Promise<UptimeMonitor[]> => {
	return db.query.uptimeMonitor.findMany({
		where: eq(uptimeMonitor.userId, userId),
		orderBy: desc(uptimeMonitor.createdAt),
		limit,
		offset,
	});
};

/** Serialize method/body changes against the current owned configuration. */
export const updateUptimeMonitor = async (
  input: z.output<typeof apiUpdateUptimeMonitor>,
  userId: string,
  t: Translator = getTranslator("en"),
): Promise<UptimeMonitor> => {
  // DNS-backed policy check before taking the row lock.
  if (input.url !== undefined) await assertMonitorUrlAllowed(input.url, t);
  return db.transaction(async tx => {
  const { uptimeMonitorId, requestConfig: _requestConfig, channelIds: _channelIds, ...data } = input;
  const scope = and(eq(uptimeMonitor.uptimeMonitorId, uptimeMonitorId), eq(uptimeMonitor.userId, userId));
  const [existing] = await tx.select().from(uptimeMonitor).where(scope).for("update");
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
  if (existing.monitorType !== "http" && [input.interval, input.url, input.method, input.expectedStatus, input.expectedStatuses, input.tlsMonitoringEnabled, input.timeout, input.failureThreshold, input.requestConfig, input.httpAssertions, input.redirectPolicy, input.latencyPolicy].some(value => value !== undefined)) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.monitorTypeAction") });
  assertCredentialOrigin(existing.requestCipher, existing.url, input.url, input.requestConfig, t);
  const updateData: Record<string, unknown> = httpConfigPatch(input, input.method ?? existing.method, t, existing.requestCipher);
  for (const [key, value] of Object.entries(data)) if (value !== undefined) updateData[key] = value;
  if (input.expectedStatus !== undefined && input.expectedStatuses === undefined) updateData.expectedStatuses = null;
  if (input.tlsMonitoringEnabled === false) Object.assign(updateData, { tlsExpiresAt: null, tlsExpiresInDays: null });
  Object.assign(updateData, countersForPolicyChange(existing.latencyPolicy, input.latencyPolicy));
  // Resume or a change to what is checked runs the next check now (see firstCheckAt).
  if (input.active === false) updateData.nextCheckAt = null;
  const resumed = input.active === true && !existing.active;
  const retargeted = (input.url !== undefined && input.url !== existing.url) || (input.method !== undefined && input.method !== existing.method) || (input.interval !== undefined && input.interval !== existing.interval) || input.requestConfig !== undefined;
  if ((resumed || retargeted) && (input.active ?? existing.active)) updateData.nextCheckAt = firstCheckAt();
  const [updated] = await tx.update(uptimeMonitor).set(updateData).where(scope).returning();
  if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: t("errors.internal") });
  if (input.channelIds !== undefined) {
    await assertOwnedMonitorChannels(tx, userId, input.channelIds, t);
    await tx.delete(uptimeMonitorChannelBinding).where(and(eq(uptimeMonitorChannelBinding.userId, userId), eq(uptimeMonitorChannelBinding.monitorId, uptimeMonitorId)));
    const ids = [...new Set(input.channelIds)];
    if (ids.length) await tx.insert(uptimeMonitorChannelBinding).values(ids.map(channelId => ({ userId, monitorId: uptimeMonitorId, channelId })));
  }
  return updated;
  });
};

export const findUptimeMonitorById = async (
	uptimeMonitorId: string,
	userId: string,
): Promise<UptimeMonitor & {
	notificationChannels: MaskedNotificationChannel[];
	incidents: Array<Record<string, unknown>>;
}> => {
	const monitor = await db.query.uptimeMonitor.findFirst({
		where: and(
			eq(uptimeMonitor.uptimeMonitorId, uptimeMonitorId),
			eq(uptimeMonitor.userId, userId),
		),
		with: {
			notificationChannels: {
				where: eq(uptimeNotificationChannel.userId, userId),
			},
			incidents: true,
		},
	});

	if (!monitor) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Uptime monitor not found",
		});
	}

	return {
		...monitor,
		notificationChannels: monitor.notificationChannels.map(
			maskNotificationChannel,
		),
	};
};

export const deleteUptimeMonitor = async (
	uptimeMonitorId: string,
	userId: string,
): Promise<void> => {
	const deleted = await db
		.delete(uptimeMonitor)
		.where(
			and(
				eq(uptimeMonitor.uptimeMonitorId, uptimeMonitorId),
				eq(uptimeMonitor.userId, userId),
			),
		)
		.returning({ uptimeMonitorId: uptimeMonitor.uptimeMonitorId });

	if (deleted.length === 0) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Uptime monitor not found",
		});
	}
};
