// ---------------------------------------------------------------------------
// Superadmin seed runner (thin wrapper, coverage-excluded).
//
// Wires the testable `ensureSuperadmin` core to the real db + better-auth and
// exits. Invoked on the Docker entrypoint (backgrounded) and via
// `pnpm --filter @pulsy/server seed:superadmin`.
// ---------------------------------------------------------------------------

import { db } from "@pulsy/db";
import { auth } from "./auth/auth";
import { ensureSuperadmin } from "./admin/superadmin-seed";
import { safeErrorSummary } from "./lib/safe-error";

ensureSuperadmin({
	db,
	auth,
	email: process.env.SUPERADMIN_EMAIL,
	password: process.env.SUPERADMIN_PASSWORD,
	name: process.env.SUPERADMIN_NAME,
	log: (message) => console.info(message),
})
	.then((result) => {
		console.info(`[superadmin] Done (${result.status}).`);
		process.exit(0);
	})
	.catch((err) => {
		console.error(`[superadmin] Failed: ${safeErrorSummary(err)}`);
		process.exit(1);
	});
