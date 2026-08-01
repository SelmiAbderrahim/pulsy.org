import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// Vitest globalSetup for the server suite.
//
// Goal: every DB-backed test runs against a REAL Postgres, and the suite is
// self-provisioning so `pnpm test` works anywhere Docker is present.
//
//   1. If DATABASE_URL is already exported (CI service / `make test` / a local
//      throwaway DB) -> reuse it untouched.
//   2. Otherwise -> start a disposable Postgres via @testcontainers/postgresql,
//      point DATABASE_URL at it, and stop it on teardown.
//
// In both cases we apply the Drizzle migrations so the schema exists, and we
// set the other required secrets (ENCRYPTION_KEY, BETTER_AUTH_SECRET, ...) so
// crypto/auth modules import cleanly. Env set here is inherited by the test
// workers (spawned after globalSetup), which is why DATABASE_URL must be set
// before any `@pulsy/db` import in a worker.
//
// SAFETY: vitest does NOT load the root .env, so a bare `pnpm test` never
// targets your dev database — it spins an ephemeral container instead. Only an
// explicitly exported DATABASE_URL is reused. Never point it at a DB whose data
// you care about: the harness TRUNCATEs tables between tests.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/server/test -> ../../packages/db/drizzle
const MIGRATIONS_FOLDER = path.resolve(
	__dirname,
	"../../../packages/db/drizzle",
);

// Required secrets for modules that read env at import time. Only set when the
// runner hasn't already provided a value.
function ensureEnv(key: string, value: string): void {
	if (!process.env[key]) process.env[key] = value;
}

async function applyMigrations(databaseUrl: string): Promise<void> {
	const { drizzle } = await import("drizzle-orm/postgres-js");
	const { migrate } = await import("drizzle-orm/postgres-js/migrator");
	const postgres = (await import("postgres")).default;

	const client = postgres(databaseUrl, { max: 1 });
	try {
		await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
	} finally {
		await client.end({ timeout: 5 });
	}
}

function databaseNameFromUrl(databaseUrl: string): string {
	const parsed = new URL(databaseUrl);
	return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

function withDatabaseName(databaseUrl: string, databaseName: string): string {
	const parsed = new URL(databaseUrl);
	parsed.pathname = `/${encodeURIComponent(databaseName)}`;
	return parsed.toString();
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function isTestDatabase(databaseUrl: string): boolean {
	const databaseName = databaseNameFromUrl(databaseUrl);
	return /(^|[_-])test($|[_-])/i.test(databaseName);
}

async function recreateSiblingTestDatabase(
	databaseUrl: string,
): Promise<{ databaseUrl: string; teardown: () => Promise<void> }> {
	const postgres = (await import("postgres")).default;
	const sourceDatabase = databaseNameFromUrl(databaseUrl) || "pulsy";
	const testDatabase = `${sourceDatabase}_test`;
	const adminUrl = withDatabaseName(databaseUrl, "postgres");
	const quotedTestDatabase = quoteIdentifier(testDatabase);

	const admin = postgres(adminUrl, { max: 1 });
	try {
		await admin.unsafe(
			`DROP DATABASE IF EXISTS ${quotedTestDatabase} WITH (FORCE)`,
		);
		await admin.unsafe(`CREATE DATABASE ${quotedTestDatabase}`);
	} finally {
		await admin.end({ timeout: 5 });
	}

	return {
		databaseUrl: withDatabaseName(databaseUrl, testDatabase),
		teardown: async () => {
			const teardownClient = postgres(adminUrl, { max: 1 });
			try {
				await teardownClient.unsafe(
					`DROP DATABASE IF EXISTS ${quotedTestDatabase} WITH (FORCE)`,
				);
			} finally {
				await teardownClient.end({ timeout: 5 });
			}
		},
	};
}

export default async function setup(): Promise<() => Promise<void>> {
	ensureEnv("ENCRYPTION_KEY", "pulsy-test-encryption-key-do-not-use-in-prod");
	ensureEnv("BETTER_AUTH_SECRET", "pulsy-test-better-auth-secret");
	ensureEnv("BETTER_AUTH_URL", "http://localhost:4000");
	ensureEnv("PUBLIC_WEB_URL", "http://localhost:3000");

	// (1) Reuse an externally provided DB.
	if (process.env.DATABASE_URL) {
		if (
			isTestDatabase(process.env.DATABASE_URL) ||
			process.env.PULSY_TEST_ALLOW_CONFIGURED_DATABASE === "true"
		) {
			await applyMigrations(process.env.DATABASE_URL);
			return async () => {
				/* external test DB: nothing to tear down */
			};
		}

		const sibling = await recreateSiblingTestDatabase(process.env.DATABASE_URL);
		process.env.DATABASE_URL = sibling.databaseUrl;
		await applyMigrations(sibling.databaseUrl);
		return sibling.teardown;
	}

	// (2) Spin a disposable Postgres.
	const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
	const container = await new PostgreSqlContainer("postgres:16-alpine")
		.withDatabase("pulsy_test")
		.withUsername("pulsy")
		.withPassword("pulsy")
		.start();

	const databaseUrl = container.getConnectionUri();
	process.env.DATABASE_URL = databaseUrl;

	await applyMigrations(databaseUrl);

	return async () => {
		await container.stop();
	};
}
