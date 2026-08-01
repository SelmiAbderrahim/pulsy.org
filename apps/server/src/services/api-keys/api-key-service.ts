// ---------------------------------------------------------------------------
// API-key service.
//
// Keys authenticate the public `/api/v1` REST surface. The plaintext key
// (`pul_<24 random bytes, base64url>`) is shown to the user exactly once at
// creation and NEVER persisted: only its SHA-256 hash is stored. Resolution is
// an indexed equality lookup on that hash — a high-entropy random token via a
// DB index, the same model as better-auth session tokens and Pulsy share
// links, so no `timingSafeEqual` is required (see monitor-sharing-patterns).
// Keys are never logged and never returned after creation.
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from "node:crypto";
import { type ApiKey, apiKey, db as defaultDb, type Database } from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";

/** Plaintext key prefix that identifies a Pulsy API key. */
export const API_KEY_PREFIX = "pul_";

/** Chars of the plaintext key surfaced to the UI (e.g. "pul_AbCd"). */
const DISPLAY_PREFIX_LENGTH = 8;

/** A listed key with the secret hash stripped — the only shape the UI sees. */
export type MaskedApiKey = Omit<ApiKey, "hashedKey">;

export interface CreatedApiKey {
	/** The persisted row (without exposing the plaintext beyond `plaintext`). */
	row: MaskedApiKey;
	/** Full plaintext key — returned ONCE, never stored, never logged. */
	plaintext: string;
}

/** Outcome of resolving a Bearer token; `revoked` and `invalid` both 401. */
export type ResolvedApiKey =
	| {
			ok: true;
			user: { id: string };
			apiKeyId: string;
	  }
	| { ok: false; reason: "invalid" | "revoked" };

/** Generate a fresh plaintext key (192 bits of entropy, URL-safe). */
export function generateApiKey(): string {
	return API_KEY_PREFIX + randomBytes(24).toString("base64url");
}

/** SHA-256 hex digest of the plaintext key — the only stored form. */
export function hashApiKey(plaintext: string): string {
	return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

function mask(row: ApiKey): MaskedApiKey {
	const { hashedKey: _hashedKey, ...rest } = row;
	return rest;
}

/**
 * Create a key for `userId`. Returns the masked row plus the plaintext, which
 * the caller surfaces to the user exactly once.
 */
export async function createApiKey(
	userId: string,
	name: string,
	db: Database = defaultDb,
): Promise<CreatedApiKey> {
	const plaintext = generateApiKey();
	const hashedKey = hashApiKey(plaintext);
	const keyPrefix = plaintext.slice(0, DISPLAY_PREFIX_LENGTH);

	const [row] = await db
		.insert(apiKey)
		.values({ userId, name, keyPrefix, hashedKey })
		.returning();

	/* v8 ignore next 6 -- unreachable: INSERT ... RETURNING yields the row or throws */
	if (!row) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create API key",
		});
	}

	return { row: mask(row), plaintext };
}

/** List a user's keys, newest first, with the secret hash stripped. */
export async function listApiKeys(
	userId: string,
	db: Database = defaultDb,
): Promise<MaskedApiKey[]> {
	return db.query.apiKey.findMany({
		where: eq(apiKey.userId, userId),
		orderBy: desc(apiKey.createdAt),
		columns: { hashedKey: false },
	});
}

/**
 * Revoke a key the user owns. Returns `false` when no matching live key exists
 * (wrong owner, already revoked, or unknown id) so the caller can localize a
 * NOT_FOUND — never revealing which case it was.
 */
export async function revokeApiKey(
	userId: string,
	apiKeyId: string,
	db: Database = defaultDb,
): Promise<boolean> {
	const revoked = await db
		.update(apiKey)
		.set({ revokedAt: new Date().toISOString() })
		.where(
			and(
				eq(apiKey.apiKeyId, apiKeyId),
				eq(apiKey.userId, userId),
				isNull(apiKey.revokedAt),
			),
		)
		.returning({ apiKeyId: apiKey.apiKeyId });
	return revoked.length > 0;
}

/**
 * Resolve a plaintext Bearer token to its owner. Hash → indexed lookup →
 * reject revoked/expired. On success the key's `lastUsedAt` is bumped.
 */
export async function resolveApiKey(
	plaintext: string,
	db: Database = defaultDb,
): Promise<ResolvedApiKey> {
	if (!plaintext.startsWith(API_KEY_PREFIX)) {
		return { ok: false, reason: "invalid" };
	}

	const row = await db.query.apiKey.findFirst({
		where: eq(apiKey.hashedKey, hashApiKey(plaintext)),
		with: {
			user: {
				columns: { id: true, banned: true },
			},
		},
	});
	if (!row) {
		return { ok: false, reason: "invalid" };
	}
	if (row.revokedAt) {
		return { ok: false, reason: "revoked" };
	}
	// A ban must invalidate every authentication mechanism. The admin ban flow
	// also permanently revokes live keys; this defense-in-depth check safely
	// handles accounts banned outside that flow. Do not disclose the
	// account's ban state through the Bearer-token response.
	if (!row.user || row.user.banned) {
		return { ok: false, reason: "invalid" };
	}
	if (row.expiresAt && row.expiresAt <= new Date().toISOString()) {
		return { ok: false, reason: "invalid" };
	}

	// Bump last-used. A single indexed UPDATE — cheap enough to await, which
	// also keeps it observable/testable.
	await db
		.update(apiKey)
		.set({ lastUsedAt: new Date().toISOString() })
		.where(
			and(
				eq(apiKey.apiKeyId, row.apiKeyId),
				eq(apiKey.userId, row.userId),
			),
		);

	return {
		ok: true,
		user: { id: row.userId },
		apiKeyId: row.apiKeyId,
	};
}
