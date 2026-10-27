import { db, uptimeCheckLog } from "@pulsy/db";
import { expect, it } from "vitest";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { buildSlaReportModel } from "../../../services/uptime/sla-report-service";
import { getTranslator } from "../../../lib/i18n";
useCleanDatabase();
it("Overview and Reports average all recorded outcomes within the same rolling 30-day window", async () => {
  const user = await createTestUser(), monitor = await createTestMonitor(user.id);
  const now = new Date();
  for (const [status, responseTime, ageDays] of [["up", 63, 1], ["degraded", 593, 2], ["down", 900, 3], ["down", null, 4], ["up", 9999, 31], ["up", 9999, -1]] as const) await db.insert(uptimeCheckLog).values({uptimeMonitorId:monitor.uptimeMonitorId,status,responseTime,createdAt:new Date(now.getTime()-ageDays*86400000).toISOString()});
  const overview = await authedCaller(user).uptimeMonitor.checkLog.stats({uptimeMonitorId:monitor.uptimeMonitorId,days:30});
  const report = await buildSlaReportModel({userId:user.id,monitorId:monitor.uptimeMonitorId,window:{kind:"days",days:30},now,t:getTranslator("en")});
  expect(overview).toMatchObject({totalChecks:4,upChecks:1,degradedChecks:1,downChecks:2,avgResponseTime:519,minResponseTime:63,maxResponseTime:900});
  expect(report.stats.avgResponseTime).toBe(overview.avgResponseTime);
  expect(report.stats.totalChecks).toBe(overview.totalChecks);
  const foreign = await createTestUser();
  await expect(authedCaller(foreign).uptimeMonitor.checkLog.stats({uptimeMonitorId:monitor.uptimeMonitorId,days:30})).rejects.toMatchObject({code:"NOT_FOUND"});
});
