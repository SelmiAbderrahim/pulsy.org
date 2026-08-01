// ---------------------------------------------------------------------------
// Express handler for `GET /api/reports/sla/:monitorId.pdf?days=`.
//
// Mounted AFTER `express.json()` at the index.ts bootstrap. Re-resolves the
// better-auth session (same as the tRPC context), re-runs the per-user
// ownership check, then streams a branded PDF with
// `Content-Disposition: attachment`. Response error shapes are machine-facing
// JSON (no i18n); the PDF body itself is rendered in the request language.
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { z } from "zod";
import { auth } from "../auth/auth";
import { getEffectiveLanguage, getTranslator } from "../lib/i18n";
import { buildSlaReportModel, renderSlaReportPdf } from "../services/uptime";
import { toHeaders } from "../trpc/trpc";

const daysSchema = z.coerce.number().int().min(1).max(366).default(30);

type SessionLike = { user: { id: string } | null } | null;

/**
 * Factory so tests can inject a session resolver without a better-auth HTTP
 * round-trip. Production uses the real `auth.api.getSession`.
 */
export function createSlaReportPdfHandler(
	deps: {
		getSession?: (headers: Headers) => Promise<SessionLike>;
	} = {},
) {
	const getSession =
		deps.getSession ?? ((headers: Headers) => auth.api.getSession({ headers }));

	return async function slaReportPdfHandler(
		req: Request,
		res: Response,
	): Promise<void> {
		const acceptLanguage = req.headers["accept-language"];
		const language = getEffectiveLanguage({
			acceptLanguage: Array.isArray(acceptLanguage)
				? acceptLanguage[0]
				: acceptLanguage,
		});
		const t = getTranslator(language);

		let session: SessionLike;
		try {
			session = await getSession(toHeaders(req));
		} catch {
			session = null;
		}
		const userId = session?.user?.id ?? null;
		if (!userId) {
			res.status(401).json({ error: "unauthorized" });
			return;
		}

		const parsedDays = daysSchema.safeParse(req.query.days);
		if (!parsedDays.success) {
			res.status(400).json({ error: "invalid days" });
			return;
		}

		// @types/express 5 widens param values to string | string[].
		const rawMonitorId = req.params.monitorId;
		const monitorId = typeof rawMonitorId === "string" ? rawMonitorId : "";
		let model: Awaited<ReturnType<typeof buildSlaReportModel>>;
		try {
			model = await buildSlaReportModel({
				monitorId,
				userId,
				window: { kind: "days", days: parsedDays.data },
				t,
			});
		} catch {
			res.status(404).json({ error: "not found" });
			return;
		}

		const pdf = await renderSlaReportPdf(model, t);
		res.setHeader("Content-Type", "application/pdf");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="sla-report-${model.periodLabel}.pdf"`,
		);
		res.send(pdf);
	};
}

export const slaReportPdfHandler = createSlaReportPdfHandler();
