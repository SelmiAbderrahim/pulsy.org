import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Resend SDK so no real email is sent. `sendMock` is the stand-in for
// `new Resend(key).emails.send(...)`.
const { sendMock, resendCtor } = vi.hoisted(() => ({
	sendMock: vi.fn(),
	resendCtor: vi.fn(),
}));

// vitest 4: a mock invoked with `new` needs a constructible implementation —
// arrow functions throw "is not a constructor". Use function expressions.
vi.mock("resend", () => ({
	Resend: resendCtor.mockImplementation(function () {
		return { emails: { send: sendMock } };
	}),
}));

beforeEach(() => {
	vi.resetModules();
	sendMock.mockReset();
	// Re-apply the constructor implementation each run (afterEach restores mocks).
	resendCtor.mockReset();
	resendCtor.mockImplementation(function () {
		return { emails: { send: sendMock } };
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

const email = {
	to: "user@example.com",
	subject: "Verify your Pulsy email",
	html: "<p>hi</p>",
};

describe("sendAuthEmail", () => {
	it("logs instead of sending when RESEND_API_KEY is unset", async () => {
		vi.stubEnv("RESEND_API_KEY", undefined);
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const { sendAuthEmail } = await import("./email");

		await sendAuthEmail(email);

		expect(sendMock).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledTimes(2);
		expect(info.mock.calls[0]?.[0]).toContain("RESEND_API_KEY unset");
	});

	it("sends via Resend using the default from-address", async () => {
		vi.stubEnv("RESEND_API_KEY", "re_test");
		vi.stubEnv("EMAIL_FROM", undefined);
		sendMock.mockResolvedValue({ error: null });
		const { sendAuthEmail } = await import("./email");

		await sendAuthEmail(email);

		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(sendMock.mock.calls[0]?.[0]).toMatchObject({
			from: "Pulsy <noreply@pulsy.org>",
			to: email.to,
			subject: email.subject,
		});
	});

	it("honours the EMAIL_FROM override and caches the client", async () => {
		vi.stubEnv("RESEND_API_KEY", "re_test");
		vi.stubEnv("EMAIL_FROM", "Alerts <alerts@pulsy.test>");
		sendMock.mockResolvedValue({ error: null });
		const { sendAuthEmail } = await import("./email");

		await sendAuthEmail(email);
		await sendAuthEmail(email);

		expect(sendMock).toHaveBeenCalledTimes(2);
		expect(sendMock.mock.calls[0]?.[0]).toMatchObject({
			from: "Alerts <alerts@pulsy.test>",
		});
		// Client is created once and reused across calls.
		expect(resendCtor).toHaveBeenCalledTimes(1);
	});

	it("throws when the provider returns an error", async () => {
		vi.stubEnv("RESEND_API_KEY", "re_test");
		sendMock.mockResolvedValue({ error: { message: "rate limited" } });
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const { sendAuthEmail } = await import("./email");

		await expect(sendAuthEmail(email)).rejects.toThrow("Failed to send auth email");
		expect(err).toHaveBeenCalled();
		expect(JSON.stringify(err.mock.calls)).not.toContain("rate limited");
	});
});
