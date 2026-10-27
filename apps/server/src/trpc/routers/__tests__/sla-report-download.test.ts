import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeCheckLog, uptimeIncident } from "@pulsy/db";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { encrypt } from "../../../lib/crypto";
import { getTranslator } from "../../../lib/i18n";
import type { SlaReportModel } from "../../../services/uptime/sla-report-service";

useCleanDatabase();
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// Match the web service's dynamic procedure lookup. A missing route must fail at
// runtime with its full RPC path, rather than preventing test collection/typecheck.
function download(caller: ReturnType<typeof authedCaller>, input: unknown): Promise<{ report: SlaReportModel; pdf: string }> {
  const query = Reflect.get(caller.uptimeMonitor.slaReport, "download") as (value: unknown) => Promise<{ report: SlaReportModel; pdf: string }>;
  return query(input);
}

function assertPdf(encoded: string) {
  const pdf = Buffer.from(encoded, "base64");
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(pdf.subarray(-20).toString("ascii")).toContain("%%EOF");
  return pdf;
}

describe("uptimeMonitor.slaReport.download", () => {
  it("resolves the exact client RPC path and returns unknown check success without accepting client totals", async () => {
    const owner = await createTestUser();
    const monitor = await createTestMonitor(owner.id);
    const result = await download(authedCaller(owner), { uptimeMonitorId: monitor.uptimeMonitorId, stats: { totalChecks: 99, uptimePercentage: 100 } });
    expect(Object.keys(result).sort()).toEqual(["pdf", "report"]);
    assertPdf(result.pdf);
    expect(result.report).toMatchObject({ uptimeMonitorId: monitor.uptimeMonitorId, periodLabel: "30d", windowDays: 30, windowTimezone: "UTC", stats: { totalChecks: 0, uptimePercentage: null, avgResponseTime: null }, incidents: { count: 0 }, incidentList: [], dailyUptime: [] });
  });

  it("renders owned measured facts and the requested timezone without exposing private history or stored credentials", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    const owner = await createTestUser({ timezone: "Europe/Berlin" });
    const other = await createTestUser();
    const secret = "request-credential-must-not-escape";
    const cipher = encrypt(secret);
    const monitor = await createTestMonitor(owner.id, { name: "Owned API", requestCipher: cipher });
    const foreign = await createTestMonitor(other.id, { name: "Foreign secret monitor" });
    await db.insert(uptimeCheckLog).values([
      { uptimeMonitorId: monitor.uptimeMonitorId, status: "up", responseTime: 100, createdAt: "2026-10-20T11:00:00.000Z" },
      { uptimeMonitorId: monitor.uptimeMonitorId, status: "degraded", responseTime: 200, errorMessage: "private-history-credential", createdAt: "2026-10-20T11:05:00.000Z" },
      { uptimeMonitorId: foreign.uptimeMonitorId, status: "down", responseTime: null, createdAt: "2026-10-20T11:10:00.000Z" },
    ]);
    await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, status: "resolved", startedAt: "2026-10-20T11:05:00.000Z", resolvedAt: "2026-10-20T11:10:00.000Z", durationSeconds: 300, cause: "private-incident-credential" });
    // Observe real PDF rendering while allowing pdfkit to create the complete PDF.
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const result = await download(authedCaller(owner), { uptimeMonitorId: monitor.uptimeMonitorId, days: 7, timezone: "Asia/Tokyo" });
    const pdf = assertPdf(result.pdf);
    expect(result.report).toMatchObject({ uptimeMonitorId: monitor.uptimeMonitorId, monitorName: "Owned API", windowFrom: "2026-10-13T12:00:00.000Z", windowTo: "2026-10-20T12:00:00.000Z", generatedAt: "2026-10-20T12:00:00.000Z", windowTimezone: "UTC", stats: { totalChecks: 2, successfulChecks: 1, degradedChecks: 1, failedChecks: 0, uptimePercentage: 50, avgResponseTime: 150 }, incidents: { count: 1, totalDowntimeSeconds: 300 } });
    const drawn = text.mock.calls.map(call => typeof call[0] === "string" ? call[0] : "").join("\n");
    expect(drawn).toContain("Owned API");
    expect(drawn).toContain("Total checks: 2");
    expect(drawn).toContain("2026-10-20 21:00");
    expect(drawn).toContain("Asia/Tokyo");
    expect(drawn).toContain(getTranslator("en")("slaReport.dailyUptimeUtc"));
    const exposed = JSON.stringify(result.report) + drawn + pdf.toString("latin1");
    for (const privateValue of [secret, cipher, "requestCipher", "private-history-credential", "private-incident-credential", foreign.uptimeMonitorId, foreign.name]) expect(exposed).not.toContain(privateValue);
  });

  it("uses the owner's account timezone when omitted and localizes the actual PDF", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    const owner = await createTestUser({ timezone: "Europe/Berlin" });
    await createTestUser({ timezone: "Asia/Tokyo" });
    const monitor = await createTestMonitor(owner.id);
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const result = await download(authedCaller({ ...owner, language: "fr" }), { uptimeMonitorId: monitor.uptimeMonitorId });
    assertPdf(result.pdf);
    const drawn = text.mock.calls.map(call => typeof call[0] === "string" ? call[0] : "").join("\n");
    expect(drawn).toContain("Europe/Berlin");
    expect(drawn).toContain("2026-10-20 14:00");
    expect(drawn).toContain(getTranslator("fr")("slaReport.pdfTitle"));
    expect(drawn).not.toContain("Asia/Tokyo");
  });

  it("requires a session and returns the same localized NOT_FOUND for foreign and missing monitors", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const monitor = await createTestMonitor(owner.id);
    await expect(download(publicCaller(), { uptimeMonitorId: monitor.uptimeMonitorId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const caller = authedCaller({ ...other, language: "fr" });
    const expected = { code: "NOT_FOUND", message: getTranslator("fr")("errors.notFound", { resource: "monitor" }) };
    await expect(download(caller, { uptimeMonitorId: monitor.uptimeMonitorId })).rejects.toMatchObject(expected);
    await expect(download(caller, { uptimeMonitorId: "missing-monitor" })).rejects.toMatchObject(expected);
  });

  it("validates monitor, day and timezone input before rendering", async () => {
    const owner = await createTestUser();
    const monitor = await createTestMonitor(owner.id);
    const caller = authedCaller(owner);
    for (const invalid of [
      { uptimeMonitorId: "" },
      { uptimeMonitorId: monitor.uptimeMonitorId, days: 0 },
      { uptimeMonitorId: monitor.uptimeMonitorId, days: 367 },
      { uptimeMonitorId: monitor.uptimeMonitorId, days: 1.5 },
      { uptimeMonitorId: monitor.uptimeMonitorId, days: "30" },
      { uptimeMonitorId: monitor.uptimeMonitorId, timezone: "invalid/timezone" },
    ]) await expect(download(caller, invalid)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
