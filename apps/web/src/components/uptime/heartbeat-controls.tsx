import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { FormField } from "@/components/ui/form-field";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatIncidentTimestamp } from "@/lib/uptime/incident-time";
import { requestConfirmation } from "@/lib/confirmation";
import { useElapsedClock } from "@/hooks/useElapsedClock";
import { formatSeconds } from "@/lib/uptime/number-format";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "@/lib/uptime/format";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { MaintenanceControls } from "./maintenance-controls";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { useSession } from "@/lib/auth-client";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { HeartbeatService } from "@/services/uptime/heartbeatService";
import { HeartbeatEndpoint } from "./heartbeat-endpoint";
import type { HeartbeatConfiguration } from "@/types/heartbeat";
import type { UptimeMonitor } from "@/types/uptime";

function SecretReveal({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useTranslation("uptimeMonitor");
  return <div className="grid min-w-0 gap-3"><HeartbeatEndpoint token={token} /><Button onClick={onDone}>{t("heartbeat.done")}</Button></div>;
}

function HeartbeatForm({ initial, onSave, onCancel, label }: { onCancel?: () => void; initial: HeartbeatConfiguration; onSave: (input: HeartbeatConfiguration) => Promise<void>; label: string }) {
  const { t, i18n } = useTranslation("uptimeMonitor"); const [name, setName] = useState(initial.name); const [interval, setInterval] = useState(String(initial.interval)); const [grace, setGrace] = useState(String(initial.graceSeconds)); const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  const validation = useFormValidation();
  const [intervalUnit, setIntervalUnit] = useState(1), [graceUnit, setGraceUnit] = useState(1);
  const unitOptions = [[1, "seconds"], [60, "minutes"], [3600, "hours"], [86400, "days"]] as const;
  const unitSelector = (kind: "interval" | "grace", unit: number, change: (value: number) => void) => <Select value={String(unit)} onValueChange={value => change(Number(value))} disabled={busy}><SelectTrigger className="w-32 shrink-0" aria-label={t(`heartbeat.${kind}Unit`)}><SelectValue /></SelectTrigger><SelectContent>{unitOptions.map(([value, key]) => <SelectItem key={key} value={String(value)}>{t(`heartbeat.units.${key}`)}</SelectItem>)}</SelectContent></Select>;
  const seconds = (value: string, unit: number) => Number((Number(value) * unit).toFixed(8));
  const intervalSeconds = seconds(interval, intervalUnit), graceSeconds = seconds(grace, graceUnit);
  const draft = useDraftComparison({ name, interval: interval === "" ? "" : String(intervalSeconds), grace: grace === "" ? "" : String(graceSeconds) });
  const { reset } = draft;
  const dirty = useRef(false);
  dirty.current = draft.dirty;
  useEffect(() => { if (!dirty.current) { setName(initial.name); setIntervalUnit(1); setGraceUnit(1); setInterval(String(initial.interval)); setGrace(String(initial.graceSeconds)); reset({ name: initial.name, interval: String(initial.interval), grace: String(initial.graceSeconds) }); } }, [initial.name, initial.interval, initial.graceSeconds, reset]);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (busy || !validation.validate([...(Number.isInteger(intervalSeconds) ? [] : [{ id: "heartbeat-interval", message: t("heartbeat.wholeSeconds") }]), ...(Number.isInteger(graceSeconds) ? [] : [{ id: "heartbeat-grace", message: t("heartbeat.wholeSeconds") }])])) return; setBusy(true); setError(""); try { await onSave({ ...initial, name, interval: intervalSeconds, graceSeconds }); draft.accept(); dirty.current = false; } catch (caught) { if (!validation.server(caught, { name: "heartbeat-name", interval: "heartbeat-interval", graceSeconds: "heartbeat-grace" })) setError(extractErrorMessage(caught, t("heartbeat.error"))); } finally { setBusy(false); } };
  return <><form {...draft.formProps} ref={validation.formRef} noValidate onSubmit={event => void submit(event)} className="grid min-w-0 gap-6"><FormErrorSummary issues={validation.issues} /><FormField className="form-field"><Label htmlFor="heartbeat-name">{t("heartbeat.name")}</Label><Input {...validation.field("heartbeat-name")} validateOnBlur id="heartbeat-name" placeholder={t("formUX.example", { value: "nightly-backup" })} className="min-h-11" value={name} required maxLength={200} onChange={event => setName(event.target.value)} disabled={busy} /></FormField><FormField className="form-field"><Label htmlFor="heartbeat-interval">{t("heartbeat.interval")}</Label><div className="flex min-w-0 gap-2"><Input {...validation.field("heartbeat-interval", "heartbeat-interval-help")} validateOnBlur id="heartbeat-interval" className="min-h-11 min-w-0" type="number" min={30 / intervalUnit} max={604800 / intervalUnit} step="any" value={interval} required onChange={event => setInterval(event.target.value)} disabled={busy} />{unitSelector("interval", intervalUnit, next => { if (interval !== "") setInterval(String(intervalSeconds / next)); setIntervalUnit(next); })}</div><p id="heartbeat-interval-help" className="text-sm text-muted-foreground">{t("heartbeat.intervalHelp")}</p></FormField><FormField className="form-field"><Label htmlFor="heartbeat-grace">{t("heartbeat.grace")}</Label><div className="flex min-w-0 gap-2"><Input {...validation.field("heartbeat-grace", "heartbeat-deadlines")} validateOnBlur id="heartbeat-grace" className="min-h-11 min-w-0" type="number" min={0} max={604800 / graceUnit} step="any" value={grace} required onChange={event => setGrace(event.target.value)} disabled={busy} />{unitSelector("grace", graceUnit, next => { if (grace !== "") setGrace(String(graceSeconds / next)); setGraceUnit(next); })}</div><p id="heartbeat-deadlines" className="text-sm text-muted-foreground">{t("heartbeat.deadlines")}</p>{Number.isFinite(intervalSeconds) && intervalSeconds >= 30 && Number.isFinite(graceSeconds) && graceSeconds >= 0 && <p className="text-sm">{t("heartbeat.deadlineExample", { interval: formatSeconds(intervalSeconds, i18n.language), grace: formatSeconds(graceSeconds, i18n.language), total: formatSeconds(intervalSeconds + graceSeconds, i18n.language) })}</p>}</FormField>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" data-dialog-discard disabled={busy} onClick={() => { if (onCancel) onCancel(); else { setName(initial.name); setIntervalUnit(1); setGraceUnit(1); setInterval(String(initial.interval)); setGrace(String(initial.graceSeconds)); setError(""); dirty.current = false; } }}>{t("actions.cancel")}</Button><Button type="submit" className="min-h-11 w-full sm:w-auto sm:justify-self-start" disabled={busy || (!onCancel && !draft.dirty)}>{label}</Button></DialogFooter></form></>;
}

function HeartbeatCreateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("uptimeMonitor"); const client = useQueryClient(); const [token, setToken] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const save = async (input: HeartbeatConfiguration) => { setCreating(true); try { const created = await HeartbeatService.create(input); setToken(created.token); void client.invalidateQueries({ queryKey: uptimeKeys.all() }); } finally { setCreating(false); } };
  return <Dialog open onOpenChange={open => { if (!open && !creating) onClose(); }}><DialogContent className={layoutTokens.createDialog}><DialogHeader><DialogTitle>{t("heartbeat.add")}</DialogTitle><DialogDescription>{t("heartbeat.description")} <DocsHelpLink docPath="heartbeat" /></DialogDescription></DialogHeader>{token ? <SecretReveal token={token} onDone={onClose} /> : <><HeartbeatForm initial={{ name: "", interval: 300, graceSeconds: 60, active: true, tags: [] }} label={t("heartbeat.create")} onSave={save} onCancel={onClose} /></>}</DialogContent></Dialog>;
}
export function HeartbeatCreateControl({ open: controlledOpen, onOpenChange, hideTrigger = false }: { open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean } = {}) {
  const { t } = useTranslation("uptimeMonitor"); const [localOpen, setLocalOpen] = useState(false); const open = controlledOpen ?? localOpen; const setOpen = onOpenChange ?? setLocalOpen;
  return <>{!hideTrigger && <Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start" onClick={() => setOpen(true)}>{t("heartbeat.add")}</Button>}{open && <HeartbeatCreateDialog onClose={() => setOpen(false)} />}</>;
}

export function HeartbeatPanel({ monitor, editing = false }: { monitor: UptimeMonitor; editing?: boolean }) {
  const accountTimezone = useAccountTimezone();
  const { t, i18n } = useTranslation("uptimeMonitor"); const { data: session } = useSession(); const client = useQueryClient(); const [token, setToken] = useState<string | null>(null); const [error, setError] = useState(""); const [rotating, setRotating] = useState(false);
  const query = useQuery({ queryKey: uptimeKeys.heartbeat.detail(monitor.uptimeMonitorId, session?.user.id), queryFn: () => HeartbeatService.one(monitor.uptimeMonitorId), enabled: Boolean(session?.user.id), refetchInterval: 15_000 });
  const runs = useQuery({ queryKey: uptimeKeys.heartbeat.runs(monitor.uptimeMonitorId, session?.user.id), queryFn: () => HeartbeatService.runs(monitor.uptimeMonitorId), enabled: Boolean(session?.user.id) && !editing, refetchInterval: 15_000 });
  const now = useElapsedClock(Boolean(query.data));
  const date = (value: string | null) => value ? formatIncidentTimestamp(value, i18n.language, accountTimezone) : t("heartbeat.none");
  const rotate = async () => { if (!await requestConfirmation(t("heartbeat.rotateConfirm"), { title: t("heartbeat.rotate"), action: t("heartbeat.rotate") })) return; setRotating(true); setError(""); try { setToken((await HeartbeatService.rotate(monitor.uptimeMonitorId)).token); } catch (caught) { setError(extractErrorMessage(caught, t("heartbeat.error"))); } finally { setRotating(false); } };
  return <SectionCard title={t("heartbeat.title")} description={t("heartbeat.description")} headerEnd={<DocsHelpLink docPath="heartbeat" />}><div className="grid min-w-0 gap-4">{query.isPending && <p role="status">{t("heartbeat.loading")}</p>}{(query.error || runs.error || error) && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{error || extractErrorMessage(query.error ?? runs.error, t("heartbeat.error"))}</p><Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start" onClick={() => { void query.refetch(); if (!editing) void runs.refetch(); }}>{t("heartbeat.retry")}</Button></div>}{query.data && <><HeartbeatEndpoint key={token ?? monitor.uptimeMonitorId} monitorId={monitor.uptimeMonitorId} /><p role="status" aria-label={t("heartbeat.title")} className="text-sm font-medium">{(() => {
    // Deadline state is derived from the receipt schedule, separate from when it was last evaluated.
    const expected = Date.parse(query.data.expectedAt), final = expected + query.data.graceSeconds * 1000;
    const at = (iso: number) => formatIncidentTimestamp(iso, i18n.language, accountTimezone);
    const relative = (iso: number) => formatRelativeTime(new Date(iso).toISOString(), i18n.language, now);
    if (!monitor.active) return t("heartbeat.paused");
    if (now >= final) return t("heartbeat.overdueSince", { date: at(final) });
    if (query.data.nextDeadline === null) return t("heartbeat.stateDown");
    if (now < expected) return t(query.data.lastSuccessAt ? "heartbeat.stateOnTime" : query.data.lastReceivedAt ? "heartbeat.stateAwaitingSuccess" : "heartbeat.stateNone", { relative: relative(expected), absolute: at(expected) });
    if (now < final) return t("heartbeat.stateLate", { relative: relative(expected), absolute: at(final) });
    return t("heartbeat.stateOverdue", { relative: relative(final), absolute: at(final) });
  })()}</p><dl className="grid min-w-0 gap-3 sm:grid-cols-2">{[["expected", date(query.data.expectedAt)], ["finalDeadline", date(new Date(Date.parse(query.data.expectedAt) + query.data.graceSeconds * 1000).toISOString())], ["received", query.data.lastReceivedAt ? date(query.data.lastReceivedAt) : t("heartbeat.never")], ["success", date(query.data.lastSuccessAt)], ["runDuration", query.data.lastRunDurationMs == null ? t("heartbeat.none") : formatSeconds(query.data.lastRunDurationMs / 1000, i18n.language)]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{t(`heartbeat.${label}`)}</dt><dd className="break-words text-sm"><bdi>{value}</bdi></dd></div>)}</dl><p className="text-sm text-muted-foreground">{t("heartbeat.timezone", { timezone: accountTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>{editing ? <><HeartbeatForm key={monitor.uptimeMonitorId} initial={{ name: monitor.name, interval: query.data.interval, graceSeconds: query.data.graceSeconds, active: monitor.active, tags: monitor.tags }} label={t("heartbeat.save")} onSave={async input => { await HeartbeatService.update(monitor.uptimeMonitorId, input); await client.invalidateQueries({ queryKey: uptimeKeys.all() }); }} /><Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start" disabled={rotating} onClick={() => void rotate()}>{t("heartbeat.rotate")}</Button><MaintenanceControls monitorIds={[monitor.uptimeMonitorId]} /></> : <div className="grid gap-2"><h3 className="text-sm font-medium">{t("heartbeat.runs")}</h3>{runs.isPending ? <p role="status">{t("heartbeat.loading")}</p> : runs.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t("heartbeat.noRuns")}</p> : runs.data?.map(run => <div key={run.id} className="grid gap-1 rounded-md border p-3 text-sm"><bdi className="break-all font-medium">{run.runId}</bdi><p>{t(`heartbeat.run.${run.outcome}`)}</p><p><bdi>{date(run.startedAt)} → {date(run.finishedAt)}</bdi></p>{run.metadata && <p><bdi>{[run.metadata.environment, run.metadata.version].filter(Boolean).join(" · ")}</bdi></p>}</div>)}</div>}</>}{token && <Dialog open onOpenChange={open => { if (!open) setToken(null); }}><DialogContent><DialogHeader><DialogTitle>{t("heartbeat.rotate")}</DialogTitle><DialogDescription>{t("heartbeat.oneTime")}</DialogDescription></DialogHeader><SecretReveal token={token} onDone={() => setToken(null)} /></DialogContent></Dialog>}</div></SectionCard>;
}
