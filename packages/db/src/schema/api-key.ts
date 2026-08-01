import { relations } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./auth";

// ---------------------------------------------------------------------------
// API keys — Bearer credentials for the public `/api/v1` REST surface.
//
// The plaintext key (`pul_<random>`) is shown to the user exactly once at
// creation and NEVER stored: only its SHA-256 hash (`hashedKey`) is persisted.
// Resolution is an indexed equality lookup on `hashedKey` (high-entropy random
// token → DB index), which — like better-auth session tokens and Pulsy share
// links — needs no `timingSafeEqual`. `keyPrefix` (the first 8 chars) is the
// only fragment ever returned after creation, so the UI can identify a key.
// ---------------------------------------------------------------------------

export const apiKey = pgTable(
	"api_key",
	{
		apiKeyId: text("apiKeyId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		// Ownership (single-user: scoped to the owning user).
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// User-supplied label, e.g. "CI pipeline".
		name: text("name").notNull(),
		// First ~8 chars of the plaintext key, shown in the management UI.
		keyPrefix: text("keyPrefix").notNull(),
		// sha256(full plaintext key) — the only stored form of the secret.
		hashedKey: text("hashedKey").notNull(),
		// Bumped (async, best-effort) on each successful authentication.
		lastUsedAt: text("lastUsedAt"),
		// Optional hard expiry (ISO). NULL ⇒ never expires.
		expiresAt: text("expiresAt"),
		// Set on revocation (ISO). Revoked keys never authenticate again and are
		// indistinguishable from missing keys at resolve time.
		revokedAt: text("revokedAt"),
		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		// Authentication resolves a key by exact hash; uniqueness guards against
		// the astronomically unlikely collision and backs the index lookup.
		uniqueIndex("api_key_hashed_key_uq").on(table.hashedKey),
		// Management UI lists a user's own keys.
		index("api_key_user_idx").on(table.userId),
	],
);

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
	user: one(user, {
		fields: [apiKey.userId],
		references: [user.id],
	}),
}));

export type ApiKey = typeof apiKey.$inferSelect;
export type NewApiKey = typeof apiKey.$inferInsert;
