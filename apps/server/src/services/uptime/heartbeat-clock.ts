/** Server-receive time only. A scan may skip Late and go directly Down. */
export function heartbeatDeadline(input: { expectedAt: number; graceSeconds: number; receivedSuccess: boolean; now: number }): {
  status: "pending" | "up" | "degraded" | "down"; nextDeadline: number | null; reason: "heartbeat_late" | "heartbeat_missed" | null;
} {
  const finalDeadline = input.expectedAt + input.graceSeconds * 1000;
  if (input.now >= finalDeadline) return { status: "down", nextDeadline: null, reason: "heartbeat_missed" };
  if (input.now >= input.expectedAt) return { status: "degraded", nextDeadline: finalDeadline, reason: "heartbeat_late" };
  return { status: input.receivedSuccess ? "up" : "pending", nextDeadline: input.expectedAt, reason: null };
}
