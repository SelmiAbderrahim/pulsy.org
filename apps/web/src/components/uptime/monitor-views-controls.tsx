import { isSessionClientActive } from "@/lib/session-query-client";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { removeCachedRows } from "@/hooks/uptime/optimistic-cache";
import { FormField } from "@/components/ui/form-field";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { requestConfirmation } from "@/lib/confirmation";
import { MoreHorizontal, Bookmark, Star } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import { sameViewFilters } from "@/lib/uptime/monitor-views";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { MonitorViewsService } from "@/services/uptime/monitorViewsService";
import type { MonitorView, MonitorViewFilters } from "@/types/monitor-views";

export function MonitorViewsControls({ pickerOpen: controlledPickerOpen, onPickerOpenChange, filters, selectedId, allowDefault, onApply, onClear }: {
  pickerOpen?: boolean; onPickerOpenChange?: (open: boolean) => void;
  filters: MonitorViewFilters; selectedId?: string; allowDefault: boolean;
  onApply: (view: MonitorView, replace?: boolean) => void; onClear: () => void;
}) {
  const { t } = useTranslation("uptimeMonitor"); const id = useId();
  const { data: session } = useSession(); const client = useQueryClient();
  const queryKey = uptimeKeys.views.list(session?.user.id);
  const [localPickerOpen, setLocalPickerOpen] = useState(false);
  const pickerOpen = controlledPickerOpen ?? localPickerOpen;
  const query = useQuery({queryKey,queryFn:MonitorViewsService.list,enabled:Boolean(session?.user.id) && pickerOpen,staleTime:30_000});
  const initialKey=uptimeKeys.views.initial(session?.user.id,selectedId);
  const initialKeys = uptimeKeys.views.initials(session?.user.id);
  const initial = useQuery({queryKey:initialKey,queryFn:()=>MonitorViewsService.initial(selectedId),enabled:Boolean(session?.user.id) && (allowDefault || Boolean(selectedId)),staleTime:30_000});
  const selected=query.data?.find(view=>view.id===selectedId) ?? (initial.data && initial.data.id===selectedId ? initial.data : undefined);
  const setPickerOpen = onPickerOpenChange ?? setLocalPickerOpen; const [viewSearch, setViewSearch] = useState("");
  const [open, setOpenState] = useState(false); const editorGeneration = useRef(0);
  const setOpen = (next: boolean) => { if (!next) editorGeneration.current++; setOpenState(next); };
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<MonitorView>(); const [renameOnly, setRenameOnly] = useState(false);
  const [name, setName] = useState(""); const [pinned, setPinned] = useState(false); const [isDefault, setDefault] = useState(false);
  const save = useMutation({
    mutationFn: MonitorViewsService.save,
    onMutate: () => ({ generation: editorGeneration.current, apply: !renameOnly }),
    onSuccess: async (view, _input, request) => {
      await Promise.all([client.cancelQueries({ queryKey: initialKeys }), client.cancelQueries({ queryKey })]);
      // Initial queries include the default and individually selected views.
      // Replace stale defaults before any later navigation can reuse them.
      client.setQueriesData<MonitorView | null>({ queryKey: initialKeys }, previous => previous?.id === view.id ? view : view.isDefault && previous?.isDefault ? { ...previous, isDefault: false } : previous);
      const defaultKey = uptimeKeys.views.initial(session?.user.id);
      const previousDefault = client.getQueryData<MonitorView | null>(defaultKey);
      if (view.isDefault || previousDefault?.id === view.id) client.setQueryData(defaultKey, view.isDefault ? view : null);
      client.setQueryData<MonitorView[]>(queryKey, previous => previous?.map(item => item.id === view.id ? view : view.isDefault && item.isDefault ? { ...item, isDefault: false } : item));
      await Promise.all([client.invalidateQueries({ queryKey }), client.invalidateQueries({ queryKey: initialKeys })]);
      if (!isSessionClientActive(client) || request?.generation !== editorGeneration.current) return;
      setOpen(false);
      if (request.apply) onApply(view);
    },
  });
  const remove = useMutation({
    mutationFn: MonitorViewsService.remove,
    onMutate: async id => {
      await client.cancelQueries({ queryKey: initialKeys });
      const previous = client.getQueriesData<MonitorView | null>({ queryKey: initialKeys }).filter(([, view]) => view?.id === id);
      const restoreList = await removeCachedRows<MonitorView>(client, queryKey, row => row.id === id);
      for (const [key] of previous) client.setQueryData(key, null);
      return () => {
        restoreList();
        for (const [key, view] of previous) client.setQueryData(key, view);
      };
    },
    onError: (_error, _id, rollback) => rollback?.(),
    onSuccess: (_, removedId) => { if (!isSessionClientActive(client)) return; if (removedId === selectedId) onClear(); },
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey }),
      client.invalidateQueries({ queryKey: initialKeys }),
    ]),
  });
  const defaultView = initial.data?.isDefault ? initial.data : query.data?.find(view => view.isDefault);
  useEffect(() => { if (allowDefault && defaultView) onApply(defaultView, true); }, [allowDefault, defaultView, onApply]);
  const begin = (update: boolean, view = selected, rename = false) => { editorGeneration.current++; setEditing(update); setTarget(view); setRenameOnly(rename); setName(update ? view?.name ?? "" : ""); setPinned(update ? view?.pinned ?? false : false); setDefault(update ? view?.isDefault ?? false : false); save.reset(); setOpen(true); };
  const canClear = Boolean(selectedId || filters.search || filters.tags.length || filters.health !== "all" || filters.group !== "none" || filters.density !== "comfortable" || filters.sort !== "status" || filters.direction !== "asc" || filters.tagMode !== "any");
  const deleteView = async (view: MonitorView) => { if (await requestConfirmation(t("views.removeConfirm", { name: view.name }), { title: t("views.remove"), action: t("views.remove") }) && isSessionClientActive(client)) remove.mutate(view.id); };
  const modified = selected && !sameViewFilters(selected.filters, filters);
  return <div className="flex w-full min-w-0 items-center gap-1">
    <Button variant="outline" className="min-w-0 flex-1" onClick={() => setPickerOpen(true)} disabled={query.isFetching && pickerOpen} title={selected?.name} aria-label={selected ? t("views.pickerLabel", { name: selected.name }) : t("views.title")}><Bookmark /><span className="min-w-0 flex-1 truncate text-start">{selected?.name ?? t("views.title")}</span>{modified && <span className="shrink-0 text-xs" title={t("views.modified")}>{t("views.unsaved")}</span>}</Button>
    <DropdownMenu><TooltipProvider><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="shrink-0" aria-label={t("views.manage")}><MoreHorizontal /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>{t("views.manage")}</TooltipContent></Tooltip></TooltipProvider><DropdownMenuContent align="end">
      <DropdownMenuItem onClick={() => begin(false)}>{t("views.saveNew")}</DropdownMenuItem>
      {selected && <><DropdownMenuItem onClick={() => begin(true)}>{t("views.update")}</DropdownMenuItem><DropdownMenuItem onClick={() => begin(true, selected, true)}>{t("views.rename")}</DropdownMenuItem></>}
      <DropdownMenuItem className="data-[disabled]:text-muted-foreground data-[disabled]:opacity-100" disabled={!canClear} title={!canClear ? t("views.clearDisabled") : undefined} onClick={onClear}>{t("views.clear")}</DropdownMenuItem>
      {selected && <><DropdownMenuSeparator /><DropdownMenuItem disabled={remove.isPending} onClick={async () => { if (await requestConfirmation(t("views.removeConfirm", { name: selected.name }), { title: t("views.remove"), action: t("views.remove") }) && isSessionClientActive(client)) remove.mutate(selected.id); }}>{t("views.remove")}</DropdownMenuItem></>}
    </DropdownMenuContent></DropdownMenu>
    <Sheet open={pickerOpen} onOpenChange={setPickerOpen}><SheetContent className={`flex flex-col ${layoutTokens.listDrawer}`}><SheetHeader><SheetTitle>{t("views.title")}</SheetTitle><SheetDescription>{t("views.description")}</SheetDescription></SheetHeader>
      <Input type="search" aria-label={t("common:nav.searchViews")} placeholder={t("common:nav.searchViews")} value={viewSearch} onChange={event => setViewSearch(event.target.value)} />
      {query.data?.length === 0 && <p className="rounded-md border bg-muted/50 p-3 text-sm">{t("views.firstSave")}</p>}
      <div className="grid max-h-80 gap-1 overflow-y-auto"><Button variant="ghost" className="justify-start" onClick={() => { onClear(); setPickerOpen(false); }}>{t("views.transient")}</Button>{query.data?.filter(view => view.name.toLocaleLowerCase().includes(viewSearch.toLocaleLowerCase())).map(view => <div key={view.id} className="flex min-w-0 items-center gap-1"><Button variant={view.id === selected?.id ? "secondary" : "ghost"} className="h-auto min-w-0 flex-1 justify-start whitespace-normal text-start" aria-pressed={view.id === selected?.id} onClick={() => { onApply(view); setPickerOpen(false); }}>{view.pinned && <Star aria-label={t("views.pinned")} />}<bdi className="min-w-0 break-words">{view.name}</bdi>{view.isDefault && <span className="text-xs text-muted-foreground">{t("views.default")}</span>}</Button><DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`${t("views.manage")} — ${view.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => begin(true, view, true)}>{t("views.rename")}</DropdownMenuItem><DropdownMenuItem className="text-destructive" disabled={remove.isPending} onClick={() => void deleteView(view)}>{t("views.remove")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</div>
      <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" className="min-h-11" onClick={() => { setPickerOpen(false); begin(false); }}>{t("views.saveCurrent")}</Button><DocsHelpLink docPath="saved-views" /></div>
    </SheetContent></Sheet>
    {query.isFetching && pickerOpen && <p role="status" className="text-sm">{t("views.loading")}</p>}
    {(query.error || initial.error || remove.error) && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><p>{extractErrorMessage(query.error ?? initial.error ?? remove.error, t("views.error"))}</p>{(query.error || initial.error) && <Button variant="outline" onClick={() => initial.error ? initial.refetch() : query.refetch()}>{t("metrics.retry")}</Button>}</div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{t(renameOnly ? "views.rename" : editing ? "views.update" : "views.saveNew")}</DialogTitle><DialogDescription>{t("views.description")}</DialogDescription></DialogHeader><form className="grid gap-4" onSubmit={event => { event.preventDefault(); save.mutate({ ...(editing && target ? { id: target.id } : {}), name: name.trim(), filters: renameOnly && target ? target.filters : filters, pinned, isDefault }); }}>
      <FormField className="form-field"><Label htmlFor={`${id}-name`}>{t("views.name")}</Label><Input id={`${id}-name`} dir="auto" required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></FormField>
      <Label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} />{t("views.pinned")}</Label>
      <Label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={isDefault} onChange={event => setDefault(event.target.checked)} />{t("views.defaultDescription")}</Label>
      {save.error && <p role="alert" className="text-sm text-destructive">{extractErrorMessage(save.error, t("views.error"))}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11" data-dialog-discard onClick={() => setOpen(false)}>{t("actions.cancel", "Cancel")}</Button>
        <Button type="submit" className="min-h-11" disabled={save.isPending || !name.trim()}>{t("views.save")}</Button>
      </DialogFooter>
    </form></DialogContent></Dialog>
  </div>;
}
