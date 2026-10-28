import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		// Never schedule real 30s/2m/10m notification-retry timers during tests —
		// a detached dispatch's backoff would otherwise leak across serial files
		// and trip vitest's worker RPC timeouts. Tests that assert retry behavior
		// pass their own `delaysMs`.
		env: { NOTIFICATION_RETRY_DELAYS_MS: "" },
		// Integration tests share one real Postgres and TRUNCATE between tests —
		// run files serially so they never race on the same database.
		fileParallelism: false,
		globalSetup: ["./test/global-setup.ts"],
		// A real DB / network needs headroom; pure unit tests are unaffected.
		testTimeout: 30_000,
		hookTimeout: 120_000, // first run may pull the postgres image
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/index.ts", // Express + scheduler bootstrap (entry point)
				"src/seed.ts", // dev seeding script
				"src/seed-superadmin.ts", // superadmin seed runner (thin wrapper)
				"src/auth/auth.ts", // better-auth declarative wiring
				"src/**/*.test.ts",
				"src/**/index.ts", // barrel re-exports
				"**/*.d.ts",
			],
			thresholds: {
				statements: 100,
				branches: 100,
				functions: 100,
				lines: 100,
			},
		},
	},
});
