import { safeErrorSummary } from "../../lib/safe-error";
import postgres from "postgres";

/**
 * Cross-replica leader election for the in-process check scheduler, built on a
 * PostgreSQL session-level advisory lock. Exactly one server process holds the lock
 * and runs the monitor-check cron jobs; the others serve the API and keep running the
 * workers that are already replica-safe (SKIP LOCKED / leases). Because the lock is
 * session-level, a crashed leader releases it the moment its connection drops.
 *
 * The lock lives on its own single connection (not the shared pool), and every tick
 * re-asks `pg_try_advisory_lock`: it is re-entrant for the holder (true), but returns
 * false if the connection was silently reset and another process took over, so a lost
 * lock cannot go unnoticed.
 */
const LOCK_KEY = 7_450_121_004; // arbitrary, stable: "pulsy scheduler"

export interface SchedulerLeadership {
	isLeader(): boolean;
	/** Release the lock and stop retrying. Calls `onLost` first when currently leading. */
	stop(): Promise<void>;
}

export function startSchedulerLeadership(options: {
	onElected: () => Promise<void> | void;
	onLost: () => Promise<void> | void;
	retryMs?: number;
	databaseUrl?: string;
}): SchedulerLeadership {
	const url = options.databaseUrl ?? process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL is required for scheduler leader election");
	const retryMs = options.retryMs ?? 10_000;
	let sql = connect();
	let leader = false;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let running: Promise<void> = Promise.resolve();

	function connect() {
		// One dedicated connection that never idles out: the lock lives and dies with it.
		return postgres(url as string, { max: 1, idle_timeout: 0, max_lifetime: null, connect_timeout: 10 });
	}

	async function tryLock(): Promise<boolean> {
		const [row] = await sql<{ locked: boolean }[]>`select pg_try_advisory_lock(${LOCK_KEY}::bigint) as locked`;
		return row?.locked === true;
	}

	async function lose(reason: string) {
		if (!leader) return;
		leader = false;
		console.warn(`[scheduler] Lost scheduler leadership (${reason})`);
		try { await options.onLost(); } catch (error) { console.error("[scheduler] onLost failed:", safeErrorSummary(error)); }
	}

	async function tick() {
		if (stopped) return;
		try {
			const held = await tryLock();
			if (held && !leader) {
				leader = true;
				console.info("[scheduler] Elected scheduler leader");
				await options.onElected();
			} else if (!held && leader) {
				await lose("another process holds the lock");
			}
		} catch (error) {
			// Connection trouble: assume the lock is gone and rebuild the session.
			await lose(safeErrorSummary(error));
			try { await sql.end({ timeout: 1 }); } catch { /* already closed */ }
			if (!stopped) sql = connect();
		}
		if (!stopped) timer = setTimeout(() => { running = tick(); }, retryMs);
	}

	running = tick();

	return {
		isLeader: () => leader,
		async stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			await running.catch(() => undefined);
			await lose("shutdown");
			try { await sql.end({ timeout: 2 }); } catch { /* already closed */ }
		},
	};
}
