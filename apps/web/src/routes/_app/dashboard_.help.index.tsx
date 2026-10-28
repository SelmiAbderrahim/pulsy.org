import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_app/dashboard_/help/")({ component: Page });
function Page() { const { t } = useTranslation("common"); return <section className="app-page"><h1 className="app-title">{t("nav.help")}</h1></section>; }
