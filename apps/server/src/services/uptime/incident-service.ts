import { db, uptimeIncident, uptimeMonitor, type DbExecutor } from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, exists } from "drizzle-orm";

export type UptimeIncident = typeof uptimeIncident.$inferSelect;

export const createIncident = async (
	monitorId: string,
	cause?: string | null,
	dbc: DbExecutor = db,
  severity: "critical" | "warning" | "informational" = "critical",
  observedAt?: string,
): Promise<UptimeIncident> => {
	const now = observedAt ?? new Date().toISOString();

	const [incident] = await dbc
		.insert(uptimeIncident)
		.values({
			uptimeMonitorId: monitorId,
			status: "ongoing",
			startedAt: now,
			cause: cause ?? null,
      severity,
		})
		.returning();

	/* v8 ignore next 6 -- unreachable: INSERT ... RETURNING yields the row or throws */
	if (!incident) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create incident",
		});
	}

	return incident;
};

export const resolveIncident = async (
	monitorId: string,
	dbc: DbExecutor = db,
  observedAt?: string,
): Promise<UptimeIncident | null> => {
	const ongoing = await dbc.query.uptimeIncident.findFirst({
		where: and(
			eq(uptimeIncident.uptimeMonitorId, monitorId),
			eq(uptimeIncident.status, "ongoing"),
		),
	});

	if (!ongoing) {
		return null;
	}

	const now = observedAt ? new Date(observedAt) : new Date();
	const startedAt = new Date(ongoing.startedAt);
	const durationSeconds = Math.round(
		(now.getTime() - startedAt.getTime()) / 1000,
	);

	const [resolved] = await dbc
		.update(uptimeIncident)
		.set({
			status: "resolved",
			resolvedAt: now.toISOString(),
			durationSeconds,
		})
		.where(eq(uptimeIncident.incidentId, ongoing.incidentId))
		.returning();

	/* v8 ignore next -- UPDATE ... RETURNING on the found row always yields it */
	return resolved ?? null;
};

export const findIncidentsByMonitor = async (
	monitorId: string,
	userId: string,
	limit = 50,
	offset = 0,
): Promise<UptimeIncident[]> => {
	const incidents = await db.query.uptimeIncident.findMany({
		where: and(
			eq(uptimeIncident.uptimeMonitorId, monitorId),
			exists(
				db
					.select({ id: uptimeMonitor.uptimeMonitorId })
					.from(uptimeMonitor)
					.where(
						and(
							eq(uptimeMonitor.uptimeMonitorId, monitorId),
							eq(uptimeMonitor.userId, userId),
						),
					),
			),
		),
		orderBy: [desc(uptimeIncident.startedAt)],
		limit,
		offset,
	});

	return incidents;
};
export const getOngoingIncident = async (
	monitorId: string,
	dbc: DbExecutor = db,
): Promise<UptimeIncident | null> => {
	const incident = await dbc.query.uptimeIncident.findFirst({
		where: and(
			eq(uptimeIncident.uptimeMonitorId, monitorId),
			eq(uptimeIncident.status, "ongoing"),
		),
	});

	return incident ?? null;
};
