import { FormField } from "@/components/ui/form-field";
import { Helmet } from "@dr.pogodin/react-helmet";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Activity, ArrowLeft, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
} from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authFailureKey } from "@/lib/auth-failure";

export interface ResetPasswordSearch {
	token?: string;
	error?: string;
}

export const Route = createFileRoute("/reset-password")({
	component: ResetPasswordPage,
	validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
		token: typeof search.token === "string" ? search.token : undefined,
		error: typeof search.error === "string" ? search.error : undefined,
	}),
});

function ResetPasswordPage() {
	const { t } = useTranslation(["auth", "common"]);
	const navigate = useNavigate();
	const { token, error } = Route.useSearch();
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [submitting, setSubmitting] = useState(false);
  const sending = useRef(false);
  const [formError, setFormError] = useState("");
  const [linkFailed, setLinkFailed] = useState(false);

	// The reset link redirects here with the token in the query. A missing or
	// invalid token means the link expired or was already used.
	const invalidLink = !token || Boolean(error);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
    if (sending.current) return;
    setFormError("");
		if (!token) return;
		if (password !== confirm) {
			setFormError(t("auth:reset.mismatch"));
      document.getElementById("confirm")?.focus();
			return;
		}
		sending.current = true;
    setSubmitting(true);
		try {
			const { error: resetError } = await authClient.resetPassword({
				newPassword: password,
				token,
			});
			if (resetError) {
				const rateLimited = authFailureKey(resetError, "") !== "";
				setFormError(t(authFailureKey(resetError, "auth:reset.error")));
				setLinkFailed(!rateLimited);
				return;
			}
			toast.success(t("auth:reset.success"));
			navigate({ to: "/login" });
		} catch {
			setFormError(t("auth:reset.error"));
		} finally {
			sending.current = false;
      setSubmitting(false);
		}
	};

	return (
		<main className="flex min-h-[calc(100dvh-45px)] flex-col bg-background px-4 py-8">
			<Helmet><title>{t("auth:reset.title")} | Pulsy</title></Helmet>
      <Card className="mx-auto my-auto w-full max-w-[var(--auth-width)]">
				<CardHeader className="space-y-2 text-center">
					<div className="mx-auto inline-flex min-h-11 items-center gap-2 text-primary"><Activity aria-hidden="true" className="size-6" /><span className="font-semibold">Pulsy</span></div>
					<h1 className="text-xl font-semibold">{t("auth:reset.title")}</h1>
					<CardDescription>
						{invalidLink
							? t("auth:reset.invalidLink")
							: t("auth:reset.description")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{invalidLink ? (
						<Button asChild className="h-[44px] w-full">
							<Link to="/forgot-password">
								{t("auth:reset.requestNewLink")}
							</Link>
						</Button>
					) : (
						<form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            {linkFailed && <Link to="/forgot-password" className="inline-flex min-h-11 items-center text-sm text-primary underline">{t("auth:reset.requestNewLink")}</Link>}
							<FormField className="form-field">
								<Label htmlFor="password">{t("auth:reset.newPassword")}</Label>
								<PasswordInput
									id="password" name="password"

									autoComplete="new-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder={t("auth:fields.passwordPlaceholder")}
									required
									minLength={8}
                  aria-describedby="password-requirements"
								/>
							</FormField>
							<FormField className="form-field">
								<Label htmlFor="confirm">
									{t("auth:reset.confirmPassword")}
								</Label>
								<PasswordInput
									id="confirm" name="confirmPassword"

									autoComplete="new-password"
									value={confirm}
									onChange={(e) => setConfirm(e.target.value)}
									placeholder={t("auth:fields.passwordPlaceholder")}
									required
									minLength={8}
                  aria-describedby="password-requirements"
								/>
							</FormField>
              <p id="password-requirements" className="text-sm text-muted-foreground">{t("auth:ux.passwordRequirements")}</p>
							<Button
								type="submit"
								className="h-[44px] w-full"
								disabled={submitting}
							>
								{submitting && (
									<Loader2 className="h-4 w-4 me-2 animate-spin" />
								)}
								{submitting
									? t("auth:reset.submitting")
									: t("auth:reset.submit")}
							</Button>
						</form>
					)}
					<p className="mt-4 text-center text-sm">
						<Link
							to="/login"
							className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground"
						>
							<ArrowLeft className="h-4 w-4 me-1 rtl:scale-x-[-1]" />
							{t("auth:forgot.backToLogin")}
						</Link>
					</p>
				</CardContent>
			</Card>
		</main>
	);
}
