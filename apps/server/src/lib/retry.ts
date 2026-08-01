// ---------------------------------------------------------------------------
// In-process retry with backoff for notification sends.
//
// Deliberately NOT a persistent queue: retries live in the process and are
// lost on restart — the delivery log still records the final known outcome.
// Flap bursts that trip provider rate limits (e.g. Resend's 2 req/s) surface
// as 429s and are absorbed by the backoff; a global send pacer is deliberately
// omitted (zero shared state beats a cross-monitor mutex here).
// ---------------------------------------------------------------------------

/** Thrown by senders that know the HTTP status; carries the retryability signal. */
export class NotificationSendError extends Error {
	readonly httpStatus?: number;

	constructor(message: string, httpStatus?: number) {
		super(message);
		this.name = "NotificationSendError";
		this.httpStatus = httpStatus;
	}
}

const TRANSIENT_SOCKET_CODES = new Set([
	"ECONNRESET",
	"ETIMEDOUT",
	"ECONNREFUSED",
	"EAI_AGAIN",
	"EPIPE",
]);

/**
 * Transient ⇒ worth retrying: provider 429/5xx, request timeouts/aborts,
 * fetch network failures (TypeError), and socket-level errors (also covers
 * nodemailer, which sets `code` on its errors). Everything else — 401/403/422,
 * validation, decrypt failures — is permanent and fails fast.
 */
export function isTransientSendError(err: unknown): boolean {
	if (err instanceof NotificationSendError) {
		if (err.httpStatus === undefined) {
			return false;
		}
		return err.httpStatus === 429 || err.httpStatus >= 500;
	}

	if (err instanceof Error) {
		if (err.name === "TimeoutError" || err.name === "AbortError") {
			return true;
		}
		const code = (err as NodeJS.ErrnoException).code;
		if (typeof code === "string" && TRANSIENT_SOCKET_CODES.has(code)) {
			return true;
		}
		// Undici surfaces network failures as TypeError("fetch failed").
		if (err instanceof TypeError) {
			return true;
		}
	}

	return false;
}

/** Backoff schedule: first retry after 30s, then 2m, then 10m (4 attempts total). */
export const NOTIFICATION_RETRY_DELAYS_MS: readonly number[] = [
	30_000, 120_000, 600_000,
];

/**
 * Resolve the default backoff schedule. `NOTIFICATION_RETRY_DELAYS_MS` (a
 * comma-separated ms list) overrides it — the test env sets it to `""` so no
 * real long-lived timers are ever scheduled during a test run.
 */
export function resolveDefaultRetryDelays(): readonly number[] {
	const raw = process.env.NOTIFICATION_RETRY_DELAYS_MS;
	if (raw === undefined) {
		return NOTIFICATION_RETRY_DELAYS_MS;
	}
	const trimmed = raw.trim();
	if (trimmed === "") {
		return [];
	}
	return trimmed
		.split(",")
		.map((part) => Number(part.trim()))
		.filter((ms) => Number.isFinite(ms) && ms >= 0);
}

export type RetryResult<T> =
	| { ok: true; value: T; attempts: number }
	| { ok: false; error: unknown; attempts: number };

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		// unref() so a pending backoff never keeps the process alive on shutdown.
		setTimeout(resolve, ms).unref();
	});

/**
 * Run `fn`, retrying transient failures per `delaysMs`. Never throws — the
 * caller always receives the final outcome plus the attempt count.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	opts: {
		delaysMs?: readonly number[];
		isRetryable?: (err: unknown) => boolean;
		sleep?: (ms: number) => Promise<void>;
		onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
	} = {},
): Promise<RetryResult<T>> {
	const delaysMs = opts.delaysMs ?? resolveDefaultRetryDelays();
	const isRetryable = opts.isRetryable ?? isTransientSendError;
	const sleep = opts.sleep ?? defaultSleep;

	let attempts = 0;

	for (;;) {
		try {
			const value = await fn();
			return { ok: true, value, attempts: attempts + 1 };
		} catch (err) {
			attempts++;
			if (attempts > delaysMs.length || !isRetryable(err)) {
				return { ok: false, error: err, attempts };
			}
			const delayMs = delaysMs[attempts - 1] as number;
			opts.onRetry?.(err, attempts, delayMs);
			await sleep(delayMs);
		}
	}
}
