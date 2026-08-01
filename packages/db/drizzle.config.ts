import { defineConfig } from "drizzle-kit";

const DATABASE_URL =
	process.env.DATABASE_URL ?? "postgres://pulsy:pulsy@localhost:5432/pulsy";

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema/index.ts",
	out: "./drizzle",
	dbCredentials: {
		url: DATABASE_URL,
	},
	verbose: true,
	strict: true,
});
