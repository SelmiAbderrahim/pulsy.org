// HTTP failures store classified codes and no fabricated response timing.
import { matchesExpectedStatus } from "@pulsy/db/http-status-rule";
import { performAdvancedHttpCheck } from "./http-request";
import type { HttpAssertionOutcome } from "./http-assertions";
import { safeFetch } from "../../lib/ssrf";
import { classifyCheckError, classifyUnexpectedHttpStatus } from "./check-error";
import type { UptimeMonitor } from "./monitor-service";

export interface HttpCheckResult {
	status: "up" | "down" | "degraded";
	httpStatus: number | null;
	/** Milliseconds until a response arrived; null when the check failed without one. */
	responseTime: number | null;
	/** A `CheckErrorCode` for classified failures; latency causes stay descriptive text. */
	errorMessage?: string;
	assertionOutcomes?: HttpAssertionOutcome[];
}

export const performHttpCheck = async (
	monitor: UptimeMonitor,
): Promise<HttpCheckResult> => {
	if (monitor.requestCipher || monitor.httpAssertions?.length || (monitor.redirectPolicy && monitor.redirectPolicy !== "follow")) {
		return performAdvancedHttpCheck(monitor);
	}
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), monitor.timeout);

	const startTime = performance.now();

	try {
		const requestInit: RequestInit = {
			method: monitor.method,
			signal: controller.signal,
			redirect: "follow",
			headers: {
				"User-Agent": "Pulsy-Uptime/1.0",
			},
		};

		const response = await safeFetch(monitor.url, requestInit);
		const responseTime = Math.round(performance.now() - startTime);

		clearTimeout(timeoutId);
		// Only the status line matters here; release the socket instead of leaving
		// an unread body (and its connection) open until GC.
		void response.body?.cancel().catch(() => undefined);

		if (matchesExpectedStatus(response.status, monitor)) {
			return { status: "up", httpStatus: response.status, responseTime };
		}

		return {
			status: classifyUnexpectedHttpStatus(response.status),
			httpStatus: response.status,
			responseTime,
			errorMessage: "unexpected_status",
		};
	} catch (error: unknown) {
		clearTimeout(timeoutId);
		// Time-to-failure is not a response time: never store it as one.
		return {
			status: "down",
			httpStatus: null,
			responseTime: null,
			errorMessage: classifyCheckError(error, controller.signal.aborted),
		};
	}
};
