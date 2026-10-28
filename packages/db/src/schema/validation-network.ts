import { DEFAULT_FAILURE_THRESHOLD, MAX_MONITOR_TIMEOUT_MS } from "./monitor-defaults";
import { z } from "zod";
import { apiLatencyPolicy } from "./validation-latency";
// Bounded ASCII/punycode DNS labels, 50 records and 64 KiB expectations;
// extend international-name entry after validated IDNA UI normalization.
const dnsHostname = z.string().min(1).max(253).regex(/^(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.)*[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.?$/);
const exchangeHostname = dnsHostname.refine(value => !value.includes("_"));
const mxRecord = z.object({ exchange: z.union([exchangeHostname, z.literal(".")]), priority: z.number().int().min(0).max(65535) }).strict().refine(value => value.exchange !== "." || value.priority === 0);
const dnsBase = { type: z.literal("dns"), hostname: dnsHostname, mode: z.enum(["exists", "matches"]) };
const answerShape = [
  z.object({ ...dnsBase, recordType: z.literal("A"), expected: z.array(z.ipv4()).max(50).default([]) }).strict(),
  z.object({ ...dnsBase, recordType: z.literal("AAAA"), expected: z.array(z.ipv6()).max(50).default([]) }).strict(),
  z.object({ ...dnsBase, recordType: z.literal("CNAME"), expected: z.array(dnsHostname).max(50).default([]) }).strict(),
  z.object({ ...dnsBase, recordType: z.literal("MX"), expected: z.array(mxRecord).max(50).default([]) }).strict(),
  z.object({ ...dnsBase, recordType: z.literal("TXT"), expected: z.array(z.string().max(4096)).max(50).default([]) }).strict(),
] as const;
export const apiDnsConfiguration = z.discriminatedUnion("recordType", answerShape).refine(value => value.mode !== "matches" || value.expected.length > 0)
  .refine(value => value.recordType !== "MX" || !value.expected.some(record => record.exchange === ".") || value.expected.length === 1)
  .refine(value => new TextEncoder().encode(JSON.stringify(value.expected)).byteLength <= 65536);
const socketHostname = z.string().min(1).max(253).refine(value => {
  if (exchangeHostname.safeParse(value).success) return true;
  const address = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return z.ipv6().safeParse(address).success;
});
export const apiTcpConfiguration = z.object({ type: z.literal("tcp"), hostname: socketHostname, port: z.number().int().min(1).max(65535) }).strict();
export const apiNetworkConfiguration = z.union([apiDnsConfiguration, apiTcpConfiguration]);
export const apiNetworkMonitor = z.object({ name: z.string().trim().min(1).max(255), configuration: apiNetworkConfiguration,
  interval: z.union([z.literal(30), z.literal(60), z.literal(300), z.literal(600), z.literal(1800), z.literal(3600)]).default(300),
  timeout: z.number().int().min(1000).max(MAX_MONITOR_TIMEOUT_MS).default(10000), failureThreshold: z.number().int().min(1).max(10).default(DEFAULT_FAILURE_THRESHOLD),
  active: z.boolean().default(true), tags: z.array(z.string().min(1).max(50)).max(10).default([]),
  latencyPolicy: apiLatencyPolicy.nullable().optional(), channelIds: z.array(z.string().min(1).max(64)).max(20).optional(),
}).strict();
export type DnsConfiguration = z.infer<typeof apiDnsConfiguration>;
export type NetworkConfiguration = z.infer<typeof apiNetworkConfiguration>;
export type NetworkMonitorInput = z.infer<typeof apiNetworkMonitor>;
