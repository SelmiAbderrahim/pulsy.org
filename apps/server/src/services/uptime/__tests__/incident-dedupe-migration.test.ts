import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, uptimeIncident } from "@pulsy/db";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";

useCleanDatabase();

// Execute the real data cleanup and index from the bundled OSS migration.
// This suite must run on its isolated test database, never the runtime database.
const statements = readFileSync(resolve(process.cwd(), "../../packages/db/drizzle/0013_wet_dracula.sql"), "utf8")
  .split("--> statement-breakpoint");
const dedupe = statements.find(statement => statement.includes('UPDATE "uptime_incident" i SET'));
const createIndex = statements.find(statement => statement.includes('CREATE UNIQUE INDEX "uptime_incident_one_ongoing_idx"'));
if (!dedupe || !createIndex) throw new Error("OSS migration 0013 incident invariant statements are missing");

const sortedRows = async () => (await db.select().from(uptimeIncident)).sort((a, b) => a.incidentId.localeCompare(b.incidentId));

describe("OSS migration 0013: duplicate ongoing incidents", () => {
  it("retains the earliest incident, deterministically closes duplicates at zero duration, and reinstates the unique invariant", async () => {
    const owner = await createTestUser();
    const first = await createTestMonitor(owner.id);
    const second = await createTestMonitor(owner.id);
    await db.execute(sql`DROP INDEX uptime_incident_one_ongoing_idx`);
    try {
      await db.insert(uptimeIncident).values([
        { incidentId: "a", uptimeMonitorId: first.uptimeMonitorId, status: "ongoing", startedAt: "2026-10-01T10:00:00.000Z" },
        { incidentId: "b", uptimeMonitorId: first.uptimeMonitorId, status: "ongoing", startedAt: "2026-10-01T10:05:00.000Z" },
        { incidentId: "c", uptimeMonitorId: first.uptimeMonitorId, status: "ongoing", startedAt: "2026-10-01T10:09:00.000Z" },
        { incidentId: "tie", uptimeMonitorId: first.uptimeMonitorId, status: "ongoing", startedAt: "2026-10-01T10:00:00.000Z" },
        { incidentId: "other", uptimeMonitorId: second.uptimeMonitorId, status: "ongoing", startedAt: "2026-10-01T11:00:00.000Z" },
        { incidentId: "resolved", uptimeMonitorId: first.uptimeMonitorId, status: "resolved", startedAt: "2026-09-01T10:00:00.000Z", resolvedAt: "2026-09-01T10:30:00.000Z", durationSeconds: 1800 },
      ]);
      await db.execute(sql.raw(dedupe));
      const before = await sortedRows();
      const rows = new Map(before.map(row => [row.incidentId, row]));
      expect(rows.size).toBe(6);
      expect(rows.get("a")).toMatchObject({ status: "ongoing", startedAt: "2026-10-01T10:00:00.000Z", resolvedAt: null, durationSeconds: null });
      for (const id of ["b", "c", "tie"]) {
        expect(rows.get(id)).toMatchObject({ status: "resolved", resolvedAt: rows.get(id)!.startedAt, durationSeconds: 0 });
      }
      expect(rows.get("other")).toMatchObject({ status: "ongoing", resolvedAt: null, durationSeconds: null });
      expect(rows.get("resolved")).toMatchObject({ status: "resolved", resolvedAt: "2026-09-01T10:30:00.000Z", durationSeconds: 1800 });

      await db.execute(sql.raw(dedupe));
      expect(await sortedRows()).toEqual(before);
      await db.execute(sql.raw(createIndex));
      await expect(db.insert(uptimeIncident).values({ incidentId: "blocked-duplicate", uptimeMonitorId: first.uptimeMonitorId, status: "ongoing", startedAt: "2026-10-01T12:00:00.000Z" })).rejects.toThrow();
      expect(await sortedRows()).toEqual(before);
    } finally {
      // Even a failing cleanup assertion must not leave this test database's
      // uniqueness guard disabled for other integration files.
      await db.execute(sql`DELETE FROM uptime_incident WHERE "status" = 'ongoing'`);
      await db.execute(sql.raw(createIndex.replace("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ")));
    }
  });
});
