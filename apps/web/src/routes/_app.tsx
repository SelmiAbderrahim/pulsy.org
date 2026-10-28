import { useDirtyNavigation } from "@/hooks/use-dirty-navigation";
import { hasRegisteredDraft, discardRegisteredDrafts } from "@/lib/draft-guards";
import { NavItem } from "@/components/ui/nav-item";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PreferencesDialog } from "@/components/preferences-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { AppNotFound } from "@/components/page-not-found";
import { useQueryClient } from "@tanstack/react-query";
import { changeSessionLanguage } from "@/lib/session-language";
import { isSessionClientActive } from "@/lib/session-query-client";
import { AccountTimezoneProvider } from "@/components/account-timezone";
import { flushSync } from "react-dom";
import {
	createFileRoute,
	Link,
	Outlet,
	useNavigate,
	useLocation,
} from "@tanstack/react-router";
import {
	Activity, UserRound, Settings, ChevronUp,
	BookOpen,
	Globe,
	KeyRound,
	Loader2,
	LogOut,
	Menu,
	Search,
	ShieldAlert,
	Bell,
	FileInput,
	Layers,
	TriangleAlert,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { useEffect, useRef, useState } from "react";
import { focusNavigationStart } from "@/lib/focus-navigation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { safeAuthReturn } from "@/lib/auth-return";
import { useTranslation } from "react-i18next";

import { GlobalSearchDialog } from "@/components/uptime/global-search-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient, useSession } from "@/lib/auth-client";
import { VerifyEmailBanner } from "@/components/auth/verify-email-banner";
import { type SupportedLanguage } from "@/i18n";

export const Route = createFileRoute("/_app")({
	component: AppLayout,
  notFoundComponent: AppNotFound,
});

function AppLayout() {
  const client = useQueryClient();
  const draftNavigation = useDirtyNavigation(hasRegisteredDraft, discardRegisteredDrafts);
	const { data: observedSession, isPending, error, refetch } = useSession();
  const lastSession = useRef(observedSession);
  const terminalSessionError = error?.status === 401 || error?.status === 403;
  if (observedSession && !terminalSessionError) lastSession.current = observedSession;
  const transientSessionError = error && error.status !== 401 && error.status !== 403;
  const session = terminalSessionError ? null : observedSession ?? (isPending || transientSessionError ? lastSession.current : null);
	const { t, i18n } = useTranslation("common");
	const navigate = useNavigate();
	const location = useLocation();
	const returnTo = useRef<string | undefined>(undefined);
	const privateDestination = safeAuthReturn(`${location.pathname}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`);
	// Navigate may render again while the login route is committing. Retain
	// the last private destination rather than replacing it with /login.
	if (privateDestination) returnTo.current = privateDestination;
  const routeTitles: Record<string, string> = { "/dashboard": "monitors", "/dashboard/incidents": "incidents", "/dashboard/import-export": "portability", "/dashboard/api-keys": "apiKeys", "/dashboard/api-docs": "apiDocs", "/superadmin": "admin" };
  const panel = (location.search as Record<string, unknown>).panel;
  const panelTitles: Record<string, string> = { notifications: "notifications", "status-pages": "statusPages", templates: "templates", "share-links": "shareLinks", "saved-views": "savedViews" };
  const titleKey = location.pathname === "/dashboard" && typeof panel === "string" && panelTitles[panel] ? panelTitles[panel] : routeTitles[location.pathname];
  useDocumentTitle(titleKey ? t(`nav.${titleKey}`) : undefined);
	const [navigationOpen, setNavigationOpen] = useState(false);
	const drawerRef = useRef<HTMLDivElement>(null);
	// The permanent sidebar replaces the drawer at the `lg` breakpoint (1024px); an open modal
	// drawer must not linger, trapping focus, when the window grows past it.
	useEffect(() => {
		if (!navigationOpen || typeof window.matchMedia !== "function") return;
		const desktop = window.matchMedia("(min-width: 1024px)");
		const closeOnDesktop = () => { if (desktop.matches) setNavigationOpen(false); };
		desktop.addEventListener("change", closeOnDesktop);
		return () => desktop.removeEventListener("change", closeOnDesktop);
	}, [navigationOpen]);
	const [searchOpen, setSearchOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signOutPending = useRef(false);

	// Global ⌘K / Ctrl+K shortcut to search monitors and incidents.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				flushSync(() => setSearchOpen((prev) => !prev));
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	if (isPending && !session) {
		return <main className="grid min-h-[calc(100dvh-45px)] place-content-center gap-4 p-4 text-center">
			<h1 className="text-xl font-semibold">Pulsy</h1>
			<p role="status" className="flex items-center justify-center gap-2 text-muted-foreground"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />{t("common:states.loading")}</p>
		</main>;
	}

	if (!session && error && error.status !== 401 && error.status !== 403) {
		return (
			<main className="grid min-h-[calc(100dvh-45px)] place-content-center gap-4 p-6 text-center">
				<h1 className="text-xl font-semibold">{t("session.unavailable")}</h1>
				<p role="alert" className="max-w-md text-sm text-muted-foreground">{t("session.retryDescription")}</p>
				<Button onClick={() => void refetch()}>{t("actions.retry")}</Button>
			</main>
		);
	}

	if (!session) {
		return <SessionLoginRedirect returnTo={returnTo.current} />;
	}

	const handleSignOut = async () => {
    if (signOutPending.current) return;
    signOutPending.current = true; setSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (!isSessionClientActive(client)) return;
      if (result.error) { toast.error(t("session.signOutFailed")); return; }
      navigate({ to: "/login" });
    } catch { toast.error(t("session.signOutFailed")); }
    finally { signOutPending.current = false; setSigningOut(false); }
	};

	const changeLanguage = async (lng: SupportedLanguage) => {
    if (!await changeSessionLanguage(i18n, client, lng)) return;
    const search = new URLSearchParams(location.searchStr);
    search.set("lng", lng);
    const href = `${location.pathname}?${search.toString()}${location.hash ? `#${location.hash}` : ""}`;
    await navigate({ href, replace: true, resetScroll: false });
  };


  const closeNavigation = () => setNavigationOpen(false);
  const accountLinks = <>
    <NavItem asChild active={location.pathname.includes("/help")}><Link activeOptions={{ exact: true }} to="/dashboard/help" onClick={closeNavigation}><BookOpen className="size-4 shrink-0" />{t("nav.help")}</Link></NavItem>
    {session.user?.role === "superadmin" && <NavItem asChild><Link activeOptions={{ exact: true }} to="/superadmin" search={{ section: "overview" }} onClick={closeNavigation}><ShieldAlert className="size-4" />{t("nav.admin", "Admin")}</Link></NavItem>}
  </>;
  const navigation = (mobile = false) => <nav aria-label={t("nav.navigation")} className="app-navigation flex h-full min-h-0 flex-col gap-3">
    <div data-sidebar-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 pb-3 pe-3"><div className="grid gap-5">
    <div className="grid gap-1"><p className="px-3 text-xs font-medium text-muted-foreground">{t("nav.monitorGroup")}</p>
      <NavItem asChild active={(location.pathname === "/dashboard" && !panel || location.pathname.startsWith("/dashboard/uptime/"))}><Link activeOptions={{ exact: true }} to="/dashboard"   onClick={closeNavigation}><Activity className="size-4 shrink-0" />{t("nav.monitors")}</Link></NavItem>
      <NavItem asChild active={location.pathname === "/dashboard/incidents"}><Link activeOptions={{ exact: true }} to="/dashboard/incidents"   onClick={closeNavigation}><TriangleAlert className="size-4 shrink-0" />{t("nav.incidents")}</Link></NavItem>
      <NavItem asChild active={panel === "status-pages" || location.pathname.includes("/status-pages/")}><Link activeOptions={{ exact: true }} to="/dashboard" search={{ panel: "status-pages" }}   onClick={closeNavigation}><Globe className="size-4 shrink-0" />{t("nav.statusPages")}</Link></NavItem>
    </div>
    <div className="grid gap-1"><p className="px-3 text-xs font-medium text-muted-foreground">{t("nav.configureGroup")}</p>
      <NavItem asChild active={panel === "notifications"}><Link activeOptions={{ exact: true }} to="/dashboard" search={{ panel: "notifications" }}   onClick={closeNavigation}><Bell className="size-4 shrink-0" />{t("nav.notifications")}</Link></NavItem>
      <NavItem asChild active={panel === "templates"}><Link activeOptions={{ exact: true }} to="/dashboard" search={{ panel: "templates" }}   onClick={closeNavigation}><Layers className="size-4 shrink-0" />{t("nav.templates")}</Link></NavItem>
    </div>
    <div className="grid gap-1"><p className="px-3 text-xs font-medium text-muted-foreground">{t("nav.developGroup")}</p>
      <NavItem asChild active={location.pathname === "/dashboard/import-export"}><Link activeOptions={{ exact: true }} to="/dashboard/import-export"   onClick={closeNavigation}><FileInput className="size-4 shrink-0" />{t("nav.portability")}</Link></NavItem>
      <NavItem asChild active={location.pathname === "/dashboard/api-keys"}><Link activeOptions={{ exact: true }} to="/dashboard/api-keys"   onClick={closeNavigation}><KeyRound className="size-4 shrink-0" />{t("nav.apiKeys")}</Link></NavItem>
      <NavItem asChild active={location.pathname === "/dashboard/api-docs"}><Link activeOptions={{ exact: true }} to="/dashboard/api-docs"   onClick={closeNavigation}><BookOpen className="size-4 shrink-0" />{t("nav.apiDocs")}</Link></NavItem>
    </div>
    {mobile ? <Collapsible data-mobile-account-group><CollapsibleTrigger className="px-3">{t("nav.accountGroup")}</CollapsibleTrigger><CollapsibleContent className="p-0"><div className="grid gap-1">{accountLinks}</div></CollapsibleContent></Collapsible> : <div className="grid gap-1"><p className="px-3 text-xs font-medium text-muted-foreground">{t("nav.accountGroup")}</p>{accountLinks}</div>}
    </div></div>
    <div data-sidebar-footer className="grid shrink-0 gap-1 border-t p-1 pt-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><NavItem data-account-menu-trigger aria-label={t("preferences.accountMenu")}><UserRound aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{session.user.name || session.user.email}</span><ChevronUp aria-hidden="true" className="ms-auto" /></NavItem></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPreferencesOpen(true)}><Settings aria-hidden="true" className="me-2 size-4" />{t("nav.preferences")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPreferencesOpen(true)}>{t("nav.language", "Language")}</DropdownMenuItem>
          {mobile && <DropdownMenuItem onSelect={() => void handleSignOut()} disabled={signingOut}><LogOut aria-hidden="true" className="me-2 size-4 rtl:scale-x-[-1]" />{t("nav.signOut")}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {!mobile && <NavItem onClick={handleSignOut} disabled={signingOut}><LogOut aria-hidden="true" className="rtl:scale-x-[-1]" />{t("nav.signOut")}</NavItem>}

    </div>
  </nav>;
  return <AccountTimezoneProvider><div className="min-h-[calc(100dvh-45px)] bg-background">
    <a href="#app-main" className="fixed start-4 top-2 z-[60] -translate-y-24 rounded-md bg-card p-3 focus:translate-y-0">{t("nav.skip")}</a>
    <header className="sticky top-0 z-30 h-[var(--header-height)] border-b bg-card">
      <div className="flex h-full items-center justify-between gap-3 px-[var(--page-gutter)]">
        <div className="flex min-w-0 items-center gap-2">
          <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}><SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("nav.openMenu")}><Menu /></Button></SheetTrigger><SheetContent ref={drawerRef} side="left" className="flex w-full flex-col overflow-hidden sm:max-w-sm" onOpenAutoFocus={event => { if (focusNavigationStart(drawerRef.current)) event.preventDefault(); }}><SheetHeader><SheetTitle>{t("nav.navigation")}</SheetTitle><SheetDescription className="sr-only">{t("nav.preferences")}</SheetDescription></SheetHeader><div className="min-h-0 flex-1 pt-6">{navigation(true)}</div></SheetContent></Sheet>
          <Link activeOptions={{ exact: true }} to="/dashboard" className="flex min-h-11 items-center gap-2"><Activity className="size-5 text-primary" /><span dir="ltr" className="font-semibold" style={{ unicodeBidi: "isolate" }}>Pulsy</span></Link>
        </div>
        <div className="flex items-center gap-1"><Button variant="ghost" onClick={() => flushSync(() => setSearchOpen(true))} aria-label={t("nav.search")}><Search /><span className="hidden sm:inline">{t("nav.search")}</span><kbd dir="ltr" className="hidden rounded border px-1 text-xs text-muted-foreground md:inline">{typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd></Button><ThemeToggle /></div>
      </div>
    </header>
    <aside className="fixed top-[var(--header-height)] bottom-[45px] start-0 hidden w-[var(--sidebar-width)] overflow-y-auto border-e bg-card p-2 lg:block">{navigation()}</aside>
    <div className="lg:ms-[var(--sidebar-width)]"><main id="app-main" tabIndex={-1} className="app-content"><div className="flex min-w-0 flex-col gap-4">{transientSessionError && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><p className="min-w-0 flex-1 text-sm">{t("session.retryDescription")}</p><Button variant="outline" onClick={() => void refetch()}>{t("actions.retry")}</Button></div>}<VerifyEmailBanner />{draftNavigation}<Outlet /></div></main></div>
    {preferencesOpen && <PreferencesDialog open onOpenChange={setPreferencesOpen} onLanguageChange={changeLanguage} />}
    <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
  </div></AccountTimezoneProvider>;
}

/** Router transition renders must not start another session redirect. */
function SessionLoginRedirect({ returnTo }: { returnTo?: string }) {
  const navigate = useNavigate();
  const started = useRef<string | null>(null);
  useEffect(() => {
    const destination = returnTo ?? "";
    if (started.current === destination) return;
    started.current = destination;
    void navigate({ to: "/login", search: { reason: "session", returnTo }, replace: true });
  }, [navigate, returnTo]);
  return null;
}
