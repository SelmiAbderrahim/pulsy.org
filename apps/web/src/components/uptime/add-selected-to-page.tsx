import { useQueryClient } from "@tanstack/react-query";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { FormField } from "@/components/ui/form-field";
import { formatCount } from "@/lib/count-format";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { PageSelectionPreview } from "@/types/page-selection";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { UptimeService } from "@/services/uptime/uptimeService";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { StatusPage } from "@/types/uptime";

export function AddSelectedToPage({ monitorIds, onApplied, children }: { monitorIds: string[]; onApplied: () => void; children?: (begin: () => void) => React.ReactNode }) {
  const { t, i18n } = useTranslation("uptimeMonitor"); const id = useId();
 const client = useQueryClient();
  const [open, setOpen] = useState(false); const [pages, setPages] = useState<StatusPage[]>([]); const [pageId, setPageId] = useState("");
  const [preview, setPreview] = useState<PageSelectionPreview | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const selectionKey = [...new Set(monitorIds)].sort().join("\u0000");
  const requestVersion = useRef(0);
  useEffect(() => { requestVersion.current++; setPreview(null); setOpen(false); setBusy(false); }, [selectionKey]);
  useEffect(() => () => { requestVersion.current++; }, []);
  const changeOpen = (next: boolean) => { if (!next) { requestVersion.current++; setBusy(false); setPreview(null); } setOpen(next); };
  const begin = async () => {
    const version = ++requestVersion.current; setOpen(true); setPreview(null); setPageId(""); setPages([]); setError(""); setBusy(true);
    try { const result = await UptimeService.listStatusPages(); if (version === requestVersion.current) setPages(result); }
    catch (caught) { if (version === requestVersion.current) setError(extractErrorMessage(caught, t("pageSelection.error"))); }
    finally { if (version === requestVersion.current) setBusy(false); }
  };
  const loadPreview = async () => {
    const version = ++requestVersion.current; setBusy(true); setError(""); setPreview(null);
    try { const result = await UptimeService.previewAddToStatusPage(pageId, monitorIds); if (version === requestVersion.current) setPreview(result); }
    catch (caught) { if (version === requestVersion.current) setError(extractErrorMessage(caught, t("pageSelection.error"))); }
    finally { if (version === requestVersion.current) setBusy(false); }
  };
  const apply = async () => {
    if (!preview) return; const version = ++requestVersion.current; setBusy(true); setError("");
    try { await UptimeService.applyAddToStatusPage(pageId, monitorIds, preview.revision); await Promise.all([client.invalidateQueries({ queryKey: uptimeKeys.statusPages.all() }), client.invalidateQueries({ queryKey: uptimeKeys.public.all() }), client.invalidateQueries({ queryKey: uptimeKeys.monitors.lists() })]); if (version === requestVersion.current) { setOpen(false); onApplied(); } }
    catch (caught) { if (version === requestVersion.current) { setError(extractErrorMessage(caught, t("pageSelection.error"))); setPreview(null); } }
    finally { if (version === requestVersion.current) setBusy(false); }
  };
  return <>{children ? children(() => void begin()) : <Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start" onClick={() => void begin()}>{t("pageSelection.button")}</Button>}<Dialog open={open} onOpenChange={changeOpen}><DialogContent><DialogHeader><DialogTitle>{t("pageSelection.button")}</DialogTitle><DialogDescription>{t("pageSelection.description", { count: new Set(monitorIds).size })} <DocsHelpLink docPath="saved-views" /></DialogDescription></DialogHeader><FormField className="grid min-w-0 gap-3">
    <Label htmlFor={`${id}-page`}>{t("pageSelection.page")}</Label><Select value={pageId || "__none"} disabled={busy} onValueChange={value => { requestVersion.current++; setPageId(value === "__none" ? "" : value); setPreview(null); }}><SelectTrigger id={`${id}-page`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">{t("pageSelection.choose")}</SelectItem>{pages.map(page => <SelectItem key={page.statusPageId} value={page.statusPageId}><bdi>{page.title} · {page.slug} · {t(page.isPublished ? "pageSelection.published" : "pageSelection.draft")}</bdi></SelectItem>)}</SelectContent></Select>
    <Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start" disabled={!pageId || busy} onClick={() => void loadPreview()}>{t("pageSelection.preview")}</Button>
    {busy && <p role="status">{t("pageSelection.loading")}</p>}{error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {preview && <div className="grid gap-3 rounded-md border p-3"><p className="break-words font-medium"><bdi>{preview.title} · {preview.slug}</bdi></p><p className={preview.isPublished ? "text-sm font-medium text-foreground" : "text-sm text-muted-foreground"}>{t(preview.isPublished ? "pageSelection.liveWarning" : "pageSelection.draftNotice")}</p><p className="text-sm">{t("pageSelection.disclosure")}</p><p className="text-sm">{t("pageSelection.counts", { added: formatCount(t, "pageSelection.addedCount", preview.added.length, i18n.language), existing: formatCount(t, "pageSelection.existingCount", preview.alreadySelected.length, i18n.language), total: formatCount(t, "pageSelection.totalCount", preview.resultingCount, i18n.language) })}</p><ul className="grid gap-1 text-sm">{preview.added.map(monitor => <li key={monitor.id}><bdi>{monitor.publicName}</bdi></li>)}</ul><Button className="h-auto min-h-11 whitespace-normal w-full sm:w-auto sm:justify-self-start" disabled={busy || !preview.added.length} onClick={() => void apply()}>{t("pageSelection.apply")}</Button></div>}
  </FormField></DialogContent></Dialog></>;
}
