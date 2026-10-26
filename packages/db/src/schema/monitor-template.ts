import { z } from "zod";
import { apiCreateUptimeMonitor } from "./validation";
import { apiNetworkConfiguration } from "./validation-network";

// The allowlist deliberately excludes URL, requestConfig and operational facts.
export const apiMonitorTemplateConfiguration = apiCreateUptimeMonitor.pick({ method: true, expectedStatus: true, expectedStatuses: true, tlsMonitoringEnabled: true, timeout: true, interval: true, failureThreshold: true, tags: true, httpAssertions: true, redirectPolicy: true, latencyPolicy: true, channelIds: true }).extend({ monitorType: z.enum(["dns", "tcp"]).optional(), networkConfig: apiNetworkConfiguration.optional() }).strict().refine(value => value.monitorType ? value.networkConfig?.type === value.monitorType && value.timeout <= 30000 : value.networkConfig === undefined);
export type MonitorTemplateConfiguration = z.infer<typeof apiMonitorTemplateConfiguration>;
export const apiSaveMonitorTemplate = z.object({ id: z.string().min(1).max(64).optional(), name: z.string().trim().min(1).max(80), configuration: apiMonitorTemplateConfiguration, needsRequestValues: z.boolean().default(false) }).strict();
