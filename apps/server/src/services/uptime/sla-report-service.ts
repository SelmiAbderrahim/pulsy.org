import {
	db,
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
	getMonitorIncidentSummary,
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
	stats: MonitorStats;
	incidents: IncidentSummary;
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

	const [stats, incidents, dailyUptime] = await Promise.all([
		getMonitorStatsForWindow(opts.monitorId, opts.userId, from, to),
		getMonitorIncidentSummary(opts.monitorId, opts.userId, from, to),
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
		stats,
		incidents,
		dailyUptime,
	};
}

/** Render a nullable numeric metric for display. */
function fmtNum(value: number | null): string {
	return value === null ? "—" : String(value);
}

function dateOnly(iso: string): string {
	return iso.slice(0, 10);
}

/** Strip control characters so user text renders cleanly in the PDF. */
function pdfText(value: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping control chars
	return value.replace(/[\u0000-\u001f\u007f]/g, " ");
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
	t: Translator,
): Promise<Buffer> {
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
			`${t("slaReport.period")}: ${dateOnly(model.windowFrom)} – ${dateOnly(
				model.windowTo,
			)}`,
		);
		doc.moveDown(0.5);

		doc
			.fontSize(28)
			.text(`${model.stats.uptimePercentage}%`, { align: "left" });
		doc.fontSize(12).text(t("slaReport.uptime"));
		doc.moveDown(0.5);

		doc.text(`${t("slaReport.totalChecks")}: ${model.stats.totalChecks}`);
		doc.text(
			`${t("slaReport.successfulChecks")}: ${model.stats.successfulChecks}`,
		);
		doc.text(`${t("slaReport.failedChecks")}: ${model.stats.failedChecks}`);
		doc.text(
			`${t("slaReport.avgResponseTime")}: ${fmtNum(model.stats.avgResponseTime)} ms`,
		);
		doc.text(
			`${t("slaReport.p95ResponseTime")}: ${fmtNum(model.stats.p95ResponseTime)} ms`,
		);
		doc.moveDown(0.5);

		doc.fontSize(14).text(t("slaReport.incidents"));
		doc.fontSize(12);
		if (model.incidents.count === 0) {
			doc.text(t("slaReport.noIncidents"));
		} else {
			doc.text(`${t("slaReport.incidentCount")}: ${model.incidents.count}`);
			doc.text(
				`${t("slaReport.totalDowntime")}: ${model.incidents.totalDowntimeSeconds}s`,
			);
			doc.text(
				`${t("slaReport.longestIncident")}: ${model.incidents.longestIncidentSeconds}s`,
			);
		}
		doc.moveDown(0.5);

		doc.fontSize(14).text(t("slaReport.dailyUptime"));
		doc.fontSize(10);
		if (model.dailyUptime.length === 0) {
			doc.text(t("slaReport.noData"));
		} else {
			for (const day of model.dailyUptime) {
				doc.text(`${day.date}: ${day.uptimePercentage}% (${day.totalChecks})`);
			}
		}
		doc.moveDown(0.5);

		doc
			.fontSize(9)
			.fillColor("#64748b")
			.text(
				`${t("slaReport.generatedAt")}: ${model.generatedAt} · ${COMPANY_NAME}`,
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
				<tr><td ${head}>${escapeHtml(t("slaReport.uptime"))}</td><td ${cell}>${model.stats.uptimePercentage}%</td></tr>
				<tr><td ${head}>${escapeHtml(t("slaReport.incidents"))}</td><td ${cell}>${model.incidents.count}</td></tr>
			</table>
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
 * (without sending) when the owner's plan no longer includes SLA reports or
 * the linked provider is gone. Per-recipient send failures are logged and
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
		const pdf = await renderSlaReportPdf(model, t);
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
