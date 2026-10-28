import { TRPCError } from "@trpc/server";
import type { Translator } from "./i18n";

/**
 * Bounds how many user-triggered outbound actions (manual checks, channel and provider
 * tests) one account can have in flight at once. Each can reach a user-supplied target
 * and hold a socket for up to the monitor timeout, so unbounded parallel clicks (or a
 * script) could exhaust connections for everyone.
 * per process; with several replicas the effective cap is multiplied by the
 * replica count. Move to shared admission control if that matters.
 */
const MAX_PER_ACCOUNT = 3;
const inFlight = new Map<string, number>();

export async function withManualActionLimit<T>(userId: string, t: Translator, work: () => Promise<T>, max = MAX_PER_ACCOUNT): Promise<T> {
	const running = inFlight.get(userId) ?? 0;
	if (running >= max) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: t("errors.networkBusy") });
	inFlight.set(userId, running + 1);
	try {
		return await work();
	} finally {
		const left = (inFlight.get(userId) ?? 1) - 1;
		if (left <= 0) inFlight.delete(userId);
		else inFlight.set(userId, left);
	}
}
