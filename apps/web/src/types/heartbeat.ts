import type { UptimeMonitor } from "./uptime";
export interface HeartbeatConfiguration { name: string; interval: number; graceSeconds: number; active?: boolean; tags?: string[] }
export interface HeartbeatState { monitorId: string; interval: number; graceSeconds: number; expectedAt: string; nextDeadline: string | null; lastReceivedAt: string | null; lastSuccessAt: string | null; lastFailAt: string | null; currentRunId: string | null; lastRunDurationMs: number | null }
export interface HeartbeatRun { id: string; runId: string; startedAt: string; finishedAt: string | null; outcome: "running" | "success" | "fail" | "superseded"; metadata: { environment?: string; version?: string } | null }
export interface HeartbeatCreated { monitor: UptimeMonitor; token: string }
