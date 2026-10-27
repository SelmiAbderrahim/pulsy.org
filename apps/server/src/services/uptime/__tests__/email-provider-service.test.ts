import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, uptimeEmailProvider } from "@pulsy/db";
import { eq } from "drizzle-orm";
import {
	createTestEmailProvider,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { mockFetch } from "../../../../test/fetch-mock";
import { decrypt } from "../../../lib/crypto";
import {
	createEmailProvider,
	deleteEmailProvider,
	findEmailProviderById,
	findEmailProvidersByUser,
	sendViaProvider,
	testEmailProvider,
	updateEmailProvider,
} from "../email-provider-service";

// nodemailer is mocked so SMTP paths never open a real connection.
const sendMail = vi.fn(async () => ({ messageId: "test" }));
const close = vi.fn();
const createTransport = vi.fn(() => ({ sendMail, close }));
const callCreateTransport = createTransport as unknown as (
	...args: unknown[]
) => ReturnType<typeof createTransport>;

vi.mock("nodemailer", () => ({
	default: {
		createTransport: (...args: unknown[]) => callCreateTransport(...args),
	},
}));

useCleanDatabase();

let userId: string;

beforeEach(async () => {
	const u = await createTestUser();
	userId = u.id;
	sendMail.mockClear();
	close.mockClear();
	createTransport.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createEmailProvider — validation", () => {
	it("rejects resend without an apiKey", async () => {
		await expect(
			createEmailProvider(
				{
					name: "P",
					providerType: "resend",
					fromAddress: "a@pulsy.test",
				} as never,
				userId,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("rejects sendgrid without an apiKey", async () => {
		await expect(
			createEmailProvider(
				{
					name: "P",
					providerType: "sendgrid",
					fromAddress: "a@pulsy.test",
				} as never,
				userId,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("rejects smtp missing required fields", async () => {
		await expect(
			createEmailProvider(
				{
					name: "P",
					providerType: "smtp",
					fromAddress: "a@pulsy.test",
					smtpHost: "smtp.test",
				} as never,
				userId,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

describe("createEmailProvider — encryption at rest", () => {
	it("stores the apiKey encrypted (ciphertext != plaintext, decrypts back)", async () => {
		const plaintextKey = "re_super_secret_key_123";
		const provider = await createEmailProvider(
			{
				name: "Resend",
				providerType: "resend",
				apiKey: plaintextKey,
				fromAddress: "alerts@pulsy.test",
			} as never,
			userId,
		);

		const row = await db.query.uptimeEmailProvider.findFirst({
			where: eq(
				uptimeEmailProvider.emailProviderId,
				provider.emailProviderId,
			),
		});

		expect(row?.apiKey).toBeTruthy();
		expect(row?.apiKey).not.toBe(plaintextKey);
		expect(decrypt(row?.apiKey as string)).toBe(plaintextKey);
	});

	it("stores the smtpPassword encrypted and applies smtpSecure default", async () => {
		const plaintextPw = "smtp-p@ssw0rd";
		const provider = await createEmailProvider(
			{
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "alerts@pulsy.test",
				smtpHost: "smtp.test",
				smtpPort: 587,
				smtpUsername: "user",
				smtpPassword: plaintextPw,
			} as never,
			userId,
		);

		const row = await db.query.uptimeEmailProvider.findFirst({
			where: eq(
				uptimeEmailProvider.emailProviderId,
				provider.emailProviderId,
			),
		});

		expect(row?.smtpPassword).not.toBe(plaintextPw);
		expect(decrypt(row?.smtpPassword as string)).toBe(plaintextPw);
		// smtpSecure default (true) is applied when omitted.
		expect(row?.smtpSecure).toBe(true);
	});

	it("respects an explicit smtpSecure=false", async () => {
		const provider = await createEmailProvider(
			{
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "alerts@pulsy.test",
				smtpHost: "smtp.test",
				smtpPort: 25,
				smtpUsername: "user",
				smtpPassword: "pw",
				smtpSecure: false,
			} as never,
			userId,
		);
		expect(provider.smtpSecure).toBe(false);
	});
});

describe("findEmailProviderById — masking & ownership", () => {
	it("masks secrets by default and never returns plaintext", async () => {
		const created = await createEmailProvider(
			{
				name: "Resend",
				providerType: "resend",
				apiKey: "re_abcdef123456",
				fromAddress: "alerts@pulsy.test",
			} as never,
			userId,
		);

		const found = await findEmailProviderById(
			created.emailProviderId,
			userId,
		);
		expect(found.apiKey).toBeNull();
		expect(found.apiKeyMasked).toBe("re••••56");
		expect(found.apiKeyMasked).not.toContain("abcdef");
	});

	it("returns decrypted secrets when includeSecrets is true", async () => {
		const created = await createEmailProvider(
			{
				name: "Resend",
				providerType: "resend",
				apiKey: "re_abcdef123456",
				fromAddress: "alerts@pulsy.test",
			} as never,
			userId,
		);

		const found = await findEmailProviderById(
			created.emailProviderId,
			userId,
			true,
		);
		expect(found.apiKey).toBe("re_abcdef123456");
		expect(found.apiKeyMasked).toBe("re••••56");
	});

	it("masks short secrets entirely", async () => {
		// Direct insert of an already-encrypted short value to exercise the
		// `value.length <= 4` masking branch.
		const { encrypt } = await import("../../../lib/crypto");
		const provider = await createTestEmailProvider(userId, {
			providerType: "sendgrid",
			apiKey: encrypt("ab"),
		});
		const found = await findEmailProviderById(
			provider.emailProviderId,
			userId,
		);
		expect(found.apiKeyMasked).toBe("••••");
	});

	it("returns empty mask when secret is absent", async () => {
		const provider = await createTestEmailProvider(userId, {
			providerType: "smtp",
			smtpHost: "smtp.test",
			smtpPort: 587,
			smtpUsername: "u",
			smtpPassword: null,
			apiKey: null,
		});
		const found = await findEmailProviderById(
			provider.emailProviderId,
			userId,
		);
		expect(found.apiKeyMasked).toBe("");
		expect(found.smtpPasswordMasked).toBe("");
	});

	it("throws when a stored secret cannot be decrypted (includeSecrets)", async () => {
		// Plaintext (not a valid encrypted payload) -> decrypt throws -> surfaced,
		// never returned as-is (which would send ciphertext as a credential).
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const provider = await createTestEmailProvider(userId, {
			providerType: "resend",
			apiKey: "plain-not-encrypted",
		});
		await expect(
			findEmailProviderById(provider.emailProviderId, userId, true),
		).rejects.toThrow(/could not be decrypted/);
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it("masks an undecryptable secret as •••• instead of breaking the listing", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const provider = await createTestEmailProvider(userId, {
			providerType: "resend",
			apiKey: "plain-not-encrypted",
		});
		const found = await findEmailProviderById(provider.emailProviderId, userId);
		expect(found.apiKeyMasked).toBe("••••");
		errSpy.mockRestore();
	});

	it("throws NOT_FOUND for a wrong owner (ownership scoping)", async () => {
		const created = await createEmailProvider(
			{
				name: "Resend",
				providerType: "resend",
				apiKey: "re_secret",
				fromAddress: "alerts@pulsy.test",
			} as never,
			userId,
		);
		const intruder = await createTestUser();
		await expect(
			findEmailProviderById(created.emailProviderId, intruder.id),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws NOT_FOUND for a missing provider", async () => {
		await expect(
			findEmailProviderById("missing", userId),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("findEmailProvidersByUser", () => {
	it("returns only the user's providers, all masked", async () => {
		await createEmailProvider(
			{
				name: "Mine",
				providerType: "resend",
				apiKey: "re_mine_123456",
				fromAddress: "a@pulsy.test",
			} as never,
			userId,
		);
		const other = await createTestUser();
		await createTestEmailProvider(other.id, { name: "Theirs" });

		const list = await findEmailProvidersByUser(userId);
		expect(list).toHaveLength(1);
		expect(list[0]?.name).toBe("Mine");
		expect(list[0]?.apiKey).toBeNull();
		expect(list[0]?.apiKeyMasked).toBe("re••••56");
	});
});

describe("updateEmailProvider", () => {
	it("throws NOT_FOUND for a missing provider", async () => {
		await expect(
			updateEmailProvider(
				{ emailProviderId: "missing", name: "x" } as never,
				userId,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("re-encrypts a changed apiKey and marks unverified", async () => {
		const created = await createEmailProvider(
			{
				name: "Resend",
				providerType: "resend",
				apiKey: "re_old_123456",
				fromAddress: "a@pulsy.test",
			} as never,
			userId,
		);

		const updated = await updateEmailProvider(
			{
				emailProviderId: created.emailProviderId,
				apiKey: "re_new_999999",
			} as never,
			userId,
		);

		expect(updated.verified).toBe(false);
		expect(updated.apiKey).not.toBe("re_new_999999");
		expect(decrypt(updated.apiKey as string)).toBe("re_new_999999");
	});

	it("re-encrypts a changed smtpPassword", async () => {
		const created = await createEmailProvider(
			{
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "a@pulsy.test",
				smtpHost: "smtp.test",
				smtpPort: 587,
				smtpUsername: "u",
				smtpPassword: "old-pw",
			} as never,
			userId,
		);

		const updated = await updateEmailProvider(
			{
				emailProviderId: created.emailProviderId,
				smtpPassword: "new-pw",
			} as never,
			userId,
		);
		expect(decrypt(updated.smtpPassword as string)).toBe("new-pw");
	});

	it("updates plain fields without forcing reverification", async () => {
		const created = await createTestEmailProvider(userId, {
			providerType: "resend",
			apiKey: (await import("../../../lib/crypto")).encrypt("re_keep_123456"),
			verified: true,
		});

		const updated = await updateEmailProvider(
			{
				emailProviderId: created.emailProviderId,
				name: "Renamed",
				fromAddress: "new@pulsy.test",
			} as never,
			userId,
		);
		expect(updated.name).toBe("Renamed");
		expect(updated.fromAddress).toBe("new@pulsy.test");
		// Only name/fromAddress changed -> verified stays true.
		expect(updated.verified).toBe(true);
	});

	it("validates the effective provider type after a partial update", async () => {
		// Existing smtp provider; switching providerType to resend with no apiKey
		// must fail validation against the effective (merged) values.
		const created = await createEmailProvider(
			{
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "a@pulsy.test",
				smtpHost: "smtp.test",
				smtpPort: 587,
				smtpUsername: "u",
				smtpPassword: "pw",
			} as never,
			userId,
		);

		await expect(
			updateEmailProvider(
				{
					emailProviderId: created.emailProviderId,
					providerType: "resend",
				} as never,
				userId,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("updates smtp connection fields and forces reverification", async () => {
		const created = await createEmailProvider(
			{
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "a@pulsy.test",
				smtpHost: "smtp.test",
				smtpPort: 587,
				smtpUsername: "u",
				smtpPassword: "pw",
				smtpSecure: true,
			} as never,
			userId,
		);
		const updated = await updateEmailProvider(
			{
				emailProviderId: created.emailProviderId,
				smtpHost: "smtp2.test",
				smtpPort: 2525,
				smtpUsername: "u2",
				smtpSecure: false,
			} as never,
			userId,
		);
		expect(updated.smtpHost).toBe("smtp2.test");
		expect(updated.smtpPort).toBe(2525);
		expect(updated.smtpUsername).toBe("u2");
		expect(updated.smtpSecure).toBe(false);
		expect(updated.verified).toBe(false);
	});

	it("switches the provider type when the new credentials are valid", async () => {
		// smtp -> resend WITH an apiKey passes the effective-credential check,
		// so the providerType assignment branch actually executes.
		const created = await createEmailProvider(
			{
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "a@pulsy.test",
				smtpHost: "smtp.test",
				smtpPort: 587,
				smtpUsername: "u",
				smtpPassword: "pw",
			} as never,
			userId,
		);
		const updated = await updateEmailProvider(
			{
				emailProviderId: created.emailProviderId,
				providerType: "resend",
				apiKey: "re_newkey_123456",
			} as never,
			userId,
		);
		expect(updated.providerType).toBe("resend");
		// A credential/provider change forces re-verification.
		expect(updated.verified).toBe(false);
	});
});

describe("deleteEmailProvider", () => {
	it("throws NOT_FOUND for a missing provider", async () => {
		await expect(
			deleteEmailProvider("missing", userId),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws NOT_FOUND for a wrong owner", async () => {
		const created = await createTestEmailProvider(userId);
		const intruder = await createTestUser();
		await expect(
			deleteEmailProvider(created.emailProviderId, intruder.id),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("deletes an owned provider", async () => {
		const created = await createTestEmailProvider(userId);
		await deleteEmailProvider(created.emailProviderId, userId);
		await expect(
			findEmailProviderById(created.emailProviderId, userId),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("sendViaProvider", () => {
	it("posts to the Resend API with the bearer token", async () => {
		const fx = mockFetch();
		try {
			await sendViaProvider(
				{
					providerType: "resend",
					apiKey: "re_key",
					smtpHost: null,
					smtpPort: null,
					smtpUsername: null,
					smtpPassword: null,
					smtpSecure: null,
					fromAddress: "from@pulsy.test",
				},
				"to@pulsy.test",
				"Subj",
				"<p>hi</p>",
			);
			expect(fx.calls).toHaveLength(1);
			expect(fx.calls[0]?.url).toBe("https://api.resend.com/emails");
			expect(fx.calls[0]?.headers.Authorization).toBe("Bearer re_key");
		} finally {
			fx.restore();
		}
	});

	it("attaches a base64 PDF for Resend", async () => {
		const fx = mockFetch();
		try {
			await sendViaProvider(
				{
					providerType: "resend",
					apiKey: "re_key",
					smtpHost: null,
					smtpPort: null,
					smtpUsername: null,
					smtpPassword: null,
					smtpSecure: null,
					fromAddress: "from@pulsy.test",
				},
				"to@pulsy.test",
				"Subj",
				"<p>hi</p>",
				[{ filename: "r.pdf", content: Buffer.from("PDFDATA") }],
			);
			const body = JSON.parse(fx.calls[0]?.body ?? "{}");
			expect(body.attachments[0].filename).toBe("r.pdf");
			expect(body.attachments[0].content).toBe(
				Buffer.from("PDFDATA").toString("base64"),
			);
		} finally {
			fx.restore();
		}
	});

	it("attaches a base64 PDF for SendGrid with type + disposition", async () => {
		const fx = mockFetch();
		try {
			await sendViaProvider(
				{
					providerType: "sendgrid",
					apiKey: "sg_key",
					smtpHost: null,
					smtpPort: null,
					smtpUsername: null,
					smtpPassword: null,
					smtpSecure: null,
					fromAddress: "from@pulsy.test",
				},
				"to@pulsy.test",
				"Subj",
				"<p>hi</p>",
				[{ filename: "s.pdf", content: Buffer.from("PDFDATA") }],
			);
			const body = JSON.parse(fx.calls[0]?.body ?? "{}");
			expect(body.attachments[0]).toMatchObject({
				filename: "s.pdf",
				type: "application/pdf",
				disposition: "attachment",
			});
		} finally {
			fx.restore();
		}
	});

	it("attaches a Buffer for SMTP", async () => {
		await sendViaProvider(
			{
				providerType: "smtp",
				apiKey: null,
				smtpHost: "smtp.test",
				smtpPort: 465,
				smtpUsername: "u",
				smtpPassword: "pw",
				smtpSecure: true,
				fromAddress: "from@pulsy.test",
			},
			"to@pulsy.test",
			"Subj",
			"<p>hi</p>",
			[{ filename: "m.pdf", content: Buffer.from("PDFDATA") }],
		);
		expect(sendMail).toHaveBeenCalledWith(
			expect.objectContaining({
				attachments: [
					expect.objectContaining({ filename: "m.pdf" }),
				],
			}),
		);
	});

	it("throws when Resend returns a non-ok response", async () => {
		const fx = mockFetch(() => new Response("nope", { status: 422 }));
		try {
			await expect(
				sendViaProvider(
					{
						providerType: "resend",
						apiKey: "re_key",
						smtpHost: null,
						smtpPort: null,
						smtpUsername: null,
						smtpPassword: null,
						smtpSecure: null,
						fromAddress: "from@pulsy.test",
					},
					"to@pulsy.test",
					"Subj",
					"<p>hi</p>",
				),
			).rejects.toThrow(/Resend API error \(422\)/);
		} finally {
			fx.restore();
		}
	});

	it("posts to the SendGrid API", async () => {
		const fx = mockFetch();
		try {
			await sendViaProvider(
				{
					providerType: "sendgrid",
					apiKey: "sg_key",
					smtpHost: null,
					smtpPort: null,
					smtpUsername: null,
					smtpPassword: null,
					smtpSecure: null,
					fromAddress: "from@pulsy.test",
				},
				"to@pulsy.test",
				"Subj",
				"<p>hi</p>",
			);
			expect(fx.calls[0]?.url).toBe(
				"https://api.sendgrid.com/v3/mail/send",
			);
			expect(fx.calls[0]?.headers.Authorization).toBe("Bearer sg_key");
		} finally {
			fx.restore();
		}
	});

	it("throws when SendGrid returns a non-ok response", async () => {
		const fx = mockFetch(() => new Response("bad", { status: 401 }));
		try {
			await expect(
				sendViaProvider(
					{
						providerType: "sendgrid",
						apiKey: "sg_key",
						smtpHost: null,
						smtpPort: null,
						smtpUsername: null,
						smtpPassword: null,
						smtpSecure: null,
						fromAddress: "from@pulsy.test",
					},
					"to@pulsy.test",
					"Subj",
					"<p>hi</p>",
				),
			).rejects.toThrow(/SendGrid API error \(401\)/);
		} finally {
			fx.restore();
		}
	});

	it("sends via SMTP using nodemailer with auth", async () => {
		await sendViaProvider(
			{
				providerType: "smtp",
				apiKey: null,
				smtpHost: "smtp.test",
				smtpPort: 465,
				smtpUsername: "u",
				smtpPassword: "pw",
				smtpSecure: true,
				fromAddress: "from@pulsy.test",
			},
			"to@pulsy.test",
			"Subj",
			"<p>hi</p>",
		);
		expect(createTransport).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "smtp.test",
				port: 465,
				secure: true,
				auth: { user: "u", pass: "pw" },
			}),
		);
		expect(sendMail).toHaveBeenCalledWith(
			expect.objectContaining({
				from: "from@pulsy.test",
				to: "to@pulsy.test",
				subject: "Subj",
			}),
		);
		expect(close).toHaveBeenCalled();
	});

	it("sends via SMTP without auth and applies port/secure defaults", async () => {
		await sendViaProvider(
			{
				providerType: "smtp",
				apiKey: null,
				smtpHost: "smtp.test",
				smtpPort: null,
				smtpUsername: null,
				smtpPassword: null,
				smtpSecure: null,
				fromAddress: "from@pulsy.test",
			},
			"to@pulsy.test",
			"Subj",
			"<p>hi</p>",
		);
		expect(createTransport).toHaveBeenCalledWith(
			expect.objectContaining({
				port: 587,
				secure: false,
				auth: undefined,
			}),
		);
	});

	it("throws when smtp host is missing", async () => {
		await expect(
			sendViaProvider(
				{
					providerType: "smtp",
					apiKey: null,
					smtpHost: null,
					smtpPort: 587,
					smtpUsername: "u",
					smtpPassword: "pw",
					smtpSecure: false,
					fromAddress: "from@pulsy.test",
				},
				"to@pulsy.test",
				"Subj",
				"<p>hi</p>",
			),
		).rejects.toThrow(/SMTP host is required/);
	});

	it("throws for an unsupported provider type", async () => {
		await expect(
			sendViaProvider(
				{
					providerType: "carrier-pigeon",
					apiKey: null,
					smtpHost: null,
					smtpPort: null,
					smtpUsername: null,
					smtpPassword: null,
					smtpSecure: null,
					fromAddress: "from@pulsy.test",
				},
				"to@pulsy.test",
				"Subj",
				"<p>hi</p>",
			),
		).rejects.toThrow(/Unsupported provider type/);
	});

	const resendProvider = {
		providerType: "resend" as const,
		apiKey: "re_key",
		smtpHost: null,
		smtpPort: null,
		smtpUsername: null,
		smtpPassword: null,
		smtpSecure: null,
		fromAddress: "from@pulsy.test",
	};

	it("returns the Resend message id from the response body", async () => {
		const fx = mockFetch(
			() =>
				new Response(JSON.stringify({ id: "re_msg_1" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);
		try {
			const id = await sendViaProvider(
				resendProvider,
				"to@pulsy.test",
				"Subj",
				"<p>hi</p>",
			);
			expect(id).toBe("re_msg_1");
		} finally {
			fx.restore();
		}
	});

	it("returns null when the Resend body has no id", async () => {
		const fx = mockFetch(() => new Response("not json", { status: 200 }));
		try {
			const id = await sendViaProvider(
				resendProvider,
				"to@pulsy.test",
				"Subj",
				"<p>hi</p>",
			);
			expect(id).toBeNull();
		} finally {
			fx.restore();
		}
	});

	it("returns the SendGrid X-Message-Id header", async () => {
		const fx = mockFetch(
			() =>
				new Response("", {
					status: 202,
					headers: { "X-Message-Id": "sg_msg_1" },
				}),
		);
		try {
			const id = await sendViaProvider(
				{ ...resendProvider, providerType: "sendgrid", apiKey: "sg_key" },
				"to@pulsy.test",
				"Subj",
				"<p>hi</p>",
			);
			expect(id).toBe("sg_msg_1");
		} finally {
			fx.restore();
		}
	});

	it("returns the nodemailer message id for SMTP", async () => {
		const id = await sendViaProvider(
			{
				providerType: "smtp",
				apiKey: null,
				smtpHost: "smtp.test",
				smtpPort: 465,
				smtpUsername: "u",
				smtpPassword: "pw",
				smtpSecure: true,
				fromAddress: "from@pulsy.test",
			},
			"to@pulsy.test",
			"Subj",
			"<p>hi</p>",
		);
		expect(id).toBe("test");
	});

	it("returns null for SMTP when nodemailer omits the message id", async () => {
		sendMail.mockResolvedValueOnce({} as unknown as { messageId: string });
		const id = await sendViaProvider(
			{
				providerType: "smtp",
				apiKey: null,
				smtpHost: "smtp.test",
				smtpPort: 465,
				smtpUsername: "u",
				smtpPassword: "pw",
				smtpSecure: true,
				fromAddress: "from@pulsy.test",
			},
			"to@pulsy.test",
			"Subj",
			"<p>hi</p>",
		);
		expect(id).toBeNull();
	});
});

describe("testEmailProvider", () => {
	it("throws NOT_FOUND for a missing provider", async () => {
		await expect(
			testEmailProvider("missing", userId, "x@pulsy.test"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("sends a test email and marks the provider verified on success", async () => {
		const fx = mockFetch();
		try {
			const created = await createEmailProvider(
				{
					name: "Resend",
					providerType: "resend",
					apiKey: "re_test_key",
					fromAddress: "from@pulsy.test",
				} as never,
				userId,
			);

			const result = await testEmailProvider(
				created.emailProviderId,
				userId,
				"dest@pulsy.test",
			);
			expect(result.success).toBe(true);

			// The decrypted apiKey was used for the outbound call.
			expect(fx.calls[0]?.headers.Authorization).toBe("Bearer re_test_key");

			const row = await db.query.uptimeEmailProvider.findFirst({
				where: eq(
					uptimeEmailProvider.emailProviderId,
					created.emailProviderId,
				),
			});
			expect(row?.verified).toBe(true);
		} finally {
			fx.restore();
		}
	});

	it("escapes a malicious provider name in the test-email body (no HTML injection)", async () => {
		const fx = mockFetch();
		try {
			const created = await createEmailProvider(
				{
					name: '<script>alert(1)</script>',
					providerType: "resend",
					apiKey: "re_test_key",
					fromAddress: "from@pulsy.test",
				} as never,
				userId,
			);

			await testEmailProvider(
				created.emailProviderId,
				userId,
				"dest@pulsy.test",
			);

			const body = fx.calls[0]?.body ?? "";
			const { html } = JSON.parse(body) as { html: string };
			expect(html).not.toContain("<script>");
			expect(html).toContain("&lt;script&gt;");
		} finally {
			fx.restore();
		}
	});

	it("returns success:false with the error message on failure", async () => {
		const fx = mockFetch(() => new Response("denied", { status: 403 }));
		try {
			const created = await createEmailProvider(
				{
					name: "Resend",
					providerType: "resend",
					apiKey: "re_test_key",
					fromAddress: "from@pulsy.test",
				} as never,
				userId,
			);

			const result = await testEmailProvider(
				created.emailProviderId,
				userId,
				"dest@pulsy.test",
			);
			expect(result.success).toBe(false);
			expect(result.error).toMatch(/Resend API error \(403\)/);

			const row = await db.query.uptimeEmailProvider.findFirst({
				where: eq(
					uptimeEmailProvider.emailProviderId,
					created.emailProviderId,
				),
			});
			expect(row?.verified).toBe(false);
		} finally {
			fx.restore();
		}
	});

	it("surfaces a non-Error throw as 'Unknown error'", async () => {
		// Make fetch reject with a non-Error value to hit the `: "Unknown error"`
		// branch of the catch.
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue("string failure");
		try {
			const created = await createEmailProvider(
				{
					name: "Resend",
					providerType: "resend",
					apiKey: "re_test_key",
					fromAddress: "from@pulsy.test",
				} as never,
				userId,
			);
			const result = await testEmailProvider(
				created.emailProviderId,
				userId,
				"dest@pulsy.test",
			);
			expect(result.success).toBe(false);
			expect(result.error).toBe("Unknown error");
		} finally {
			spy.mockRestore();
		}
	});
});

describe("provider failure privacy and cleanup", () => {
	it.each(["resend", "sendgrid"] as const)("releases an unread %s failure body without replacing the safe error", async providerType => {
		const cancel = vi.fn().mockRejectedValue(new Error("private cleanup failure"));
		const response = new Response("private-provider-token", { status: 401 });
		vi.spyOn(response.body!, "cancel").mockImplementation(cancel);
		const fx = mockFetch(() => response);
		try {
			const error = await sendViaProvider({ providerType, apiKey: "fixture-secret", smtpHost: null, smtpPort: null, smtpUsername: null, smtpPassword: null, smtpSecure: null, fromAddress: "sender@fixtures.invalid" }, "recipient@fixtures.invalid", "Fixture", "<p>fixture</p>").catch(value => value);
			expect(cancel).toHaveBeenCalledTimes(1);
			expect(String(error)).toContain("401");
			expect(String(error)).not.toMatch(/private|fixture-secret|recipient@/);
		} finally { fx.restore(); }
	});
  it.each([[450, true], [550, false]])("preserves SMTP %i temporary/permanent retry policy", async (responseCode, retryable) => {
    sendMail.mockRejectedValueOnce(Object.assign(new Error("private smtp response"), { code: "EENVELOPE", responseCode }));
    const error = await sendViaProvider({ providerType: "smtp", apiKey: null, smtpHost: "smtp.fixtures.invalid", smtpPort: 2525, smtpUsername: "fixture", smtpPassword: "smtp-password", smtpSecure: false, fromAddress: "sender@fixtures.invalid" }, "recipient@fixtures.invalid", "Fixture", "<p>fixture</p>").catch(value => value);
    const { isTransientSendError } = await import("../../../lib/retry"); expect(isTransientSendError(error)).toBe(retryable);
    expect(String(error)).not.toContain("private smtp response"); expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(["resend", "sendgrid"])("does not retain a %s error response that echoes credentials or recipients", async providerType => {
    const fx = mockFetch(() => new Response("fixture-secret recipient@fixtures.invalid", { status: 401 }));
    try {
      const error = await sendViaProvider({ providerType, apiKey: "fixture-secret", smtpHost: null, smtpPort: null, smtpUsername: null, smtpPassword: null, smtpSecure: null, fromAddress: "sender@fixtures.invalid" }, "recipient@fixtures.invalid", "Fixture", "<p>fixture</p>").catch(value => value);
      expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain("fixture-secret"); expect(String(error)).not.toContain("recipient@"); expect(String(error)).toContain("401");
    } finally { fx.restore(); }
  });
  it("closes SMTP transport on a failed send and returns a safe error preserving retry classification", async () => {
    const error = Object.assign(new Error("smtp-password recipient@fixtures.invalid"), { code: "ECONNREFUSED" }); sendMail.mockRejectedValueOnce(error);
    const result = await sendViaProvider({ providerType: "smtp", apiKey: null, smtpHost: "smtp.fixtures.invalid", smtpPort: 2525, smtpUsername: "fixture", smtpPassword: "smtp-password", smtpSecure: false, fromAddress: "sender@fixtures.invalid" }, "recipient@fixtures.invalid", "Fixture", "<p>fixture</p>").catch(value => value);
    expect(close).toHaveBeenCalledTimes(1); expect(String(result)).not.toContain("smtp-password"); expect(String(result)).not.toContain("recipient@"); expect(result).toMatchObject({ code: "ECONNREFUSED" });
  });
});

it("fully masks short provider credentials", async () => {
  for (const [secret, masked] of [["abcde", "••••"], ["abcdefghijk", "••••"], ["abcdefghijkl", "ab••••kl"]] as const) {
    const owner = await createTestUser();
    const created = await createEmailProvider({ name: "Mask", providerType: "resend", apiKey: secret, fromAddress: "a@pulsy.test", smtpSecure: true }, owner.id);
    expect((await findEmailProviderById(created.emailProviderId, owner.id)).apiKeyMasked).toBe(masked);
  }
});
