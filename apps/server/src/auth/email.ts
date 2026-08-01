import { Resend } from "resend";
import { safeErrorSummary } from "../lib/safe-error";

// ---------------------------------------------------------------------------
// Minimal email sender used by better-auth (verification + password reset).
//
// When RESEND_API_KEY is unset (the dev default), emails are logged to the
// console instead of being sent. This keeps local development friction-free.
// ---------------------------------------------------------------------------

let resendClient: Resend | null = null;

function getResend(): Resend | null {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) return null;
	if (!resendClient) {
		resendClient = new Resend(apiKey);
	}
	return resendClient;
}

export interface AuthEmail {
	to: string;
	subject: string;
	html: string;
}

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
	const resend = getResend();
	const from = process.env.EMAIL_FROM ?? "Pulsy <noreply@pulsy.org>";

	if (!resend) {
		console.info(
			"[auth][email] RESEND_API_KEY unset — would send an auth email",
		);
		console.info(
			"[auth][email] body omitted because it can contain verification or reset tokens",
		);
		return;
	}

	const { error } = await resend.emails.send({
		from,
		to: email.to,
		subject: email.subject,
		html: email.html,
	});

	if (error) {
		console.error(
			`[auth][email] Failed to send auth email: ${safeErrorSummary(error)}`,
		);
		throw new Error("Failed to send auth email");
	}
}
