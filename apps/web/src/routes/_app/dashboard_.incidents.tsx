import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IncidentWorkspace } from "@/components/uptime/incident-workspace";
import type { IncidentCursor, IncidentWorkspaceFilters } from "@/types/incident-workspace";
type Search = IncidentWorkspaceFilters & { incidentId?: string; cursorAt?: string; cursorId?: string };
function validateSearch(value: Record<string, unknown>): Search {
  const state = ["all", "open", "acknowledged", "resolved"].includes(String(value.state)) ? value.state as Search["state"] : "open";
  const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 64 ? value : undefined;
  const cursorAt = typeof value.cursorAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.cursorAt) && Number.isFinite(Date.parse(value.cursorAt)) ? value.cursorAt : undefined;
  return { state, search: typeof value.search === "string" ? value.search.slice(0, 100) : "", severity: ["critical", "warning", "informational"].includes(String(value.severity)) ? value.severity as Search["severity"] : undefined, monitorId: id(value.monitorId), groupId: id(value.groupId), incidentId: id(value.incidentId), cursorAt, cursorId: cursorAt ? id(value.cursorId) : undefined };
}
export const Route = createFileRoute("/_app/dashboard_/incidents")({ component: IncidentsPage, validateSearch });
function IncidentsPage() {
  const { t } = useTranslation("uptimeMonitor"); const search = Route.useSearch(); const navigate = useNavigate();
  const { incidentId, cursorAt, cursorId, ...filters } = search;
  const cursor: IncidentCursor | undefined = cursorAt && cursorId ? { startedAt: cursorAt, incidentId: cursorId } : undefined;
  // Defaults (open state, empty search) stay implicit so the URL only records real choices.
  const change = (next: Search) => { void navigate({ to: "/dashboard/incidents", search: { ...next, state: next.state === "open" ? undefined : next.state, search: next.search?.trim() ? next.search : undefined } }); };
  return <section className="grid min-w-0 gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="app-title">{t("workspace.title")}</h1></div><p className="text-sm text-muted-foreground">{t("workspace.description")}</p><IncidentWorkspace filters={filters} cursor={cursor} incidentId={incidentId} onFilters={value => change(value)} onCursor={value => change({ ...filters, cursorAt: value?.startedAt, cursorId: value?.incidentId })} onSelect={value => change({ ...search, incidentId: value })} /></section>;
}
