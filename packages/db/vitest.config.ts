import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		fileParallelism: false,
		globalSetup: ["./test/global-setup.ts"],
		testTimeout: 30_000,
		hookTimeout: 120_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/index.ts",
				"src/schema/index.ts",
				// Declarative Drizzle table/enum/relation declarations. These contain
				// only lazy `.references(() => ...)` / relation callbacks that the
				// runtime driver never invokes — config, not logic. The validation
				// schemas (validation.ts) and the client (client.ts) ARE gated.
				"src/schema/auth.ts",
				"src/schema/uptime-monitor.ts",
				"src/schema/organization.ts",
				"src/schema/api-key.ts",
				"**/*.test.ts",
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
