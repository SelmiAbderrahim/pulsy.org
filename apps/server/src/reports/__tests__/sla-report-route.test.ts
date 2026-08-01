import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../test/db";
import {
	createSlaReportPdfHandler,
	slaReportPdfHandler,
} from "../sla-report-route";

useCleanDatabase();

beforeEach(() => {
});

afterEach(() => {
});

interface CapturedRes {
	res: Response;
	statusCode: number;
	jsonBody: unknown;
	headers: Record<string, string>;
	sent: Buffer | null;
}

function mockRes(): CapturedRes {
	const captured: CapturedRes = {
		statusCode: 200,
		jsonBody: undefined,
		headers: {},
		sent: null,
		res: {} as Response,
	};
	const res = {
		status(code: number) {
			captured.statusCode = code;
			return res;
		},
		json(body: unknown) {
			captured.jsonBody = body;
			return res;
		},
		setHeader(name: string, value: string) {
			captured.headers[name] = value;
		},
		send(payload: Buffer) {
			captured.sent = payload;
		},
	} as unknown as Response;
	captured.res = res;
	return captured;
}

function mockReq(opts: {
	monitorId?: string;
	days?: string;
	acceptLanguage?: string | string[];
}): Request {
	return {
		headers:
			opts.acceptLanguage === undefined
				? {}
				: { "accept-language": opts.acceptLanguage },
		params: { monitorId: opts.monitorId ?? "" },
		query: opts.days === undefined ? {} : { days: opts.days },
	} as unknown as Request;
}

const sessionFor = (id: string) => async () => ({ user: { id } });

describe("slaReportPdfHandler", () => {
	it("401 when there is no session", async () => {
		const handler = createSlaReportPdfHandler({
			getSession: async () => null,
		});
		const cap = mockRes();
		await handler(mockReq({ monitorId: "m" }), cap.res);
		expect(cap.statusCode).toBe(401);
	});

	it("the default handler resolves the real session (no cookie → 401)", async () => {
		// Exercises the production `auth.api.getSession` default with an
		// unauthenticated request.
		const cap = mockRes();
		await slaReportPdfHandler(mockReq({ monitorId: "m" }), cap.res);
		expect(cap.statusCode).toBe(401);
	});

	it("401 when the session has no user", async () => {
		const handler = createSlaReportPdfHandler({
			getSession: async () => ({ user: null }),
		});
		const cap = mockRes();
		await handler(mockReq({ monitorId: "m" }), cap.res);
		expect(cap.statusCode).toBe(401);
	});

	it("401 when session resolution throws", async () => {
		const handler = createSlaReportPdfHandler({
			getSession: async () => {
				throw new Error("boom");
			},
		});
		const cap = mockRes();
		await handler(mockReq({ monitorId: "m" }), cap.res);
		expect(cap.statusCode).toBe(401);
	});

	it("400 when days is out of range", async () => {
		const u = await createTestUser();
		const handler = createSlaReportPdfHandler({ getSession: sessionFor(u.id) });
		const cap = mockRes();
		await handler(mockReq({ monitorId: "m", days: "999" }), cap.res);
		expect(cap.statusCode).toBe(400);
	});

	it("404 for a monitor the user does not own", async () => {
		const u = await createTestUser();
		const handler = createSlaReportPdfHandler({ getSession: sessionFor(u.id) });
		const cap = mockRes();
		await handler(mockReq({ monitorId: "nope" }), cap.res);
		expect(cap.statusCode).toBe(404);
	});

	it("404 when the route param is absent", async () => {
		const u = await createTestUser();
		const handler = createSlaReportPdfHandler({ getSession: sessionFor(u.id) });
		const cap = mockRes();
		const req = {
			headers: {},
			params: {},
			query: {},
		} as unknown as Request;
		await handler(req, cap.res);
		expect(cap.statusCode).toBe(404);
	});

	it("streams a PDF on success (default days)", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id);
		const handler = createSlaReportPdfHandler({ getSession: sessionFor(u.id) });
		const cap = mockRes();
		await handler(mockReq({ monitorId: m.uptimeMonitorId }), cap.res);

		expect(cap.headers["Content-Type"]).toBe("application/pdf");
		expect(cap.headers["Content-Disposition"]).toContain("attachment");
		expect(cap.sent).not.toBeNull();
		expect(cap.sent!.subarray(0, 4).toString("ascii")).toBe("%PDF");
	});

	it("honours an array Accept-Language header", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id);
		const handler = createSlaReportPdfHandler({ getSession: sessionFor(u.id) });
		const cap = mockRes();
		await handler(
			mockReq({
				monitorId: m.uptimeMonitorId,
				acceptLanguage: ["fr", "en"],
			}),
			cap.res,
		);
		expect(cap.headers["Content-Type"]).toBe("application/pdf");
	});
});
