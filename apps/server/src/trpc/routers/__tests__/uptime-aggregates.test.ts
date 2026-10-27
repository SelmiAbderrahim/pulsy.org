import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeCheckLog, uptimeMonitor } from "@pulsy/db";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { eq } from "drizzle-orm";

useCleanDatabase();
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const now = "2026-10-09T12:00:00.000Z";
function freezeWindow() { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); }
async function checks(id: string, up: number, down: number, date = now) {
  await db.insert(uptimeCheckLog).values(Array.from({length:up+down}, (_,i)=>({
    uptimeMonitorId:id, status:i<up?"up" as const:"down" as const, responseTime: i<up?0:100, createdAt:date,
  })));
}

describe("live rolling uptime aggregates", () => {
  it("agrees for list, detail stats and SLA on one window, excludes future/old and foreign samples, refreshes", async () => {
    freezeWindow();
    const owner = await createTestUser();

    const foreign = await createTestUser();
    const monitor = await createTestMonitor(owner.id, {uptimePercentage:99});
    const other = await createTestMonitor(foreign.id);
    await checks(monitor.uptimeMonitorId, 1, 1, "2026-09-09T12:00:00.000Z");
    await checks(monitor.uptimeMonitorId, 1, 0, "2026-09-09T11:59:59.999Z");
    await checks(monitor.uptimeMonitorId, 1, 0, "2026-10-09T12:00:00.001Z");
    await checks(other.uptimeMonitorId, 0, 8);
    const api=authedCaller(owner).uptimeMonitor;
    const row=(await api.monitor.list())[0]!;
    const stats=await api.checkLog.stats({uptimeMonitorId:monitor.uptimeMonitorId,days:30});
    const report=await api.slaReport.data({uptimeMonitorId:monitor.uptimeMonitorId,days:30});
    expect(row).toMatchObject({uptimePercentage:50,uptimeChecks:2});
    expect(stats).toMatchObject({uptimePercentage:50,totalChecks:2});
    expect(report.stats).toMatchObject({uptimePercentage:50,totalChecks:2,avgResponseTime:50,p95ResponseTime:100});
    expect(stats.avgResponseTime).toBe(report.stats.avgResponseTime); // Overview and Reports include all recorded latency in the same 30-day window.
    await checks(monitor.uptimeMonitorId, 0, 2);
    expect((await api.monitor.list())[0]!.uptimePercentage).toBe(25);
    // Read-time aggregation does not rewrite historical cached columns or mutate monitor configuration.
    expect((await db.query.uptimeMonitor.findFirst({where:eq(uptimeMonitor.uptimeMonitorId,monitor.uptimeMonitorId)}))!.uptimePercentage).toBe(99);
  });

  it("averages monitors equally, includes zero, excludes unknowns and does not trust stale stored values", async () => {
    const owner=await createTestUser();
    const up=await createTestMonitor(owner.id,{uptimePercentage:1});
    const down=await createTestMonitor(owner.id,{uptimePercentage:99});
    await createTestMonitor(owner.id,{uptimePercentage:100});
    await checks(up.uptimeMonitorId, 3, 0, new Date().toISOString());
    await checks(down.uptimeMonitorId, 0, 1, new Date().toISOString());
    const summary=await authedCaller(owner).uptimeMonitor.dashboard.summary();
    expect(summary).toMatchObject({avgUptimePercentage:50,uptimeMonitorsWithData:2});
  });

  it("summary counters and average equal the values derived from the list snapshot (fixture clock)", async () => {
    freezeWindow();
    const owner=await createTestUser();
    const up=await createTestMonitor(owner.id,{status:"up",active:true});
    const down=await createTestMonitor(owner.id,{status:"down",active:true});
    await createTestMonitor(owner.id,{status:"down",active:false});
    await createTestMonitor(owner.id,{status:"pending",active:true});
    await checks(up.uptimeMonitorId, 9, 1);
    await checks(down.uptimeMonitorId, 1, 3);
    const api=authedCaller(owner).uptimeMonitor;
    const [rows,summary]=await Promise.all([api.monitor.list(),api.dashboard.summary()]);
    const known=rows.map(row=>row.uptimePercentage).filter((value):value is number=>value!==null);
    expect(summary).toMatchObject({totalMonitors:rows.length,monitorsUp:1,monitorsDown:1,monitorsPending:1,monitorsPaused:1,monitorsDegraded:0,activeMonitors:3,avgUptimePercentage:57.5,uptimeMonitorsWithData:2});
    expect(summary.monitorsUp+summary.monitorsDown+summary.monitorsDegraded+summary.monitorsPending+summary.monitorsPaused).toBe(summary.totalMonitors);
    expect(summary.avgUptimePercentage).toBe(Math.round(known.reduce((sum,value)=>sum+value,0)/known.length*100)/100);
  });

  it("never counts another account's monitors in the summary and keeps the states summing to the total", async () => {
    const owner=await createTestUser(), stranger=await createTestUser();
    for (const [status,active] of [["up",true],["down",true],["degraded",true],["pending",true],["up",false]] as const) await createTestMonitor(owner.id,{status,active});
    for (let i=0;i<4;i++) await createTestMonitor(stranger.id,{status:"down",active:true});
    const summary=await authedCaller(owner).uptimeMonitor.dashboard.summary();
    expect(summary).toMatchObject({totalMonitors:5,monitorsUp:1,monitorsDown:1,monitorsDegraded:1,monitorsPending:1,monitorsPaused:1});
    expect(summary.monitorsUp+summary.monitorsDown+summary.monitorsDegraded+summary.monitorsPending+summary.monitorsPaused).toBe(summary.totalMonitors);
  });

  it("returns unknown rather than 0% or 100% without samples", async () => {
    const owner=await createTestUser();

    const m=await createTestMonitor(owner.id,{uptimePercentage:98});
    const api=authedCaller(owner).uptimeMonitor;
    expect((await api.monitor.list())[0]).toMatchObject({uptimePercentage:null,uptimeChecks:0});
    expect((await api.checkLog.stats({uptimeMonitorId:m.uptimeMonitorId})).uptimePercentage).toBeNull();
    expect((await api.slaReport.data({uptimeMonitorId:m.uptimeMonitorId,days:30})).stats.uptimePercentage).toBeNull();
    expect((await api.dashboard.summary()).avgUptimePercentage).toBeNull();
  });

  it("loads 200 monitors / 24000 checks with constant grouped queries and no per-row statistics fetches", async () => {
    const owner=await createTestUser();
    const monitors=await db.insert(uptimeMonitor).values(Array.from({length:200},(_,i)=>({userId:owner.id,name:`Large list ${i}`,url:"https://fixtures.invalid",active:false}))).returning();
    const createdAt=new Date().toISOString();
    for(const m of monitors) await checks(m.uptimeMonitorId,60,60,createdAt);
    const select=vi.spyOn(db,"select");
    const rowsQuery=vi.spyOn(db.query.uptimeCheckLog,"findMany");
    const started=performance.now();
    const rows=await authedCaller(owner).uptimeMonitor.monitor.list();
    console.log(JSON.stringify({fixture:"200 monitors / 24000 checks",elapsedMs:Math.round(performance.now()-started),groupedQueries:select.mock.calls.length,perMonitorLogQueries:rowsQuery.mock.calls.length}));
    const listMs=performance.now()-started;
    const listSelects=select.mock.calls.length;
    expect(rows).toHaveLength(200);
    expect(rows.every(row=>row.uptimePercentage===50)).toBe(true);
    // Generous regression guard (not a benchmark): an N+1 over 200 monitors would be an order of magnitude slower.
    expect(listMs).toBeLessThan(1500);
    const summaryStarted=performance.now();
    const summary=await authedCaller(owner).uptimeMonitor.dashboard.summary();
    expect(performance.now()-summaryStarted).toBeLessThan(1500);
    expect(summary).toMatchObject({totalMonitors:200,monitorsPaused:200,avgUptimePercentage:50});
    // Full-day rollups + partial-day observations, plus three account-wide
    // channel/binding/status-page-membership queries; the count stays constant as monitors grow.
    expect(listSelects).toBe(5);
    // dashboard.summary issues its own constant set of grouped queries.
    expect(select.mock.calls.length-listSelects).toBe(4);
    expect(rowsQuery).not.toHaveBeenCalled();
  });
});
