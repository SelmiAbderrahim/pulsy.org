import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
export const Route = createFileRoute("/_app/dashboard_/import-export")({ component: Page });
function Page() {
  const { t } = useTranslation("common");
  useDocumentTitle(t("nav.portability"));
  return <section className="app-page-wide"><h1 className="app-title">{t("nav.portability")}</h1></section>;
}
