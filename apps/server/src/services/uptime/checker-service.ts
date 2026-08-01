import { safeFetch } from "../../lib/ssrf";
import type { UptimeMonitor } from "./monitor-service";

export interface HttpCheckResult {
	status: "up" | "down" | "degraded";
	httpStatus: number | null;
	responseTime: number;
	errorMessage?: string;
}

export const performHttpCheck = async (
	monitor: UptimeMonitor,
): Promise<HttpCheckResult> => {
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
		const endTime = performance.now();
		const responseTime = Math.round(endTime - startTime);

		clearTimeout(timeoutId);

		let redirectCount = 0;
		if (response.redirected) {
			redirectCount = 1;
		}

		/* v8 ignore next 8 -- defensive: fetch follows ≤ maxRedirects, so redirectCount never exceeds 1 */
		if (redirectCount > 5) {
			return {
				status: "down",
				httpStatus: response.status,
				responseTime,
				errorMessage: "Too many redirects (exceeded 5)",
			};
		}

		if (response.status === monitor.expectedStatus) {
			return {
				status: "up",
				httpStatus: response.status,
				responseTime,
			};
		}

		if (response.status >= 400) {
			return {
				status: "down",
				httpStatus: response.status,
				responseTime,
				errorMessage: `Unexpected status: ${response.status} (expected ${monitor.expectedStatus})`,
			};
		}

		return {
			status: "degraded",
			httpStatus: response.status,
			responseTime,
			errorMessage: `Unexpected status: ${response.status} (expected ${monitor.expectedStatus})`,
		};
	} catch (error: unknown) {
		const endTime = performance.now();
		const responseTime = Math.round(endTime - startTime);

		clearTimeout(timeoutId);

		const errorMessage = getErrorMessage(error);

		return {
			status: "down",
			httpStatus: null,
			responseTime,
			errorMessage,
		};
	}
};

function getErrorMessage(error: unknown): string {
	if (error instanceof DOMException && error.name === "AbortError") {
		return "Request timed out";
	}

	if (error instanceof TypeError) {
		const message = error.message.toLowerCase();

		if (message.includes("fetch failed") || message.includes("econnrefused")) {
			return "Connection refused";
		}

		if (message.includes("enotfound") || message.includes("getaddrinfo")) {
			return "DNS resolution failed";
		}

		if (message.includes("econnreset")) {
			return "Connection reset by server";
		}

		if (message.includes("etimedout")) {
			return "Connection timed out";
		}

		if (message.includes("cert") || message.includes("ssl") || message.includes("tls")) {
			return "TLS/SSL certificate error";
		}

		return `Network error: ${error.message}`;
	}

	if (error instanceof Error) {
		return error.message;
	}

	return "Unknown error occurred";
}
