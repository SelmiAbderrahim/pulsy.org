import { connectOutboundSocket } from "../../lib/outbound-socket";
import type { Socket } from "node:net";
import { assertBelowCap } from "../../lib/account-caps";
import { getTranslator, type Translator } from "../../lib/i18n";
import { assertMonitorHostAllowed } from "./egress-input";
import type { z } from "zod";
import {
	db,
	uptimeEmailProvider,
	type apiCreateUptimeEmailProvider,
	type apiUpdateUptimeEmailProvider,
} from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import { and, count, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { decrypt, encrypt } from "../../lib/crypto";
import { escapeHtml } from "../../lib/html";
import { NotificationSendError } from "../../lib/retry";
import { safeErrorSummary } from "../../lib/safe-error";

const COMPANY_NAME = "Pulsy";

export type UptimeEmailProvider = typeof uptimeEmailProvider.$inferSelect;

function encryptField(value: string | undefined | null): string | null {
	if (!value) return null;
	return encrypt(value);
}

function decryptField(value: string | null): string | null {
	if (!value) return null;
	try {
		return decrypt(value);
	} catch (err) {
		// Never fall back to the raw stored value: sending ciphertext as a
		// credential produces confusing provider 401s. Surface the real cause.
		console.error(
			`[uptime] Failed to decrypt stored credential (${safeErrorSummary(err)}) — was ENCRYPTION_KEY rotated? Re-enter the provider's API key/password.`,
		);
		throw new NotificationSendError(
			"Stored credential could not be decrypted; re-enter the API key/password",
		);
	}
}

function maskServiceKey(value: string): string {
	if (value.length < 12) return "••••";
	return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

function maskField(value: string | null): string {
	if (!value) return "";
	let decrypted: string | null;
	try {
		decrypted = decryptField(value);
	} catch {
		// One corrupted credential must not break the whole providers list.
		return "••••";
	}
	/* v8 ignore next -- defensive: a stored secret never decrypts to empty (empty inputs are stored as NULL) */
	if (!decrypted) return "";
	return maskServiceKey(decrypted);
}

function maskProvider(
	provider: UptimeEmailProvider,
): UptimeEmailProvider & { apiKeyMasked: string; smtpPasswordMasked: string } {
	return {
		...provider,
		apiKey: null,
		smtpPassword: null,
		apiKeyMasked: maskField(provider.apiKey),
		smtpPasswordMasked: maskField(provider.smtpPassword),
	};
}

function assertProviderCredentials(
	providerType: string,
	values: {
		apiKey?: string | null;
		smtpHost?: string | null;
		smtpPort?: number | null;
		smtpUsername?: string | null;
		smtpPassword?: string | null;
	},
): void {
	if (
		(providerType === "resend" || providerType === "sendgrid") &&
		!values.apiKey
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "API key is required",
		});
	}

	if (providerType === "smtp") {
		if (
			!values.smtpHost ||
			!values.smtpPort ||
			!values.smtpUsername ||
			!values.smtpPassword
		) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "SMTP host, port, username, and password are required",
			});
		}
	}
}

export const createEmailProvider = async (
	input: z.infer<typeof apiCreateUptimeEmailProvider>,
	userId: string,
	t: Translator = getTranslator("en"),
): Promise<UptimeEmailProvider> => {
	assertProviderCredentials(input.providerType, input);
	if (input.providerType === "smtp" && input.smtpHost) await assertMonitorHostAllowed(input.smtpHost, "tcp", t, "smtpHost");
	const [existingCount] = await db.select({ value: count() }).from(uptimeEmailProvider).where(eq(uptimeEmailProvider.userId, userId));
	assertBelowCap(existingCount?.value ?? 0, "emailProviders", t);

	const encryptedApiKey = encryptField(input.apiKey);
	const encryptedSmtpPassword = encryptField(input.smtpPassword);

	const [provider] = await db
		.insert(uptimeEmailProvider)
		.values({
			name: input.name,
			providerType: input.providerType,
			apiKey: encryptedApiKey,
			smtpHost: input.smtpHost ?? null,
			smtpPort: input.smtpPort ?? null,
			smtpUsername: input.smtpUsername ?? null,
			smtpPassword: encryptedSmtpPassword,
			smtpSecure: input.smtpSecure ?? true,
			fromAddress: input.fromAddress,
			userId,
		})
		.returning();

	/* v8 ignore next 6 -- unreachable: INSERT/UPDATE ... RETURNING yields the row or throws */
	if (!provider) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create email provider",
		});
	}

	return provider;
};

export const updateEmailProvider = async (
	input: z.infer<typeof apiUpdateUptimeEmailProvider>,
	userId: string,
	t: Translator = getTranslator("en"),
): Promise<UptimeEmailProvider> => {
	const { emailProviderId, ...data } = input;

	const existing = await db.query.uptimeEmailProvider.findFirst({
		where: and(
			eq(uptimeEmailProvider.emailProviderId, emailProviderId),
			eq(uptimeEmailProvider.userId, userId),
		),
	});

	if (!existing) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Email provider not found",
		});
	}

	const effectiveProviderType = data.providerType ?? existing.providerType;
	if (effectiveProviderType === "smtp" && data.smtpHost) await assertMonitorHostAllowed(data.smtpHost, "tcp", t, "smtpHost");
	assertProviderCredentials(effectiveProviderType, {
		apiKey: data.apiKey ?? existing.apiKey,
		smtpHost: data.smtpHost ?? existing.smtpHost,
		smtpPort: data.smtpPort ?? existing.smtpPort,
		smtpUsername: data.smtpUsername ?? existing.smtpUsername,
		smtpPassword: data.smtpPassword ?? existing.smtpPassword,
	});

	const updateData: Record<string, unknown> = {};

	if (data.name !== undefined) updateData.name = data.name;
	if (data.providerType !== undefined)
		updateData.providerType = data.providerType;
	if (data.fromAddress !== undefined) updateData.fromAddress = data.fromAddress;
	if (data.smtpHost !== undefined) updateData.smtpHost = data.smtpHost;
	if (data.smtpPort !== undefined) updateData.smtpPort = data.smtpPort;
	if (data.smtpUsername !== undefined)
		updateData.smtpUsername = data.smtpUsername;
	if (data.smtpSecure !== undefined) updateData.smtpSecure = data.smtpSecure;

	if (data.apiKey !== undefined) {
		updateData.apiKey = encryptField(data.apiKey);
	}
	if (data.smtpPassword !== undefined) {
		updateData.smtpPassword = encryptField(data.smtpPassword);
	}

	const requiresReverification =
		data.providerType !== undefined ||
		data.apiKey !== undefined ||
		data.smtpHost !== undefined ||
		data.smtpPort !== undefined ||
		data.smtpUsername !== undefined ||
		data.smtpPassword !== undefined ||
		data.smtpSecure !== undefined;

	const [updated] = await db
		.update(uptimeEmailProvider)
		.set({
			...updateData,
			...(requiresReverification ? { verified: false } : {}),
		})
		.where(
			and(
				eq(uptimeEmailProvider.emailProviderId, emailProviderId),
				eq(uptimeEmailProvider.userId, userId),
			),
		)
		.returning();

	/* v8 ignore next 6 -- unreachable: INSERT/UPDATE ... RETURNING yields the row or throws */
	if (!updated) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to update email provider",
		});
	}

	return updated;
};

export const deleteEmailProvider = async (
	emailProviderId: string,
	userId: string,
): Promise<void> => {
	const existing = await db.query.uptimeEmailProvider.findFirst({
		where: and(
			eq(uptimeEmailProvider.emailProviderId, emailProviderId),
			eq(uptimeEmailProvider.userId, userId),
		),
	});

	if (!existing) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Email provider not found",
		});
	}

	await db
		.delete(uptimeEmailProvider)
		.where(
			and(
				eq(uptimeEmailProvider.emailProviderId, emailProviderId),
				eq(uptimeEmailProvider.userId, userId),
			),
		);
};

export const findEmailProviderById = async (
	emailProviderId: string,
	userId: string,
	includeSecrets = false,
): Promise<
	UptimeEmailProvider & { apiKeyMasked: string; smtpPasswordMasked: string }
> => {
	const provider = await db.query.uptimeEmailProvider.findFirst({
		where: and(
			eq(uptimeEmailProvider.emailProviderId, emailProviderId),
			eq(uptimeEmailProvider.userId, userId),
		),
	});

	if (!provider) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Email provider not found",
		});
	}

	if (includeSecrets) {
		return {
			...provider,
			apiKey: decryptField(provider.apiKey),
			smtpPassword: decryptField(provider.smtpPassword),
			apiKeyMasked: maskField(provider.apiKey),
			smtpPasswordMasked: maskField(provider.smtpPassword),
		};
	}

	return maskProvider(provider);
};

export const findEmailProvidersByUser = async (
	userId: string,
): Promise<
	Array<
		UptimeEmailProvider & { apiKeyMasked: string; smtpPasswordMasked: string }
	>
> => {
	const providers = await db.query.uptimeEmailProvider.findMany({
		where: eq(uptimeEmailProvider.userId, userId),
	});

	return providers.map(maskProvider);
};

export const testEmailProvider = async (
	emailProviderId: string,
	userId: string,
	testEmail: string,
): Promise<{ success: boolean; error?: string }> => {
	const provider = await db.query.uptimeEmailProvider.findFirst({
		where: and(
			eq(uptimeEmailProvider.emailProviderId, emailProviderId),
			eq(uptimeEmailProvider.userId, userId),
		),
	});

	if (!provider) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Email provider not found",
		});
	}

	const decryptedProvider = {
		...provider,
		apiKey: decryptField(provider.apiKey),
		smtpPassword: decryptField(provider.smtpPassword),
	};

	try {
		const brandName = COMPANY_NAME;
		await sendViaProvider(
			decryptedProvider,
			testEmail,
			`${brandName} Uptime - Test Email`,
			`
			<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
				<h2 style="margin: 0 0 16px 0;">Email Provider Test</h2>
				<p>This is a test email from ${brandName} Uptime Monitor.</p>
				<p>Your email provider <strong>${escapeHtml(provider.name)}</strong> (${escapeHtml(provider.providerType)}) is configured correctly.</p>
				<p style="color: #64748b; font-size: 12px; margin-top: 24px;">Sent by ${brandName} Uptime Monitor</p>
			</div>
			`,
		);

		await db
			.update(uptimeEmailProvider)
			.set({ verified: true })
			.where(
				and(
					eq(uptimeEmailProvider.emailProviderId, emailProviderId),
					eq(uptimeEmailProvider.userId, userId),
				),
			);

		return { success: true };
	} catch (err) {
		const errorMessage =
			err instanceof Error ? err.message : "Unknown error";
		return { success: false, error: errorMessage };
	}
};

/**
 * A binary attachment for outbound mail. `content` is the raw bytes; each
 * transport encodes it as required (base64 for the HTTP APIs, Buffer for SMTP).
 */
export interface EmailAttachment {
	filename: string;
	content: Buffer;
}

export const sendViaProvider = async (
	provider: {
		providerType: string;
		apiKey: string | null;
		smtpHost: string | null;
		smtpPort: number | null;
		smtpUsername: string | null;
		smtpPassword: string | null;
		smtpSecure: boolean | null;
		fromAddress: string;
	},
	to: string,
	subject: string,
	html: string,
	attachments?: EmailAttachment[],
): Promise<string | null> => {
	switch (provider.providerType) {
		case "resend":
			return sendViaResend(
				provider.apiKey!,
				provider.fromAddress,
				to,
				subject,
				html,
				attachments,
			);
		case "sendgrid":
			return sendViaSendGrid(
				provider.apiKey!,
				provider.fromAddress,
				to,
				subject,
				html,
				attachments,
			);
		case "smtp":
			return sendViaSmtp(provider, to, subject, html, attachments);
		default:
			throw new Error(`Unsupported provider type: ${provider.providerType}`);
	}
};

async function sendViaResend(
	apiKey: string,
	from: string,
	to: string,
	subject: string,
	html: string,
	attachments?: EmailAttachment[],
): Promise<string | null> {
	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from,
			to: [to],
			subject,
			html,
			...(attachments?.length
				? {
						attachments: attachments.map((a) => ({
							filename: a.filename,
							content: a.content.toString("base64"),
						})),
					}
				: {}),
		}),
		signal: AbortSignal.timeout(15000),
	});

	if (!response.ok) {
		throw new NotificationSendError(
			`Resend API error (${response.status})`,
			response.status,
		);
	}

	// Resend's provider-side message id — persisted in the delivery log so a
	// "sent but never delivered" report can be escalated with the exact id.
	const body: unknown = await response.json().catch(() => null);
	const id = (body as { id?: unknown } | null)?.id;
	return typeof id === "string" ? id : null;
}

async function sendViaSendGrid(
	apiKey: string,
	from: string,
	to: string,
	subject: string,
	html: string,
	attachments?: EmailAttachment[],
): Promise<string | null> {
	const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			personalizations: [{ to: [{ email: to }] }],
			from: { email: from },
			subject,
			content: [{ type: "text/html", value: html }],
			...(attachments?.length
				? {
						attachments: attachments.map((a) => ({
							content: a.content.toString("base64"),
							filename: a.filename,
							type: "application/pdf",
							disposition: "attachment",
						})),
					}
				: {}),
		}),
		signal: AbortSignal.timeout(15000),
	});

	if (!response.ok) {
		throw new NotificationSendError(
			`SendGrid API error (${response.status})`,
			response.status,
		);
	}

	return response.headers.get("X-Message-Id");
}

async function sendViaSmtp(
	provider: {
		smtpHost: string | null;
		smtpPort: number | null;
		smtpUsername: string | null;
		smtpPassword: string | null;
		smtpSecure: boolean | null;
		fromAddress: string;
	},
	to: string,
	subject: string,
	html: string,
	attachments?: EmailAttachment[],
): Promise<string | null> {
	if (!provider.smtpHost) {
		throw new Error("SMTP host is required");
	}

	let connection: Socket | undefined;
	const transporter = nodemailer.createTransport({
		host: provider.smtpHost,
		port: provider.smtpPort ?? 587,
		secure: provider.smtpSecure ?? false,
		getSocket: (_options: unknown, callback: (error: Error | null, options?: { connection: Socket; secured: boolean }) => void) => {
			void connectOutboundSocket(provider.smtpHost!, provider.smtpPort ?? 587, 10_000, provider.smtpSecure ?? false)
				.then(socket => { connection = socket; callback(null, { connection: socket, secured: provider.smtpSecure ?? false }); })
				.catch((error: unknown) => {
					const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
					const temporary = typeof code === "string" && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EPIPE"].includes(code);
					callback(Object.assign(new Error("SMTP destination unavailable or prohibited"), { code: temporary ? "ESMTP_CONNECT" : "EDESTINATION" }));
				});
		},
		auth:
			provider.smtpUsername && provider.smtpPassword
				? {
						user: provider.smtpUsername,
						pass: provider.smtpPassword,
					}
				: undefined,
		greetingTimeout: 10000,
		connectionTimeout: 10000,
		socketTimeout: 15000,
	});

	let deadline: ReturnType<typeof setTimeout> | undefined;
	try {
		const sending = transporter.sendMail({
		from: provider.fromAddress,
		to,
		subject,
		html,
		...(attachments?.length
			? {
					attachments: attachments.map((a) => ({
						filename: a.filename,
						content: a.content,
					})),
				}
			: {}),
	});


		const info = await Promise.race([sending, new Promise<never>((_resolve, reject) => {
			deadline = setTimeout(() => reject(Object.assign(new Error("SMTP delivery deadline exceeded"), { code: "ETIMEDOUT" })), 30_000);
		})]);
		return info.messageId ?? null;
	} catch (error) {
		const allowed = new Set(["ESMTP_CONNECT", "EDESTINATION", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "EAUTH", "EENVELOPE", "EDNS", "ESOCKET"]);
		const responseCode = error && typeof error === "object" && "responseCode" in error && typeof error.responseCode === "number" && Number.isInteger(error.responseCode) && error.responseCode >= 400 && error.responseCode <= 599 ? error.responseCode : null;
		const originalCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" && allowed.has(error.code) ? error.code : undefined;
		const code = responseCode && responseCode < 500 ? "ESMTP_TEMPORARY" : originalCode === "ESOCKET" ? "ECONNRESET" : originalCode;
		const safe = new Error(`SMTP delivery failed${responseCode ? ` (${responseCode})` : code ? ` (${code})` : ""}: check provider configuration`);
		if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) safe.name = error.name;
		if (code) Object.assign(safe, { code });
		throw safe;
	} finally {
		if (deadline) clearTimeout(deadline);
		transporter.close();
		connection?.destroy();
	}
}
