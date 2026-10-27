import type { NetworkConfiguration } from "@pulsy/db/validation-network";
import type { HttpAssertion, LatencyPolicy, UptimeMonitorMethod } from "./uptime";
export interface MonitorTemplateConfiguration {
  monitorType?: "dns" | "tcp"; networkConfig?: NetworkConfiguration;
  method: UptimeMonitorMethod; expectedStatus: number; expectedStatuses?: string | null; tlsMonitoringEnabled?: boolean; timeout: number; interval: number; failureThreshold: number; tags: string[];
  httpAssertions?: HttpAssertion[]; redirectPolicy?: "follow" | "manual" | "error"; latencyPolicy?: LatencyPolicy | null; channelIds?: string[];
}
export interface MonitorCreationDraft { name: string; configuration: MonitorTemplateConfiguration; needsRequestValues: boolean }
export interface MonitorTemplate extends MonitorCreationDraft { id: string; createdAt: string; updatedAt: string }
export interface TemplateChannelOption { id: string; type: string; monitorId: string | null; destination?: string | null }
