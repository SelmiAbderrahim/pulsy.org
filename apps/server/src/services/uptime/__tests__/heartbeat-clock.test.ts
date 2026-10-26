import { describe, expect, it } from "vitest";
import { heartbeatDeadline } from "../heartbeat-clock";

const due = Date.parse("2026-10-10T12:00:00Z");
describe("heartbeat receive-time deadlines", () => {
  it("keeps a never received monitor New before its first deadline", () => {
    expect(heartbeatDeadline({ expectedAt: due, graceSeconds: 60, receivedSuccess: false, now: due - 1 })).toEqual({ status: "pending", nextDeadline: due, reason: null });
  });
  it("uses exact Late and Down boundaries without requiring intermediate ticks", () => {
    expect(heartbeatDeadline({ expectedAt: due, graceSeconds: 60, receivedSuccess: false, now: due })).toEqual({ status: "degraded", nextDeadline: due + 60_000, reason: "heartbeat_late" });
    expect(heartbeatDeadline({ expectedAt: due, graceSeconds: 60, receivedSuccess: true, now: due + 59_999 }).status).toBe("degraded");
    expect(heartbeatDeadline({ expectedAt: due, graceSeconds: 60, receivedSuccess: false, now: due + 60_000 })).toEqual({ status: "down", nextDeadline: null, reason: "heartbeat_missed" });
    expect(heartbeatDeadline({ expectedAt: due, graceSeconds: 60, receivedSuccess: true, now: due + 86_400_000 }).status).toBe("down");
  });
  it("allows zero grace and only a real received success is healthy", () => {
    expect(heartbeatDeadline({ expectedAt: due, graceSeconds: 0, receivedSuccess: false, now: due }).status).toBe("down");
    expect(heartbeatDeadline({ expectedAt: due, graceSeconds: 0, receivedSuccess: true, now: due - 1 }).status).toBe("up");
  });
});
