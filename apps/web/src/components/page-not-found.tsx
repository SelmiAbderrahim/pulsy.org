import { Helmet } from "@dr.pogodin/react-helmet";
import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/auth-client";

export function AppNotFound() {
  const { data, error } = useSession();
  const dashboard = typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard");
  const signedIn = ![401, 403].includes(error?.status ?? 0) && Boolean(data?.user);
  return <PageNotFound dashboard={dashboard} signedIn={signedIn} />;
}

/** Router misses and missing owned resources share one restrained composition. */
export function PageNotFound({ dashboard = false, signedIn = false }: { dashboard?: boolean; signedIn?: boolean }) {
  const { t } = useTranslation(["common", "auth"]);
  const Container = dashboard ? "section" : "main";
  return <Container className={`flex ${dashboard ? "min-h-[60dvh]" : "min-h-[calc(100dvh-45px)]"} flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground`}>
    <Helmet><title>{t("notFound.title")} | Pulsy</title><meta name="robots" content="noindex, nofollow" /></Helmet>
    <SearchX aria-hidden="true" className="size-10 text-muted-foreground" />
    <h1 className="text-2xl font-semibold">{t("notFound.title", "Page not found")}</h1>
    <p className="max-w-md text-sm text-muted-foreground">{t("notFound.description")}</p>
    {dashboard || signedIn ? <div className="flex flex-wrap items-center justify-center gap-3">
      <a href="/dashboard" className="inline-flex min-h-11 items-center rounded-md bg-primary px-6 font-medium text-primary-foreground hover:bg-primary/90">{t("notFound.dashboard", "Back to monitors")}</a>
      <a href="/dashboard/help" className="inline-flex min-h-11 items-center px-3 text-sm text-primary underline underline-offset-4">{t("notFound.help")}</a>
    </div> : <a href="/login" className="inline-flex min-h-11 items-center rounded-md bg-primary px-6 font-medium text-primary-foreground hover:bg-primary/90">{t("auth:login.submit")}</a>}
  </Container>;
}
