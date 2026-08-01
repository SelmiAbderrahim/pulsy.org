import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// Vitest globalSetup for @pulsy/db. Same self-provisioning Postgres strategy as
// the server suite: use an explicitly test-named DATABASE_URL as-is, derive a
// sibling throwaway DB from any other configured URL, or start a disposable
// container when no DATABASE_URL is provided.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../drizzle");

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

	const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
	const container = await new PostgreSqlContainer("postgres:16-alpine")
		.withDatabase("pulsy_test")
		.withUsername("pulsy")
		.withPassword("pulsy")
		.start();

	process.env.DATABASE_URL = container.getConnectionUri();
	await applyMigrations(process.env.DATABASE_URL);

	return async () => {
		await container.stop();
	};
}
