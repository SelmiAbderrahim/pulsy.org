import { formatPercent } from "@pulsy/db/percent-format";
import { isValidTimezone, timezoneLabel } from "@pulsy/db/timezone";
import {
	db,
	user,
	uptimeMonitor,
	uptimeSlaReportSubscription,
	type UptimeSlaReportSubscriptionRow,
} from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { PUBLIC_WEB_URL } from "../../lib/auth-config";
import { escapeHtml } from "../../lib/html";
import {
	DEFAULT_LANGUAGE,
	getTranslator,
	type Translator,
} from "../../lib/i18n";
import { safeErrorSummary } from "../../lib/safe-error";
import {
	type EmailAttachment,
	findEmailProviderById,
	sendViaProvider,
} from "./email-provider-service";
import {
	type DailyUptimeEntry,
	getMonitorDailyUptime,
	getMonitorIncidentsForWindow,
	summarizeWindowIncidents,
	type WindowIncident,
	getMonitorStatsForWindow,
	type IncidentSummary,
	type MonitorStats,
} from "./stats-service";

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPANY_NAME = "Pulsy";

/**
 * Report window contract. `days` powers the on-demand tab/route (rolling window
 * ending now); `range` powers the monthly job (a full prior calendar month).
 */
export type SlaReportWindow =
	| { kind: "days"; days: number }
	| { kind: "range"; from: string; to: string };

export interface SlaReportModel {
	uptimeMonitorId: string;
	monitorName: string;
	url: string;
	windowFrom: string; // ISO
	windowTo: string; // ISO
	windowDays: number;
	periodLabel: string; // "YYYY-MM" (month) or "30d" (rolling)
	generatedAt: string; // ISO
	/** Windows and daily buckets are computed in UTC; displays name their own zone. */
	windowTimezone: "UTC";
	stats: MonitorStats;
	incidents: IncidentSummary;
	/** Incidents overlapping the window, oldest first; totals above derive from it. */
	incidentList: WindowIncident[];
	dailyUptime: DailyUptimeEntry[];
}

function resolveWindow(
	window: SlaReportWindow,
	now: Date,
): { from: string; to: string; windowDays: number; periodLabel: string } {
	if (window.kind === "days") {
		return {
			from: new Date(now.getTime() - window.days * DAY_MS).toISOString(),
			to: now.toISOString(),
			windowDays: window.days,
			periodLabel: `${window.days}d`,
		};
	}
	const span = new Date(window.to).getTime() - new Date(window.from).getTime();
	return {
		from: window.from,
		to: window.to,
		windowDays: Math.max(1, Math.round(span / DAY_MS)),
		periodLabel: window.from.slice(0, 7),
	};
}

/**
 * Assemble the typed SLA report model for one monitor over a window. Scoped to
 * `userId`; throws NOT_FOUND (translated) when the monitor is not the user's.
 * All statistics math lives in stats-service; this only composes.
 */
export async function buildSlaReportModel(opts: {
	monitorId: string;
	userId: string;
	window: SlaReportWindow;
	t: Translator;
	now?: Date;
}): Promise<SlaReportModel> {
	const now = opts.now ?? new Date();
	const monitor = await db.query.uptimeMonitor.findFirst({
		where: and(
			eq(uptimeMonitor.uptimeMonitorId, opts.monitorId),
			eq(uptimeMonitor.userId, opts.userId),
		),
	});
	if (!monitor) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: opts.t("errors.notFound", { resource: "monitor" }),
		});
	}

	const { from, to, windowDays, periodLabel } = resolveWindow(
		opts.window,
		now,
	);

	const [stats, incidentList, dailyUptime] = await Promise.all([
		getMonitorStatsForWindow(opts.monitorId, opts.userId, from, to),
		getMonitorIncidentsForWindow(opts.monitorId, opts.userId, from, to),
		getMonitorDailyUptime(opts.monitorId, opts.userId, from, to),
	]);

	return {
		uptimeMonitorId: monitor.uptimeMonitorId,
		monitorName: monitor.name,
		url: monitor.url,
		windowFrom: from,
		windowTo: to,
		windowDays,
		periodLabel,
		generatedAt: now.toISOString(),
		windowTimezone: "UTC",
		stats,
		incidents: summarizeWindowIncidents(incidentList),
		incidentList,
		dailyUptime,
	};
}

/** The account's chosen display zone for server-rendered reports; UTC until one is chosen. */
export async function accountReportTimezone(userId: string): Promise<string> {
	const [account] = await db.select({ timezone: user.timezone }).from(user).where(eq(user.id, userId)).limit(1);
	return account?.timezone && isValidTimezone(account.timezone) ? account.timezone : "UTC";
}

/** A missing timing is a dash with no unit, never "— ms". */
function fmtMsPdf(value: number | null): string {
	return value === null ? "—" : `${value} ms`;
}

function dateOnly(iso: string): string {
	return iso.slice(0, 10);
}

/** "2026-10-17 14:05" wall time in `timezone` (Latin digits, PDF-safe). */
function zonedDateTime(iso: string, timezone: string): string {
	const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

// pdfkit's built-in fonts encode WinAnsi (cp1252) only. Any other character would be truncated to an
// unrelated byte and print as garbage, so it is replaced with "?" instead.
// Rendering constraint: bundling a Unicode font (with Arabic shaping + bidi) would fix this properly; deferred.
const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function pdfEncodable(char: string): boolean {
	const code = char.codePointAt(0) ?? 0;
	return code < 0x80 || (code >= 0xa0 && code < 0x100) || CP1252_EXTRA.has(char);
}
const PDF_LABEL_KEYS = [
	"slaReport.pdfTitle", "slaReport.monitor", "slaReport.url", "slaReport.period", "slaReport.noData", "slaReport.uptime", "slaReport.basis",
	"slaReport.totalChecks", "slaReport.successfulChecks", "slaReport.degradedChecks", "slaReport.failedChecks", "slaReport.avgResponseTime",
	"slaReport.p95ResponseTime", "slaReport.incidents", "slaReport.noIncidents", "slaReport.incidentCount", "slaReport.totalDowntime",
	"slaReport.longestIncident", "slaReport.dailyUptime", "slaReport.generatedAt", "slaReport.pdfCharsNote", "slaReport.timezoneBasis",
	"slaReport.ongoing", "slaReport.dailyUptimeUtc",
];
/** Strip control characters and characters the PDF font cannot draw so user text renders cleanly. */
function pdfText(value: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping control chars
	return [...value.replace(/[\u0000-\u001f\u007f]/g, " ")].map(char => (pdfEncodable(char) ? char : "?")).join("");
}
function hasUnencodable(value: string): boolean {
	return [...value.replace(/[\u0000-\u001f\u007f]/g, " ")].some(char => !pdfEncodable(char));
}
/** "2,592,000 s" is exact but unreadable: append days/hours/minutes. */
function humanSeconds(seconds: number): string {
	const parts = [Math.floor(seconds / 86400) && `${Math.floor(seconds / 86400)}d`, Math.floor((seconds % 86400) / 3600) && `${Math.floor((seconds % 86400) / 3600)}h`, Math.floor((seconds % 3600) / 60) && `${Math.floor((seconds % 3600) / 60)}m`].filter(Boolean);
	return parts.length ? `${seconds}s (${parts.join(" ")})` : `${seconds}s`;
}

/** The on-demand download URL embedded in the monthly email. */
export function slaReportPdfUrl(uptimeMonitorId: string, days: number): string {
	return `${PUBLIC_WEB_URL}/api/reports/sla/${encodeURIComponent(
		uptimeMonitorId,
	)}.pdf?days=${days}`;
}

/**
 * Render the report as a branded PDF buffer. pdfkit draws text literally (no
 * HTML parsing), so the XSS surface is the email path; here we only strip
 * control chars from user values.
 */
export function renderSlaReportPdf(
	model: SlaReportModel,
	requested: Translator,
	language: string = DEFAULT_LANGUAGE,
	displayTimezone = "UTC",
): Promise<Buffer> {
	const zone = isValidTimezone(displayTimezone) ? displayTimezone : "UTC";
	const zoneLabel = timezoneLabel(zone, new Date(model.generatedAt));
	// A locale whose labels the PDF font cannot draw (Arabic) gets English labels rather than garbled text.
	const supportedLabels = PDF_LABEL_KEYS.every(key => !hasUnencodable(requested(key)));
	const t = supportedLabels ? requested : getTranslator(DEFAULT_LANGUAGE);
	// Match the existing English fallback when the built-in PDF font cannot draw the locale.
	const locale = supportedLabels ? language : DEFAULT_LANGUAGE;
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: "A4", margin: 50 });
		const chunks: Buffer[] = [];
		doc.on("data", (chunk: Buffer) => chunks.push(chunk));
		doc.on("end", () => resolve(Buffer.concat(chunks)));
		/* v8 ignore next -- defensive: pdfkit text rendering does not error in practice */
		doc.on("error", reject);

		doc
			.fontSize(20)
			.text(`${COMPANY_NAME} — ${t("slaReport.pdfTitle")}`, { align: "left" });
		doc.moveDown(0.5);

		doc.fontSize(12);
		doc.text(`${t("slaReport.monitor")}: ${pdfText(model.monitorName)}`);
		doc.text(`${t("slaReport.url")}: ${pdfText(model.url)}`);
		doc.text(
			`${t("slaReport.period")}: ${zonedDateTime(model.windowFrom, zone)} – ${zonedDateTime(model.windowTo, zone)}`,
		);
		doc.fontSize(9).text(t("slaReport.timezoneBasis", { timezone: zoneLabel })).fontSize(12);
		if (hasUnencodable(model.monitorName) || hasUnencodable(model.url)) doc.fontSize(9).fillColor("#64748b").text(t("slaReport.pdfCharsNote")).fillColor("black").fontSize(12);
		doc.moveDown(0.5);

		doc
			.fontSize(28)
			.text(formatPercent(model.stats.uptimePercentage, locale) ?? t("slaReport.noData"), { align: "left" });
		doc.fontSize(12).text(t("slaReport.uptime"));
		doc.fontSize(9).text(t("slaReport.basis"));
		doc.fontSize(12);
		doc.moveDown(0.5);

		doc.text(`${t("slaReport.totalChecks")}: ${model.stats.totalChecks}`);
		doc.text(
			`${t("slaReport.successfulChecks")}: ${model.stats.successfulChecks}`,
		);
		doc.text(`${t("slaReport.degradedChecks")}: ${model.stats.degradedChecks}`);
		doc.text(`${t("slaReport.failedChecks")}: ${model.stats.failedChecks}`);
		doc.text(
			`${t("slaReport.avgResponseTime")}: ${fmtMsPdf(model.stats.avgResponseTime)}`,
		);
		doc.text(
			`${t("slaReport.p95ResponseTime")}: ${fmtMsPdf(model.stats.p95ResponseTime)}`,
		);
		doc.moveDown(0.5);

		doc.fontSize(14).text(t("slaReport.incidents"));
		doc.fontSize(12);
		if (model.incidents.count === 0) {
			doc.text(t("slaReport.noIncidents"));
		} else {
			doc.text(`${t("slaReport.incidentCount")}: ${model.incidents.count}`);
			doc.text(
				`${t("slaReport.totalDowntime")}: ${humanSeconds(model.incidents.totalDowntimeSeconds)}`,
			);
			doc.text(
				`${t("slaReport.longestIncident")}: ${humanSeconds(model.incidents.longestIncidentSeconds)}`,
			);
			doc.fontSize(10);
			for (const incident of model.incidentList) {
				doc.text(`${zonedDateTime(incident.startedAt, zone)} – ${incident.resolvedAt ? zonedDateTime(incident.resolvedAt, zone) : t("slaReport.ongoing")}: ${humanSeconds(incident.downtimeSeconds)}`);
			}
			doc.fontSize(12);
		}
		doc.moveDown(0.5);

		doc.fontSize(14).text(t("slaReport.dailyUptime"));
		doc.fontSize(9).text(t("slaReport.dailyUptimeUtc"));
		doc.fontSize(10);
		if (model.dailyUptime.length === 0) {
			doc.text(t("slaReport.noData"));
		} else {
			for (const day of model.dailyUptime) {
				doc.text(`${day.date}: ${formatPercent(day.uptimePercentage, locale) ?? t("slaReport.noData")} (${day.totalChecks})`);
			}
		}
		doc.moveDown(0.5);

		doc
			.fontSize(9)
			.fillColor("#64748b")
			.text(
				`${t("slaReport.generatedAt")}: ${zonedDateTime(model.generatedAt, zone)} ${zoneLabel} · ${COMPANY_NAME}`,
			);

		doc.end();
	});
}

/**
 * Render the summary email body. Every user-controlled value is escaped before
 * interpolation (the monitor name/url cross accounts via share-clone), and the
 * download link derives from PUBLIC_WEB_URL (no raw IP/port).
 */
export function renderSlaReportEmailHtml(
	model: SlaReportModel,
	t: Translator,
	language: string = DEFAULT_LANGUAGE,
): string {
	const link = slaReportPdfUrl(model.uptimeMonitorId, model.windowDays);
	const cell =
		'style="padding: 8px 12px; border: 1px solid #e2e8f0;"';
	const head =
		'style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;"';
	return `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
			<h2 style="margin: 0 0 16px 0;">${escapeHtml(t("slaReport.pdfTitle"))}</h2>
			<p>${escapeHtml(
				t("slaReport.emailIntro", {
					monitor: model.monitorName,
					period: model.periodLabel,
				}),
			)}</p>
			<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
				<tr><td ${head}>${escapeHtml(t("slaReport.monitor"))}</td><td ${cell}>${escapeHtml(model.monitorName)}</td></tr>
				<tr><td ${head}>${escapeHtml(t("slaReport.url"))}</td><td ${cell}>${escapeHtml(model.url)}</td></tr>
				<tr><td ${head}>${escapeHtml(t("slaReport.period"))}</td><td ${cell}>${escapeHtml(dateOnly(model.windowFrom))} – ${escapeHtml(dateOnly(model.windowTo))}</td></tr>
				<tr><td ${head}>${escapeHtml(t("slaReport.uptime"))}</td><td ${cell}>${escapeHtml(formatPercent(model.stats.uptimePercentage, language) ?? t("slaReport.noData"))}</td></tr>
				<tr><td ${head}>${escapeHtml(t("slaReport.degradedChecks"))}</td><td ${cell}>${model.stats.degradedChecks}</td></tr>
				<tr><td ${head}>${escapeHtml(t("slaReport.incidents"))}</td><td ${cell}>${model.incidents.count}</td></tr>
			</table>
			<p style="color: #64748b; font-size: 12px;">${escapeHtml(t("slaReport.basis"))}</p>
			<p><a href="${escapeHtml(link)}" style="color: #2563eb;">${escapeHtml(t("slaReport.downloadPdf"))}</a></p>
			<p style="color: #64748b; font-size: 12px;">${escapeHtml(t("slaReport.footer"))}</p>
		</div>
	`;
}

/** First day of the prior calendar month (UTC) through its last millisecond. */
function priorMonthRange(now: Date): { from: string; to: string } {
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth();
	const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
	const to = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - 1);
	return { from: from.toISOString(), to: to.toISOString() };
}

export interface ProcessSubscriptionResult {
	skipped: boolean;
	monitorsReported: number;
	emailsSent: number;
}

/**
 * Build and send the prior-month report(s) for a single subscription. Skips
 * (without sending) when the linked provider is unavailable. Per-recipient send failures are logged and
 * swallowed so one bad address never blocks the rest; the caller decides how
 * to treat a thrown build error.
 */
export async function processSubscription(
	sub: UptimeSlaReportSubscriptionRow,
	now: Date,
): Promise<ProcessSubscriptionResult> {
	if (!sub.emailProviderId) {
		return { skipped: true, monitorsReported: 0, emailsSent: 0 };
	}

	let provider: Awaited<ReturnType<typeof findEmailProviderById>>;
	try {
		provider = await findEmailProviderById(sub.emailProviderId, sub.userId, true);
	} catch {
		console.error(
			`[sla-report] Provider ${sub.emailProviderId} missing for subscription ${sub.slaReportSubscriptionId}`,
		);
		return { skipped: true, monitorsReported: 0, emailsSent: 0 };
	}

	const monitors = sub.uptimeMonitorId
		? await db.query.uptimeMonitor.findMany({
				where: and(
					eq(uptimeMonitor.uptimeMonitorId, sub.uptimeMonitorId),
					eq(uptimeMonitor.userId, sub.userId),
				),
			})
		: await db.query.uptimeMonitor.findMany({
				where: eq(uptimeMonitor.userId, sub.userId),
			});

	const { from, to } = priorMonthRange(now);
	const t = getTranslator(DEFAULT_LANGUAGE);
	let emailsSent = 0;

	for (const monitor of monitors) {
		const model = await buildSlaReportModel({
			monitorId: monitor.uptimeMonitorId,
			userId: sub.userId,
			window: { kind: "range", from, to },
			t,
			now,
		});
		const pdf = await renderSlaReportPdf(model, t, DEFAULT_LANGUAGE, await accountReportTimezone(sub.userId));
		const html = renderSlaReportEmailHtml(model, t);
		const subject = t("slaReport.emailSubject", {
			monitor: monitor.name,
			period: model.periodLabel,
		});
		const attachments: EmailAttachment[] = [
			{ filename: `sla-report-${model.periodLabel}.pdf`, content: pdf },
		];

		for (const recipient of sub.recipientAddresses) {
			try {
				await sendViaProvider(provider, recipient, subject, html, attachments);
				emailsSent += 1;
			} catch (err) {
				console.error(
					`[sla-report] Send failed for subscription ${sub.slaReportSubscriptionId}: ${safeErrorSummary(err)}`,
				);
			}
		}
	}

	await db
		.update(uptimeSlaReportSubscription)
		.set({ lastSentAt: now.toISOString() })
		.where(
			and(
				eq(
					uptimeSlaReportSubscription.slaReportSubscriptionId,
					sub.slaReportSubscriptionId,
				),
				eq(uptimeSlaReportSubscription.userId, sub.userId),
			),
		);

	return {
		skipped: false,
		monitorsReported: monitors.length,
		emailsSent,
	};
}

/**
 * Monthly cron entrypoint: build + email the prior month's report for every
 * active subscription. A failure in one subscription is logged and never aborts
 * the rest of the run.
 */
export async function runMonthlySlaReports(now: Date = new Date()): Promise<void> {
	const subs = await db.query.uptimeSlaReportSubscription.findMany({
		where: eq(uptimeSlaReportSubscription.active, true),
	});

	for (const sub of subs) {
		// One failing subscription (e.g. an unexpected build/render error) must
		// never abort the whole run — log and continue. Per-recipient send
		// failures are already swallowed inside processSubscription.
		try {
			await processSubscription(sub, now);
		} catch (err) {
			console.error(
				`[sla-report] Subscription ${sub.slaReportSubscriptionId} failed: ${safeErrorSummary(err)}`,
			);
		}
	}
}
