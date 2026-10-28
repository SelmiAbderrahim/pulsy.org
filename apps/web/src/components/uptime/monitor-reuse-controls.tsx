import { isSessionClientActive } from "@/lib/session-query-client";
import { FormField } from "@/components/ui/form-field";
import { formatCount } from "@/lib/count-format";
import { formatInterval } from "@/lib/uptime/format";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { formatMilliseconds } from "@/lib/uptime/number-format";
import { requestConfirmation } from "@/lib/confirmation";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useState, type ReactNode } from "react";
import { toast } from "@/lib/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, BookmarkPlus, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { MonitorTemplatesService } from "@/services/uptime/monitorTemplatesService";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import type { MonitorCreationDraft, MonitorTemplate, TemplateChannelOption } from "@/types/monitor-templates";
import { MonitorCreateDialog } from "./monitor-create-dialog";

export function MonitorReuseActions({ monitorId, children }: { monitorId: string; children?: (actions: { duplicate: () => void; saveTemplate: () => void; busy: boolean }) => ReactNode }) {
  const client = useQueryClient();
  const { data: session } = useSession();
  const { t } = useTranslation("uptimeMonitor");
  const [draft, setDraft] = useState<MonitorCreationDraft | null>(null); const [templateMode, setTemplateMode] = useState(false);
  const [channels, setChannels] = useState<TemplateChannelOption[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const begin = async (asTemplate: boolean) => {
    setBusy(true); setError("");
    try { const [source, options] = await Promise.all([MonitorTemplatesService.fromMonitor(monitorId), MonitorTemplatesService.channels()]); if (!isSessionClientActive(client)) return; setChannels(options); setTemplateMode(asTemplate); setDraft({ ...source, name: asTemplate ? source.name.slice(0, 80) : t("templates.copyName", { name: source.name }).slice(0, 255) }); }
    catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("templates.error"))); }
    finally { setBusy(false); }
  };
  return <>{children ? children({ duplicate: () => void begin(false), saveTemplate: () => void begin(true), busy }) : <><Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={t("templates.duplicate")} title={t("templates.duplicate")} disabled={busy} onClick={() => void begin(false)}><Copy className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={t("templates.fromMonitor")} title={t("templates.fromMonitor")} disabled={busy} onClick={() => void begin(true)}><BookmarkPlus className="h-4 w-4" /></Button></>}{error && <p role="alert" className="max-w-40 whitespace-normal text-sm text-destructive">{error}</p>}{draft && <MonitorCreateDialog open onOpenChange={open => { if (!open) setDraft(null); }} initial={draft} templateMode={templateMode} channelOptions={channels} onTemplateSaved={saved => { if (!isSessionClientActive(client)) return; const key = uptimeKeys.templates.list(session?.user.id); client.setQueryData<MonitorTemplate[]>(key, previous => [...(previous ?? []).filter(template => template.id !== saved.id), saved]); void client.invalidateQueries({ queryKey: key }); toast.success(t("templates.saved")); }} />}</>;
}

export function MonitorTemplatesControls({ open: controlledOpen, onOpenChange, hideTrigger = false }: { open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean } = {}) {
  const { t, i18n } = useTranslation("uptimeMonitor"); const { data: session } = useSession(); const client = useQueryClient();
  const [localOpen, setLocalOpen] = useState(false); const open = controlledOpen ?? localOpen; const setOpen = onOpenChange ?? setLocalOpen; const [selectedId, setSelectedId] = useState(""); const [search, setSearch] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ draft?: MonitorTemplate; asTemplate: boolean } | null>(null);
  const key = uptimeKeys.templates.list(session?.user.id);
  const query = useQuery({ queryKey: key, queryFn: MonitorTemplatesService.list, enabled: open && Boolean(session?.user.id) });
  const channels = useQuery({ queryKey: uptimeKeys.templates.channels(session?.user.id), queryFn: MonitorTemplatesService.channels, enabled: open && Boolean(session?.user.id) });
  const selected = query.data?.find(template => template.id === selectedId);
  const filtered = query.data?.filter(template => template.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const selectedVisible = filtered.some(template => template.id === selectedId);
  const focusId = filtered.some(template => template.id === selectedId) ? selectedId : filtered[0]?.id;
  const begin = (asTemplate: boolean, draft?: MonitorTemplate) => { setEditor({ asTemplate, draft }); };
  const remove = async (template: MonitorTemplate) => {
    if (!await requestConfirmation(t("templates.removeConfirm", { name: template.name }), { title: t("templates.remove"), action: t("templates.remove") })) return;
    if (!isSessionClientActive(client)) return;
    setBusy(true); setError("");
    try {
      await MonitorTemplatesService.remove(template.id);
 if (!isSessionClientActive(client)) return;
      if (selectedId === template.id) setSelectedId("");
      client.setQueryData<MonitorTemplate[]>(key, previous => previous?.filter(item => item.id !== template.id));
      await client.invalidateQueries({ queryKey: key });
    } catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("templates.error"))); }
    finally { setBusy(false); }
  };
  return <>{!hideTrigger && <Button variant="outline" className="min-h-11" onClick={() => { setError(""); setOpen(true); }}>{t("templates.title")}</Button>}<Sheet open={open} onOpenChange={setOpen}><SheetContent className={layoutTokens.listDrawer}><SheetHeader><div className="flex flex-wrap items-center gap-2"><SheetTitle>{t("templates.title")}</SheetTitle><DocsHelpLink docPath="saved-views" /></div><SheetDescription>{t("templates.futureOnly")}</SheetDescription></SheetHeader><div className="grid min-w-0 gap-3">
    {query.isPending && <p role="status">{t("templates.loading")}</p>}
    {(query.error || channels.error || error) && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{error || extractErrorMessage(query.error ?? channels.error, t("templates.error"))}</p><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" variant="outline" onClick={() => { void query.refetch(); void channels.refetch(); }}>{t("templates.retry")}</Button></div>}
    <FormField className="form-field"><Label htmlFor="saved-template">{t("bulkUX.searchTemplates")}</Label><Input id="saved-template" type="search" placeholder={t("bulkUX.searchTemplates")} value={search} onChange={event => setSearch(event.target.value)} /></FormField>
    <p className="text-sm text-muted-foreground">{t("templates.pickerHint")}</p>
    {query.data?.length === 0 && <p className="rounded-md border bg-muted/50 p-3 text-sm">{t("templates.empty")}</p>}
    <div role="radiogroup" aria-label={t("templates.choose")} className="grid min-w-0 gap-2">{filtered.map(template => <div key={template.id} data-template-card className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-3 hover:bg-accent ${selectedId === template.id ? "border-primary bg-muted" : "border-border"}`}>
      <button type="button" className="flex min-h-11 min-w-0 items-center gap-3 rounded-xs text-start focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" role="radio" aria-checked={selectedId === template.id} tabIndex={focusId === template.id ? 0 : -1} onKeyDown={event => {
        const radios = Array.from(event.currentTarget.closest('[role="radiogroup"]')!.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
        const index = radios.indexOf(event.currentTarget), rtl = i18n.language.startsWith("ar");
        const forward = event.key === "ArrowDown" || event.key === (rtl ? "ArrowLeft" : "ArrowRight");
        const backward = event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft");
        const next = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1 : forward ? (index + 1) % radios.length : backward ? (index + radios.length - 1) % radios.length : null;
        if (next !== null) { event.preventDefault(); radios[next]?.focus(); radios[next]?.click(); }
      }} onClick={() => setSelectedId(template.id)}>
        <span data-radio-indicator aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selectedId === template.id ? "border-primary" : "border-muted-foreground"}`}>{selectedId === template.id && <span className="size-2.5 rounded-full bg-primary" />}</span>
        <span className="grid min-w-0 gap-1"><span className="break-words font-medium"><bdi>{template.name}</bdi></span><span className="flex flex-wrap gap-x-1 text-sm text-muted-foreground"><bdi>{template.configuration.monitorType?.toUpperCase() ?? template.configuration.method}</bdi><span aria-hidden="true">·</span><span className="whitespace-nowrap">{formatInterval(template.configuration.interval, t, i18n.language)}</span><span aria-hidden="true">·</span><span className="whitespace-nowrap">{formatMilliseconds(template.configuration.timeout, i18n.language)}</span></span></span>
      </button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t("detailUX.more", { name: template.name })}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!channels.data || Boolean(channels.error)} onSelect={() => begin(true, template)}>{t("templates.edit")}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" disabled={busy} onSelect={() => void remove(template)}>{t("templates.remove")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      {selectedId === template.id && <div role="status" data-template-summary className="col-span-2 grid min-w-0 gap-1 border-t pt-2 text-sm"><p className="break-words"><span className="text-muted-foreground">{t("templates.selected")}:</span> <bdi className="font-medium">{template.name}</bdi></p><p>{formatCount(t, "templates.rulesCount", template.configuration.httpAssertions?.length ?? 0, i18n.language)}</p></div>}
    </div>)}</div>
    {search && query.data && !query.data.some(template => template.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className="text-sm text-muted-foreground">{t("bulkUX.noTemplates")}</p>}
    {!selected && !!query.data?.length && <p role="status" className="text-sm text-muted-foreground">{t("templates.choose")}</p>}
    <div className="flex flex-wrap gap-2"><Button className="w-full sm:w-auto" disabled={!selected || !selectedVisible || !channels.data || Boolean(channels.error)} onClick={() => begin(false, selected)}>{t("templates.use")}</Button><Button variant="outline" className="w-full sm:w-auto" disabled={!channels.data || Boolean(channels.error)} onClick={() => begin(true)}>{t("templates.new")}</Button></div>
  </div></SheetContent></Sheet>{editor && <MonitorCreateDialog open initial={editor.draft} fromTemplate={!editor.asTemplate && Boolean(editor.draft)} templateMode={editor.asTemplate} templateId={editor.asTemplate ? editor.draft?.id : undefined} channelOptions={channels.data} onTemplateSaved={saved => { if (!isSessionClientActive(client)) return; client.setQueryData<MonitorTemplate[]>(key, previous => [...(previous ?? []).filter(template => template.id !== saved.id), saved]); setSelectedId(saved.id); setOpen(true); toast.success(t("templates.saved")); void client.invalidateQueries({ queryKey: key }); }} onOpenChange={next => { if (!next) setEditor(null); }} />}</>;
}
