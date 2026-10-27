import { FormField } from "@/components/ui/form-field";
import { Helmet } from "@dr.pogodin/react-helmet";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authFailureKey } from "@/lib/auth-failure";

export const Route = createFileRoute("/forgot-password")({
	component: ForgotPasswordPage,
});

export function ForgotPasswordPage() {
	const { t } = useTranslation(["auth", "common"]);
	const [email, setEmail] = useState("");
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
			const { error } = await authClient.requestPasswordReset({
				email,
				redirectTo: "/reset-password",
			});
			if (error) { setFormError(t(authFailureKey(error, "auth:forgot.error"))); return; }
      toast.success(t("auth:forgot.success"));
		} catch {
			setFormError(t("auth:forgot.error"));
		} finally {
			sending.current = false;
      setSubmitting(false);
		}
	};

	return (
		<main className="flex min-h-[calc(100dvh-45px)] flex-col bg-background px-4 py-8">
      <Helmet><title>{t("auth:forgot.title")} | Pulsy</title></Helmet>
			<Card className="mx-auto my-auto w-full max-w-[var(--auth-width)]">
				<CardHeader className="space-y-2 text-center">
					<div className="mx-auto inline-flex min-h-11 items-center gap-2 text-primary"><Activity aria-hidden="true" className="size-6" /><span className="font-semibold">Pulsy</span></div>
					<h1 className="text-xl font-semibold tracking-tight">{t("auth:forgot.title")}</h1>
					<CardDescription>{t("auth:forgot.description")}</CardDescription>
				</CardHeader>
				<CardContent>
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
						<Button
							type="submit"
							className="h-[44px] w-full"
							disabled={submitting}
						>
							{submitting && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
							{submitting
								? t("auth:forgot.submitting")
								: t("auth:forgot.submit")}
						</Button>
					</form>
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
