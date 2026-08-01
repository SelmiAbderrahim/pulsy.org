import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";

// ---------------------------------------------------------------------------
// AES-256-GCM symmetric encryption for stored application secrets, including
// email-provider credentials, notification targets, and custom header values.
//
// Key derivation: SHA-256 over `process.env.ENCRYPTION_KEY` so any length /
// encoding (base64 or hex or raw) of the env value yields a stable 32-byte key.
//
// Output format: base64( iv(12) || authTag(16) || ciphertext )
// ---------------------------------------------------------------------------

const IV_LENGTH = 12; // GCM standard nonce length
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

// Reject the .env.example placeholder and trivially short keys instead of
// silently deriving a publicly-known key from them.
const PLACEHOLDER_KEY = /^replace[-_]?with/i;
const MIN_KEY_LENGTH = 16;

function getKey(): Buffer {
	const raw = process.env.ENCRYPTION_KEY;
	if (!raw) {
		throw new Error(
			"ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.",
		);
	}
	if (PLACEHOLDER_KEY.test(raw) || raw.length < MIN_KEY_LENGTH) {
		throw new Error(
			"ENCRYPTION_KEY looks like a placeholder or is shorter than " +
				`${MIN_KEY_LENGTH} characters. Generate a real key with ` +
				"`openssl rand -base64 32`.",
		);
	}
	// SHA-256 always yields a 32-byte key regardless of input length/encoding.
	return createHash("sha256").update(raw, "utf8").digest();
}

export function encrypt(plain: string): string {
	const key = getKey();
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);

	const ciphertext = Buffer.concat([
		cipher.update(plain, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(payload: string): string {
	const key = getKey();
	const data = Buffer.from(payload, "base64");

	if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
		throw new Error("Invalid encrypted payload: too short.");
	}

	const iv = data.subarray(0, IV_LENGTH);
	const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
	const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);

	const plain = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);

	return plain.toString("utf8");
}
