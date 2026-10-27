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
  Loader2,
  WifiOff,
} from "lucide-react";
import { Helmet } from "@dr.pogodin/react-helmet";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import type { PublicStatusPage, UptimeMonitorStatus } from "@/types/uptime";

export function PublicStatusBadge({ status }: { status: UptimeMonitorStatus }) {
  const { t } = useTranslation("uptimeMonitor");
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
  operational: "border-success/30 bg-success/10 text-success",
  degraded: "border-warning/30 bg-warning/10 text-warning",
  outage: "border-destructive/30 bg-destructive/10 text-destructive",
};

const OVERALL_LABEL_KEY: Record<string, string> = {
  operational: "statusPage.allOperational",
  degraded: "statusPage.degradedPerformance",
  outage: "statusPage.majorOutage",
};

/**
 * Metadata for a resolved public status page. Status pages are dynamic, so
 * this runs at runtime via
 * @dr.pogodin/react-helmet — covering JS-executing crawlers (Googlebot/Bingbot). The
 * canonical is derived from the live location so it works on custom domains too.
 */
function StatusPageSeo({ data }: { data: PublicStatusPage }) {
  // PublicStatusContent only renders client-side (after data resolves), so
  // `window` is always available. Canonical is derived live so it is correct
  // on custom status-page domains too.
  const canonical = `${window.location.origin}${window.location.pathname}`;
  const title = `${data.title ?? "Service"} — Status`;
  const description =
    data.description ?? "Live service status and uptime overview.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: title,
    description,
    url: canonical,
  };
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta name="robots" content="index, follow" />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
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
  data,
  isLoading,
  error,
  errorKey = "statusPage.unavailable",
  onRetry,
}: PublicStatusContentProps) {
  const { t } = useTranslation(["uptimeMonitor", "common"]);

  const heading = data?.title ?? t("statusPage.title", "Service Status");

  return (
    <div className="min-h-[calc(100dvh-45px)] bg-muted/30">
      {data ? <StatusPageSeo data={data} /> : null}
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="mb-8 flex items-center justify-between gap-3">
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
              <h1 className="truncate text-2xl font-semibold">{heading}</h1>
              {data?.description ? (
                <p className="truncate text-sm text-muted-foreground">
                  {data.description}
                </p>
              ) : null}
            </div>
          </div>
          <ThemeToggle />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error || !data ? (
          <Card>
            <CardContent className="grid justify-items-center gap-4 p-8 text-center text-muted-foreground">
              <p>{t(errorKey, "Status page is unavailable.")}</p>
              {onRetry && <Button variant="outline" onClick={onRetry}>{t("common:actions.retry")}</Button>}
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            <div
              className={`rounded-lg border p-4 text-center font-medium ${
                OVERALL_STYLES[data.overallStatus] ?? ""
              }`}
            >
              {t(
                OVERALL_LABEL_KEY[data.overallStatus] ?? "statusPage.title",
                data.overallStatus,
              )}
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">
                  {t("statusPage.monitorsTitle", "Monitors")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.monitors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("statusPage.noMonitors", "No public monitors to display.")}
                  </p>
                ) : (
                  data.monitors.map((monitor) => (
                    <div
                      key={monitor.name}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{monitor.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {monitor.uptimePercentage != null
                            ? `${monitor.uptimePercentage.toFixed(2)}%`
                            : "—"}
                          {monitor.responseTime != null
                            ? ` · ${monitor.responseTime}ms`
                            : ""}
                        </p>
                      </div>
                      <PublicStatusBadge status={monitor.status} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {data.recentIncidents.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">
                    {t("statusPage.recentIncidents", "Recent Incidents")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {data.recentIncidents.map((incident, index) => (
                    <div
                      key={`${incident.monitorName}-${incident.startedAt}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {incident.monitorName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(incident.startedAt).toLocaleString()}
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
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
