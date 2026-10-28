import { db, uptimeMonitor } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
export async function storedMonitorSnapshot(monitorId: string, userId: string) {
  const monitor = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.uptimeMonitorId, monitorId), eq(uptimeMonitor.userId, userId)), with: { incidents: true } });
  if (!monitor) throw new Error("Missing owned test monitor");
  return monitor;
}
