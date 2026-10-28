import { db, user, uptimeMonitor, uptimeMonitorTemplate, uptimeNotificationChannel, type DbTransaction, type UptimeMonitorRow, apiUpdateUptimeMonitorsBulk } from "@pulsy/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { Translator } from "../../lib/i18n";
import { httpConfigPatch } from "./http-config";
import { countersForPolicyChange } from "./latency-policy";
import { firstCheckAt } from "./first-check";

/** Deadlines cancel PostgreSQL work, not merely the HTTP promise. Throwing
 * inside the transaction always rolls back; no abandoned write can commit. */
export async function writeDeadline(tx: DbTransaction, deadline: number, t: Translator) {
  const remaining = Math.floor(deadline-Date.now());
  if (remaining <= 0) throw new TRPCError({code:"TIMEOUT",message:t("errors.bulkTimeout")});
  await tx.execute(sql`select set_config('statement_timeout', ${String(remaining)}, true), set_config('lock_timeout', ${String(Math.min(remaining,5000))}, true)`);
}

function isDatabaseTimeout(error: unknown): boolean {
  let current: unknown = error;
  for(let n=0;n<8 && current && typeof current === "object";n++) {
    if ("code" in current && ["57014","55P03"].includes(String(current.code))) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export async function updateMonitorsBulk(input: z.infer<typeof apiUpdateUptimeMonitorsBulk>, userId: string, t: Translator, requestId: string) {
  const started = Date.now();
  const phases: Record<string,number> = {};
  try {
    return await db.transaction(async tx => {
      await writeDeadline(tx,started+20_000,t);
      const scope = and(eq(uptimeMonitor.userId,userId),inArray(uptimeMonitor.uptimeMonitorId,input.monitorIds));
      const owned = await tx.select().from(uptimeMonitor).where(scope).orderBy(uptimeMonitor.uptimeMonitorId).for("update");
      if(owned.length !== input.monitorIds.length) throw new TRPCError({code:"NOT_FOUND",message:t("errors.notFound",{resource:"monitor"})});
      phases.lockMs = Date.now()-started;
      const supports = (monitor: UptimeMonitorRow, field: string) => field === "tags" ||
        (["interval","timeout","failureThreshold"].includes(field) ? !["heartbeat","server"].includes(monitor.monitorType) : monitor.monitorType === "http");
      const groups = new Map<string,{patch:Partial<UptimeMonitorRow>;ids:string[]}>();
      const results: Array<{id:string;status:"updated"|"rejected";reason?:string}> = [];
      const recheckAt = firstCheckAt(input.monitorIds.length);
      for(const monitor of owned) {
        const patch: Partial<UptimeMonitorRow> = Object.fromEntries(Object.entries(input.patch).filter(([field])=>supports(monitor,field)));
        try {
          if(!Object.keys(patch).length) throw new TRPCError({code:"BAD_REQUEST",message:t("errors.monitorTypeAction")});
          if(monitor.monitorType === "http") httpConfigPatch({}, input.patch.method ?? monitor.method,t,monitor.requestCipher);
          if(patch.expectedStatus !== undefined && patch.expectedStatuses === undefined) patch.expectedStatuses = null;
          if(patch.tlsMonitoringEnabled === false) { patch.tlsExpiresAt=null; patch.tlsExpiresInDays=null; }
          Object.assign(patch,countersForPolicyChange(monitor.latencyPolicy,patch.latencyPolicy));
          if(monitor.active && ((patch.interval !== undefined && patch.interval !== monitor.interval) || (patch.method !== undefined && patch.method !== monitor.method))) patch.nextCheckAt=recheckAt;
          const key=JSON.stringify(patch);
          const group=groups.get(key) ?? {patch,ids:[]};
          group.ids.push(monitor.uptimeMonitorId); groups.set(key,group);
          results.push({id:monitor.uptimeMonitorId,status:"updated"});
        } catch(error) {
          if(!(error instanceof TRPCError) || error.code !== "BAD_REQUEST") throw error;
          results.push({id:monitor.uptimeMonitorId,status:"rejected",reason:error.message});
        }
      }
      phases.validationMs=Date.now()-started-phases.lockMs;
      const updated: UptimeMonitorRow[]=[];
      // At most one UPDATE per distinct applicable patch, independent of count.
      for(const group of groups.values()) {
        await writeDeadline(tx,started+20_000,t);
        updated.push(...await tx.update(uptimeMonitor).set(group.patch).where(and(eq(uptimeMonitor.userId,userId),inArray(uptimeMonitor.uptimeMonitorId,group.ids))).returning());
      }
      phases.writeMs=Date.now()-started-phases.lockMs-phases.validationMs;
      await writeDeadline(tx,started+20_000,t);
      return {updated,results};
    });
  } catch(error) {
    if(isDatabaseTimeout(error)) throw new TRPCError({code:"TIMEOUT",message:t("errors.bulkTimeout")});
    throw error;
  } finally {
    console.info(JSON.stringify({event:"monitor.updateBulk",requestId,monitorCount:input.monitorIds.length,...phases,totalMs:Date.now()-started}));
  }
}

export async function deleteMonitorsBulk(ids: string[], userId: string, t: Translator) {
  const deadline=Date.now()+20_000;
  try {
    return await db.transaction(async tx => {
      await writeDeadline(tx,deadline,t);
      // Template saves use the same owner lock, preventing a new JSON channel
      // reference from racing cleanup while its channel is being deleted.
      await tx.select({id:user.id}).from(user).where(eq(user.id,userId)).for("update");
      const channels=await tx.select({id:uptimeNotificationChannel.channelId}).from(uptimeNotificationChannel)
        .where(and(eq(uptimeNotificationChannel.userId,userId),inArray(uptimeNotificationChannel.uptimeMonitorId,ids)));
      const removedChannels=new Set(channels.map(row=>row.id));
      if(removedChannels.size) {
        const templates=await tx.select().from(uptimeMonitorTemplate).where(eq(uptimeMonitorTemplate.userId,userId)).orderBy(uptimeMonitorTemplate.id).for("update");
        for(const template of templates) {
          const references=template.configuration.channelIds;
          if(!references?.some(id=>removedChannels.has(id))) continue;
          await writeDeadline(tx,deadline,t);
          await tx.update(uptimeMonitorTemplate).set({configuration:{...template.configuration,channelIds:references.filter(id=>!removedChannels.has(id))}})
            .where(and(eq(uptimeMonitorTemplate.userId,userId),eq(uptimeMonitorTemplate.id,template.id)));
        }
      }
      await writeDeadline(tx,deadline,t);
      // Foreign keys cascade through history, channels, components and bindings.
      return tx.delete(uptimeMonitor).where(and(eq(uptimeMonitor.userId,userId),inArray(uptimeMonitor.uptimeMonitorId,ids))).returning({id:uptimeMonitor.uptimeMonitorId});
    });
  } catch(error) {
    if(isDatabaseTimeout(error)) throw new TRPCError({code:"TIMEOUT",message:t("errors.bulkTimeout")});
    throw error;
  }
}
