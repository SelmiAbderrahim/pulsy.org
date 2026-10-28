import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, uptimeMonitor } from "@pulsy/db";
import { eq, inArray, sql } from "drizzle-orm";
import { formatApiError } from "../../validation-errors";
import { getTranslator } from "../../../lib/i18n";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";

// Bulk write contracts: all-or-nothing updates under an infrastructure failure
// and the deleteBulk input bounds. Ownership and happy paths live in uptime.test.ts
// and uptime-isolation.test.ts.

vi.mock("../../../services/uptime", async importActual => ({
	...(await importActual<typeof import("../../../services/uptime")>()),
	scheduleMonitorCheck: vi.fn(),
	rescheduleMonitorCheck: vi.fn(),
	cancelMonitorCheck: vi.fn(),
}));

useCleanDatabase();

let owner: Awaited<ReturnType<typeof createTestUser>>;
beforeEach(async () => {
	owner = await createTestUser();
});
afterEach(async () => {
	await db.execute(sql`drop trigger if exists test_fail_bulk on "uptime_monitor"`);
	await db.execute(sql`drop function if exists test_fail_bulk()`);
});

describe("uptimeMonitor.monitor.updateBulk — atomicity", () => {
	it("rolls every row back and returns a typed server error when a later write fails", async () => {
		const http = await createTestMonitor(owner.id, { name: "Http", tags: ["before"] });
		const hb = await createTestMonitor(owner.id, { name: "Heartbeat", monitorType: "heartbeat", tags: ["before"] });
		const ids = [http.uptimeMonitorId, hb.uptimeMonitorId].sort();
		// `method` applies to HTTP only, so the two rows form two distinct UPDATE groups
		// in id order; the second one (the last id) is made to fail after the first succeeded.
		const lastId = ids[1]!;
		await db.execute(sql.raw(`create function test_fail_bulk() returns trigger as $$ begin if NEW."uptimeMonitorId" = '${lastId}' then raise exception 'injected infrastructure failure'; end if; return NEW; end $$ language plpgsql`));
		await db.execute(sql`create trigger test_fail_bulk before update on "uptime_monitor" for each row execute function test_fail_bulk()`);
		const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const error = await authedCaller(owner).uptimeMonitor.monitor
			.updateBulk({ monitorIds: ids, patch: { method: "HEAD", tags: ["after"] } })
			.catch((caught: unknown) => caught);
		quiet.mockRestore();
		expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
		// The wire format (errorFormatter) never forwards database detail: a support reference only.
		const wire = formatApiError({ message: (error as Error).message, data: { code: "INTERNAL_SERVER_ERROR" } }, error as never, getTranslator("en"), "req-bulk-1");
		expect(wire.message).toContain("req-bulk-1");
		expect(JSON.stringify(wire)).not.toContain("injected");
		const rows = await db.select().from(uptimeMonitor).where(inArray(uptimeMonitor.uptimeMonitorId, ids));
		expect(rows).toHaveLength(2);
		for (const row of rows) expect(row.tags).toEqual(["before"]);
		expect(rows.find(row => row.uptimeMonitorId === http.uptimeMonitorId)?.method).toBe("GET");
	});

	it("maps a database deadline (query_canceled) to a typed TIMEOUT with the localized copy and rolls everything back", async () => {
		const a = await createTestMonitor(owner.id, { timeout: 4000 });
		const b = await createTestMonitor(owner.id, { timeout: 4000 });
		const ids = [a.uptimeMonitorId, b.uptimeMonitorId];
		await db.execute(sql.raw(`create function test_fail_bulk() returns trigger as $$ begin raise exception 'deadline' using errcode = '57014'; end $$ language plpgsql`));
		await db.execute(sql`create trigger test_fail_bulk before update on "uptime_monitor" for each row execute function test_fail_bulk()`);
		const error = await authedCaller(owner).uptimeMonitor.monitor
			.updateBulk({ monitorIds: ids, patch: { timeout: 9000 } })
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: "TIMEOUT", message: getTranslator("en")("errors.bulkTimeout") });
		for (const lang of ["ar", "fr", "de", "es"] as const) expect(getTranslator(lang)("errors.bulkTimeout")).not.toBe(getTranslator("en")("errors.bulkTimeout"));
		const rows = await db.select().from(uptimeMonitor).where(inArray(uptimeMonitor.uptimeMonitorId, ids));
		expect(rows.map(row => row.timeout)).toEqual([4000, 4000]);
	});

	it("updates a 50-monitor selection atomically in well under the 5 s acceptance bound", async () => {
		const made = await Promise.all(Array.from({ length: 50 }, (_, i) => createTestMonitor(owner.id, { name: `qa-scale-${i}`, failureThreshold: 2 })));
		const ids = made.map(m => m.uptimeMonitorId);
		const started = performance.now();
		const result = await authedCaller(owner).uptimeMonitor.monitor.updateBulk({ monitorIds: ids, patch: { failureThreshold: 3 } });
		expect(performance.now() - started).toBeLessThan(5000);
		expect(result.results).toHaveLength(50);
		expect(result.results.every(row => row.status === "updated")).toBe(true);
		const rows = await db.select().from(uptimeMonitor).where(inArray(uptimeMonitor.uptimeMonitorId, ids));
		expect(rows.every(row => row.failureThreshold === 3)).toBe(true);
	});

	it("reports a per-item rejection for a monitor that cannot take the patch while still updating the rest", async () => {
		const http = await createTestMonitor(owner.id, { timeout: 4000 });
		const beat = await createTestMonitor(owner.id, { monitorType: "heartbeat", url: "", timeout: 4000 } as never);
		const result = await authedCaller(owner).uptimeMonitor.monitor.updateBulk({ monitorIds: [http.uptimeMonitorId, beat.uptimeMonitorId], patch: { method: "HEAD" } });
		expect(result.results.find(row => row.id === http.uptimeMonitorId)?.status).toBe("updated");
		const rejected = result.results.find(row => row.id === beat.uptimeMonitorId);
		expect(rejected?.status).toBe("rejected");
		expect(rejected?.reason).toBeTruthy();
		const rows = await db.select().from(uptimeMonitor).where(inArray(uptimeMonitor.uptimeMonitorId, [http.uptimeMonitorId, beat.uptimeMonitorId]));
		expect(rows.find(row => row.uptimeMonitorId === http.uptimeMonitorId)?.method).toBe("HEAD");
		expect(rows.find(row => row.uptimeMonitorId === beat.uptimeMonitorId)?.method).not.toBe("HEAD");
	});

	it("rejects an out-of-range patch value before touching any row", async () => {
		const mine = await createTestMonitor(owner.id, { timeout: 4000 });
		await expect(authedCaller(owner).uptimeMonitor.monitor.updateBulk({ monitorIds: [mine.uptimeMonitorId], patch: { timeout: -5 } as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		const [row] = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, mine.uptimeMonitorId));
		expect(row?.timeout).toBe(4000);
	});

	it("makes an interval change due now for active monitors and leaves paused monitors unscheduled", async () => {
		const stale = "2000-01-01T00:00:00.000Z";
		const active = await createTestMonitor(owner.id, { interval: 300, active: true, nextCheckAt: stale });
		const paused = await createTestMonitor(owner.id, { interval: 300, active: false, nextCheckAt: stale });
		await authedCaller(owner).uptimeMonitor.monitor.updateBulk({ monitorIds: [active.uptimeMonitorId, paused.uptimeMonitorId], patch: { interval: 600 } });
		const rows = await db.select().from(uptimeMonitor).where(inArray(uptimeMonitor.uptimeMonitorId, [active.uptimeMonitorId, paused.uptimeMonitorId]));
		const activeRow = rows.find(row => row.uptimeMonitorId === active.uptimeMonitorId)!;
		const pausedRow = rows.find(row => row.uptimeMonitorId === paused.uptimeMonitorId)!;
		expect(Math.abs(new Date(activeRow.nextCheckAt as string).getTime() - Date.now())).toBeLessThan(15_000);
		expect(pausedRow.nextCheckAt).toBe(stale);
	});

	it("leaves everything unchanged when the selection contains a foreign id", async () => {
		const other = await createTestUser();
		const mine = await createTestMonitor(owner.id, { timeout: 4000 });
		const theirs = await createTestMonitor(other.id, { timeout: 4000 });
		await expect(authedCaller(owner).uptimeMonitor.monitor.updateBulk({ monitorIds: [mine.uptimeMonitorId, theirs.uptimeMonitorId], patch: { timeout: 9000 } })).rejects.toMatchObject({ code: "NOT_FOUND" });
		const [row] = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, mine.uptimeMonitorId));
		expect(row?.timeout).toBe(4000);
	});
});

describe("uptimeMonitor.monitor.deleteBulk — input bounds", () => {
	it("rejects more than 200 ids, duplicate ids and an empty list before touching the database", async () => {
		const api = authedCaller(owner).uptimeMonitor.monitor;
		const many = Array.from({ length: 201 }, (_, i) => `id-${i}`);
		await expect(api.deleteBulk({ ids: many, count: 201 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(api.deleteBulk({ ids: [], count: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(api.deleteBulk({ ids: ["a", "a"], count: 2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("deletes nothing foreign in a mixed list and reports foreign and missing ids identically", async () => {
		const other = await createTestUser();
		const mine = await createTestMonitor(owner.id);
		const theirs = await createTestMonitor(other.id);
		const result = await authedCaller(owner).uptimeMonitor.monitor.deleteBulk({ ids: [mine.uptimeMonitorId, theirs.uptimeMonitorId, "no-such-id"], count: 3 });
		expect(result[0]).toEqual({ id: mine.uptimeMonitorId, status: "deleted" });
		expect(result[1]).toMatchObject({ id: theirs.uptimeMonitorId, status: "rejected" });
		expect(result[2]).toMatchObject({ id: "no-such-id", status: "rejected", reason: (result[1] as { reason?: string }).reason });
		expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, theirs.uptimeMonitorId))).toHaveLength(1);
	});

	it("deletes a full 12-monitor selection in one call and reports each id", async () => {
		const made = await Promise.all(Array.from({ length: 12 }, (_, i) => createTestMonitor(owner.id, { name: `qa-${i}` })));
		const ids = made.map(m => m.uptimeMonitorId);
		const result = await authedCaller(owner).uptimeMonitor.monitor.deleteBulk({ ids, count: 12 });
		expect(result).toEqual(ids.map(id => ({ id, status: "deleted" })));
		expect(await db.select().from(uptimeMonitor).where(inArray(uptimeMonitor.uptimeMonitorId, ids))).toHaveLength(0);
	});
});
