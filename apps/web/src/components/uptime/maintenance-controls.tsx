import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { FormField } from "@/components/ui/form-field";
import { formatInterval } from "@/lib/uptime/format";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatDate, dateTimeFormat } from "@/lib/date-format";
import { requestConfirmation } from "@/lib/confirmation";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMaintenance, useMaintenanceActions } from "@/hooks/uptime/useMaintenance";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { MaintenanceConfig, MaintenanceWindow } from "@/types/maintenance";

export function SuppressionBadge({ value }: { value?: { until: string; maintenance: boolean } | null }) {
  const { t, i18n } = useTranslation("uptimeMonitor");
  const accountTimezone = useAccountTimezone();
  if (!value || Date.parse(value.until) <= Date.now()) return null;
  return <Badge variant="outline" className="whitespace-normal" title={t("maintenance.until", { time: formatDate(value.until, i18n.language, accountTimezone) })}>{t(value.maintenance ? "maintenance.badge" : "maintenance.snoozed")}</Badge>;
}

function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function MaintenanceControls({ monitorIds, embedded = false }: { monitorIds: string[]; embedded?: boolean }) {
  const { t, i18n } = useTranslation("uptimeMonitor");
  const accountTimezone = useAccountTimezone();
  const client = useQueryClient();
  const id = useId(); const query = useMaintenance(); const actions = useMaintenanceActions();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null), submitting = useRef(false);
  const [snoozeReason, setSnoozeReason] = useState(""), [snoozeEnd, setSnoozeEnd] = useState(() => localInput(new Date(Date.now() + 3600_000)));
  const [reason, setReason] = useState(""), [name, setName] = useState("");
  const [start, setStart] = useState(() => localInput(new Date())), [end, setEnd] = useState(() => localInput(new Date(Date.now() + 3600_000)));
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [recurrence, setRecurrence] = useState<MaintenanceConfig["recurrence"]>("once");
  const [previewed, setPreviewed] = useState(""), [error, setError] = useState("");
  const [editing, setEditing] = useState<MaintenanceWindow | null>(null);
  const snoozeValidation = useFormValidation(), scheduleValidation = useFormValidation();
  const scheduleValues = { name, reason, start, end, timezone, recurrence };
  const scheduleDraft = useDraftComparison(scheduleValues);
  const snoozeDraft = useDraftComparison({ snoozeReason, snoozeEnd });
  const scheduleFieldId = (key: string) => `${id}-${key}`;
  const scheduleField = (key: string, help?: string) => scheduleValidation.field(scheduleFieldId(key), [help, scheduleValidation.issues.some(issue => issue.id === scheduleFieldId(key)) ? `${id}-${key}-inline-error` : undefined].filter(Boolean).join(" "));
  const scheduleFieldError = (key: string) => {
    const messages = [...new Set(scheduleValidation.issues.filter(issue => issue.id === scheduleFieldId(key)).map(issue => issue.message))];
    return messages.length ? <p id={`${id}-${key}-inline-error`} className="text-sm text-destructive">{messages.join(" ")}</p> : null;
  };
  const scheduleServerError = (caught: unknown, message: string) => {
    const validation = (caught as { data?: { validationErrors?: { fieldErrors?: Record<string, unknown>; formErrors?: unknown[] } } })?.data?.validationErrors;
    // These schema keys are localized by the maintenance router; retain its safe domain message.
    const domainMessage = extractErrorMessage({ message: (caught as { message?: unknown })?.message }, message);
    const fields: Record<string, string[]> = {};
    const add = (path: string, values: unknown) => {
      for (const value of Array.isArray(values) ? values : []) {
        if (typeof value !== "string" || value.length > 500 || /^\s*[[{]/.test(value)) continue;
        const key = value === "errors.maintenanceDuration" ? "endsAt" : value === "errors.maintenanceTimezone" ? "timezone" : path;
        (fields[key] ??= []).push(value.startsWith("errors.") ? domainMessage : value);
      }
    };
    for (const [path, values] of Object.entries(validation?.fieldErrors ?? {})) add(path, values);
    add("name", validation?.formErrors);

    const mapping = Object.fromEntries(Object.entries({ name: "name", reason: "reason", startsAt: "start", endsAt: "end", timezone: "timezone", recurrence: "recurrence" }).flatMap(([key, field]) => [[key, scheduleFieldId(field)], [`config.${key}`, scheduleFieldId(field)]]));
    if (!scheduleValidation.server({ data: { validationErrors: { fieldErrors: fields } } }, mapping)) scheduleValidation.show([{ id: scheduleFieldId("name"), message }]);
    setPreviewed("");
  };
  const scope = [...new Set(monitorIds)];
  const busy = actions.create.isPending || actions.update.isPending || actions.snooze.isPending || actions.cancel.isPending || actions.resume.isPending || actions.preview.isPending;
  const fingerprint = JSON.stringify({ name, start, end, timezone, recurrence, reason, scope, editing: editing?.id });
  const config = (): MaintenanceConfig => ({ name, reason, startsAt: editing && start === localInput(new Date(editing.startsAt)) ? editing.startsAt : new Date(start).toISOString(), endsAt: editing && end === localInput(new Date(editing.endsAt)) ? editing.endsAt : new Date(end).toISOString(), timezone, recurrence });
  const perform = async (fn: () => Promise<unknown>, success = "maintenance.saved", area?: "schedule" | "snooze") => {
    if (submitting.current) return; submitting.current = true; setError("");
    try { await fn(); if (!isSessionClientActive(client)) return; if (area === "snooze") snoozeDraft.accept(); toast.success(t(success)); } catch (caught) { if (!isSessionClientActive(client)) return; const message = extractErrorMessage(caught, t("maintenance.error")); if (area === "schedule") scheduleServerError(caught, message); else if (area === "snooze") snoozeValidation.show([{ id: `${id}-snooze-until`, message }]); else { setError(message); toast.error(message); } }
    finally { submitting.current = false; }
  };
  const format = (value: string, zone?: string) => dateTimeFormat(i18n.language, zone ?? accountTimezone, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const windows = (query.data ?? []).filter(window => window.monitorIds.some(monitorId => scope.includes(monitorId)));
  const schedules = windows.filter(window => window.kind === "maintenance"), snoozes = windows.filter(window => window.kind === "snooze");
  const zones = typeof Intl.supportedValuesOf === "function" ? ["UTC", ...Intl.supportedValuesOf("timeZone")] : ["UTC", "Europe/Berlin", "America/New_York", "Asia/Tokyo"];
  const edit = (window: MaintenanceWindow) => {
    scheduleDraft.reset({ name: window.name, reason: window.reason, start: localInput(new Date(window.startsAt)), end: localInput(new Date(window.endsAt)), timezone: window.timezone, recurrence: window.recurrence }); scheduleValidation.clear();
    setEditing(window); setName(window.name); setReason(window.reason); setStart(localInput(new Date(window.startsAt))); setEnd(localInput(new Date(window.endsAt))); setTimezone(window.timezone); setRecurrence(window.recurrence); setPreviewed(""); setError("");
    setScheduleOpen(true);
    requestAnimationFrame(() => { nameInput.current?.scrollIntoView({ block: "center" }); nameInput.current?.focus(); });
  };
  const expected = (window: MaintenanceWindow): MaintenanceConfig => ({ name: window.name, reason: window.reason, startsAt: window.startsAt, endsAt: window.endsAt, timezone: window.timezone, recurrence: window.recurrence });
  return <SectionCard title={embedded ? <span className="sr-only" aria-hidden="true">{t("maintenance.title")}</span> : t("maintenance.title")} description={embedded ? undefined : t("maintenance.description")} headerEnd={embedded ? undefined : <DocsHelpLink docPath="maintenance" />}>
    <div className="grid min-w-0 gap-6">
      {scope.length > 1 && <p className="text-sm">{t("maintenance.selected", { count: scope.length })}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <section {...snoozeDraft.formProps} aria-labelledby={`${id}-snooze-title`} className="grid min-w-0 gap-4">
        <h3 id={`${id}-snooze-title`} className="text-base font-semibold">{t("maintenanceUX.snoozeTitle")}</h3>
        <FormField className="form-field"><Label htmlFor={`${id}-snooze-reason`}>{t("maintenance.reason")}</Label><Input validateOnBlur id={`${id}-snooze-reason`} maxLength={1000} value={snoozeReason} onChange={event => setSnoozeReason(event.target.value)} /></FormField>
        <div className="flex flex-wrap gap-2">{([15, 60, 240] as const).map(minutes => <Button key={minutes} type="button" variant="outline" disabled={busy || !scope.length} onClick={() => void perform(() => actions.snooze.mutateAsync({ monitorIds: scope, reason: snoozeReason, endsAt: new Date(Date.now() + minutes * 60_000).toISOString() }), "maintenance.saved", "snooze")}>{t(`maintenanceUX.snooze${minutes}`)}</Button>)}</div>
        <Collapsible><CollapsibleTrigger>{t("maintenance.customEnd")}</CollapsibleTrigger><CollapsibleContent><form ref={snoozeValidation.formRef} noValidate className="form-field" onSubmit={event => { event.preventDefault(); if (!snoozeValidation.validate()) return; void perform(() => actions.snooze.mutateAsync({ monitorIds: scope, reason: snoozeReason, endsAt: new Date(snoozeEnd).toISOString() }), "maintenance.saved", "snooze"); }}><FormErrorSummary issues={snoozeValidation.issues} /><FormField><Label htmlFor={`${id}-snooze-until`}>{t("maintenance.customEnd")}</Label><Input validateOnBlur id={`${id}-snooze-until`} {...snoozeValidation.field(`${id}-snooze-until`)} type="datetime-local" required value={snoozeEnd} onChange={event => setSnoozeEnd(event.target.value)} /></FormField><Button type="submit" variant="outline" className="w-fit" disabled={busy || !snoozeEnd || !scope.length}>{t("maintenance.snooze")}</Button></form></CollapsibleContent></Collapsible>
        {snoozes.length > 0 && <div className="grid gap-2 rounded-md border p-3">{snoozes.map(window => <p className="text-sm" key={window.id}>{t("maintenance.until", { time: format(window.endsAt) })}{scope.length > 1 && <> · {t("maintenance.selected", { count: window.monitorIds.filter(mid => scope.includes(mid)).length })}</>}</p>)}<Button type="button" variant="outline" className="w-fit" disabled={busy} onClick={() => void perform(() => actions.resume.mutateAsync(scope), "maintenance.resumed")}>{t("maintenance.resume")}</Button></div>}
      </section>
      <section {...scheduleDraft.formProps} aria-labelledby={`${id}-schedule-title`} className="grid min-w-0 gap-4 border-t pt-6">
        <h3 id={`${id}-schedule-title`} className="text-base font-semibold">{t("maintenanceUX.scheduleTitle")}</h3>
        <Collapsible open={scheduleOpen} onOpenChange={setScheduleOpen} className="rounded-md border"><CollapsibleTrigger className="ps-4">{t(editing ? "maintenanceUX.edit" : "maintenance.schedule")}</CollapsibleTrigger><CollapsibleContent>
          <form ref={scheduleValidation.formRef} noValidate className="grid min-w-0 gap-y-[var(--field-row-gap)]" onSubmit={event => { event.preventDefault(); if (!scheduleValidation.validate()) return; void perform(async () => { await actions.preview.mutateAsync(config()); setPreviewed(fingerprint); }, "maintenance.previewReady", "schedule"); }}>
            <FormErrorSummary issues={scheduleValidation.issues} />
            {editing && <p className="text-sm">{t("maintenanceUX.editScope", { count: editing.monitorIds.length })}</p>}
            <FormField className="form-field"><Label htmlFor={`${id}-name`}>{t("maintenance.name")}</Label><Input ref={nameInput} id={`${id}-name`} {...scheduleField("name")} value={name} maxLength={100} required onChange={event => setName(event.target.value)} />{scheduleFieldError("name")}</FormField>
            <FormField className="form-field"><Label htmlFor={`${id}-reason`}>{t("maintenance.reason")}</Label><Input id={`${id}-reason`} {...scheduleField("reason")} value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} />{scheduleFieldError("reason")}</FormField>
            <p className="text-sm text-muted-foreground">{t("maintenance.localInput", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
            <div className="form-grid grid-cols-1 sm:grid-cols-2"><FormField className="form-field"><Label htmlFor={`${id}-start`}>{t("maintenance.start")}</Label><Input id={`${id}-start`} {...scheduleField("start")} type="datetime-local" value={start} required onChange={event => setStart(event.target.value)} />{scheduleFieldError("start")}</FormField><FormField className="form-field"><Label htmlFor={`${id}-end`}>{t("maintenance.end")}</Label><Input id={`${id}-end`} {...scheduleField("end")} type="datetime-local" value={end} required onChange={event => setEnd(event.target.value)} />{scheduleFieldError("end")}</FormField></div>
            <div className="form-grid grid-cols-1 sm:grid-cols-2"><FormField className="form-field"><Label htmlFor={`${id}-timezone`}>{t("maintenance.timezone")}</Label><Input id={`${id}-timezone`} {...scheduleField("timezone", `${id}-timezone-help`)} dir="ltr" list={`${id}-zones`} value={timezone} maxLength={100} required onChange={event => setTimezone(event.target.value)} /><datalist id={`${id}-zones`}>{zones.map(zone => <option key={zone} value={zone} />)}</datalist><p id={`${id}-timezone-help`} className="text-sm text-muted-foreground">{t("maintenanceUX.timezoneHelp")}</p>{scheduleFieldError("timezone")}</FormField><FormField className="form-field"><Label htmlFor={`${id}-recurrence`}>{t("maintenance.recurrence")}</Label><Select value={recurrence} onValueChange={next => setRecurrence(next as MaintenanceConfig["recurrence"])}><SelectTrigger id={`${id}-recurrence`} {...scheduleField("recurrence")}><SelectValue /></SelectTrigger><SelectContent>{["once", "daily", "weekly"].map(value => <SelectItem key={value} value={String(value)}>{t(`maintenance.${value}`)}</SelectItem>)}</SelectContent></Select>{scheduleFieldError("recurrence")}</FormField></div>
            <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" disabled={busy}>{t("maintenance.preview")}</Button><Button type="button" disabled={busy || Boolean(editing && !scheduleDraft.dirty) || previewed !== fingerprint || !actions.preview.data?.length} onClick={() => void perform(async () => { if (editing) await actions.update.mutateAsync({ id: editing.id, config: config(), expected: expected(editing) }); else await actions.create.mutateAsync({ monitorIds: scope, config: config() }); scheduleDraft.accept(); scheduleValidation.clear(); setPreviewed(""); setEditing(null); setScheduleOpen(false); }, "maintenance.saved", "schedule")}>{t("maintenance.saveSchedule")}</Button>{editing && <Button type="button" variant="outline" disabled={busy} onClick={() => { scheduleDraft.reset({ ...scheduleValues, name: "" }); scheduleValidation.clear(); setEditing(null); setName(""); setPreviewed(""); setScheduleOpen(false); }}>{t("maintenanceUX.cancelEdit")}</Button>}</div>
            {previewed === fingerprint && <ul aria-live="polite" className="text-sm">{actions.preview.data?.map(occurrence => <li key={occurrence.startsAt}><time dateTime={occurrence.startsAt}>{format(occurrence.startsAt, timezone)}</time> – <time dateTime={occurrence.endsAt}>{format(occurrence.endsAt, timezone)}</time> <bdi>{timezone}</bdi></li>)}</ul>}
            <p className="text-sm text-muted-foreground">{t("maintenance.policy")}</p>
          </form>
        </CollapsibleContent></Collapsible>
        <p className="text-sm text-muted-foreground">{t("maintenanceUX.futureEdits")}</p>
        {query.isLoading ? <p role="status">{t("maintenance.loading")}</p> : query.isError ? <div role="alert"><p>{t("maintenance.error")}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("maintenance.retry")}</Button></div> : schedules.length ? <ul className="grid gap-3">{schedules.map(window => <li key={window.id} className="grid min-w-0 gap-2 rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span dir="auto" className="min-w-0 break-words font-medium">{window.name}</span><SuppressionBadge value={window.suppression} /></div><p className="text-sm">{t("maintenance.selected", { count: window.monitorIds.length })}</p>{window.reason && <p dir="auto" className="break-words text-sm text-muted-foreground">{window.reason}</p>}<p className="text-sm"><bdi>{window.timezone}</bdi> · {t(`maintenance.${window.recurrence}`)}</p>{window.occurrences.slice(0, 1).map(occurrence => <p className="text-sm" key={occurrence.startsAt}><time dateTime={occurrence.startsAt}>{format(occurrence.startsAt, window.timezone)}</time> – <time dateTime={occurrence.endsAt}>{format(occurrence.endsAt, window.timezone)}</time></p>)}<div className="flex flex-wrap gap-2">{Date.parse(window.startsAt) > Date.now() && <Button type="button" variant="outline" disabled={busy} onClick={() => edit(window)}>{t("maintenanceUX.edit")}</Button>}<Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={async () => { if (await requestConfirmation(t("maintenance.cancelConfirm", { count: window.monitorIds.length, name: window.name }), { title: t("maintenance.cancel"), action: t("maintenance.cancel") })) void perform(() => actions.cancel.mutateAsync(window.id), "maintenance.cancelled"); }}>{t("maintenance.cancel")}</Button></div></li>)}</ul> : <p className="text-sm text-muted-foreground">{t("maintenance.empty")}</p>}
      </section>
    </div>
  </SectionCard>;
}

export function MaintenanceDialog({ monitorIds }: { monitorIds: string[] }) {
  const { t } = useTranslation("uptimeMonitor");
  return <Dialog><DialogTrigger asChild><Button type="button" variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal">{t("maintenance.title")}</Button></DialogTrigger><DialogContent className="sm:max-w-[var(--dialog-standard)]"><DialogHeader><DialogTitle>{t("maintenance.title")}</DialogTitle><DialogDescription>{t("maintenance.description")}</DialogDescription></DialogHeader><MaintenanceControls monitorIds={monitorIds} embedded /></DialogContent></Dialog>;
}
