import { FormField } from "@/components/ui/form-field";
import { safeAuthReturn } from "@/lib/auth-return";
import { Helmet } from "@dr.pogodin/react-helmet";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Activity, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";
import { authFailureKey } from "@/lib/auth-failure";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { share?: string; returnTo?: string; reason?: "session"; verificationError?: boolean } => {
    const share = typeof search.share === "string" ? search.share.trim() : "";
    return {
      ...(share && share.length <= 128 ? { share } : {}),
      ...(safeAuthReturn(search.returnTo) ? { returnTo: safeAuthReturn(search.returnTo) } : {}),
      ...(search.reason === "session" ? { reason: "session" as const } : {}),
      ...(["TOKEN_EXPIRED", "INVALID_TOKEN"].includes(typeof search.error === "string" ? search.error.toUpperCase() : "") ? { verificationError: true } : {}),
    };
  },
});

function LoginPage() {
	const { t } = useTranslation(["auth", "common"]);
	const navigate = useNavigate();
  const { data: observedSession, error: sessionError } = useSession();
  const session = sessionError?.status === 401 || sessionError?.status === 403 ? null : observedSession;
  const { share, returnTo, reason, verificationError } = Route.useSearch();
  const carriedSearch = { ...(share ? { share } : {}), ...(returnTo ? { returnTo } : {}) };
  useEffect(() => {
    if (!session?.user) return;
    if (share) void navigate({ to: "/share/$token", params: { token: share }, replace: true });
    else if (returnTo) void navigate({ href: returnTo, replace: true });
    else void navigate({ to: "/dashboard", replace: true });
  }, [navigate, returnTo, session?.user, share]);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
  const sending = useRef(false);
  const [formError, setFormError] = useState("");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
    if (sending.current) return;
    setFormError("");
		sending.current = true;
    setSubmitting(true);
		try {
			const { error } = await authClient.signIn.email({ email, password });
			if (error) {
				setFormError(t(authFailureKey(error, "auth:login.error")));
				return;
			}
      if (share) {
        await navigate({ to: "/share/$token", params: { token: share } });
      } else if (returnTo) {
        await navigate({ href: returnTo });
      } else {
        const { data: signedIn } = await authClient.getSession();
        if (signedIn?.user?.role === "superadmin") await navigate({ to: "/superadmin", search: { section: "overview" } });
        else await navigate({ to: "/dashboard" });
      }
		} catch {
			setFormError(t("auth:login.error"));
		} finally {
			sending.current = false;
      setSubmitting(false);
		}
	};

	return (
		<main className="grid min-h-[calc(100dvh-45px)] place-items-center bg-background px-4 py-8">
			<Helmet><title>{t("auth:login.title")} | Pulsy</title></Helmet>
			<Card className="mx-auto my-auto w-full max-w-[var(--auth-width)]">
				<CardHeader className="space-y-2 text-center">
					<div className="mx-auto inline-flex min-h-11 items-center gap-2 text-primary"><Activity aria-hidden="true" className="size-6" /><span className="font-semibold">Pulsy</span></div>
					<h1 className="text-xl font-semibold tracking-tight">{t("auth:login.title")}</h1>
					<CardDescription>{t("auth:login.description")}</CardDescription>
          {import.meta.env.VITE_DEMO_NOTICE && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{import.meta.env.VITE_DEMO_NOTICE}</p>}
				</CardHeader>
				<CardContent>
					{verificationError && <p role="alert" className="mb-4 text-sm text-destructive">{t("auth:login.verificationError")}</p>}
          {reason === "session" && <p role="status" className="mb-4 text-sm text-muted-foreground">{t("common:session.signInAgain")}</p>}
					<form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
						<FormField className="form-field">
							<Label htmlFor="email">{t("auth:fields.email")}</Label>
							<Input
								id="email" name="email" dir="ltr" validateOnBlur
								type="email"
								autoComplete="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder={t("auth:fields.emailPlaceholder")}
								required
							/>
						</FormField>
						<FormField className="form-field">
							<div className="flex items-center justify-between">
								<Label htmlFor="password">{t("auth:fields.password")}</Label>
								<Link
									to="/forgot-password"
									className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground"
								>
									{t("auth:login.forgotPassword")}
								</Link>
							</div>
							<PasswordInput
								id="password" name="password"

								autoComplete="current-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={t("auth:fields.passwordPlaceholder")}
								required
							/>
						</FormField>
						<Button
							type="submit"
							className="h-[44px] w-full"
							disabled={submitting}
						>
							{submitting && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
							{submitting ? t("auth:login.submitting") : t("auth:login.submit")}
						</Button>
					</form>
					<p className="mt-4 text-center text-sm text-muted-foreground">
						{t("auth:login.noAccount")}{" "}
						<Link
							to="/signup"
							search={carriedSearch}
							className="text-primary hover:underline"
						>
							{t("auth:login.signUpLink")}
						</Link>
					</p>
				</CardContent>
			</Card>
		</main>
	);
}
