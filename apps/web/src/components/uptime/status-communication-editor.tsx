import { isSessionClientActive } from "@/lib/session-query-client";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { formattingLocale } from "@/lib/formatting-locale";
import { FormField } from "@/components/ui/form-field";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { FormFooter } from "@/components/ui/form-footer";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { TimezoneCombobox } from "@/components/ui/timezone-combobox";
import { requestDiscardConfirmation } from "@/lib/confirmation";
import { Link } from "@tanstack/react-router";
import { browserTimezone, isValidTimezone } from "@pulsy/db/timezone";
import { useConfirmation } from "@/hooks/use-confirmation";
import { useDirtyNavigation } from "@/hooks/use-dirty-navigation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { PublicHistorySettings } from "./public-history-settings";
import { StatusSubscriptionSettings } from "./status-subscription-settings";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isMissingResource } from "@/lib/api/is-missing-resource";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStatusPage } from "@/hooks/uptime";
import { statusPageUrl } from "@/lib/status-domain";
import { StatusPageForm } from "./status-pages-sheet";
import { CopyableUrl } from "./copyable-url";
import { StatusPageMembership } from "./status-page-membership";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useSession } from "@/lib/auth-client";
import { extractErrorMessage, extractFieldErrors } from "@/lib/api/extractErrorMessage";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { StatusCommunicationService } from "@/services/uptime/statusCommunicationService";
import { MaintenanceService } from "@/services/uptime/maintenanceService";
import type { AnnouncementDraft, AnnouncementPreview, ComponentDraft, ComponentPreview, PageCommunication } from "@/types/status-communication";
import type { MaintenanceWindow } from "@/types/maintenance";
const actionClass = "min-h-11 h-auto w-full whitespace-normal break-words py-2 sm:w-auto sm:justify-self-start";
export function PublicAnnouncementPreview({ preview }: { preview: AnnouncementPreview }) {
  const { t, i18n } = useTranslation("uptimeMonitor"); const value = preview.announcement;
  const date = (input: string) => new Intl.DateTimeFormat(formattingLocale(i18n.language), { dateStyle: "medium", timeStyle: "medium", timeZone: value.timezone }).format(new Date(input));
  return <SectionCard headingLevel="h3" title={t("communication.previewHeading")}><div className="grid min-w-0 gap-3"><p>{t("communication.page")}: <bdi>{preview.page.title}</bdi></p><p>{t("communication.affected")}: {preview.components.map(component => <bdi key={component.componentId} className="me-2">{component.name}</bdi>)}</p><p>{t(value.kind === "maintenance" ? "communication.maintenance" : `communication.stages.${value.stage}`)}</p><h4 className="break-words font-medium" dir="auto">{value.title}</h4><p className="whitespace-pre-wrap break-words" dir="auto">{value.text}</p>{value.startsAt && value.endsAt && <p><bdi>{date(value.startsAt)} — {date(value.endsAt)}</bdi></p>}<p className="text-xs text-muted-foreground"><bdi>{value.timezone}</bdi></p></div></SectionCard>;
}
export function ComponentEditor({ data, changed, onDirtyChange }: { data: PageCommunication; changed: () => Promise<void>; onDirtyChange?: (dirty: boolean) => void }) {
  const client = useQueryClient();
  const { t } = useTranslation("uptimeMonitor");
  const validation = useFormValidation();
  const fieldMessage = (id: string) => { const issue = validation.issues.find(issue => issue.id === id); return issue ? <p className="text-sm text-destructive">{issue.message}</p> : null; };
  const [components, setComponents] = useState<ComponentDraft[]>(data.components.map(component => ({ componentId: component.componentId, name: component.name, description: component.description, group: component.group })));
  const [preview, setPreview] = useState<{ value: ComponentPreview; snapshot: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const serverRows = data.components.map(component => ({ componentId: component.componentId, name: component.name, description: component.description, group: component.group }));
  const serverSnapshot = JSON.stringify(serverRows), [baseline, setBaseline] = useState(serverSnapshot);
  const snapshot = JSON.stringify(components); const current = useRef(snapshot); current.current = snapshot;
  const dirty = snapshot !== baseline;
  const dragged = useRef<string | null>(null);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!dirty && !busy) { setComponents(JSON.parse(serverSnapshot) as ComponentDraft[]); setBaseline(serverSnapshot); } }, [serverSnapshot, dirty, busy]);
  const errorFields = Object.fromEntries(components.flatMap((component, index) => ["name", "description", "group"].map(field => [`components.${index}.${field}`, `public-${field}-${component.componentId}`])));
  const edit = (index: number, field: "name" | "description" | "group", value: string) => { setError(""); setComponents(rows => rows.map((row, position) => position === index ? { ...row, [field]: value } : row)); setPreview(null); };
  const move = (index: number, offset: number) => { setComponents(rows => { if (index < 0 || index + offset < 0 || index + offset >= rows.length) return rows; const result = [...rows]; const [moved] = result.splice(index, 1); result.splice(index + offset, 0, moved!); return result; }); setPreview(null); };
  const prepare = async () => { if (busy) return; setError(""); if (!validation.validate()) return; const requestSnapshot = snapshot; setBusy(true); setError(""); setPreview(null); try { const value = await StatusCommunicationService.componentsPreview(data.page.id, components); if (current.current === requestSnapshot) setPreview({ value, snapshot: requestSnapshot }); } catch (caught) { if (!isSessionClientActive(client)) return; if (!validation.server(caught, errorFields)) setError(extractErrorMessage(caught, t("communication.error"))); } finally { setBusy(false); } };
  const apply = async () => { if (!preview || preview.snapshot !== current.current) return; setBusy(true); setError(""); try { await StatusCommunicationService.componentsApply(data.page.id, components, preview.value.revision); setComponents(preview.value.components); setBaseline(JSON.stringify(preview.value.components)); setPreview(null); if (!isSessionClientActive(client)) return; await changed(); } catch (caught) { if (!isSessionClientActive(client)) return; if (!validation.server(caught, errorFields)) setError(extractErrorMessage(caught, t("communication.error"))); setPreview(null); } finally { setBusy(false); } };
  return <SectionCard title={t("communication.components")} description={t("communication.componentHint")}>
    <form ref={validation.formRef} noValidate onSubmit={event => { event.preventDefault(); void prepare(); }} className="grid min-w-0 gap-4">
      <FormErrorSummary issues={validation.issues} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {dirty && <p className="text-sm">{t("statusUX.unsaved")}</p>}
      {dirty && baseline !== serverSnapshot && <div role="alert" className="grid gap-2 text-sm"><p>{t("statusUX.stale")}</p><Button type="button" className="w-full sm:w-auto sm:justify-self-start sm:self-start" variant="outline" onClick={async () => { if (await requestDiscardConfirmation()) { setComponents(serverRows); setBaseline(serverSnapshot); setPreview(null); } }}>{t("statusUX.reload")}</Button></div>}
      {!components.length && <p>{t("communication.noComponents")}</p>}
      {components.map((component, index) => <fieldset key={component.componentId} data-component-id={component.componentId} className="grid min-w-0 gap-2 rounded-md border p-4"
        onDragOver={event => { if (!busy && dragged.current) event.preventDefault(); }}
        onDrop={event => {
          if (busy || !dragged.current) return;
          event.preventDefault();
          const from = components.findIndex(row => row.componentId === dragged.current);
          if (from >= 0) move(from, index - from);
          dragged.current = null;
        }}>
        <legend className="break-words px-1 text-sm" dir="auto">{data.components.find(row => row.componentId === component.componentId)?.privateName}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="icon" data-component-drag-handle draggable={!busy && components.length > 1} disabled={busy || components.length < 2}
            className="cursor-grab active:cursor-grabbing" aria-label={t("communication.reorderComponent", { name: component.name, defaultValue: "Reorder {{name}}" })}
            title={t("communication.reorderHint", { defaultValue: "Drag or use the arrow keys to reorder" })}
            onDragStart={event => { dragged.current = component.componentId; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", component.componentId); }}
            onDragEnd={() => { dragged.current = null; }}
            onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); move(index, event.key === "ArrowUp" ? -1 : 1); } }}><GripVertical className="h-4 w-4" aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon" aria-label={t("communication.moveUp")} title={t("communication.moveUp")} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon" aria-label={t("communication.moveDown")} title={t("communication.moveDown")} disabled={busy || index === components.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <FormField className="form-field"><Label htmlFor={`public-name-${component.componentId}`}>{t("communication.componentName")}</Label><Input id={`public-name-${component.componentId}`} {...validation.field(`public-name-${component.componentId}`)} required className="min-h-11" dir="auto" value={component.name} maxLength={200} disabled={busy} onChange={event => edit(index, "name", event.target.value)} />{fieldMessage(`public-name-${component.componentId}`)}</FormField>
        <FormField className="form-field"><Label htmlFor={`public-description-${component.componentId}`}>{t("communication.componentDescription")}</Label><Textarea id={`public-description-${component.componentId}`} {...validation.field(`public-description-${component.componentId}`)} dir="auto" value={component.description ?? ""} maxLength={1000} disabled={busy} onChange={event => edit(index, "description", event.target.value)} />{fieldMessage(`public-description-${component.componentId}`)}</FormField>
        <FormField className="form-field"><Label htmlFor={`public-group-${component.componentId}`}>{t("communication.componentGroup")}</Label><Input id={`public-group-${component.componentId}`} {...validation.field(`public-group-${component.componentId}`)} className="min-h-11" dir="auto" value={component.group ?? ""} maxLength={80} disabled={busy} onChange={event => edit(index, "group", event.target.value)} />{fieldMessage(`public-group-${component.componentId}`)}</FormField>
      </fieldset>)}
      <Button type="submit" variant="outline" className={actionClass} disabled={busy || !components.length}>{t("communication.previewComponents")}</Button>
      {preview && preview.snapshot === snapshot && <SectionCard headingLevel="h3" title={t("communication.previewHeading")}><div className="grid gap-3"><p className="text-sm">{t("communication.page")}: <bdi>{preview.value.title}</bdi></p><p className="text-sm text-muted-foreground">{t(preview.value.published ? "communication.liveDisclosure" : "communication.draftDisclosure")}</p><ol className="grid gap-2">{preview.value.components.map(component => <li key={component.componentId} className="break-words text-sm" dir="auto"><bdi>{component.name}</bdi>{component.group && <> · <bdi>{component.group}</bdi></>}{component.description && <p>{component.description}</p>}</li>)}</ol><Button type="button" className={actionClass} disabled={busy} onClick={() => void apply()}>{t("communication.applyComponents")}</Button></div></SectionCard>}
    </form>
  </SectionCard>;
}
export function AnnouncementEditor({ data, schedules, changed, onDirtyChange }: { data: PageCommunication; schedules: MaintenanceWindow[]; changed: () => Promise<void>; onDirtyChange?: (dirty: boolean) => void }) {
  const client = useQueryClient();
  const { t, i18n } = useTranslation("uptimeMonitor");
  const { confirm, dialog } = useConfirmation();
  const [draftId, setDraftId] = useState<string | undefined>(), [previousId, setPreviousId] = useState<string | undefined>();
  const [title, setTitle] = useState(""), [text, setText] = useState(""), [stage, setStage] = useState<AnnouncementDraft["stage"]>("investigating"), [selected, setSelected] = useState<string[]>([]), [timezone, setTimezone] = useState(browserTimezone);
  const [scheduleId, setScheduleId] = useState(""), [maintenance, setMaintenance] = useState<AnnouncementDraft["maintenance"]>();
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null), [lastSaved, setLastSaved] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ value: AnnouncementPreview; snapshot: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null), [deleting, setDeleting] = useState<string | null>(null);
  const errorFields = ["title", "text", "timezone", "componentIds"] as const;
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<typeof errorFields[number], string>>>({});
  const validation = useFormValidation();
  const form = validation.formRef, inFlight = useRef(false);
  const schedule = schedules.find(window => window.id === scheduleId);
  const eligibleSchedules = schedules.filter(window => window.enabled && window.kind === "maintenance" && window.occurrences.length && data.components.some(component => window.monitorIds.includes(component.monitorId)));
  const occurrenceIndex = schedule?.occurrences.findIndex(value => value.startsAt === maintenance?.startsAt && value.endsAt === maintenance?.endsAt) ?? -1;
  const occurrence = schedule?.occurrences[occurrenceIndex];
  const fields = { previousId, title, text, stage, componentIds: selected, timezone, maintenance };
  // Track every editable value, including timezone, stage and schedule-only changes.
  const snapshotOf = (value: typeof fields, scheduleValue = scheduleId) => JSON.stringify({ ...value, scheduleId: scheduleValue });
  const snapshot = snapshotOf(fields), [baseline, setBaseline] = useState(snapshot), current = useRef(snapshot); current.current = snapshot;
  const dirty = baseline !== snapshot;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const date = (value: string, zone = "UTC") => new Intl.DateTimeFormat(formattingLocale(i18n.language), { dateStyle: "medium", timeStyle: "medium", timeZone: isValidTimezone(zone) ? zone : "UTC" }).format(new Date(value));
  const clearFeedback = () => { validation.clear(); setError(""); setFieldErrors({}); setLastSaved(null); setPreview(null); };
  const reset = () => {
    const zone = browserTimezone();
    setDraftId(undefined); setPreviousId(undefined); setTitle(""); setText(""); setSelected([]); setStage("investigating"); setTimezone(zone); setScheduleId(""); setMaintenance(undefined);
    setBaseline(snapshotOf({ previousId: undefined, title: "", text: "", stage: "investigating", componentIds: [], timezone: zone, maintenance: undefined }, ""));
    setSavedSnapshot(null); setEditingTitle(null); validation.clear(); clearFeedback(); setDeleteError(null);
  };
  const discard = () => confirm({ title: t("communication.unsavedTitle"), description: t("common:nav.discard"), action: t("communication.discard") });
  const replace = async (action: () => void) => { if (inFlight.current) return; if (!dirty || await discard()) action(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (inFlight.current) return;
    clearFeedback();
    const errors: typeof fieldErrors = {};
    if (!title.trim() || title.trim().length > 200) errors.title = t("common:nav.requiredField");
    if (!text.trim() || text.trim().length > 6000) errors.text = t("common:nav.requiredField");
    if (!isValidTimezone(timezone)) errors.timezone = t("communication.timezoneError");
    if (!selected.length) errors.componentIds = t("communication.affectedError");
    if (Object.keys(errors).length) {
      setFieldErrors(errors); validation.validate(Object.entries(errors).map(([field, message]) => ({ id: `announcement-${field}`, message }))); return;
    }
    if (!validation.validate()) return;
    const requestSnapshot = snapshot; inFlight.current = true; setBusy(true);
    try {
      const saved = await StatusCommunicationService.draft({ ...fields, id: draftId, statusPageId: data.page.id });
      if (current.current === requestSnapshot) { setDraftId(saved.id); setSavedSnapshot(requestSnapshot); setBaseline(requestSnapshot); setLastSaved(requestSnapshot); setEditingTitle(title); }
      if (!isSessionClientActive(client)) return; await changed();
    } catch (caught) { if (!isSessionClientActive(client)) return;
      const fields = extractFieldErrors(caught, errorFields);
      setFieldErrors(fields);
      if (Object.keys(fields).length) validation.show(Object.entries(fields).map(([field, message]) => ({ id: `announcement-${field}`, message })));
      else setError(extractErrorMessage(caught, t("communication.submitError")));
    } finally { inFlight.current = false; setBusy(false); }
  };
  const prepare = async () => {
    if (!draftId || savedSnapshot !== snapshot || inFlight.current) return;
    const requestSnapshot = snapshot; inFlight.current = true; setBusy(true); setError(""); setPreview(null);
    try { const value = await StatusCommunicationService.preview(draftId); if (current.current === requestSnapshot) setPreview({ value, snapshot: requestSnapshot }); }
    catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("communication.error"))); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const publish = async () => {
    if (!draftId || preview?.snapshot !== current.current || savedSnapshot !== current.current || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setLastSaved(null);
    try { await StatusCommunicationService.publish(draftId, preview.value.revision); reset(); if (!isSessionClientActive(client)) return; await changed(); }
    catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("communication.error"))); setPreview(null); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const open = (row: PageCommunication["announcements"][number]) => {
    const value = { previousId: row.publishedAt ? row.id : row.previousId ?? undefined, title: row.title, text: row.text, stage: row.stage, componentIds: row.componentIds.filter(id => data.components.some(component => component.componentId === id)), timezone: row.timezone, maintenance: row.maintenanceId && row.startsAt && row.endsAt ? { id: row.maintenanceId, startsAt: row.startsAt, endsAt: row.endsAt } : undefined };
    const saved = snapshotOf(value, row.maintenanceId ?? "");
    setDraftId(row.publishedAt ? undefined : row.id); setPreviousId(value.previousId); setTitle(value.title); setText(value.text); setStage(value.stage); setSelected(value.componentIds); setTimezone(value.timezone); setScheduleId(row.maintenanceId ?? ""); setMaintenance(value.maintenance);
    validation.clear(); setBaseline(saved); setSavedSnapshot(row.publishedAt ? null : saved); setEditingTitle(row.title); clearFeedback(); setDeleteError(null);
  };
  const remove = async (row: PageCommunication["announcements"][number]) => {
    if (inFlight.current || row.publishedAt) return;
    const accepted = await confirm({ title: t("communication.deleteDraft"), description: t("communication.deleteConfirm", { title: row.title }) + (row.id === draftId && dirty ? ` ${t("common:nav.discard")}` : ""), action: t("communication.deleteDraft"), destructive: true });
    if (!accepted || inFlight.current || !isSessionClientActive(client)) return;
    inFlight.current = true; setBusy(true); setDeleting(row.id); setDeleteError(null);
    try { await StatusCommunicationService.deleteDraft(row.id); if (draftId === row.id) reset(); if (!isSessionClientActive(client)) return; await changed(); }
    catch (caught) { if (!isSessionClientActive(client)) return; setDeleteError({ id: row.id, message: extractErrorMessage(caught, t("communication.deleteError")) }); }
    finally { inFlight.current = false; setBusy(false); setDeleting(null); }
  };
  const fieldMessage = (field: typeof errorFields[number]) => fieldErrors[field] && <p id={`announcement-${field}-error`} className="text-sm text-destructive">{fieldErrors[field]}</p>;
  return <SectionCard title={t("communication.announcements")}><div className="grid min-w-0 gap-4">
      {dialog}
      <p className="text-sm text-muted-foreground">{t("communication.privateHint")}</p>
      <section aria-labelledby="announcement-prerequisites" className="grid min-w-0 gap-1 rounded-md border p-3 text-sm">
        <h3 id="announcement-prerequisites" className="font-medium">{t("communication.prerequisitesHeading")}</h3>
        <ul className="grid gap-1">{!data.page.published && <li><Link className="inline-flex min-h-11 items-center underline" to="." search={previous => ({ ...previous, tab: "general" })}>{t("communication.publishPageFirst")}</Link></li>}<li className="text-muted-foreground">{t("communication.prereqSubscribers")}</li></ul>
        <p className="text-muted-foreground">{t("communication.stateGuide")}</p>
      </section>
      {editingTitle !== null && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><p className="min-w-0 break-words">{t("communication.editing", { title: editingTitle })}</p><Button variant="outline" className={actionClass} disabled={busy} onClick={() => void replace(reset)}>{t("communication.newAnnouncement")}</Button></div>}
      {dirty && <p className="text-sm">{t("statusUX.unsaved")}</p>}
      
      <form ref={form} noValidate className="grid min-w-0 gap-3" onChangeCapture={clearFeedback} onSubmit={event => void save(event)}>
        <FormErrorSummary issues={validation.issues} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <FormField><Label id="announcement-type-label" htmlFor={eligibleSchedules.length || scheduleId ? "announcement-schedule" : undefined}>{t("communication.noticeType")}</Label>
        {eligibleSchedules.length || scheduleId ? <Select value={scheduleId || "__incident"} disabled={busy} onValueChange={selectedId => { clearFeedback(); const value = selectedId === "__incident" ? "" : selectedId; setScheduleId(value); const chosen = schedules.find(window => window.id === value); setMaintenance(chosen?.occurrences[0] ? { id: chosen.id, ...chosen.occurrences[0] } : undefined); if (chosen) { setTimezone(chosen.timezone); setSelected(ids => ids.filter(id => chosen.monitorIds.includes(data.components.find(component => component.componentId === id)?.monitorId ?? ""))); } }}>
          <SelectTrigger id="announcement-schedule"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="__incident">{t("communication.incident")}</SelectItem>
            {scheduleId && !eligibleSchedules.some(window => window.id === scheduleId) && <SelectItem value={scheduleId}>{t("communication.maintenance")}{schedule ? `: ${schedule.name}` : ""}</SelectItem>}
            {eligibleSchedules.map(window => <SelectItem key={window.id} value={window.id}><bdi>{t("communication.maintenance")}: {window.name}</bdi></SelectItem>)}
          </SelectContent>
        </Select> : <p id="announcement-schedule" aria-labelledby="announcement-type-label" className="text-sm">{t("communication.incident")}</p>}</FormField>
        {schedule && <FormField><Label htmlFor="announcement-occurrence">{t("communication.occurrence")}</Label><Select value={String(occurrenceIndex)} disabled={busy} onValueChange={selectedIndex => { clearFeedback(); const value = schedule.occurrences[Number(selectedIndex)]; setMaintenance(value ? { id: schedule.id, ...value } : undefined); setTimezone(schedule.timezone); }}><SelectTrigger id="announcement-occurrence"><SelectValue /></SelectTrigger><SelectContent>{occurrenceIndex === -1 && <SelectItem value="-1">{t("communication.chooseOccurrence")}</SelectItem>}{schedule.occurrences.map((value, index) => <SelectItem key={value.startsAt} value={String(index)}>{date(value.startsAt, timezone)} — {date(value.endsAt, timezone)}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">{t("communication.occurrenceHint")} · <bdi>{timezone}</bdi></p></FormField>}
        <FormField className="form-field"><Label htmlFor="announcement-title">{t("communication.announcementTitle")} <span aria-hidden="true">*</span></Label><Input validateOnBlur aria-label={t("communication.announcementTitle")} id="announcement-title" className="min-h-11" dir="auto" maxLength={200} required value={title} disabled={busy} aria-invalid={!!fieldErrors.title} aria-describedby={fieldErrors.title ? "announcement-title-error" : undefined} onChange={event => setTitle(event.target.value)} />{fieldMessage("title")}</FormField>
        <FormField className="form-field"><Label htmlFor="announcement-text">{t("communication.announcementText")} <span aria-hidden="true">*</span></Label><Textarea aria-label={t("communication.announcementText")} id="announcement-text" dir="auto" maxLength={6000} required value={text} disabled={busy} aria-invalid={!!fieldErrors.text} aria-describedby={fieldErrors.text ? "announcement-text-error" : "announcement-text-hint"} onChange={event => setText(event.target.value)} />{fieldMessage("text")}<p id="announcement-text-hint" className="text-xs text-muted-foreground">{t("communication.textHint")}</p></FormField>
        {!schedule && <FormField><Label htmlFor="announcement-stage">{t("communication.stage")}</Label><Select value={stage} disabled={busy} onValueChange={value => { clearFeedback(); setStage(value as AnnouncementDraft["stage"]); }}><SelectTrigger id="announcement-stage"><SelectValue /></SelectTrigger><SelectContent>{["investigating", "identified", "monitoring", "resolved"].map(value => <SelectItem key={value} value={value}>{t(`communication.stages.${value}`)}</SelectItem>)}</SelectContent></Select></FormField>}
        <FormField className="form-field"><Label htmlFor="announcement-timezone">{t("communication.timezone")}</Label><TimezoneCombobox id="announcement-timezone" value={timezone} disabled={busy || !!schedule} aria-invalid={!!fieldErrors.timezone} aria-describedby={fieldErrors.timezone ? "announcement-timezone-error" : "announcement-timezone-hint"} onValueChange={value => { clearFeedback(); setTimezone(value); }} />{fieldMessage("timezone")}<p id="announcement-timezone-hint" className="text-xs text-muted-foreground">{t("communication.timezoneHint")}</p></FormField>
        <fieldset id="announcement-componentIds" tabIndex={-1} aria-invalid={!!fieldErrors.componentIds} aria-describedby={fieldErrors.componentIds ? "announcement-componentIds-error" : undefined} className="grid gap-2"><legend className="mb-2 text-sm font-medium">{t("communication.affected")}</legend>{!data.components.length && <p className="text-sm">{t("communication.emptyComponentsAction")} <Link className="inline-flex min-h-11 items-center underline" to="." search={previous => ({ ...previous, tab: "components" })}>{t("statusUX.membership")}</Link></p>}{data.components.map(component => <label key={component.componentId} className="flex min-h-11 items-center gap-2 text-sm"><Checkbox aria-label={t("communication.selectComponent", { name: component.name })} disabled={busy || !!schedule && !schedule.monitorIds.includes(component.monitorId)} checked={selected.includes(component.componentId)} onCheckedChange={checked => setSelected(ids => checked === true ? [...ids, component.componentId] : ids.filter(id => id !== component.componentId))} /><bdi className="break-words">{component.name}</bdi></label>)}{fieldMessage("componentIds")}</fieldset>
        <FormFooter sticky className="grid gap-2 bg-card pt-3 pb-[env(safe-area-inset-bottom)] sm:grid sm:[&>*]:w-full">
          {lastSaved === snapshot && !error && <p role="status" className="text-sm">{t("communication.draftSaved")}</p>}
          <FormFooter className="border-t-0 pt-0">
            <Button type="button" variant="secondary" className={actionClass} disabled={busy || !dirty} onClick={() => void replace(reset)}>{t("common:actions.cancel")}</Button>
            <Button className={actionClass} type="submit" disabled={busy || !data.components.length || !!scheduleId && !occurrence}>{t(busy && !deleting ? "communication.saving" : "communication.saveDraft")}</Button>
          </FormFooter>
        </FormFooter>
      </form>
      {draftId && savedSnapshot === snapshot && <Button variant="outline" className={actionClass} disabled={busy} onClick={() => void prepare()}>{t("communication.previewAnnouncement")}</Button>}
      {preview && preview.snapshot === snapshot && savedSnapshot === snapshot && <><PublicAnnouncementPreview preview={preview.value} />{!preview.value.page.published && <p className="text-sm">{t("communication.unpublished")}</p>}<Button className={actionClass} disabled={busy || !preview.value.page.published} onClick={() => void publish()}>{t("communication.publish")}</Button></>}
      <h3 className="font-medium">{t("communication.savedAnnouncements")}</h3>
      {!data.announcements.length && <p className="text-sm text-muted-foreground">{t("communication.noAnnouncements")}</p>}
      <ul className="grid gap-2">{data.announcements.map(row => <li key={row.id} aria-current={row.id === draftId ? "true" : undefined} className={`grid min-w-0 gap-2 rounded-md border p-3 text-sm ${row.id === draftId ? "border-primary bg-muted" : ""}`}>
        <p className="break-words" dir="auto">{row.title}</p>
        {row.id === draftId && <Badge variant="outline">{t("communication.activeDraft")}</Badge>}
        <p>{t(row.publishedAt ? "communication.published" : "communication.draft")} · <bdi>{date(row.publishedAt ?? row.updatedAt, row.timezone)}</bdi></p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" className={actionClass} disabled={busy || row.id === draftId} onClick={() => void replace(() => open(row))}>{t(row.publishedAt ? "communication.postUpdate" : "communication.editDraft")}</Button>{!row.publishedAt && <Button variant="outline" className={`${actionClass} text-destructive`} disabled={busy} onClick={() => void remove(row)}>{t(deleting === row.id ? "communication.deleting" : "communication.deleteDraft")}</Button>}</div>
        {deleteError?.id === row.id && <p role="alert" className="text-destructive">{deleteError.message}</p>}
      </li>)}</ul>
      {data.announcements.length > 0 && <p className="text-xs text-muted-foreground">{t("communication.historyCount", { count: data.announcements.length })}{data.announcements.length >= 100 && <> {t("communication.limitNear")}</>}</p>}
    </div>
  </SectionCard>;
}

export const statusEditorTabs = ["general", "components", "announcements", "subscribers", "history"] as const;
export type StatusEditorTab = typeof statusEditorTabs[number];
export function StatusCommunicationEditor({ pageId, tab = "general", onTabChange }: { pageId: string; tab?: StatusEditorTab; onTabChange?: (tab: StatusEditorTab) => void }) {
  const { t } = useTranslation("uptimeMonitor"); const { data: session } = useSession(); const client = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const [draftEpoch, setDraftEpoch] = useState(0);
  const draftHandlers = useMemo(() => Object.fromEntries(["general", "membership", "components", "announcements", "subscribers", "history"].map(name => [name, (value: boolean) => setDrafts(previous => previous[name] === value ? previous : { ...previous, [name]: value })])), []);
  const dirty = Object.values(drafts).some(Boolean);
  const dialog = useDirtyNavigation(dirty, () => { setDrafts({}); setDraftEpoch(epoch => epoch + 1); });
  const key = uptimeKeys.statusPages.communication(session?.user.id, pageId), page = useStatusPage(pageId);
  const query = useQuery({ queryKey: key, queryFn: () => StatusCommunicationService.one(pageId), enabled: !!session?.user.id });
  useDocumentTitle(query.data ? `${query.data.page.title} — ${t(`statusUX.tabs.${tab}`)}` : t("statusPages.title"));
  const schedules = useQuery({ queryKey: [...uptimeKeys.maintenance.all(), session?.user.id, "notices"], queryFn: () => MaintenanceService.list(), enabled: !!session?.user.id });
  const changed = async () => { await client.invalidateQueries({ queryKey: uptimeKeys.statusPages.all() }); };
  return <div className="grid min-w-0 gap-5">
    {dialog}
    <nav aria-label={t("statusUX.breadcrumb")} className="flex flex-wrap items-center gap-2 text-sm"><Link className="inline-flex min-h-11 items-center underline" to="/dashboard" search={{ panel: "status-pages" }}>{t("statusPages.title")}</Link><span aria-hidden="true">/</span><span className="min-w-0 break-words" dir="auto">{query.data?.page.title ?? t("common:states.loading")}</span></nav>
    {!query.data && <h1 className="app-title">{t(isMissingResource(query.error) || isMissingResource(page.error) ? "statusPage.notFound" : "statusPages.title")}</h1>}
    {query.isPending && <><p role="status">{t("common:states.loading")}</p><div aria-hidden="true" className="grid gap-4"><Skeleton className="h-28" /><Skeleton className="h-12" /><Skeleton className="h-64" /></div></>}
    {(query.error || page.error) && <div role="alert" className="grid gap-2"><p className="text-sm text-destructive">{t(isMissingResource(query.error) || isMissingResource(page.error) ? "statusPage.notFound" : "common:resource.loadError")}</p><Button variant="outline" className={actionClass} onClick={() => { void query.refetch(); void page.refetch(); }}>{t("communication.retry")}</Button></div>}
    {query.data && <>
      <header className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-3"><h1 className="app-title min-w-0 break-words" dir="auto">{query.data.page.title}</h1><Badge variant="outline">{t(query.data.page.published ? "statusPages.published" : "statusPages.draft")}</Badge><DocsHelpLink docPath="status-communication" /></div>
        <p className="text-sm text-muted-foreground">{t("statusUX.componentCount", { count: query.data.components.length })}</p>
        {query.data.page.published && !query.data.components.length && <p role="status" className="text-sm text-warning">{t("statusUX.emptyPublishedWarning")}</p>}
        {page.data && <CopyableUrl url={statusPageUrl(page.data)} label={query.data.page.title} truncateMiddle actions={page.data.isPublished ? <Button variant="outline" asChild><a href={statusPageUrl(page.data)} target="_blank" rel="noopener noreferrer" aria-label={`${t("statusPages.open")}: ${query.data.page.title}`}>{t("statusPages.open")}</a></Button> : undefined} />}
      </header>
      <Tabs key={draftEpoch} value={tab} onValueChange={value => onTabChange?.(value as StatusEditorTab)} className="min-w-0"><div><TabsList aria-label={t("statusPages.title")} className="w-full justify-start">{statusEditorTabs.map(value => <TabsTrigger key={value} value={value}>{t(`statusUX.tabs.${value}`)}</TabsTrigger>)}</TabsList></div>
        <TabsContent value="general" forceMount hidden={tab !== "general"}>{page.data && <StatusPageForm page={page.data} onDirtyChange={draftHandlers.general} embedded onClose={() => void changed()} />}</TabsContent>
        <TabsContent value="components" forceMount hidden={tab !== "components"}><div className="grid gap-5"><StatusPageMembership onDirtyChange={draftHandlers.membership} pageId={pageId} changed={changed} /><ComponentEditor onDirtyChange={draftHandlers.components} data={query.data} changed={changed} /></div></TabsContent>
        <TabsContent value="announcements" forceMount hidden={tab !== "announcements"}>{schedules.error && <div role="alert" className="grid gap-2 text-sm"><p>{t("communication.scheduleError")}</p><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" variant="outline" onClick={() => void schedules.refetch()}>{t("communication.retry")}</Button></div>}<AnnouncementEditor onDirtyChange={draftHandlers.announcements} data={query.data} schedules={schedules.data ?? []} changed={changed} /></TabsContent>
        <TabsContent value="subscribers" forceMount hidden={tab !== "subscribers"}><StatusSubscriptionSettings onDirtyChange={draftHandlers.subscribers} pageId={pageId} published={query.data.page.published} /></TabsContent>
        <TabsContent value="history" forceMount hidden={tab !== "history"}><PublicHistorySettings onDirtyChange={draftHandlers.history} key={`${pageId}:${query.data.page.historyEnabled}`} pageId={pageId} enabled={query.data.page.historyEnabled} changed={changed} /></TabsContent>
      </Tabs>
    </>}
  </div>;
}
