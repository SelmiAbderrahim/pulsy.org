/**
 * /superadmin — the platform operator panel. Guarded to `role === "superadmin"`
 * (the server's adminProcedure is the real gate; this is the UX guard). The
 * active section persists in the URL `?section=` query param.
 *
 * @module routes/_app/superadmin
 */

import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AdminStats } from "@/components/admin/admin-stats";
import { AdminUsers } from "@/components/admin/admin-users";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const SECTIONS = ["overview", "users"] as const;
type Section = (typeof SECTIONS)[number];

export const Route = createFileRoute("/_app/superadmin")({
	component: SuperadminPage,
	validateSearch: (search: Record<string, unknown>) => ({
		section: (SECTIONS as readonly string[]).includes(search.section as string)
			? (search.section as Section)
			: ("overview" as Section),
	}),
});

function SuperadminPage() {
	const { t } = useTranslation("admin");
	const { data: session, isPending } = useSession();
	const { section } = Route.useSearch();
	const navigate = useNavigate();

	if (isPending) {
		return (
			<div className="flex min-h-[40vh] items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (session?.user?.role !== "superadmin") {
		return <Navigate to="/dashboard" replace />;
	}

	const setSection = (next: Section) => {
		void navigate({ to: "/superadmin", search: { section: next }, replace: true });
	};

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="text-2xl font-semibold">{t("title")}</h1>
				<p className="text-sm text-muted-foreground">{t("subtitle")}</p>
			</div>

			<nav className="flex flex-wrap gap-1 border-b">
				{SECTIONS.map((s) => (
					<Button
						key={s}
						variant="ghost"
						size="sm"
						onClick={() => setSection(s)}
						className={cn(
							"h-[44px] rounded-none border-b-2 border-transparent",
							section === s && "border-primary text-foreground",
						)}
					>
						{t(`nav.${s}`)}
					</Button>
				))}
			</nav>

			{section === "overview" && <AdminStats />}
			{section === "users" && <AdminUsers />}
		</div>
	);
}
