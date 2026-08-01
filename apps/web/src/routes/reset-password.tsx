import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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

	// The reset link redirects here with the token in the query. A missing or
	// invalid token means the link expired or was already used.
	const invalidLink = !token || Boolean(error);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!token) return;
		if (password !== confirm) {
			toast.error(t("auth:reset.mismatch"));
			return;
		}
		setSubmitting(true);
		try {
			const { error: resetError } = await authClient.resetPassword({
				newPassword: password,
				token,
			});
			if (resetError) {
				toast.error(resetError.message ?? t("auth:reset.error"));
				return;
			}
			toast.success(t("auth:reset.success"));
			navigate({ to: "/login" });
		} catch (err) {
			toast.error(extractErrorMessage(err, t("auth:reset.error")));
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
					<CardTitle className="text-xl">{t("auth:reset.title")}</CardTitle>
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
						<form onSubmit={handleSubmit} className="flex flex-col gap-4">
							<div className="grid gap-2">
								<Label htmlFor="password">{t("auth:reset.newPassword")}</Label>
								<Input
									id="password"
									type="password"
									autoComplete="new-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder={t("auth:fields.passwordPlaceholder")}
									required
									minLength={8}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="confirm">
									{t("auth:reset.confirmPassword")}
								</Label>
								<Input
									id="confirm"
									type="password"
									autoComplete="new-password"
									value={confirm}
									onChange={(e) => setConfirm(e.target.value)}
									placeholder={t("auth:fields.passwordPlaceholder")}
									required
									minLength={8}
								/>
							</div>
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
