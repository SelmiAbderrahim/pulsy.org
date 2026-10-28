import { z } from "zod";
import { apiServerReportingInterval } from "./validation-server-interval";

const id = z.string().min(1).max(64);
const percent = z.number().finite().min(0).max(100);
const positive = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const path = z.string().min(1).max(512).startsWith("/").refine(value => new TextEncoder().encode(value).length <= 512 && !/[\x00-\x1f\x7f]/.test(value));
export const apiServerThresholds = z.object({ cpu: percent.default(90), memory: percent.default(90), disk: percent.default(90) }).strict();
export const apiServerConfiguration = z.object({
  name: z.string().trim().min(1).max(200),
  interval: apiServerReportingInterval.default(60),
  active: z.boolean().default(true),
  tags: z.array(z.string().min(1).max(50)).max(10).default([]),
  thresholds: apiServerThresholds.prefault({}),
  excludedFilesystems: z.array(path).max(32).default([]),
  channelIds: z.array(id).max(20).default([]).transform(values => [...new Set(values)]),
}).strict();
export const apiServerId = z.object({ monitorId: id }).strict();
export const apiServerHistory = apiServerId.extend({
  from: z.string().datetime(), to: z.string().datetime(), limit: z.number().int().min(1).max(1000).default(500),
}).refine(value => Date.parse(value.from) < Date.parse(value.to));
export const apiServerSample = z.object({
  version: z.literal(1),
  bootId: z.string().uuid(),
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sampledAt: z.string().datetime(),
  agent: z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/).max(32), arch: z.enum(["amd64", "arm64"]) }).strict(),
  cpuPercent: percent.nullable(), memoryPercent: percent.nullable(), swapPercent: percent.nullable(),
  load: z.tuple([positive, positive, positive]).nullable(), uptimeSeconds: positive.nullable(),
  filesystems: z.array(z.object({ path, usedPercent: percent.nullable() }).strict()).max(64),
}).strict().refine(value => new Set(value.filesystems.map(fs => fs.path)).size === value.filesystems.length);
export type ServerSample = z.infer<typeof apiServerSample>;
export type ServerCondition = { key: string; active: boolean; violating: number; healthy: number; value: number | null; threshold: number };

