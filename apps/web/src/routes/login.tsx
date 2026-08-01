import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Activity, Loader2 } from "lucide-react";
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

export const Route = createFileRoute("/login")({
	component: LoginPage,
	// `share` carries a token through the auth flow — only the token, never a
	// redirect path. The destination is always the literal route (/share/$token),
	// so there is no open-redirect surface.
	validateSearch: (search: Record<string, unknown>): { share?: string } => {
		const share = typeof search.share === "string" ? search.share.trim() : "";
		return share && share.length <= 128 ? { share } : {};
	},
});

function LoginPage() {
	const { t } = useTranslation(["auth", "common"]);
	const navigate = useNavigate();
	const { share } = Route.useSearch();
	const carriedSearch = share ? { share } : {};
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		try {
			const { error } = await authClient.signIn.email({ email, password });
			if (error) {
				toast.error(error.message ?? t("auth:login.error"));
				return;
			}
			if (share) {
				navigate({ to: "/share/$token", params: { token: share } });
			} else {
				// `signIn.email` returns no session, so fetch it to route superadmins
				// straight to the operator panel instead of the regular dashboard.
				const { data: session } = await authClient.getSession();
				if (session?.user?.role === "superadmin") {
					navigate({ to: "/superadmin", search: { section: "overview" } });
				} else {
					navigate({ to: "/dashboard" });
				}
			}
		} catch (err) {
			toast.error(extractErrorMessage(err, t("auth:login.error")));
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
					<CardTitle className="text-xl">{t("auth:login.title")}</CardTitle>
					<CardDescription>{t("auth:login.description")}</CardDescription>
					{import.meta.env.VITE_DEMO_NOTICE ? (
						<p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
							{import.meta.env.VITE_DEMO_NOTICE}
						</p>
					) : null}
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
						<div className="grid gap-2">
							<div className="flex items-center justify-between">
								<Label htmlFor="password">{t("auth:fields.password")}</Label>
								<Link
									to="/forgot-password"
									className="text-xs text-muted-foreground hover:text-foreground"
								>
									{t("auth:login.forgotPassword")}
								</Link>
							</div>
							<Input
								id="password"
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={t("auth:fields.passwordPlaceholder")}
								required
							/>
						</div>
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
		</div>
	);
}
