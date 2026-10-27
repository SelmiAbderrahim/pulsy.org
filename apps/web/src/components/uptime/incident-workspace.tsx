import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { useDirtyBeforeUnload } from "@/hooks/use-dirty-before-unload";
import { registerDraftGuard } from "@/lib/draft-guards";
import { isSessionClientActive } from "@/lib/session-query-client";
import { toast } from "@/lib/toast";
import { IncidentCard, IncidentTimestamp, TIME_SLOT } from "./incident-card";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Combobox } from "@/components/ui/combobox";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ResponsiveFilters } from "@/components/ui/responsive-filters";
import { requestDiscardConfirmation } from "@/lib/confirmation";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Activity, Check, Clock, Pause, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IncidentEscalationControls, type EscalationDraft } from "./incident-escalation-controls";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useSession } from "@/lib/auth-client";
import { formatLatencyReason } from "@/lib/uptime/format";
import { useElapsedClock } from "@/hooks/useElapsedClock";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { IncidentWorkspaceService } from "@/services/uptime/incidentWorkspaceService";
import { UptimeService } from "@/services/uptime/uptimeService";
import type { IncidentCursor, IncidentResponseDetail, IncidentWorkspaceFilters } from "@/types/incident-workspace";

function QuickAcknowledge({ incidentId, acknowledged }: { incidentId: string; acknowledged: boolean }) {
  const { t } = useTranslation("uptimeMonitor");
  const client = useQueryClient();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const acknowledge = async () => {
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError("");
    try {
      await (acknowledged ? IncidentWorkspaceService.unacknowledge(incidentId) : IncidentWorkspaceService.acknowledge(incidentId));
      if (!isSessionClientActive(client)) return;
      toast.success(t(acknowledged ? "workspace.unacknowledgedSuccess" : "workspace.acknowledgedSuccess"));
      await client.invalidateQueries({ queryKey: uptimeKeys.incidents.all() });
    } catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("workspace.error"))); }
    finally { submitting.current = false; setPending(false); }
  };
  return <div className="grid min-w-0 gap-2">
    <Button type="button" variant="outline" className="w-full sm:w-auto sm:justify-self-end" disabled={pending} aria-busy={pending} onClick={() => void acknowledge()}>{t(acknowledged ? "workspace.unacknowledge" : "workspace.acknowledge")}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

type RunbookDraft = { baseline: { description: string; url: string | null }; description: string; url: string; dirty: boolean };
type IncidentDraft = { note: string; runbook?: RunbookDraft; escalation?: EscalationDraft; runbookOpen?: boolean; escalationOpen?: boolean };

function RunbookEditor({ detail, save, busy, onDirty, cache }: { cache?: RunbookDraft; detail: IncidentResponseDetail; save: (description: string, url: string, expected: { description: string; url: string | null }, onSaved: () => void) => Promise<void>; busy: boolean; onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation("uptimeMonitor"); const { t: common } = useTranslation("common");
  const current = { description: detail.response.runbookDescription, url: detail.response.runbookUrl };
  const [baseline, setBaseline] = useState(cache?.baseline ?? current);
  const [description, setDescription] = useState(cache?.description ?? current.description), [url, setUrl] = useState(cache?.url ?? current.url ?? "");
  const dirty = useRef(cache?.dirty ?? false);
  useEffect(() => { if (cache) Object.assign(cache, { description, url, baseline, dirty: dirty.current }); }, [cache, description, url, baseline]);
  const changed = current.description !== baseline.description || current.url !== baseline.url;
  // Dirty means "differs from the saved runbook", not "was touched": an edit that is typed back is not a draft.
  useEffect(() => {
    const differs = description !== baseline.description || url !== (baseline.url ?? "");
    if (dirty.current !== differs) { dirty.current = differs; onDirty(differs); }
  }, [description, url, baseline, onDirty]);
  const reset = () => { dirty.current = false; onDirty(false); setBaseline(current); setDescription(current.description); setUrl(current.url ?? ""); };
  useEffect(() => { if (!dirty.current) { setBaseline({ description: detail.response.runbookDescription, url: detail.response.runbookUrl }); setDescription(detail.response.runbookDescription); setUrl(detail.response.runbookUrl ?? ""); } }, [detail.response.runbookDescription, detail.response.runbookUrl]);
  return <form className="grid min-w-0 gap-4" onSubmit={event => { event.preventDefault(); void save(description, url, baseline, () => { dirty.current = false; onDirty(false); setBaseline({ description, url: url || null }); }); }}>
    {dirty.current && changed && <div role="alert" className="grid gap-2 rounded-md border p-3 text-sm"><p>{t("incidentUX.runbookChanged")}</p><p className="whitespace-pre-wrap break-words">{current.description || "—"}</p><bdi className="break-all">{current.url}</bdi><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" type="button" variant="outline" onClick={async () => { if (await requestDiscardConfirmation()) reset(); }}>{t("incidentUX.useSaved")}</Button></div>}
    <FormField className="form-field"><Label htmlFor="incident-runbook">{t("workspace.runbookDescription")}</Label><Textarea id="incident-runbook" value={description} maxLength={2000} disabled={busy} dir="auto" onChange={event => setDescription(event.target.value)} /></FormField>
    <FormField className="form-field"><Label htmlFor="incident-runbook-url">{t("workspace.runbookUrl")}</Label><Input id="incident-runbook-url" value={url} maxLength={1000} type="url" dir="ltr" disabled={busy} aria-describedby="incident-runbook-help" onChange={event => setUrl(event.target.value)} /><p id="incident-runbook-help" className="text-sm text-muted-foreground">{t("workspace.safeLink")}</p></FormField>
    <Button type="submit" variant="outline" className="w-full sm:w-auto sm:justify-self-end" disabled={busy}>{t("workspace.saveRunbook")}</Button>
  </form>;
}

function Health({ status, active = true }: { status: string; active?: boolean }) {
  const { t } = useTranslation("uptimeMonitor");
  const Icon = !active ? Pause : status === "up" ? Check : status === "pending" ? Clock : Activity;
  return <Badge variant="outline" className={`gap-1 bg-card ${!active ? "text-muted-foreground" : status === "up" ? "border-success/30 text-success" : status === "down" ? "border-destructive/30 text-destructive" : status === "degraded" ? "border-warning/30 text-warning" : "text-muted-foreground"}`}><Icon aria-hidden className="h-3.5 w-3.5" />{t(!active ? "status.paused" : `status.${status}`)}</Badge>;
}
export function IncidentResponsePanel({ incidentId, onClose, onDirtyChange, draftCache, inSheet = false }: { draftCache?: IncidentDraft; inSheet?: boolean; incidentId: string; onClose: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useTranslation("uptimeMonitor"); const { t: common } = useTranslation("common"); const { data: session } = useSession(); const client = useQueryClient();
  const [runbookDirty, setRunbookDirty] = useState(draftCache?.runbook?.dirty ?? false); const submitting = useRef(false);
  const [escalationDirty, setEscalationDirty] = useState(draftCache?.escalation?.dirty ?? false);
  const [runbookOpen, setRunbookOpen] = useState(draftCache?.runbookOpen ?? false), [escalationOpen, setEscalationOpen] = useState(draftCache?.escalationOpen ?? false);
  const [note, setNote] = useState(draftCache?.note ?? ""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useDraftComparison({ note, runbookDirty, escalationDirty }, { note: "", runbookDirty: false, escalationDirty: false }, !inSheet);
  useEffect(() => { onDirtyChange?.(Boolean(note) || runbookDirty || escalationDirty); if (draftCache) Object.assign(draftCache, { note, runbookOpen, escalationOpen }); }, [note, runbookDirty, escalationDirty, runbookOpen, escalationOpen, draftCache, onDirtyChange]);
  const query = useQuery({ queryKey: uptimeKeys.incidents.response(session?.user.id, incidentId), queryFn: () => IncidentWorkspaceService.one(incidentId), enabled: !!session?.user.id, refetchInterval: 15_000 });
  const perform = async (operation: () => Promise<unknown>, success?: () => void) => { if (submitting.current) return; submitting.current = true; setBusy(true); setError(""); try { await operation(); if (!isSessionClientActive(client)) return; success?.(); await client.invalidateQueries({ queryKey: uptimeKeys.incidents.all() }); } catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("workspace.error"))); void query.refetch(); } finally { submitting.current = false; setBusy(false); } };
  if (draftCache && query.data && !draftCache.runbook) draftCache.runbook = { baseline: { description: query.data.response.runbookDescription, url: query.data.response.runbookUrl }, description: query.data.response.runbookDescription, url: query.data.response.runbookUrl ?? "", dirty: false };
  if (draftCache && !draftCache.escalation) draftCache.escalation = {};
  const title = <h2 className="min-w-0 break-words text-xl font-semibold">{query.data?.monitor.name ?? t("workspace.response")}</h2>;
  const privacy = <p className="text-sm text-muted-foreground">{t("workspace.private")}</p>;
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card" data-incident-response>
    <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b bg-card p-4">
      {inSheet ? <SheetTitle asChild>{title}</SheetTitle> : title}
      <div className="flex shrink-0 items-center gap-3"><DocsHelpLink docPath="incidents" /><Button data-overlay-chrome className="h-11 w-11 shrink-0" size="icon" variant="ghost" onClick={onClose} aria-label={common("actions.close")}><X aria-hidden className="h-4 w-4" /></Button></div>
    </header>
    <div className="grid min-h-0 min-w-0 gap-4 overflow-y-auto p-4" data-incident-body>
      {inSheet ? <SheetDescription asChild>{privacy}</SheetDescription> : privacy}{query.isPending && <p role="status">{t("workspace.loading")}</p>}{(query.error || error) && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{error || extractErrorMessage(query.error, t("workspace.error"))}</p><Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start sm:self-start" disabled={busy} onClick={() => void query.refetch()}>{t("workspace.retry")}</Button></div>}{query.data && <>
    <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">{t("workspace.measuredHealth")}</dt><dd className="mt-1"><Health status={query.data.monitor.status} active={query.data.monitor.active} /></dd></div><div><dt className="text-sm text-muted-foreground">{t("workspace.workflow")}</dt><dd>{t(query.data.incident.status === "resolved" ? "workspace.states.resolved" : query.data.response.acknowledgedAt ? "workspace.states.acknowledged" : "workspace.states.open")}</dd></div>{query.data.incident.expectedAt && <div><dt className="text-sm text-muted-foreground">{t("workspace.expectedAt")}</dt><dd><bdi><IncidentTimestamp value={query.data.incident.expectedAt} /></bdi></dd></div>}<div><dt className="text-sm text-muted-foreground">{t(query.data.incident.expectedAt ? "workspace.graceEndsAt" : "workspace.started")}</dt><dd><bdi><IncidentTimestamp value={query.data.incident.startedAt} /></bdi></dd></div><div><dt className="text-sm text-muted-foreground">{t("workspace.notifiedAt")}</dt><dd>{query.data.incident.notifiedAt ? <bdi><IncidentTimestamp value={query.data.incident.notifiedAt} /></bdi> : <span className="text-sm text-muted-foreground">{t("workspace.notNotified")}</span>}</dd></div><div><dt className="text-sm text-muted-foreground">{t("workspace.severity")}</dt><dd>{t(`workspace.severities.${query.data.incident.severity ?? "unknown"}`)}</dd></div></dl>
    {query.data.incident.cause && <p className="break-words text-sm" dir="auto"><span className="text-muted-foreground">{t("workspace.openedBecause")}: </span>{formatLatencyReason(query.data.incident.cause, t)}</p>}{(() => {
      // History is never rewritten: the incident keeps the reason it opened with. A later state change
      // (e.g. Late → Down) is shown separately as the latest observation.
      const latest = query.data.timeline.find(event => event.kind === "check" && event.text)?.text;
      return latest && latest !== query.data.incident.cause ? <p className="break-words text-sm" dir="auto"><span className="text-muted-foreground">{t("workspace.latestCause")}: </span>{formatLatencyReason(latest, t)}</p> : null;
    })()}{query.data.response.group && <p className="text-sm">{t("workspace.group")}: <bdi>{query.data.response.group.name}</bdi></p>}
    <Link to="/dashboard/uptime/$monitorId" params={{ monitorId: query.data.monitor.id }} search={{ tab: "incidents" }} className="inline-flex min-h-11 items-center text-sm underline">{t("workspace.monitorDetails")}</Link>
    {query.data.response.acknowledgedAt && <p className="text-sm"><span>{t("workspace.acknowledgedBy", { name: session?.user.name || t("workspace.you") })} </span><IncidentTimestamp value={query.data.response.acknowledgedAt} message={t("workspace.acknowledgedAt", { time: TIME_SLOT })} /></p>}{query.data.incident.status !== "resolved" && <><Button className="min-h-11 w-full sm:w-auto sm:justify-self-end" disabled={busy} aria-busy={busy} onClick={() => void perform(() => query.data.response.acknowledgedAt ? IncidentWorkspaceService.unacknowledge(incidentId) : IncidentWorkspaceService.acknowledge(incidentId), () => toast.success(t(query.data.response.acknowledgedAt ? "workspace.unacknowledgedSuccess" : "workspace.acknowledgedSuccess")))}>{t(query.data.response.acknowledgedAt ? "workspace.unacknowledge" : "workspace.acknowledge")}</Button><p className="text-xs text-muted-foreground">{t("workspace.acknowledgeHint")}</p></>}
    <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void perform(() => IncidentWorkspaceService.note(incidentId, note.trim()), () => setNote("")); }}><Label htmlFor="incident-note">{t("workspace.note")}</Label><Textarea id="incident-note" dir="auto" maxLength={2000} required value={note} disabled={busy} onChange={event => setNote(event.target.value)} /><Button className="min-h-11 w-full sm:w-auto sm:justify-self-end" type="submit" disabled={busy || !note.trim()}>{t("workspace.saveNote")}</Button></form>
    <h3 className="text-base font-medium">{t("workspace.timeline")}</h3>{query.data.timeline.length === 0 && <p className="text-sm text-muted-foreground">{t("workspace.noEvents")}</p>}<ol className="grid gap-2">{query.data.timeline.map(event => <li key={event.id} className="grid gap-1 rounded-md border p-3 text-sm"><p><bdi><IncidentTimestamp value={event.createdAt} /></bdi> · {t(event.actorId ? "workspace.you" : "workspace.system")}</p><p>{t(`workspace.events.${event.kind}`)}{event.status && ` · ${t(`status.${event.status}`)}`}{event.event && ` · ${t(`workspace.alertEvents.${event.event}`)}`}{event.outcome && ` · ${t(`workspace.outcomes.${event.outcome}`)}`}{event.channelType && ` · ${t(`workspace.channelTypes.${event.channelType}`)}`}</p>{event.text && <p className="whitespace-pre-wrap break-words" dir="auto">{event.kind === "check" ? formatLatencyReason(event.text, t) : event.text}</p>}</li>)}</ol>{query.data.timelineTruncated && <p className="text-sm text-muted-foreground">{t("workspace.timelineBound")}</p>}
    <Collapsible open={runbookOpen} onOpenChange={setRunbookOpen} className="rounded-md border"><CollapsibleTrigger className="ps-4">{t("incidentUX.runbook")}</CollapsibleTrigger><CollapsibleContent><RunbookEditor key={incidentId} cache={draftCache?.runbook} detail={query.data} busy={busy} onDirty={setRunbookDirty} save={async (description, url, expected, onSaved) => perform(() => IncidentWorkspaceService.runbook(incidentId, description, url, expected), onSaved)} />{query.data.response.runbookUrl && <a href={query.data.response.runbookUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all text-sm underline">{t("workspace.openRunbook")}</a>}</CollapsibleContent></Collapsible>
    <Collapsible open={escalationOpen} onOpenChange={setEscalationOpen} className="rounded-md border"><CollapsibleTrigger className="ps-4">{t("workspace.escalation.title")}</CollapsibleTrigger><CollapsibleContent><IncidentEscalationControls draft={draftCache?.escalation} onDirty={setEscalationDirty} detail={query.data} busy={busy} perform={perform} /></CollapsibleContent></Collapsible>
  </>}</div></section>;
}
export function IncidentWorkspace({ filters, cursor, incidentId, onFilters, onCursor, onSelect }: { filters: IncidentWorkspaceFilters; cursor?: IncidentCursor; incidentId?: string; onFilters: (value: IncidentWorkspaceFilters) => void; onCursor: (value?: IncidentCursor) => void; onSelect: (value?: string) => void }) {
  const { t } = useTranslation("uptimeMonitor"); const { t: common } = useTranslation("common");
  const { data: session } = useSession(); const client = useQueryClient();
  const narrow = useMediaQuery("(max-width: 1023px)");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]), [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  const getMode = () => typeof window === "undefined" || window.innerWidth >= 1200 ? "wide" : window.innerWidth >= 768 ? "drawer" : "mobile";
  const [mode, setMode] = useState(getMode);
  const drafts = useRef(new Map<string, IncidentDraft>());
  if (incidentId && !drafts.current.has(incidentId)) drafts.current.set(incidentId, { note: "" });
  const dirty = useRef(false), submitting = useRef(false), listScroll = useRef(0);
  useEffect(() => { const resize = () => setMode(getMode()); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  const groupDraft = useRef(groupName); groupDraft.current = groupName;
  const discardDrafts = () => { dirty.current = false; groupDraft.current = ""; drafts.current.clear(); setGroupName(""); };
  useDirtyBeforeUnload(() => dirty.current || Boolean(groupDraft.current));
  useEffect(() => registerDraftGuard({
    dirty: () => dirty.current || Boolean(groupDraft.current),
    discard: discardDrafts,
  }), []);
  const guard = async () => !(dirty.current || groupDraft.current) || await requestDiscardConfirmation();
  const selectIncident = async (next?: string) => {
    if (next === incidentId || !await guard() || !isSessionClientActive(client)) return;
    discardDrafts();
    if (!incidentId) listScroll.current = window.scrollY;
    onSelect(next);
    if (!next) requestAnimationFrame(() => window.scrollTo(0, listScroll.current));
  };
  const filter = async (next: IncidentWorkspaceFilters) => { if (await guard() && isSessionClientActive(client)) { discardDrafts(); onFilters(next); } };
  const query = useQuery({ queryKey: uptimeKeys.incidents.workspace(session?.user.id, filters, cursor), queryFn: () => IncidentWorkspaceService.list(filters, cursor), enabled: !!session?.user.id, refetchInterval: 15_000 });
  const monitors = useQuery({ queryKey: uptimeKeys.incidents.monitorChoices(session?.user.id), queryFn: () => UptimeService.listMonitors(), enabled: !!session?.user.id, staleTime: 30_000 });
  const now = useElapsedClock(query.data?.items.some(item => item.status === "ongoing") ?? false);
  const identity = JSON.stringify([filters, cursor]);
  useEffect(() => { setSelected([]); setGroupName(""); setError(""); }, [identity]);
  useEffect(() => { const items = query.data?.items; if (items) setSelected(ids => ids.filter(id => items.some(item => item.incidentId === id))); }, [query.data]);
  const group = async (event: React.FormEvent) => {
    event.preventDefault(); if (submitting.current || selected.length < 2) return; submitting.current = true; setBusy(true); setError("");
    try { await IncidentWorkspaceService.group(groupName, [...new Set(selected)]); if (!isSessionClientActive(client)) return; setSelected([]); setGroupName(""); await client.invalidateQueries({ queryKey: uptimeKeys.incidents.all() }); }
    catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("workspace.error"))); }
    finally { submitting.current = false; setBusy(false); }
  };
  const activeFilters = Boolean(filters.search || filters.severity || filters.monitorId || filters.groupId || filters.state && filters.state !== "open");
  const activeFilterCount = [filters.search, filters.severity, filters.monitorId, filters.groupId, filters.state && filters.state !== "open" ? filters.state : undefined].filter(Boolean).length;
  const visibleItems = query.data?.items ?? [];
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every(item => selected.includes(item.incidentId));
  const toggleAllVisible = () => setSelected(current => allVisibleSelected
    ? current.filter(id => !visibleItems.some(item => item.incidentId === id))
    : [...new Set([...current, ...visibleItems.map(item => item.incidentId)])]);
  const mobileDetail = mode === "mobile" && Boolean(incidentId);
  return <div className="grid min-w-0 gap-4 pb-[45dvh]">
    <div className={mobileDetail ? "hidden" : "grid min-w-0 gap-3"}>
      <Button variant="outline" className="w-fit lg:hidden" onClick={() => setFiltersOpen(true)} aria-expanded={filtersOpen}>{common("nav.filters")}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</Button>
      <ResponsiveFilters open={!narrow || filtersOpen} onOpenChange={setFiltersOpen}>
      <div className="form-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <FormField className="form-field sm:col-span-2"><Label htmlFor="workspace-search">{t("workspace.search")}</Label><div className="relative min-w-0 w-full"><Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input ref={searchInput} id="workspace-search" type="search" maxLength={100} placeholder={t("workspace.searchPlaceholder", "Search incidents")} className="min-w-0 ps-9 pe-10 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:appearance-none" value={filters.search ?? ""} onChange={event => void filter({ ...filters, search: event.target.value })} onKeyDown={event => { if (event.key === "Escape" && filters.search) { event.preventDefault(); void filter({ ...filters, search: "" }); } }} />{filters.search && <Button type="button" variant="ghost" size="icon" aria-label={t("search.clear", "Clear search")} className="absolute end-0 top-1/2 h-11 w-11 -translate-y-1/2" onClick={() => { searchInput.current?.focus(); void filter({ ...filters, search: "" }); }}><X aria-hidden="true" className="h-4 w-4" /></Button>}</div></FormField>
        <FormField className="form-field"><Label htmlFor="workspace-state">{t("workspace.workflow")}</Label><Select value={filters.state ?? "open"} onValueChange={value => void filter({ ...filters, state: value as IncidentWorkspaceFilters["state"] })}><SelectTrigger id="workspace-state"><SelectValue /></SelectTrigger><SelectContent>{["open", "acknowledged", "resolved", "all"].map(state => <SelectItem key={state} value={state}>{t(state === "open" ? "workspace.states.unresolved" : `workspace.states.${state}`)}</SelectItem>)}</SelectContent></Select></FormField>
        <FormField className="form-field"><Label htmlFor="workspace-severity">{t("workspace.severity")}</Label><Select value={filters.severity ?? "all"} onValueChange={value => void filter({ ...filters, severity: value === "all" ? undefined : value as IncidentWorkspaceFilters["severity"] })}><SelectTrigger id="workspace-severity"><SelectValue /></SelectTrigger><SelectContent>{["all", "critical", "warning", "informational"].map(severity => <SelectItem key={severity} value={severity}>{t(`workspace.severities.${severity}`)}</SelectItem>)}</SelectContent></Select></FormField>
        <FormField className="form-field"><Label htmlFor="workspace-monitor">{t("workspace.monitorFilter")}</Label><Combobox id="workspace-monitor" value={filters.monitorId ?? "__all"} disabled={monitors.isPending || !!monitors.error} onValueChange={value => void filter({ ...filters, monitorId: value === "__all" ? undefined : value })} options={[
          { value: "__all", label: t("workspace.allMonitors") },
          ...(filters.monitorId && !monitors.data?.some(m => m.uptimeMonitorId === filters.monitorId) ? [{ value: filters.monitorId, label: t("workspace.selectedMonitor") }] : []),
          ...(monitors.data?.map(m => ({ value: m.uptimeMonitorId, label: m.name })) ?? []),
        ]} />{monitors.error && <Button variant="outline" onClick={() => void monitors.refetch()}>{t("workspace.retry")}</Button>}</FormField>
      </div>
      <Button className="lg:hidden" onClick={() => setFiltersOpen(false)}>{t("views.showResults")}</Button></ResponsiveFilters>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">{query.data && <p role="status">{t("incidentUX.resultCount", { count: query.data.items.length })} · {t(query.data.nextCursor ? "incidentUX.resultMore" : cursor ? "incidentUX.resultLast" : "incidentUX.resultAll")}</p>}{filters.groupId && <p>{t("workspace.groupFilter")}</p>}{activeFilters && <Button variant="outline" onClick={() => filter({ state: "open", search: "" })}>{t("workspace.clear")}</Button>}</div>
    </div>
    <div className={`grid min-w-0 items-start gap-4 ${mode === "wide" && incidentId ? "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : "grid-cols-1"}`}>
      <div className={mobileDetail ? "hidden" : "grid min-w-0 gap-3"}>
        {query.isPending && <p role="status" className="min-h-40 rounded-md border p-4">{t("workspace.loading")}</p>}
        {(query.error || error) && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{error || extractErrorMessage(query.error, t("workspace.error"))}</p><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" variant="outline" onClick={() => void query.refetch()}>{t("workspace.retry")}</Button></div>}
        {query.data?.items.length === 0 && <p className="rounded-md border p-4 text-sm text-muted-foreground">{t(activeFilters ? "incidentUX.filteredEmpty" : "workspace.empty")}</p>}
        {!!selected.length && <form aria-label={t("workspace.createGroup")} className="fixed inset-x-3 bottom-3 z-20 mx-auto grid max-h-[45dvh] max-w-2xl min-w-0 gap-2 overflow-y-auto rounded-md border bg-card p-3 shadow-xs lg:ms-[calc(var(--sidebar-width,16rem)+1rem)]" onSubmit={event => void group(event)}>
          <FormField className="form-field"><Label htmlFor="response-group-name">{t("workspace.groupSelected", { count: selected.length })}</Label><Input id="response-group-name" dir="auto" value={groupName} required maxLength={80} disabled={busy} onChange={event => setGroupName(event.target.value)} /><p className="text-sm text-muted-foreground">{t("workspace.groupHint")}</p></FormField>
          <Collapsible><CollapsibleTrigger>{t("incidentUX.selectedPreview", { count: selected.length })}</CollapsibleTrigger><CollapsibleContent><ul className="max-h-40 overflow-auto text-sm">{query.data?.items.filter(item => selected.includes(item.incidentId)).map(item => <li key={item.incidentId} className="grid gap-1 py-2"><bdi>{item.monitorName}</bdi><code dir="ltr" className="break-all text-xs">{item.incidentId}</code></li>)}</ul></CollapsibleContent></Collapsible>
          <p id="incident-group-minimum" className="text-sm text-muted-foreground">{selected.length < 2 ? t("workspace.groupMinimum") : t("workspace.groupHint")}</p><Button type="submit" className="w-full sm:w-auto sm:justify-self-end" aria-describedby="incident-group-minimum" disabled={busy || selected.length < 2 || !groupName.trim()}>{t("workspace.createGroup")}</Button>
        </form>}
        {visibleItems.length > 0 && <div className="flex min-h-11 items-center gap-2 rounded-md border bg-card px-3 text-sm">
          <label className="inline-flex min-h-11 items-center gap-2 px-2"><Checkbox checked={allVisibleSelected ? true : selected.length > 0 ? "indeterminate" : false} aria-label={t("workspace.selectAll", "Select all visible incidents")} onCheckedChange={toggleAllVisible} disabled={busy} /><span>{t("workspace.selectAll", "Select all visible incidents")}</span></label>
          {selected.length > 0 && <span className="text-muted-foreground">· {t("incidentUX.selectedPreview", { count: selected.length })}</span>}
        </div>}
        <ul aria-label={t("workspace.title")} className={`grid min-w-0 gap-3 ${mode === "wide" && incidentId ? "max-h-[calc(100dvh-20rem)] overflow-auto pe-1" : ""}`}>{visibleItems.map(item => {
          const chosen = incidentId === item.incidentId;
          return <li key={item.incidentId} className={`grid min-w-0 grid-cols-[44px_minmax(0,1fr)] gap-2 rounded-md border p-3 ${chosen ? "border-primary bg-accent" : "bg-card"}`} data-incident-row={item.incidentId}>
            <div className="flex h-11 w-11 items-center justify-center"><Checkbox checked={selected.includes(item.incidentId)} disabled={busy} aria-label={t("workspace.select", { name: item.monitorName })} onCheckedChange={checked => setSelected(ids => checked === true ? [...new Set([...ids, item.incidentId])] : ids.filter(id => id !== item.incidentId))} /></div>
            <IncidentCard incident={item} now={now} acknowledgedBy={item.acknowledgedBy ? session?.user.name || t("workspace.you") : undefined}
              title={<Button variant="link" aria-current={chosen ? "true" : undefined} className="h-auto min-h-11 justify-start whitespace-normal break-words p-0 text-start text-base" onClick={() => selectIncident(item.incidentId)}><bdi>{item.monitorName}</bdi></Button>}
              health={<div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted-foreground">{t("workspace.measuredHealth")}:</span><Health status={item.measuredHealth ?? "pending"} active={item.monitorActive} /></div>}
              actions={item.status !== "resolved" && <QuickAcknowledge incidentId={item.incidentId} acknowledged={Boolean(item.acknowledgedAt)} />}
            />
          </li>;
        })}</ul>
        <div className="flex flex-wrap gap-2">{cursor && <Button variant="outline" onClick={async () => { if (await guard() && isSessionClientActive(client)) { discardDrafts(); onCursor(); } }}>{t("workspace.firstPage")}</Button>}{query.data?.nextCursor && <Button variant="outline" onClick={async () => { if (await guard() && isSessionClientActive(client)) { discardDrafts(); onCursor(query.data.nextCursor!); } }}>{t("workspace.nextPage")}</Button>}</div>
      </div>
      <div ref={setPanelHost} className="min-w-0" data-incident-detail-host />
      {incidentId && panelHost && <Sheet open modal={mode === "drawer"} onOpenChange={open => { if (!open) selectIncident(); }}><SheetContent container={panelHost} hideClose className={`flex flex-col overflow-hidden p-0 sm:p-0 ${mode === "drawer" ? "sm:max-w-[var(--dialog-standard)]" : "relative inset-auto h-[calc(100dvh-10rem)] w-full border-0 shadow-none sm:max-w-none"}`} onInteractOutside={event => { if (mode !== "drawer") event.preventDefault(); }}>
        <IncidentResponsePanel key={incidentId} draftCache={drafts.current.get(incidentId)} inSheet incidentId={incidentId} onClose={() => selectIncident()} onDirtyChange={value => { dirty.current = value; }} />
      </SheetContent></Sheet>}
    </div>
  </div>;
}
