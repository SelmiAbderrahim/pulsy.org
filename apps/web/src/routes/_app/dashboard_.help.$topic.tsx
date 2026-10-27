import { Search } from "lucide-react";
import { DocumentContents } from "@/components/ui/document-contents";
import { PageBreadcrumb } from "@/components/ui/page-breadcrumb";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import serverMonitoring from "../../../../../docs/uptime/server-monitoring.md?help";
import type { HelpDocument } from "../../../help-markdown";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import reliability from "../../../../../docs/uptime/reliability.md?help";
import dnsTcp from "../../../../../docs/uptime/dns-tcp.md?help";
import statusCommunication from "../../../../../docs/uptime/status-communication.md?help";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import maintenance from "../../../../../docs/uptime/maintenance.md?help";
import httpChecks from "../../../../../docs/uptime/http-checks.md?help";
import latency from "../../../../../docs/uptime/latency-alerts.md?help";
import savedViews from "../../../../../docs/uptime/saved-views.md?help";
import heartbeat from "../../../../../docs/uptime/heartbeat.md?help";
import incidents from "../../../../../docs/uptime/incidents.md?help";
import portability from "../../../../../docs/uptime/configuration-portability.md?help";
const documents: Record<string, HelpDocument> = { "server-monitoring": serverMonitoring, prometheus, reliability, "dns-tcp": dnsTcp, "configuration-portability": portability, "status-communication": statusCommunication, maintenance, "http-checks": httpChecks, "latency-alerts": latency, "saved-views": savedViews, heartbeat, incidents };
const translations = import.meta.glob<HelpDocument>("../../../../../docs/uptime/*/*.md", { eager: true, query: "?help", import: "default" });
export const Route = createFileRoute("/_app/dashboard_/help/$topic")({
  component: () => <HelpPage topic={Route.useParams().topic} />,
  beforeLoad: ({ params }) => {
    if (params.topic === "index") throw redirect({ to: "/dashboard/help", replace: true });
  },
});
/** Task-oriented grouping for the help index; every shipped article appears in exactly one group. */
const GROUPS = [
  { key: "monitoring", topics: ["server-monitoring", "http-checks", "dns-tcp", "heartbeat", "latency-alerts", "reliability", "maintenance", "saved-views"] },
  { key: "incidents", topics: ["incidents"] },
  { key: "communication", topics: ["status-communication"] },
  { key: "integrations", topics: ["configuration-portability", "prometheus"] },
] as const;
export function HelpPage({ topic }: { topic: string }) {
  const [search, setSearch] = useState("");
  const { t, i18n } = useTranslation("uptimeMonitor");
  const requested = (i18n.resolvedLanguage ?? i18n.language ?? "en").split("-")[0];
  const original = Object.hasOwn(documents, topic) ? documents[topic] : undefined;
  const translated = original && translations[`../../../../../docs/uptime/${requested}/${topic}.md`];
  const language = translated || !original ? requested : "en";
  const document = translated || original;
  useDocumentTitle(document?.title ?? t("help.title"));
  const links = Object.entries(documents).map(([key, fallback]) => { const localized = translations[`../../../../../docs/uptime/${requested}/${key}.md`] ?? fallback; return { topic: key, title: localized.title, summary: localized.summary, body: localized.html.replace(/<[^>]+>/g, " ") }; });
  const tokens = search.normalize("NFKC").toLocaleLowerCase(i18n.language).split(/[^\p{L}\p{N}]+/gu).filter(Boolean);
  const matches = (item: typeof links[number]) => { const haystack = `${item.title} ${item.summary} ${item.body}`.normalize("NFKC").toLocaleLowerCase(i18n.language); return tokens.every(token => haystack.includes(token)); };
  const group = GROUPS.find(candidate => (candidate.topics as readonly string[]).includes(topic));
  const visibleGroups = GROUPS.filter(entry => entry.topics.some(key => links.some(item => item.topic === key && matches(item))));
  const headings = document?.headings.filter(heading => heading.level === 2) ?? [];

  return <article className="app-page grid min-w-0 gap-6">
    <PageBreadcrumb section={t("help.title")} to="/dashboard/help" current={document?.title} />
    {topic === "index" ? <>
      <h1 className="app-title">{t("help.title")}</h1>
      <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="ps-9" type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label={t("help.search")} placeholder={t("help.search")} /></div>
      {!links.some(matches) && <p role="status" className="grid gap-2">{t("help.noResults")} <a className="text-primary underline" href="https://github.com/SelmiAbderrahim/pulsy/issues">{t("help.reportIssue", "Report an issue")}</a></p>}
      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[208px_minmax(0,1fr)]">
        <DocumentContents title={t("help.contents")} items={visibleGroups.map(entry => ({ id: `help-group-${entry.key}`, title: t(`help.groups.${entry.key}`) }))} />
        <div className="grid min-w-0 gap-6">{visibleGroups.map(entry => <section key={entry.key} aria-labelledby={`help-group-${entry.key}`} className="grid scroll-mt-[calc(var(--header-height)+1rem)] gap-2">
          <h2 id={`help-group-${entry.key}`} className="text-lg font-semibold">{t(`help.groups.${entry.key}`)}</h2>
          <ul className="grid gap-2">{entry.topics.flatMap(key => links.filter(item => item.topic === key && matches(item))).map(item => <li key={item.topic}><Link to="/dashboard/help/$topic" params={{ topic: item.topic }} className="grid min-h-11 gap-1 rounded-md border bg-card px-4 py-3 hover:bg-muted/50"><span className="text-primary underline">{item.title}</span>{item.summary && <span className="text-sm text-muted-foreground">{item.summary}</span>}</Link></li>)}</ul>
        </section>)}</div>

      </div>
    </> : document ? <>
      {requested !== language && <p className="text-sm text-muted-foreground">{t("help.language")}</p>}
      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[208px_minmax(0,1fr)]">
        <DocumentContents title={t("help.contents")} items={headings} />
        <section className="help-prose" dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
          <h1 id={document.titleId}>{document.title}</h1>

          <div className="help-body" dangerouslySetInnerHTML={{ __html: document.html }} />
        </section>

      </div>
      <nav aria-label={t("help.moreTopics")} className="grid gap-2 border-t pt-4">{group && <h2 className="text-sm font-medium text-muted-foreground">{t("help.moreIn", { group: t(`help.groups.${group.key}`) })}</h2>}{(group ? group.topics : []).filter(key => key !== topic).flatMap(key => links.filter(item => item.topic === key)).map(item => <Link key={item.topic} to="/dashboard/help/$topic" params={{ topic: item.topic }} className="inline-flex min-h-11 items-center text-sm text-primary underline">{item.title}</Link>)}<Link to="/dashboard/help" className="inline-flex min-h-11 items-center text-sm text-primary underline">{t("help.allTopics")}</Link></nav>
    </> : <><h1 className="app-title">{t("help.title")}</h1><p lang={language} dir={language === "ar" ? "rtl" : "ltr"}>{t("help.missing")}</p><Link to="/dashboard/help" className="inline-flex min-h-11 items-center text-primary underline">{t("help.allTopics")}</Link></>}
  </article>;
}
import prometheus from "../../../../../docs/api/prometheus.md?help";
