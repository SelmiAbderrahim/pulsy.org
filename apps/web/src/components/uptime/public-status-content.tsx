import { SectionCard } from "@/components/ui/section-card";
import { STATS_WINDOW_DAYS } from "@/lib/uptime/stats-window";
import { Unit } from "@/components/ui/unit";
import { useAccountTimezone } from "@/components/account-timezone";
import { dateTimeFormat } from "@/lib/date-format";
import { formatMilliseconds, formatPercent } from "@/lib/uptime/number-format";
import { PublicHistory } from "./public-history";
import { PublicSubscription } from "./public-subscription";
import { PublicCommunication } from "./public-communication";
import { HeartbeatStatusBadge } from "./heartbeat-status-badge";
/**
 * Shared presentational component for every public status surface — the legacy
 * per-user page (`/status/:userId`), a named page (`/status/:userId/:slug`), and
 * a verified custom domain (root). It owns only rendering; the caller resolves
 * the data (by user, by slug, or by Host) and passes it in.
 *
 * @module components/uptime/public-status-content
 */

import {
  Activity,
  AlertTriangle,
  CheckCircle,
  CircleHelp,
  WifiOff,
} from "lucide-react";
import { Helmet } from "@dr.pogodin/react-helmet";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { SERVER_URL } from "@/lib/api/trpc";
import { getSourceCodeUrl } from "@/components/source-code-offer";
import { isMissingResource } from "@/lib/api/is-missing-resource";
import type { PublicStatusPage, UptimeMonitorStatus } from "@/types/uptime";

export function PublicStatusBadge({ status, monitorType }: { status: UptimeMonitorStatus; monitorType?: string }) {
  const { t } = useTranslation("uptimeMonitor");
  if (monitorType === "heartbeat") return <HeartbeatStatusBadge status={status} />;
  switch (status) {
    case "up":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-success/30 bg-success/10 text-success"
        >
          <CheckCircle className="h-3 w-3" />
          {t("status.up", "Up")}
        </Badge>
      );
    case "down":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-destructive/30 bg-destructive/10 text-destructive"
        >
          <WifiOff className="h-3 w-3" />
          {t("status.down", "Down")}
        </Badge>
      );
    case "degraded":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-warning/30 bg-warning/10 text-warning"
        >
          <AlertTriangle className="h-3 w-3" />
          {t("status.degraded", "Degraded")}
        </Badge>
      );
    default:
      return <Badge variant="outline">{t("status.pending", "Pending")}</Badge>;
  }
}

const OVERALL_STYLES: Record<string, string> = {
  unknown: "border-border bg-muted/30 text-muted-foreground",
  operational: "border-success/30 bg-success/10 text-success",
  degraded: "border-warning/30 bg-warning/10 text-warning",
  partial: "border-destructive/20 bg-destructive/5 text-destructive",
  outage: "border-destructive/30 bg-destructive/10 text-destructive",
};

const OVERALL_LABEL_KEY: Record<string, string> = {
  unknown: "statusPage.unknown",
  operational: "statusPage.allOperational",
  degraded: "statusPage.degradedPerformance",
  partial: "statusPage.partialOutage",
  outage: "statusPage.majorOutage",
};

/**
 * SEO head for a resolved public status page. Status pages are per-user and
 * dynamic (not build-prerendered), so this runs at runtime via
 * @dr.pogodin/react-helmet — covering JS-executing crawlers (Googlebot/Bingbot). The
 * canonical is derived from the live location so it works on custom domains too.
 */
function StatusPageSeo({ data }: { data?: PublicStatusPage }) {
  const { t } = useTranslation("uptimeMonitor");
  // PublicStatusContent only renders client-side (after data resolves), so
  // `window` is always available. Canonical is derived live so it is correct
  // on custom status-page domains too.
  const canonical = `${window.location.origin}${window.location.pathname}`;
  const name = data ? data.title ?? t("statusPage.title") : t("statusPage.neutralTitle", "Status page");
  // Page-specific tab title ("{name} — Status") and a localized fallback description.
  const title = data ? t("statusPage.documentTitle", "{{name}} — Status", { name }) : name;
  const description = data?.description?.trim() || t("statusPage.metaDescription", "Live status, uptime and recent incidents for {{name}}.", { name });
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    description,
    url: canonical,
  };
  return (
    <Helmet defer={false}>
      <title>{title}</title>
      <meta property="og:title" content={title} />
      <meta name="robots" content={data ? "index, follow" : "noindex, nofollow"} />
      {data && <meta name="description" content={description} />}
      {data && <link rel="canonical" href={canonical} />}
      {data && <meta property="og:type" content="website" />}
      {data && <meta property="og:description" content={description} />}
      {data && <meta property="og:url" content={canonical} />}
      {data && <script type="application/ld+json">{JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>}
    </Helmet>
  );
}

export interface PublicStatusContentProps {
  data: PublicStatusPage | undefined;
  isLoading: boolean;
  error: unknown;
  /** Translation key for the error/empty state (defaults to "unavailable"). */
  errorKey?: string;
  onRetry?: () => void;
}

export function PublicStatusContent({
  data: resolvedData,
  isLoading,
  error,
  errorKey = "statusPage.unavailable",
  onRetry,
}: PublicStatusContentProps) {
  const accountTimezone = useAccountTimezone();
  const { t, i18n } = useTranslation(["uptimeMonitor", "common"]);
  const missing = isMissingResource(error);
  // React Query retains successful data after a failed refresh. An authoritative
  // not-found response revokes that public view; transient errors may retain it.
  const data = missing ? undefined : resolvedData;
  const retry = missing ? undefined : onRetry;
  const timestamp = (value: string) => dateTimeFormat(i18n.language, accountTimezone, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const latest = data?.monitors.map(monitor => monitor.lastCheckedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  // Missing components or missing observations never read as "All systems operational".
  const overall = data && data.overallStatus === "operational" && (data.monitors.length === 0 || !latest) ? "unknown" : data?.overallStatus;
  const hasUpdates = (data?.announcements?.length ?? 0) > 0;
  const OverallIcon = overall === "operational" ? CheckCircle : overall === "outage" ? WifiOff : overall === "degraded" || overall === "partial" ? AlertTriangle : CircleHelp;

  const groups = new Map<string, NonNullable<typeof data>["monitors"]>();
  for (const monitor of data?.monitors ?? []) {
    const name = monitor.group ?? "";
    const members = groups.get(name) ?? [];
    members.push(monitor); groups.set(name, members);
  }
  const heading = data ? data.title ?? t("statusPage.title", "Service status") : t("statusPage.neutralTitle", "Status page");

  return (
    <main className="min-h-[calc(100dvh-45px)] bg-background">
      <StatusPageSeo data={data} />
      <div className="mx-auto w-full max-w-[var(--status-width)] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {data?.logoUrl ? (
              <img
                src={data.logoUrl}
                alt=""
                className="h-7 w-7 shrink-0 rounded object-contain"
              />
            ) : (
              <Activity className="h-6 w-6 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-semibold" dir="auto">{heading}</h1>
              {data?.description ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground" dir="auto">
                  {data.description}
                </p>
              ) : null}
            </div>
          </div>
          <ThemeToggle />
        </div>

        {data && <div className="mb-5 grid gap-3">{latest && <p className="text-sm text-muted-foreground">{t("statusUX.lastObservation")}: <time dateTime={latest}>{timestamp(latest)}</time> · <bdi>{accountTimezone}</bdi></p>}{data.publicKey && <nav aria-label={t("communication.publicUpdates")} className="flex flex-wrap gap-x-4 text-sm"><a className="inline-flex min-h-11 items-center underline" href={`${SERVER_URL}/api/status/pages/${encodeURIComponent(data.publicKey)}/feed.rss`}>{t("communication.rss", "RSS feed")}</a><a className="inline-flex min-h-11 items-center underline" href={`${SERVER_URL}/api/status/pages/${encodeURIComponent(data.publicKey)}/feed.atom`}>{t("communication.atom", "Atom feed")}</a></nav>}<PublicSubscription key={data.publicKey ?? "legacy"} data={data} /></div>}
        {!data && <PublicSubscription />}
        {Boolean(error) && data && <div role="alert" className="mb-4 grid gap-2 rounded-md border p-4 text-sm"><p>{t("statusUX.stalePublic")}</p>{retry && <button className="min-h-11 w-fit underline" onClick={retry}>{t("communication.retry")}</button>}</div>}

        {isLoading && !data ? (
          <div role="status" aria-label={t("statusPage.loading")} className="grid gap-4 py-8"><div aria-hidden className="h-16 rounded-md bg-muted" /><div aria-hidden className="h-32 rounded-md bg-muted/60" /><span className="sr-only">{t("statusPage.loading")}</span></div>
        ) : !data ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              {t(missing ? errorKey : "statusPage.unavailable", "Status page is unavailable.")}{retry && <button className="mx-auto mt-3 block min-h-11 underline" onClick={retry}>{t("communication.retry")}</button>}
              <p className="mt-3">{t("statusPage.unavailableHelp")}</p>
              <a href="/" className="mt-4 inline-flex min-h-11 items-center text-primary underline">{t("statusPage.returnHome")}</a>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            <div
              className={`flex items-center gap-3 rounded-lg border p-4 font-medium ${
                OVERALL_STYLES[overall ?? "unknown"] ?? ""
              }`}
            >
              <OverallIcon aria-hidden="true" className="h-5 w-5 shrink-0" />
              <div className="min-w-0"><p>{t(OVERALL_LABEL_KEY[overall ?? "unknown"] ?? "statusPage.title", overall ?? "")}</p>{data.monitors.length === 0 && <p className="text-sm font-normal">{t("statusPage.noComponentsPublic")}</p>}</div>
            </div>

            {hasUpdates && <PublicCommunication data={data} />}

            {data.monitors.length > 0 && <section aria-labelledby="public-monitors-title">
              <h2 id="public-monitors-title" className="sr-only">{t("statusPage.monitorsTitle", "Monitors")}</h2>
              <div className="flex flex-col gap-2">
                {(
                  [...groups].map(([group, monitors], groupIndex) => (
                    <section key={group} aria-labelledby={`public-group-${groupIndex}`} className="space-y-2">
                      {groups.size > 1 || group ? <div className="flex flex-wrap items-center justify-between gap-2 py-1">
                        <h3 id={`public-group-${groupIndex}`} className="break-words font-medium"><bdi>{group || t("communication.noGroup", "Other components")}</bdi></h3>
                        <span className="text-xs text-muted-foreground">{t("communication.groupCount", "{{count}} components", { count: monitors.length })}</span>
                      </div> : <h3 id={`public-group-${groupIndex}`} className="sr-only">{t("statusPage.monitorsTitle", "Monitors")}</h3>}
                      {monitors.map((monitor, index) => (
                        <div key={monitor.componentId ?? `${groupIndex}-${index}`} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-medium"><bdi>{monitor.name}</bdi></p>
                            {monitor.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground" dir="auto">{monitor.description}</p>}
                            <p className="text-xs text-muted-foreground tabular-nums">
                              <span title={t("statusUX.uptimeHint", "Checks that answered correctly, including slow responses, out of all recorded checks in the last {{count}} days.", { count: STATS_WINDOW_DAYS })}>{t("statusUX.uptime", "Uptime ({{count}} days)", { count: STATS_WINDOW_DAYS })}: <Unit>{formatPercent(monitor.uptimePercentage, i18n.language) ?? "—"}</Unit></span>
                              {monitor.slowPercentage != null && monitor.slowPercentage > 0 && <> · {t("statusUX.slowResponses", "Slow responses")}: <Unit>{formatPercent(monitor.slowPercentage, i18n.language)}</Unit></>}
                              {monitor.monitorType !== "heartbeat" && monitor.monitorType !== "server" && monitor.status !== "down" && monitor.responseTime != null && <> · {t(monitor.monitorType === "dns" ? "network.dnsTiming" : monitor.monitorType === "tcp" ? "network.tcpTiming" : "list.columns.responseTime")}: <Unit>{formatMilliseconds(monitor.responseTime, i18n.language)}</Unit></>}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{monitor.lastCheckedAt ? <time dateTime={monitor.lastCheckedAt}>{timestamp(monitor.lastCheckedAt)}</time> : t("statusPage.unknown")}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2"><PublicStatusBadge status={monitor.status} monitorType={monitor.monitorType} />{monitor.maintenance && <Badge variant="outline">{t("maintenance.badge", "Maintenance")}</Badge>}</div>
                        </div>
                      ))}
                    </section>
                  ))
                )}
              </div>
            </section>}

            {data.historyEnabled && data.publicKey && <PublicHistory key={data.publicKey} publicKey={data.publicKey} components={data.monitors} />}
            {!hasUpdates && (data.monitors.length > 0 || data.recentIncidents.length > 0) && <PublicCommunication data={data} />}

            {data.recentIncidents.length > 0 && (
              <SectionCard title={<>
                    {t("statusPage.recentIncidents", "Recent incidents")}
                  </>}><div className="flex flex-col gap-2">
                  {data.recentIncidents.map((incident, index) => (
                    <div
                      key={`${incident.monitorName}-${incident.startedAt}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium" dir="auto">
                          {incident.monitorName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {timestamp(incident.startedAt)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          incident.status === "ongoing"
                            ? "border-destructive/30 bg-destructive/10 text-destructive"
                            : "border-success/30 bg-success/10 text-success"
                        }
                      >
                        {t(`incidents.status.${incident.status}`, incident.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>
        )}
        {data && <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
          {data.asOf && <time dateTime={data.asOf} title={timestamp(data.asOf)}>{t("statusPage.updated", { time: timestamp(data.asOf) })}</time>}
          <a className="inline-flex min-h-11 items-center underline" href={getSourceCodeUrl()}>{t("statusPage.poweredBy")}</a>
        </footer>}
      </div>
    </main>
  );
}
