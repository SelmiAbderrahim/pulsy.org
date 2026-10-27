import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

/** The section is always the root; entity names are the current page. */
export function PageBreadcrumb({ section, to, current }: { section: string; to?: string; current?: string }) {
  const { t } = useTranslation("uptimeMonitor");
  return <nav aria-label={t("detailUX.breadcrumb")} className="min-w-0 text-sm">
    <ol className="flex min-h-11 flex-wrap items-center gap-x-2">
      <li>{to && current ? <Link to={to} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">{section}</Link> : <span aria-current="page">{section}</span>}</li>
      {current && <><li aria-hidden="true"><ChevronRight className="size-4 text-muted-foreground rtl:scale-x-[-1]" /></li><li><span aria-current="page" className="break-words"><bdi>{current}</bdi></span></li></>}
    </ol>
  </nav>;
}
