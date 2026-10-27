import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { getTranslator } from "../../../lib/i18n";
import { renderSlaReportPdf, type SlaReportModel } from "../sla-report-service";

/** Decode every Flate stream and collect the strings shown by Tj/TJ — what a reader would see. */
function pdfPlainText(pdf: Buffer): { pages: number; text: string } {
	const raw = pdf.toString("latin1");
	const pages = (raw.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
	let text = "";
	for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
		let body: string;
		try {
			body = inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1");
		} catch {
			continue;
		}
		// pdfkit emits one text operator per line; scan lines (no nested quantifiers → no backtracking).
		for (const line of body.split("\n")) {
			if (!/T[jJ]\s*$/.test(line)) continue;
			for (const piece of line.matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9a-fA-F]*)>/g)) {
				text += piece[1] !== undefined ? piece[1].replace(/\\(.)/g, "$1") : Buffer.from(piece[2]!, "hex").toString("latin1");
			}
			text += "\n";
		}
	}
	return { pages, text };
}

const base: SlaReportModel = {
	uptimeMonitorId: "m1",
	monitorName: "API",
	url: "https://example.com/health",
	windowFrom: "2026-09-12T00:00:00.000Z",
	windowTo: "2026-10-12T00:00:00.000Z",
	windowDays: 30,
	periodLabel: "30d",
	generatedAt: "2026-10-12T08:00:00.000Z",
	windowTimezone: "UTC",
	incidentList: [],
	stats: { totalChecks: 0, successfulChecks: 0, failedChecks: 0, degradedChecks: 0, avgResponseTime: null, minResponseTime: null, maxResponseTime: null, p95ResponseTime: null, uptimePercentage: null, availabilityPercentage: null, slowPercentage: null },
	incidents: { count: 0, totalDowntimeSeconds: 0, longestIncidentSeconds: 0 },
	dailyUptime: [],
};
const days = (count: number, uptime: (index: number) => number, firstDay = Date.UTC(2026, 8, 12)) =>
	Array.from({ length: count }, (_, index) => ({ date: new Date(firstDay + index * 86_400_000).toISOString().slice(0, 10), uptimePercentage: uptime(index), totalChecks: 288 }));
const cases: Record<string, SlaReportModel> = {
	"long-name": { ...base, monitorName: "Production customer-facing checkout API gateway ".repeat(12), url: `https://example.com/${"very-long-path-segment/".repeat(30)}` },
	"all-down": { ...base, stats: { ...base.stats, totalChecks: 8640, successfulChecks: 0, failedChecks: 8640, uptimePercentage: 0 }, incidents: { count: 1, totalDowntimeSeconds: 2592000, longestIncidentSeconds: 2592000 }, dailyUptime: days(30, () => 0) },
	"no-data": base,
	degraded: { ...base, stats: { ...base.stats, totalChecks: 8640, successfulChecks: 8000, failedChecks: 100, degradedChecks: 540, avgResponseTime: 410, p95ResponseTime: 1900, uptimePercentage: 92.59 }, incidents: { count: 3, totalDowntimeSeconds: 900, longestIncidentSeconds: 600 }, dailyUptime: days(30, (index) => 90 + (index % 10)) },
	"page-break": { ...base, windowFrom: "2026-07-14T00:00:00.000Z", windowTo: "2026-10-12T00:00:00.000Z", windowDays: 90, periodLabel: "90d", stats: { ...base.stats, totalChecks: 25920, successfulChecks: 25920, uptimePercentage: 100, avgResponseTime: 120, p95ResponseTime: 300 }, dailyUptime: days(90, () => 100, Date.UTC(2026, 6, 14)) },
	glyphs: { ...base, monitorName: "خدمة الدفع 支付服务 Zahlungsdienst café 🚀", url: "https://münchen.example/ü" },
};

const render = async (name: string, lang: "en" | "ar" | "fr" | "de" | "es") => {
	const pdf = await renderSlaReportPdf(cases[name]!, getTranslator(lang), lang);
	const { pages, text } = pdfPlainText(pdf);
	return { pdf, pages, text };
};
describe("SLA PDF content (inspected, not just non-empty)", () => {
	it.each(Object.keys(cases))("%s renders a real PDF in every locale and never prints the unit of a missing value", async (name) => {
		for (const lang of ["en", "ar", "fr", "de", "es"] as const) {
			const { pdf, pages, text } = await render(name, lang);
			expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
			expect(pages).toBeGreaterThan(0);
			expect(text).not.toMatch(/— ms/);
			expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
		}
	});
	it("states the UTC window and reconciles every total with the model it was drawn from", async () => {
		const model = cases.degraded!;
		const { text } = await render("degraded", "en");
		expect(text).toContain("Window computed in UTC; times shown in UTC (UTC+00:00).");
		for (const line of [`Total checks: ${model.stats.totalChecks}`, `Successful checks: ${model.stats.successfulChecks}`, `Degraded checks: ${model.stats.degradedChecks}`, `Failed checks: ${model.stats.failedChecks}`, `${model.stats.uptimePercentage}%`, `Incident count: ${model.incidents.count}`]) expect(text).toContain(line);
		expect(model.stats.successfulChecks + model.stats.degradedChecks + model.stats.failedChecks).toBeLessThanOrEqual(model.stats.totalChecks);
		expect(text).toContain("Total downtime: 900s (15m)");
	});
	it("shows all-down as 0.00% and no-data as an explicit absence, never a manufactured percentage", async () => {
		const down = (await render("all-down", "en")).text, none = (await render("no-data", "en")).text;
		expect(down).toContain("0.00%"); expect(down).toContain("Failed checks: 8640"); expect(down).toContain("30d");
		expect(none).toContain("No data for this period"); expect(none).not.toMatch(/\b\d+(\.\d+)?%/);
	});
	it.each(["en", "ar", "fr", "de", "es"] as const)("uses fixed precision in summary and daily rows for %s", async locale => {
    const model = { ...base, stats: { ...base.stats, uptimePercentage: 99.1 }, dailyUptime: days(1, () => 99.999) };
    const { text } = pdfPlainText(await renderSlaReportPdf(model, getTranslator(locale), locale));
    // Arabic retains the existing readable English PDF fallback; other locales retain their separators.
    const comma = ["fr", "de", "es"].includes(locale);
    expect(text).toContain(comma ? "99,10\u00a0%" : "99.10%");
    expect(text).toContain(comma ? "99,99\u00a0%" : "99.99%");
    expect(model.stats.uptimePercentage).toBe(99.1);
  });
	it("breaks a 90-day history across pages without dropping a day", async () => {
		const { pages, text } = await render("page-break", "en");
		expect(pages).toBeGreaterThanOrEqual(2);
		for (const day of cases["page-break"]!.dailyUptime) expect(text).toContain(`${day.date}: 100.00% (288)`);
	});
	it("wraps a very long name and URL in full instead of cutting them off", async () => {
		const { text } = await render("long-name", "en");
		expect(text.replace(/\s+/g, "").split("very-long-path-segment").length - 1).toBe(30);
		expect((text.match(/Production/g) ?? []).length).toBe(12);
	});
	it("replaces characters the PDF font cannot draw with ? and says so, and falls back to English labels for Arabic instead of garbage", async () => {
		const en = (await render("glyphs", "en")).text;
		expect(en).toMatch(/Monitor: \?{4} \?{5} \?{4} Zahlungsdienst caf\u00e9 \?/);
				expect(en).toContain("Some characters in the monitor name or URL cannot be shown in this PDF");
		const ar = (await render("glyphs", "ar")).text;
		expect(ar).toContain("SLA / Uptime Report"); expect(ar).toContain("Total checks:");
		expect(ar).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
		const fr = (await render("no-data", "fr")).text;
		expect(fr).toContain("Aucune donn\u00e9e pour cette p\u00e9riode");
	});
});
