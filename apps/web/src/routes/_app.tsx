import {
	createFileRoute,
	Link,
	Navigate,
	Outlet,
	useNavigate,
} from "@tanstack/react-router";
import {
	Activity,
	BookOpen,
	Globe,
	KeyRound,
	Loader2,
	LogOut,
	Menu,
	Search,
	ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { GlobalSearchDialog } from "@/components/uptime/global-search-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient, useSession } from "@/lib/auth-client";
import { VerifyEmailBanner } from "@/components/auth/verify-email-banner";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n";

export const Route = createFileRoute("/_app")({
	component: AppLayout,
});

function AppLayout() {
	const { data: session, isPending } = useSession();
	const { t, i18n } = useTranslation("common");
	const navigate = useNavigate();
	const [searchOpen, setSearchOpen] = useState(false);

	// Global ⌘K / Ctrl+K shortcut to open the command palette.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setSearchOpen((prev) => !prev);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	if (isPending) {
		return (
			<div className="flex min-h-[calc(100dvh-45px)] items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!session) {
		return <Navigate to="/login" replace />;
	}

	const handleSignOut = async () => {
		await authClient.signOut();
		navigate({ to: "/login" });
	};

	const changeLanguage = (lng: SupportedLanguage) => {
		void i18n.changeLanguage(lng);
	};

	return (
		<div className="flex min-h-[calc(100dvh-45px)] flex-col bg-background">
			<header className="border-b bg-background">
				<div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
					<Link
						to="/dashboard"
						className="flex min-h-[44px] items-center gap-2"
					>
						<Activity className="h-5 w-5 text-primary" />
						<span className="text-base font-semibold">
							{t("app.name", "Pulsy")}
						</span>
					</Link>

					{/* Desktop nav: full inline navigation at md and up. */}
					<nav className="hidden items-center gap-1 md:flex">
						<Button variant="ghost" size="sm" asChild className="h-[44px]">
							<Link to="/dashboard">{t("nav.dashboard", "Dashboard")}</Link>
						</Button>

						<Button variant="ghost" size="sm" asChild className="h-[44px]">
							<Link to="/dashboard/api-keys">
								<KeyRound className="h-4 w-4 me-2" />
								{t("nav.apiKeys", "API Keys")}
							</Link>
						</Button>

						<Button variant="ghost" size="sm" asChild className="h-[44px]">
							<Link to="/dashboard/api-docs">
								<BookOpen className="h-4 w-4 me-2" />
								{t("nav.apiDocs", "API Docs")}
							</Link>
						</Button>

						{session.user?.role === "superadmin" && (
							<Button variant="ghost" size="sm" asChild className="h-[44px]">
								<Link to="/superadmin" search={{ section: "overview" }}>
									<ShieldAlert className="h-4 w-4 me-2" />
									{t("nav.admin", "Admin")}
								</Link>
							</Button>
						)}

						<Button
							variant="ghost"
							size="sm"
							onClick={() => setSearchOpen(true)}
							className="h-[44px] gap-2"
							aria-label={t("nav.search", "Search")}
						>
							<Search className="h-4 w-4" />
							<kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
								⌘K
							</kbd>
						</Button>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-[44px] w-[44px]"
									aria-label={t("nav.language", "Language")}
								>
									<Globe className="h-4 w-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{SUPPORTED_LANGUAGES.map((lng) => (
									<DropdownMenuItem
										key={lng}
										onClick={() => changeLanguage(lng)}
									>
										{t(`languages.${lng}`, lng)}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>

						<ThemeToggle />

						<Button
							variant="ghost"
							size="sm"
							onClick={handleSignOut}
							className="h-[44px] min-w-[44px]"
						>
							<LogOut className="h-4 w-4 me-2 rtl:scale-x-[-1]" />
							{t("nav.signOut", "Sign out")}
						</Button>
					</nav>

					{/* Mobile nav: search + theme inline, everything else in one menu. */}
					<div className="flex items-center gap-1 md:hidden">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setSearchOpen(true)}
							className="h-[44px] w-[44px]"
							aria-label={t("nav.search", "Search")}
						>
							<Search className="h-4 w-4" />
						</Button>

						<ThemeToggle />

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-[44px] w-[44px]"
									aria-label={t("nav.openMenu", "Open menu")}
								>
									<Menu className="h-5 w-5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56">
								<DropdownMenuItem asChild>
									<Link to="/dashboard">
										<Activity className="h-4 w-4 me-2" />
										{t("nav.dashboard", "Dashboard")}
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild>
									<Link to="/dashboard/api-keys">
										<KeyRound className="h-4 w-4 me-2" />
										{t("nav.apiKeys", "API Keys")}
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild>
									<Link to="/dashboard/api-docs">
										<BookOpen className="h-4 w-4 me-2" />
										{t("nav.apiDocs", "API Docs")}
									</Link>
								</DropdownMenuItem>

								{session.user?.role === "superadmin" && (
									<DropdownMenuItem asChild>
										<Link to="/superadmin" search={{ section: "overview" }}>
											<ShieldAlert className="h-4 w-4 me-2" />
											{t("nav.admin", "Admin")}
										</Link>
									</DropdownMenuItem>
								)}

								<DropdownMenuSeparator />

								<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
									{t("nav.language", "Language")}
								</div>
								{SUPPORTED_LANGUAGES.map((lng) => (
									<DropdownMenuItem
										key={lng}
										onClick={() => changeLanguage(lng)}
									>
										<Globe className="h-4 w-4 me-2" />
										{t(`languages.${lng}`, lng)}
									</DropdownMenuItem>
								))}

								<DropdownMenuSeparator />

								<DropdownMenuItem onClick={handleSignOut}>
									<LogOut className="h-4 w-4 me-2 rtl:scale-x-[-1]" />
									{t("nav.signOut", "Sign out")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
				<div className="flex flex-col gap-6">
					<VerifyEmailBanner />
					<Outlet />
				</div>
			</main>

			<GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
		</div>
	);
}
