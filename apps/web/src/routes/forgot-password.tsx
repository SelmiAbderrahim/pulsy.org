import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";

export const Route = createFileRoute("/forgot-password")({
	component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
	const { t } = useTranslation(["auth", "common"]);
	const [email, setEmail] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		try {
			await authClient.requestPasswordReset({
				email,
				redirectTo: "/reset-password",
			});
			toast.success(t("auth:forgot.success"));
		} catch (err) {
			toast.error(extractErrorMessage(err, t("auth:forgot.error")));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex min-h-[calc(100dvh-45px)] items-center justify-center bg-muted/30 p-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="space-y-2 text-center">
					<div className="flex justify-center">
						<Activity className="h-8 w-8 text-primary" />
					</div>
					<CardTitle className="text-xl">{t("auth:forgot.title")}</CardTitle>
					<CardDescription>{t("auth:forgot.description")}</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<div className="grid gap-2">
							<Label htmlFor="email">{t("auth:fields.email")}</Label>
							<Input
								id="email"
								type="email"
								autoComplete="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder={t("auth:fields.emailPlaceholder")}
								required
							/>
						</div>
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
							className="inline-flex items-center text-muted-foreground hover:text-foreground"
						>
							<ArrowLeft className="h-4 w-4 me-1 rtl:scale-x-[-1]" />
							{t("auth:forgot.backToLogin")}
						</Link>
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
