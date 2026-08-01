import type { z } from "zod";
import {
	db,
	uptimeMonitor,
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

export const updateUptimeMonitor = async (
	input: z.infer<typeof apiUpdateUptimeMonitor>,
	userId: string,
): Promise<UptimeMonitor> => {
	const { uptimeMonitorId, ...data } = input;

	const existing = await db.query.uptimeMonitor.findFirst({
		where: and(
			eq(uptimeMonitor.uptimeMonitorId, uptimeMonitorId),
			eq(uptimeMonitor.userId, userId),
		),
	});

	if (!existing) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Uptime monitor not found",
		});
	}

	const updateData: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (value !== undefined) {
			updateData[key] = value;
		}
	}

	if (updateData.interval && updateData.interval !== existing.interval) {
		const now = new Date();
		updateData.nextCheckAt = new Date(
			now.getTime() + (updateData.interval as number) * 1000,
		).toISOString();
	}

	const [updated] = await db
		.update(uptimeMonitor)
		.set(updateData)
		.where(
			and(
				eq(uptimeMonitor.uptimeMonitorId, uptimeMonitorId),
				eq(uptimeMonitor.userId, userId),
			),
		)
		.returning();

	/* v8 ignore next 6 -- unreachable: UPDATE ... RETURNING on an existing row */
	if (!updated) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to update uptime monitor",
		});
	}

	return updated;
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
