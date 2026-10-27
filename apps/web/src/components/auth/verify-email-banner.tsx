/**
 * Verify-email banner.
 *
 * Shown across the app when email verification is required (server policy) and
 * the signed-in user has not yet confirmed their email. This nudges them to
 * verify and offers to resend the verification email without limiting features.
 *
 * @module components/auth/verify-email-banner
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { MailWarning } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { authClient, useSession } from "@/lib/auth-client";
import { useConfig } from "@/hooks/useConfig";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";

export function VerifyEmailBanner() {
	const { t } = useTranslation(["auth", "common"]);
	const { data: session } = useSession();
	const { data: config } = useConfig();
	const [sending, setSending] = useState(false);

	const email = session?.user.email;
	const emailVerified = session?.user.emailVerified ?? true;
	const requireVerification = config?.requireEmailVerification ?? false;

	const handleResend = useCallback(async () => {
		// defensive: the banner renders null when `email` is falsy, so the resend
		// button (and thus this guard) is unreachable from the UI.
		/* v8 ignore next */
		if (!email) return;
		setSending(true);
		try {
			const { error } = await authClient.sendVerificationEmail({
				email,
				callbackURL: "/dashboard",
			});
			if (error) {
				toast.error(error.message ?? t("auth:verifyBanner.resendError"));
				return;
			}
			toast.success(t("auth:verifyBanner.resendSuccess"));
		} catch (err) {
			toast.error(extractErrorMessage(err, t("auth:verifyBanner.resendError")));
		} finally {
			setSending(false);
		}
	}, [email, t]);

	// Only nag when the server requires verification and this user is unverified.
	if (!requireVerification || emailVerified || !email) return null;

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex items-start gap-3 sm:items-center">
				<MailWarning className="h-5 w-5 text-primary shrink-0 mt-0.5 sm:mt-0" />
				<div>
					<p className="text-sm font-medium">{t("auth:verifyBanner.title")}</p>
					<p className="text-sm text-muted-foreground">
						{t("auth:verifyBanner.description")}
					</p>
				</div>
			</div>
			<div className="flex items-center gap-2 shrink-0">
				<Button
					size="sm"
					onClick={handleResend}
					disabled={sending}
					className="h-[44px] min-w-[44px]"
				>
					{sending
						? t("auth:verifyBanner.resending")
						: t("auth:verifyBanner.resend")}
				</Button>
			</div>
		</div>
	);
}
