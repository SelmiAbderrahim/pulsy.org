import { useTranslation } from "react-i18next";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { cn } from "@/lib/utils";
export type UptimeDocPath = "server-monitoring" | "prometheus" | "reliability" | "dns-tcp" | "maintenance" | "http-checks" | "latency-alerts" | "saved-views" | "heartbeat" | "incidents" | "status-communication" | "configuration-portability";
/** Maps only to bundled, existing public documentation; no arbitrary URL input. */
export function DocsHelpLink({ docPath }: { docPath: UptimeDocPath }) {
  const { t } = useTranslation("uptimeMonitor");
  return <a data-overlay-chrome href={`/dashboard/help/${docPath}`} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center justify-center text-sm text-muted-foreground underline hover:text-foreground", layoutTokens.touchTarget)}>{t("help.title")}</a>;
}
