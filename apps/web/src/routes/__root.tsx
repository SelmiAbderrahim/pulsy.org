import { createRootRoute, Outlet, useLocation, type ErrorComponentProps } from "@tanstack/react-router";
import { Helmet } from "@dr.pogodin/react-helmet";
import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppNotFound } from "@/components/page-not-found";
import { SourceCodeOffer } from "@/components/source-code-offer";
import { Button } from "@/components/ui/button";
import { ConfirmationHost } from "@/components/ui/confirmation-host";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRoute({
	component: RootLayout,
  notFoundComponent: AppNotFound,
  errorComponent: RouteError,
});

function useLocaleReady() {
  useLayoutEffect(() => {
    document.documentElement.removeAttribute("data-locale-pending");
    document.getElementById("locale-loading")?.setAttribute("hidden", "");
  }, []);
}
function RootOverlays() {
  return <><ConfirmationHost /><SourceCodeOffer /><Toaster richColors closeButton /></>;
}
function RootLayout() {
  const { pathname } = useLocation();
  const privatePage = pathname.startsWith("/dashboard") || pathname === "/superadmin";
  useLocaleReady();
	return (
		<>
			{privatePage ? <Helmet><meta name="robots" content="noindex, nofollow" /></Helmet> : <Helmet><title>Pulsy</title></Helmet>}
			<Outlet />
			<RootOverlays />
		</>
	);
}

function RouteError({ reset }: ErrorComponentProps) {
  const { t } = useTranslation("common");
  useLocaleReady();
  return <>
    <main className="flex min-h-[calc(100dvh-45px)] flex-col items-center justify-center gap-4 px-4 text-center">
      <Helmet><title>{t("states.error")} | Pulsy</title><meta name="robots" content="noindex, nofollow" /></Helmet>
      <h1 className="text-2xl font-semibold">{t("states.error")}</h1>
      <p role="alert" className="max-w-md text-muted-foreground">{t("notFound.retry")}</p>
      <Button onClick={reset}>{t("actions.retry")}</Button>
      <a href="/dashboard" className="flex min-h-11 items-center text-primary underline">{t("notFound.dashboard")}</a>
    </main><RootOverlays />
  </>;
}
