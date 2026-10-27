import { isSessionClientActive } from "@/lib/session-query-client";
import { FormField } from "@/components/ui/form-field";
import { Search } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { requestDiscardConfirmation } from "@/lib/confirmation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStatusPage, useUptimeMonitors } from "@/hooks/uptime";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { UptimeService } from "@/services/uptime/uptimeService";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { PageReplacementPreview } from "@/types/page-selection";

/** Membership is reviewed separately from public names, retaining both the
 * selected IDs and saved component metadata when a page is edited. */
export function StatusPageMembership({ pageId, changed, onDirtyChange }: { pageId: string; changed: () => Promise<void>; onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useTranslation("uptimeMonitor"); const { t: common } = useTranslation("common");
  const page = useStatusPage(pageId), monitors = useUptimeMonitors(), client = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]), [baseline, setBaseline] = useState("[]"), [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{ value: PageReplacementPreview; snapshot: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false), initialized = useRef(false), current = useRef("");
  const snapshot = JSON.stringify(selected); current.current = snapshot;
  const serverSnapshot = JSON.stringify(page.data?.monitorIds ?? []), dirty = snapshot !== baseline;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (page.data && !busy && (!initialized.current || !dirty)) { initialized.current = true; setSelected(page.data.monitorIds); setBaseline(serverSnapshot); }
  }, [page.data, serverSnapshot, dirty, busy]);
  const perform = async (fn: () => Promise<void>) => {
    if (submitting.current) return; submitting.current = true; setBusy(true); setError("");
    try { await fn(); } catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("communication.error"))); setPreview(null); } finally { submitting.current = false; setBusy(false); }
  };
  const prepare = () => perform(async () => {
    const request = snapshot; setPreview(null);
    const value = await UptimeService.previewStatusPageMonitors(pageId, selected);
    if (current.current === request) setPreview({ value, snapshot: request });
  });
  const apply = () => perform(async () => {
    if (!preview || preview.snapshot !== current.current) return;
    await UptimeService.setStatusPageMonitors(pageId, selected, preview.value.revision);
    setPreview(null);
    await client.invalidateQueries({ queryKey: uptimeKeys.statusPages.all() }); setBaseline(snapshot); if (!isSessionClientActive(client)) return; await changed();
  });
  const filtered = (monitors.data ?? []).filter(monitor => monitor.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <SectionCard title={t("statusUX.membership")} description={t("pageSelection.disclosure")}>
    <div className="grid min-w-0 gap-4">
    {(page.isPending || monitors.isPending) && <p role="status">{t("common:states.loading")}</p>}
    {(error || page.error || monitors.error) && <div role="alert" className="grid gap-2"><p className="text-sm text-destructive">{error || t("communication.error")}</p><Button variant="outline" className="w-full sm:w-auto sm:justify-self-start" onClick={() => { void page.refetch(); void monitors.refetch(); }}>{t("communication.retry")}</Button></div>}
    {initialized.current && <>
      <p className="text-sm">{t("statusUX.selectedCount", { count: selected.length })}{dirty && <> · {t("statusUX.unsaved")}</>}</p>
      {dirty && baseline !== serverSnapshot && <div role="alert" className="grid gap-2 rounded-md border p-3 text-sm"><p>{t("statusUX.stale")}</p><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" variant="outline" onClick={async () => { if (await requestDiscardConfirmation()) { setSelected(page.data?.monitorIds ?? []); setBaseline(serverSnapshot); setPreview(null); } }}>{t("statusUX.reload")}</Button></div>}
      <FormField className="form-field"><Label htmlFor="page-membership-search">{t("notificationUX.searchMonitors")}</Label><div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="page-membership-search" type="search" className="ps-9" placeholder={t("notificationUX.searchMonitors")} value={search} onChange={event => setSearch(event.target.value)} /></div></FormField>
      <div role="group" aria-label={t("statusUX.membership")} className=" rounded-md border p-2">
        {filtered.map(monitor => <label key={monitor.uptimeMonitorId} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted"><Checkbox disabled={busy} checked={selected.includes(monitor.uptimeMonitorId)} onCheckedChange={checked => { setSelected(ids => checked ? [...new Set([...ids, monitor.uptimeMonitorId])] : ids.filter(id => id !== monitor.uptimeMonitorId)); setPreview(null); }} /><bdi className="min-w-0 break-words text-sm">{monitor.name}</bdi></label>)}
        {!filtered.length && <p className="p-2 text-sm text-muted-foreground">{t("incidentUX.filteredEmpty")}</p>}
      </div>
      <Button variant="outline" className="w-full sm:w-auto sm:justify-self-start" disabled={busy || !dirty} onClick={() => void prepare()}>{t("statusUX.previewMembership")}</Button>
      {preview && preview.snapshot === snapshot && <SectionCard headingLevel="h3" title={t("communication.previewHeading")}><div className="grid gap-3"><p><bdi>{preview.value.title} · {preview.value.slug}</bdi></p><p className="text-sm">{t(preview.value.isPublished ? "pageSelection.liveWarning" : "pageSelection.draftNotice")}</p><p className="text-sm">{t("statusUX.membershipCounts", { added: preview.value.added.length, removed: preview.value.removed.length, total: preview.value.resultingCount })}</p><ul className="grid gap-1 text-sm">{preview.value.components.map(item => <li key={item.id}><bdi>{item.publicName}</bdi></li>)}</ul>{preview.value.removed.length > 0 && <div><h4 className="text-sm font-medium">{t("statusUX.removed")}</h4><ul className="text-sm">{preview.value.removed.map(item => <li key={item.id}><bdi>{item.publicName}</bdi></li>)}</ul></div>}<Button className="w-full sm:w-auto sm:justify-self-start" disabled={busy} onClick={() => void apply()}>{t("statusUX.applyMembership")}</Button></div></SectionCard>}
    </>}
    </div>
  </SectionCard>;
}
