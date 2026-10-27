import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { helpMarkdown } from "./help-markdown";

export default defineConfig({
	plugins: [helpMarkdown(), react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.test.{ts,tsx}"],
		// Interaction-heavy jsdom suites flake when many worker threads contend
		// for CPU (Docker build stage, small CI runners). Two workers + generous
		// per-test budget keeps runs deterministic everywhere.
		maxWorkers: 2,
		testTimeout: 30_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			// Coverage is enforced over the application's logic and interactive
			// product surface: services, hooks, utilities, and the uptime feature
			// components + shared dashboard components.
			include: [
				"src/hooks/**/*.{ts,tsx}",
				"src/services/**/*.{ts,tsx}",
				"src/lib/utils.ts",
				"src/lib/locales.ts",
				"src/lib/api/extractErrorMessage.ts",
				"src/lib/uptime/**/*.ts",
				"src/components/uptime/**/*.tsx",
				"src/components/auth/**/*.tsx",
				"src/components/dashboard/**/*.tsx",
			],
			exclude: [
				// Generated
				"src/routeTree.gen.ts",
				// App / router / i18n / auth-client bootstrap (config, not logic)
				"src/main.tsx",
				"src/i18n.ts",
				"src/lib/auth-client.ts",
				"src/lib/api/trpc.ts", // tRPC client transport setup
				"src/routes/**", // router composition / route shells
				// shadcn/ui primitives (third-party-derived)
				"src/components/ui/**",
				// Optional GA analytics wrapper
				"src/lib/analytics/**",
				// Type-only + test infra
				"src/types/**",
				"src/test/**",
				"**/*.d.ts",
				"**/*.test.{ts,tsx}",
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
