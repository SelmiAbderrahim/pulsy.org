import { createFileRoute } from "@tanstack/react-router";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { useTranslation } from "react-i18next";
import { MonitorPortability } from "@/components/uptime/monitor-portability";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export const Route = createFileRoute("/_app/dashboard_/import-export")({ component: ImportExportPage });
function ImportExportPage() {
  const { t } = useTranslation("uptimeMonitor");
  useDocumentTitle(t("portability.title"));
  return <section className="app-page grid grid-cols-1 gap-5">
    <PageBreadcrumb section={t("portability.title")} />
    <div className="flex flex-wrap items-center gap-3"><h1 className="app-title">{t("portability.title")}</h1><DocsHelpLink docPath="configuration-portability" /></div>
    <MonitorPortability />
  </section>;
}
