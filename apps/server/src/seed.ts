import { db, uptimeMonitor, user } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { auth } from "./auth/auth";
import { safeErrorSummary } from "./lib/safe-error";

// ---------------------------------------------------------------------------
// Idempotent seed: a demo user plus two monitors (one up, one down).
// ---------------------------------------------------------------------------

const DEMO_EMAIL = "demo@pulsy.org";
const DEMO_PASSWORD = "pulsy-demo-1234";
const DEMO_NAME = "Demo";

async function ensureDemoUser(): Promise<string> {
	try {
		await auth.api.signUpEmail({
			body: {
				email: DEMO_EMAIL,
				password: DEMO_PASSWORD,
				name: DEMO_NAME,
			},
		});
		console.info(`[seed] Created demo user ${DEMO_EMAIL}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// better-auth throws when the user already exists — that's fine.
		if (/exist/i.test(message)) {
			console.info(`[seed] Demo user ${DEMO_EMAIL} already exists`);
		} else {
			console.warn(
				`[seed] signUpEmail returned: ${safeErrorSummary(err)}`,
			);
		}
	}

	const row = await db.query.user.findFirst({
		where: eq(user.email, DEMO_EMAIL),
	});

	if (!row) {
		throw new Error(
			`[seed] Could not find demo user ${DEMO_EMAIL} after sign-up`,
		);
	}

	return row.id;
}

async function upsertMonitor(opts: {
	userId: string;
	name: string;
	url: string;
	expectedStatus: number;
}): Promise<void> {
	const existing = await db.query.uptimeMonitor.findFirst({
		where: eq(uptimeMonitor.name, opts.name),
	});

	if (existing) {
		console.info(`[seed] Monitor "${opts.name}" already exists`);
		return;
	}

	await db.insert(uptimeMonitor).values({
		name: opts.name,
		url: opts.url,
		method: "GET",
		expectedStatus: opts.expectedStatus,
		interval: 300,
		status: "pending",
		consecutiveFailures: 0,
		userId: opts.userId,
	});

	console.info(`[seed] Created monitor "${opts.name}" (${opts.url})`);
}

async function main(): Promise<void> {
	const userId = await ensureDemoUser();

	await upsertMonitor({
		userId,
		name: "Example (up)",
		url: "https://example.com",
		expectedStatus: 200,
	});

	await upsertMonitor({
		userId,
		name: "Always 503 (down)",
		url: "https://httpstat.us/503",
		expectedStatus: 200,
	});

	console.info("\n[seed] Done. Demo account ready:");
	console.info(`[seed]   email:    ${DEMO_EMAIL}`);
	console.info("[seed]   password: see README.md for the local demo password");
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(`[seed] Failed: ${safeErrorSummary(err)}`);
		process.exit(1);
	});
