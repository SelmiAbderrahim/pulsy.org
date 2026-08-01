import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

const DATABASE_URL = process.env.DATABASE_URL;

/* v8 ignore next 5 -- fail-fast guard; tests always run with DATABASE_URL set */
if (!DATABASE_URL) {
	throw new Error(
		"DATABASE_URL is not set. Copy .env.example to .env and configure it.",
	);
}

// Single shared postgres connection pool for the process. The scheduler (many
// concurrent monitor checks), the tRPC API, and better-auth session lookups all
// draw from this pool, so size it for the expected monitor count via
// DATABASE_POOL_MAX. Idle/connect timeouts keep the pool resilient to network
// blips instead of holding dead connections.
const POOL_MAX = Math.max(1, Number(process.env.DATABASE_POOL_MAX ?? 20));

const queryClient = postgres(DATABASE_URL, {
	max: POOL_MAX,
	idle_timeout: 20, // seconds before an idle connection is closed
	connect_timeout: 10, // seconds to wait for a new connection
});

export const db = drizzle(queryClient, { schema });

/**
 * Close the pool gracefully. Call during process shutdown so in-flight queries
 * finish (up to the timeout) and connections are released cleanly.
 */
export const closeDb = (): Promise<void> => queryClient.end({ timeout: 5 });

export type Database = typeof db;

// Transaction callback parameter type — lets services accept either the shared
// `db` or an in-flight transaction (`dbc: DbExecutor = db`).
export type DbTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
export type DbExecutor = Database | DbTransaction;

export { schema };
