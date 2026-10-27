import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Integration tests for the uptime services.
//
// These exercise the REAL services against a REAL Postgres (via @pulsy/db) and
// make REAL outbound HTTP checks. They are gated behind DATABASE_URL so they
// no-op when no database is configured:
//
//   make start            # brings up postgres + sets DATABASE_URL in the server
//   make test             # runs this suite inside the server container
//
// or, locally:
//
//   DATABASE_URL=postgres://pulsy:pulsy@localhost:5432/pulsy pnpm -r test
//
// @pulsy/db throws at import time if DATABASE_URL is unset, so every import of
// the db/services is dynamic and happens INSIDE the gated blocks below.
// ---------------------------------------------------------------------------

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("uptime integration", () => {
	// Lazily-loaded modules (populated in beforeAll once we know DATABASE_URL exists).
	let dbMod: typeof import("@pulsy/db");
	let monitorSvc: typeof import("../services/uptime/monitor-service");
	let monitorOpsSvc: typeof import("../services/uptime/monitor-operations");
	let incidentSvc: typeof import("../services/uptime/incident-service");
	let checkerSvc: typeof import("../services/uptime/checker-service");
	let notificationSvc: typeof import("../services/uptime/notification-service");
	let emailProviderSvc: typeof import("../services/uptime/email-provider-service");
	let testTranslator: import("../lib/i18n").Translator;

	let testUserId: string;
	const createdMonitorIds: string[] = [];

	async function createIntegrationMonitor(
		input: Parameters<
			typeof import("../services/uptime/monitor-operations").createMonitorForUser
		>[0],
		userId: string,
	) {
		return monitorOpsSvc.createMonitorForUser(input, userId);
	}

	beforeAll(async () => {
		dbMod = await import("@pulsy/db");
		monitorSvc = await import("../services/uptime/monitor-service");
		monitorOpsSvc = await import("../services/uptime/monitor-operations");
		incidentSvc = await import("../services/uptime/incident-service");
		checkerSvc = await import("../services/uptime/checker-service");
		notificationSvc = await import("../services/uptime/notification-service");
		emailProviderSvc = await import(
			"../services/uptime/email-provider-service"
		);
		testTranslator = (await import("../lib/i18n")).getTranslator("en");

		// Create a throwaway user row directly (avoids the better-auth HTTP flow).
		testUserId = `test_user_${Date.now()}`;
		await dbMod.db.insert(dbMod.user).values({
			id: testUserId,
			name: "Integration Test",
			email: `it-${testUserId}@pulsy.test`,
			emailVerified: true,
		});
	});

	afterAll(async () => {
		if (!dbMod) return;
		const { eq } = await import("drizzle-orm");
		// Cleanup: deleting the user cascades to monitors/incidents/channels.
		if (testUserId) {
			await dbMod.db
				.delete(dbMod.user)
				.where(eq(dbMod.user.id, testUserId));
		}
	});

	// -----------------------------------------------------------------------
	// (a) Monitor CRUD
	// -----------------------------------------------------------------------
	describe("monitor CRUD", () => {
		it("creates, reads, updates, lists and deletes a monitor", async () => {
			const created = await createIntegrationMonitor(
				{
					name: "CRUD Monitor",
					url: "https://example.com",
					method: "GET",
					expectedStatus: 200,
					timeout: 10_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);

			expect(created.uptimeMonitorId).toBeTruthy();
			expect(created.userId).toBe(testUserId);
			expect(created.status).toBe("pending");
			createdMonitorIds.push(created.uptimeMonitorId);

			// Read
			const fetched = await monitorSvc.findUptimeMonitorById(
				created.uptimeMonitorId,
				testUserId,
			);
			expect(fetched.uptimeMonitorId).toBe(created.uptimeMonitorId);
			expect(fetched.name).toBe("CRUD Monitor");

			// Update
			const updated = await monitorSvc.updateUptimeMonitor(
				{
					uptimeMonitorId: created.uptimeMonitorId,
					name: "CRUD Monitor (renamed)",
				},
				testUserId,
			);
			expect(updated.name).toBe("CRUD Monitor (renamed)");

			// List by user
			const list = await monitorSvc.listOwnedMonitors(testUserId, 100, 0);
			expect(
				list.some((m) => m.uptimeMonitorId === created.uptimeMonitorId),
			).toBe(true);

			// Delete
			await monitorSvc.deleteUptimeMonitor(
				created.uptimeMonitorId,
				testUserId,
			);
			await expect(
				monitorSvc.findUptimeMonitorById(
					created.uptimeMonitorId,
					testUserId,
				),
			).rejects.toThrow();
			createdMonitorIds.pop();
		});
	});

	// -----------------------------------------------------------------------
	// (b) Incident lifecycle: open after threshold, resolve on recovery
	// -----------------------------------------------------------------------
	describe("incident lifecycle", () => {
		it("opens an ongoing incident then resolves it on recovery", async () => {
			const monitor = await createIntegrationMonitor(
				{
					name: "Incident Monitor",
					url: "https://example.com/incident",
					method: "GET",
					expectedStatus: 200,
					timeout: 10_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			// No ongoing incident yet.
			expect(
				await incidentSvc.getOngoingIncident(monitor.uptimeMonitorId),
			).toBeNull();

			// Simulate reaching the failure threshold -> open an incident.
			const incident = await incidentSvc.createIncident(
				monitor.uptimeMonitorId,
				"3 consecutive failures",
			);
			expect(incident.status).toBe("ongoing");
			expect(incident.uptimeMonitorId).toBe(monitor.uptimeMonitorId);

			const ongoing = await incidentSvc.getOngoingIncident(
				monitor.uptimeMonitorId,
			);
			expect(ongoing?.incidentId).toBe(incident.incidentId);

			// Recovery -> resolve.
			const resolved = await incidentSvc.resolveIncident(
				monitor.uptimeMonitorId,
			);
			expect(resolved?.status).toBe("resolved");
			expect(resolved?.resolvedAt).toBeTruthy();
			expect(typeof resolved?.durationSeconds).toBe("number");

			// Nothing ongoing afterwards.
			expect(
				await incidentSvc.getOngoingIncident(monitor.uptimeMonitorId),
			).toBeNull();

			// resolveIncident on a monitor with no ongoing incident returns null.
			expect(
				await incidentSvc.resolveIncident(monitor.uptimeMonitorId),
			).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// (c) Real HTTP checks (network — assertions are tolerant)
	// -----------------------------------------------------------------------
	describe("performHttpCheck (live network)", () => {
		it("reports a known-up URL as up", async () => {
			const monitor = await createIntegrationMonitor(
				{
					name: "Up Check",
					url: "https://example.com",
					method: "GET",
					expectedStatus: 200,
					timeout: 15_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			const result = await checkerSvc.performHttpCheck(monitor);
			// Tolerate transient network flakiness: if we reached the server it
			// should be "up"; only fail loudly when we got a definitive answer.
			if (result.httpStatus !== null) {
				expect(result.status).toBe("up");
				expect(result.responseTime).toBeGreaterThanOrEqual(0);
			} else {
				// Network unreachable in this environment — don't fail the suite.
				expect(result.status).toBe("down");
			}
		});

		it("reports an unroutable URL as not up", async () => {
			const monitor = await createIntegrationMonitor(
				{
					name: "Down Check",
					// Port 1 on loopback is virtually never listening -> connection refused.
					url: "http://127.0.0.1:1",
					method: "GET",
					expectedStatus: 200,
					timeout: 5_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			const result = await checkerSvc.performHttpCheck(monitor);
			expect(result.status).not.toBe("up");
		});
	});

	// -----------------------------------------------------------------------
	// (d) Email-provider secret handling
	// -----------------------------------------------------------------------
	describe("email provider secrets", () => {
		it("encrypts provider secrets at rest and returns only masked values", async () => {
			const { eq } = await import("drizzle-orm");
			const provider = await emailProviderSvc.createEmailProvider(
				{
					name: "Resend Provider",
					providerType: "resend",
					apiKey: "resend_test_key_123",
					fromAddress: "alerts@pulsy.test",
					smtpSecure: true,
				},
				testUserId,
			);

			const raw = await dbMod.db.query.uptimeEmailProvider.findFirst({
				where: eq(
					dbMod.uptimeEmailProvider.emailProviderId,
					provider.emailProviderId,
				),
			});

			expect(raw?.apiKey).toBeTruthy();
			expect(raw?.apiKey).not.toBe("resend_test_key_123");

			const masked = await emailProviderSvc.findEmailProviderById(
				provider.emailProviderId,
				testUserId,
			);
			expect(masked.apiKey).toBeNull();
			expect(masked.apiKeyMasked).toContain("••••");

			const decrypted = await emailProviderSvc.findEmailProviderById(
				provider.emailProviderId,
				testUserId,
				true,
			);
			expect(decrypted.apiKey).toBe("resend_test_key_123");
		});

		it("decrypts provider secrets before sending email notifications", async () => {
			const monitor = await createIntegrationMonitor(
				{
					name: "Email Notify Monitor",
					url: "https://example.com/email-notify",
					method: "GET",
					expectedStatus: 200,
					timeout: 10_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			const provider = await emailProviderSvc.createEmailProvider(
				{
					name: "Dispatch Resend Provider",
					providerType: "resend",
					apiKey: "dispatch_resend_key_456",
					fromAddress: "alerts@pulsy.test",
					smtpSecure: true,
				},
				testUserId,
			);

			await dbMod.db.insert(dbMod.uptimeNotificationChannel).values({
				uptimeMonitorId: monitor.uptimeMonitorId,
				userId: testUserId,
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: ["ops@pulsy.test"],
				notifyOnDown: true,
				notifyOnRecovery: false,
			});

			const calls: Array<{ url: string; init?: RequestInit }> = [];
				const fetchSpy = vi
					.spyOn(globalThis, "fetch")
					.mockImplementation(
						async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
							calls.push({ url: String(input), init });
							return new Response("ok", { status: 200 });
						},
				);

			try {
				await notificationSvc.dispatchNotifications(monitor, {
					statusChangeId: "sc_email_test",
					uptimeMonitorId: monitor.uptimeMonitorId,
					statusBefore: "up",
					statusAfter: "down",
					httpStatus: 503,
					responseTime: 120,
					reason: "Unexpected status: 503",
					createdAt: new Date().toISOString(),
				});
			} finally {
				fetchSpy.mockRestore();
			}

			expect(calls.length).toBe(1);
			expect(calls[0]?.url).toBe("https://api.resend.com/emails");
			const headers = new Headers(calls[0]?.init?.headers);
			expect(headers.get("Authorization")).toBe(
				"Bearer dispatch_resend_key_456",
			);
			const body = JSON.parse(String(calls[0]?.init?.body ?? "{}"));
			expect(body.to).toEqual(["ops@pulsy.test"]);
		});

		it("sends email channel test notifications only through verified providers", async () => {
			const { eq } = await import("drizzle-orm");
			const [{ appRouter }, { createCallerFactory }, { getTranslator }] =
				await Promise.all([
					import("../trpc/router"),
					import("../trpc/trpc"),
					import("../lib/i18n"),
				]);

			const monitor = await createIntegrationMonitor(
				{
					name: "Email Channel Test Monitor",
					url: "https://example.com/channel-test",
					method: "GET",
					expectedStatus: 200,
					timeout: 10_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			const provider = await emailProviderSvc.createEmailProvider(
				{
					name: "Channel Test Resend Provider",
					providerType: "resend",
					apiKey: "channel_test_resend_key",
					fromAddress: "alerts@pulsy.test",
					smtpSecure: true,
				},
				testUserId,
			);

			const [channel] = await dbMod.db
				.insert(dbMod.uptimeNotificationChannel)
				.values({
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "email",
					emailProviderId: provider.emailProviderId,
					recipientAddresses: ["ops@pulsy.test", "oncall@pulsy.test"],
					notifyOnDown: true,
					notifyOnRecovery: true,
				})
				.returning();

			const now = new Date();
			const caller = createCallerFactory(appRouter)({
				db: dbMod.db,
				user: {
					id: testUserId,
					name: "Integration Test",
					email: `it-${testUserId}@pulsy.test`,
					emailVerified: true,
					image: null,
					role: "user",
					banned: false,
					createdAt: now,
					updatedAt: now,
				},
				session: {
					id: `session_${testUserId}`,
					userId: testUserId,
					token: `session_token_${testUserId}`,
					expiresAt: new Date(now.getTime() + 60_000),
					createdAt: now,
					updatedAt: now,
					ipAddress: null,
					userAgent: "vitest",
				},
				t: getTranslator("en"),
				language: "en",
			});

			const calls: Array<{ url: string; init?: RequestInit }> = [];
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(
					async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
						calls.push({ url: String(input), init });
						return new Response("ok", { status: 200 });
					},
				);

			try {
				await expect(
					caller.uptimeMonitor.channel.test({
						channelId: channel!.channelId,
					}),
				).rejects.toThrow(/Email provider is not verified/);
				expect(calls).toHaveLength(0);

				await dbMod.db
					.update(dbMod.uptimeEmailProvider)
					.set({ verified: true })
					.where(
						eq(
							dbMod.uptimeEmailProvider.emailProviderId,
							provider.emailProviderId,
						),
					);

				const result = await caller.uptimeMonitor.channel.test({
					channelId: channel!.channelId,
				});
				expect(result.success).toBe(true);
			} finally {
				fetchSpy.mockRestore();
			}

			expect(calls).toHaveLength(2);
			expect(calls.map((call) => call.url)).toEqual([
				"https://api.resend.com/emails",
				"https://api.resend.com/emails",
			]);
			const recipients = calls.map((call) => {
				const body = JSON.parse(String(call.init?.body ?? "{}"));
				return body.to[0];
			});
			expect(recipients.sort()).toEqual([
				"oncall@pulsy.test",
				"ops@pulsy.test",
			]);
			for (const call of calls) {
				const headers = new Headers(call.init?.headers);
				expect(headers.get("Authorization")).toBe(
					"Bearer channel_test_resend_key",
				);
			}
		});

		it("preserves secrets on non-secret edits and resets verification on credential edits", async () => {
			const { eq } = await import("drizzle-orm");
			const provider = await emailProviderSvc.createEmailProvider(
				{
					name: "Editable Resend Provider",
					providerType: "resend",
					apiKey: "initial_secret_key",
					fromAddress: "alerts@pulsy.test",
					smtpSecure: true,
				},
				testUserId,
			);

			await dbMod.db
				.update(dbMod.uptimeEmailProvider)
				.set({ verified: true })
				.where(
					eq(
						dbMod.uptimeEmailProvider.emailProviderId,
						provider.emailProviderId,
					),
				);

			const rawBefore = await dbMod.db.query.uptimeEmailProvider.findFirst({
				where: eq(
					dbMod.uptimeEmailProvider.emailProviderId,
					provider.emailProviderId,
				),
			});

			await emailProviderSvc.updateEmailProvider(
				{
					emailProviderId: provider.emailProviderId,
					name: "Editable Resend Provider Renamed",
				},
				testUserId,
			);

			const rawAfterNameEdit = await dbMod.db.query.uptimeEmailProvider.findFirst({
				where: eq(
					dbMod.uptimeEmailProvider.emailProviderId,
					provider.emailProviderId,
				),
			});
			expect(rawAfterNameEdit?.apiKey).toBe(rawBefore?.apiKey);
			expect(rawAfterNameEdit?.verified).toBe(true);

			await emailProviderSvc.updateEmailProvider(
				{
					emailProviderId: provider.emailProviderId,
					apiKey: "rotated_secret_key",
				},
				testUserId,
			);

			const rawAfterSecretEdit =
				await dbMod.db.query.uptimeEmailProvider.findFirst({
					where: eq(
						dbMod.uptimeEmailProvider.emailProviderId,
						provider.emailProviderId,
					),
				});
			expect(rawAfterSecretEdit?.apiKey).toBeTruthy();
			expect(rawAfterSecretEdit?.apiKey).not.toBe("rotated_secret_key");
			expect(rawAfterSecretEdit?.apiKey).not.toBe(rawBefore?.apiKey);
			expect(rawAfterSecretEdit?.verified).toBe(false);
		});

		it("formats SendGrid provider requests and validates SMTP transport config", async () => {
			const calls: Array<{ url: string; init?: RequestInit }> = [];
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(
					async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
						calls.push({ url: String(input), init });
						return new Response("", { status: 202 });
					},
				);

			try {
				await emailProviderSvc.sendViaProvider(
					{
						providerType: "sendgrid",
						apiKey: "sendgrid_test_key",
						smtpHost: null,
						smtpPort: null,
						smtpUsername: null,
						smtpPassword: null,
						smtpSecure: true,
						fromAddress: "alerts@pulsy.test",
					},
					"ops@pulsy.test",
					"Pulsy Test",
					"<p>Test</p>",
				);
			} finally {
				fetchSpy.mockRestore();
			}

			expect(calls[0]?.url).toBe("https://api.sendgrid.com/v3/mail/send");
			const headers = new Headers(calls[0]?.init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer sendgrid_test_key");
			const body = JSON.parse(String(calls[0]?.init?.body ?? "{}"));
			expect(body.personalizations[0].to[0].email).toBe("ops@pulsy.test");
			expect(body.from.email).toBe("alerts@pulsy.test");
			expect(body.content[0].value).toBe("<p>Test</p>");

			await expect(
				emailProviderSvc.sendViaProvider(
					{
						providerType: "smtp",
						apiKey: null,
						smtpHost: null,
						smtpPort: 587,
						smtpUsername: "smtp-user",
						smtpPassword: "smtp-pass",
						smtpSecure: false,
						fromAddress: "alerts@pulsy.test",
					},
					"ops@pulsy.test",
					"Pulsy Test",
					"<p>Test</p>",
				),
			).rejects.toThrow(/SMTP host is required/);
		});
	});

	// -----------------------------------------------------------------------
	// (e) Notification dispatch — webhook channel, fetch mocked
	// -----------------------------------------------------------------------
	describe("dispatchNotifications (webhook, mocked fetch)", () => {
		it("POSTs to the webhook channel on a down status change", async () => {
			const monitor = await createIntegrationMonitor(
				{
					name: "Notify Monitor",
					url: "https://example.com/webhook-notify",
					method: "GET",
					expectedStatus: 200,
					timeout: 10_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			// A webhook channel that notifies on "down".
			await dbMod.db.insert(dbMod.uptimeNotificationChannel).values({
				uptimeMonitorId: monitor.uptimeMonitorId,
				userId: testUserId,
				channelType: "webhook",
				webhookUrl: "https://hooks.test.invalid/incoming",
				notifyOnDown: true,
				notifyOnRecovery: true,
			});

			// Monkeypatch global fetch to record the call instead of hitting the net.
			const calls: Array<{ url: string; init?: RequestInit }> = [];
				const fetchSpy = vi
					.spyOn(globalThis, "fetch")
					.mockImplementation(
						async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
							calls.push({ url: String(input), init });
							return new Response("ok", { status: 200 });
						},
				);

			try {
				await notificationSvc.dispatchNotifications(monitor, {
					statusChangeId: "sc_test",
					uptimeMonitorId: monitor.uptimeMonitorId,
					statusBefore: "up",
					statusAfter: "down",
					httpStatus: 503,
					responseTime: 120,
					reason: "Unexpected status: 503",
					createdAt: new Date().toISOString(),
				});
			} finally {
				fetchSpy.mockRestore();
			}

			expect(calls.length).toBe(1);
			expect(calls[0]?.url).toBe("https://hooks.test.invalid/incoming");
			expect(calls[0]?.init?.method).toBe("POST");

			const body = JSON.parse(String(calls[0]?.init?.body ?? "{}"));
			expect(body.event).toBe("monitor.down");
			expect(body.monitor.url).toBe("https://example.com/webhook-notify");
		});

		it("formats Slack, Discord, and Telegram alert payloads", async () => {
			const monitor = await createIntegrationMonitor(
				{
					name: "Provider Matrix Monitor",
					url: "https://example.com/matrix",
					method: "GET",
					expectedStatus: 200,
					timeout: 10_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			await dbMod.db.insert(dbMod.uptimeNotificationChannel).values([
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "slack",
					webhookUrl: "https://hooks.slack.com/services/T/B/token",
					notifyOnDown: true,
					notifyOnRecovery: true,
				},
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "discord",
					webhookUrl: "https://discord.com/api/webhooks/123/token",
					notifyOnDown: true,
					notifyOnRecovery: true,
				},
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "telegram",
					webhookUrl: "123456:abcDEF:987654",
					notifyOnDown: true,
					notifyOnRecovery: true,
				},
			]);

			const calls: Array<{ url: string; init?: RequestInit }> = [];
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(
					async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
						calls.push({ url: String(input), init });
						return new Response("ok", { status: 200 });
					},
				);

			const timestamp = new Date().toISOString();
			try {
				await notificationSvc.dispatchNotifications(monitor, {
					statusChangeId: "sc_matrix_down",
					uptimeMonitorId: monitor.uptimeMonitorId,
					statusBefore: "up",
					statusAfter: "down",
					httpStatus: 503,
					responseTime: 321,
					reason: "Unexpected status: 503",
					createdAt: timestamp,
				});
			} finally {
				fetchSpy.mockRestore();
			}

			expect(calls.map((call) => call.url).sort()).toEqual([
				"https://api.telegram.org/bot123456:abcDEF/sendMessage",
				"https://discord.com/api/webhooks/123/token",
				"https://hooks.slack.com/services/T/B/token",
			]);

			const slack = calls.find((call) => call.url.includes("slack"));
			const slackBody = JSON.parse(String(slack?.init?.body ?? "{}"));
			expect(new Headers(slack?.init?.headers).get("Content-Type")).toBe(
				"application/json",
			);
			expect(JSON.stringify(slackBody)).toContain("Provider Matrix Monitor");
			expect(JSON.stringify(slackBody)).toContain("https://example.com/matrix");
			expect(JSON.stringify(slackBody)).toContain("503");
			expect(JSON.stringify(slackBody)).toContain("321ms");

			const discord = calls.find((call) => call.url.includes("discord"));
			const discordBody = JSON.parse(String(discord?.init?.body ?? "{}"));
			expect(discordBody.embeds[0].color).toBe(0xef4444);
			expect(discordBody.embeds[0].timestamp).toBe(timestamp);
			expect(JSON.stringify(discordBody)).toContain("Provider Matrix Monitor");
			expect(JSON.stringify(discordBody)).toContain("https://example.com/matrix");

			const telegram = calls.find((call) => call.url.includes("telegram"));
			const telegramBody = JSON.parse(String(telegram?.init?.body ?? "{}"));
			expect(telegramBody.chat_id).toBe("987654");
			expect(telegramBody.parse_mode).toBe("HTML");
			expect(telegramBody.text).toContain("Provider Matrix Monitor");
			expect(telegramBody.text).toContain("https://example.com/matrix");
			expect(telegramBody.text).toContain("503");
			expect(telegramBody.text).toContain("321ms");
		});

		it("supports full Telegram API URLs with chat_id and reports failures", async () => {
			const monitor = await createIntegrationMonitor(
				{
					name: "Telegram Direct Monitor",
					url: "https://example.com/telegram",
					method: "GET",
					expectedStatus: 200,
					timeout: 10_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			const [channel] = await dbMod.db
				.insert(dbMod.uptimeNotificationChannel)
				.values({
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "telegram",
					webhookUrl:
						"https://api.telegram.org/bot222:xyz/sendMessage?chat_id=321",
					notifyOnDown: true,
					notifyOnRecovery: true,
				})
				.returning();

			const calls: Array<{ url: string; init?: RequestInit }> = [];
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(
					async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
						calls.push({ url: String(input), init });
						return new Response("bad token", { status: 401 });
					},
				);

			try {
				await expect(
					notificationSvc.sendTelegramNotification(channel!, monitor, {
						statusChangeId: "sc_telegram_direct",
						uptimeMonitorId: monitor.uptimeMonitorId,
						statusBefore: "up",
						statusAfter: "down",
						httpStatus: 500,
						responseTime: 88,
						reason: "Unexpected status: 500",
						createdAt: new Date().toISOString(),
					}),
				).rejects.toThrow(/Telegram API returned 401/);
			} finally {
				fetchSpy.mockRestore();
			}

			expect(calls[0]?.url).toBe(
				"https://api.telegram.org/bot222:xyz/sendMessage",
			);
			const body = JSON.parse(String(calls[0]?.init?.body ?? "{}"));
			expect(body.chat_id).toBe("321");
		});

		it("continues dispatching when one channel fails", async () => {
			const monitor = await createIntegrationMonitor(
				{
					name: "Failure Isolation Monitor",
					url: "https://example.com/isolation",
					method: "GET",
					expectedStatus: 200,
					timeout: 10_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			await dbMod.db.insert(dbMod.uptimeNotificationChannel).values([
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "webhook",
					webhookUrl: "https://capture.test/ok-1",
					notifyOnDown: true,
					notifyOnRecovery: false,
				},
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "webhook",
					webhookUrl: "https://capture.test/fail",
					notifyOnDown: true,
					notifyOnRecovery: false,
				},
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "webhook",
					webhookUrl: "https://capture.test/ok-2",
					notifyOnDown: true,
					notifyOnRecovery: false,
				},
			]);

			const calls: string[] = [];
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
					const url = String(input);
					calls.push(url);
					if (url.endsWith("/fail")) {
						return new Response("failure", { status: 500 });
					}
					return new Response("ok", { status: 200 });
				});

			try {
				await notificationSvc.dispatchNotifications(
					monitor,
					{
						statusChangeId: "sc_isolation",
						uptimeMonitorId: monitor.uptimeMonitorId,
						statusBefore: "up",
						statusAfter: "down",
						httpStatus: 503,
						responseTime: 120,
						reason: "Unexpected status: 503",
						createdAt: new Date().toISOString(),
					},
					// No-retry: this test asserts fan-out isolation, not the retry
					// backoff (the /fail 500 is transient and would otherwise wait).
					{ delaysMs: [] },
				);
			} finally {
				fetchSpy.mockRestore();
				consoleSpy.mockRestore();
			}

			expect(calls.sort()).toEqual([
				"https://capture.test/fail",
				"https://capture.test/ok-1",
				"https://capture.test/ok-2",
			]);
		});

		it("respects down, recovery, and TLS expiry notification flags", async () => {
			const monitor = await createIntegrationMonitor(
				{
					name: "Event Flags Monitor",
					url: "https://example.com/events",
					method: "GET",
					expectedStatus: 200,
					timeout: 10_000,
					interval: 300,
					failureThreshold: 3,
					active: true,
					tags: [],
				},
				testUserId,
			);
			createdMonitorIds.push(monitor.uptimeMonitorId);

			await dbMod.db.insert(dbMod.uptimeNotificationChannel).values([
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "webhook",
					webhookUrl: "https://events.test/down-only",
					notifyOnDown: true,
					notifyOnRecovery: false,
					notifyOnTlsExpiry: false,
				},
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "webhook",
					webhookUrl: "https://events.test/recovery-only",
					notifyOnDown: false,
					notifyOnRecovery: true,
					notifyOnTlsExpiry: false,
				},
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "webhook",
					webhookUrl: "https://events.test/tls-hit",
					notifyOnDown: false,
					notifyOnRecovery: false,
					notifyOnTlsExpiry: true,
					tlsExpiryThresholdDays: 14,
				},
				{
					uptimeMonitorId: monitor.uptimeMonitorId,
					userId: testUserId,
					channelType: "webhook",
					webhookUrl: "https://events.test/tls-miss",
					notifyOnDown: false,
					notifyOnRecovery: false,
					notifyOnTlsExpiry: true,
					tlsExpiryThresholdDays: 1,
				},
			]);

			const calls: string[] = [];
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
					calls.push(String(input));
					return new Response("ok", { status: 200 });
				});

			try {
				await notificationSvc.dispatchNotifications(monitor, {
					statusChangeId: "sc_down_flags",
					uptimeMonitorId: monitor.uptimeMonitorId,
					statusBefore: "up",
					statusAfter: "down",
					httpStatus: 503,
					responseTime: 120,
					reason: "Unexpected status: 503",
					createdAt: new Date().toISOString(),
				});
				await notificationSvc.dispatchNotifications(monitor, {
					statusChangeId: "sc_recovery_flags",
					uptimeMonitorId: monitor.uptimeMonitorId,
					statusBefore: "down",
					statusAfter: "up",
					httpStatus: 200,
					responseTime: 80,
					reason: null,
					createdAt: new Date().toISOString(),
				});
				await notificationSvc.dispatchTlsExpiryNotifications(monitor, {
					valid: true,
					expiresAt: "2026-06-10T00:00:00.000Z",
					expiresInDays: 3,
					issuer: "Pulsy Test CA",
				});
			} finally {
				fetchSpy.mockRestore();
			}

			expect(calls).toEqual([
				"https://events.test/down-only",
				"https://events.test/recovery-only",
				"https://events.test/tls-hit",
			]);
		});
	});
});
