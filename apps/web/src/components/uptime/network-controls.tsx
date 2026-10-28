import { isSessionClientActive } from "@/lib/session-query-client";
import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { formattingLocale } from "@/lib/formatting-locale";
import { FormField } from "@/components/ui/form-field";
import { formatInterval } from "@/lib/uptime/format";
import { TemplateChannelLabel } from "./template-channel-label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { DEFAULT_FAILURE_THRESHOLD, MAX_MONITOR_TIMEOUT_MS } from "@pulsy/db/monitor-defaults";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { apiDnsConfiguration, apiTcpConfiguration, apiNetworkMonitor, type DnsConfiguration, type NetworkMonitorInput } from "@pulsy/db/validation-network";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { NetworkMonitorService } from "@/services/uptime/networkMonitorService";
import { MonitorTemplatesService } from "@/services/uptime/monitorTemplatesService";
import { LatencyPolicyEditor } from "./latency-policy-editor";
import { MaintenanceControls } from "./maintenance-controls";
import type { UptimeMonitor } from "@/types/uptime";
import { useTagEntry } from "@/hooks/uptime/useTagEntry";
import type { MonitorCreateDialogProps } from "./monitor-create-dialog";

const blank: NetworkMonitorInput = { name: "", configuration: { type: "dns", hostname: "", recordType: "A", mode: "exists", expected: [] }, interval: 300, timeout: 10000, failureThreshold: DEFAULT_FAILURE_THRESHOLD, active: true, tags: [] };
export function NetworkForm({ initial = blank, onSave, onCancel, label, lockType = false, templateMode = false, channels }: { initial?: NetworkMonitorInput; onCancel?: () => void; onSave: (input: NetworkMonitorInput) => Promise<void>; label: string; lockType?: boolean; templateMode?: boolean; channels?: MonitorCreateDialogProps["channelOptions"] }) {
  const { t, i18n } = useTranslation("uptimeMonitor");
  const [name, setName] = useState(initial.name), [type, setType] = useState(initial.configuration.type), [hostname, setHostname] = useState(initial.configuration.hostname);
  const [recordType, setRecordType] = useState<DnsConfiguration["recordType"]>(initial.configuration.type === "dns" ? initial.configuration.recordType : "A");
  const [mode, setMode] = useState<"exists" | "matches">(initial.configuration.type === "dns" ? initial.configuration.mode : "exists");
  const [expected, setExpected] = useState(JSON.stringify(initial.configuration.type === "dns" ? initial.configuration.expected : [], null, 2));
  const [port, setPort] = useState(String(initial.configuration.type === "tcp" ? initial.configuration.port : 443));
  const [interval, setInterval] = useState(String(initial.interval)), [timeout, setTimeoutValue] = useState(String(initial.timeout)), [failures, setFailures] = useState(String(initial.failureThreshold));
  const [active, setActive] = useState(initial.active), [tags, setTags] = useState(initial.tags), [tag, setTag] = useState("");
  const [latencyPolicy, setLatencyPolicy] = useState(initial.latencyPolicy ?? null), [channelIds, setChannelIds] = useState(initial.channelIds ?? []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const validation = useFormValidation();
  const draft = useDraftComparison({ name, type, hostname, recordType, mode, expected, port, interval, timeout, failures, active, tags, tag, latencyPolicy, channelIds });
  const form = validation.formRef;
  const fieldErrors = Object.fromEntries(validation.issues.map(issue => [issue.id.replace(/^network-/, ""), issue.message]));
  const fieldProps = (field: string) => ({ "aria-invalid": Boolean(fieldErrors[field]), "aria-describedby": fieldErrors[field] ? `network-${field}-error` : undefined });
  const fieldError = (field: string) => fieldErrors[field] ? <p id={`network-${field}-error`} role="alert" className="text-sm text-destructive">{fieldErrors[field]}</p> : null;
  const rejectFields = (errors: Record<string, string>) => {
    validation.show(Object.entries(errors).map(([field, message]) => ({ id: `network-${field}`, message, label: t(`network.${field}`) })));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setError(""); validation.clear();
    try {
      const errors: Record<string, string> = {};
      let records: unknown = [];
      if (type === "dns" && mode === "matches") {
        try { records = JSON.parse(expected); }
        catch { errors.expected = t("network.validation.json"); }
      }
      const configuration = type === "tcp" ? { type, hostname, port: Number(port) } : { type, hostname, recordType, mode, expected: records };
      const values = { name, interval: Number(interval), timeout: Number(timeout), failureThreshold: Number(failures) };
      for (const field of ["name", "interval", "timeout", "failureThreshold"] as const) {
        if (!apiNetworkMonitor.shape[field].safeParse(values[field]).success) errors[field === "failureThreshold" ? "failures" : field] = t(`network.validation.${field}`);
      }
      const configured = (type === "tcp" ? apiTcpConfiguration : apiDnsConfiguration).safeParse(configuration);
      if (!configured.success) {
        for (const issue of configured.error.issues) {
          const field = issue.path[0] === "hostname" ? "hostname" : issue.path[0] === "port" ? "port" : "expected";
          errors[field] ??= t(field === "expected" ? `network.validation.${Array.isArray(records) && records.length === 0 ? "empty" : `records_${recordType}`}` : `network.validation.${field}`);
        }
      }
      if (Object.keys(errors).length) { rejectFields(errors); return; }
      if (!validation.validate()) return;

      const input = apiNetworkMonitor.parse({ name, configuration, interval: Number(interval), timeout: Number(timeout), failureThreshold: Number(failures), active, tags, latencyPolicy, channelIds });
      setBusy(true); await onSave(input); draft.accept();
    } catch (caught) {
      if (validation.server(caught, { "configuration.hostname": "network-hostname", name: "network-name" })) return;
      setError(caught instanceof SyntaxError || caught instanceof Error && caught.name === "ZodError" ? t("network.invalid") : extractErrorMessage(caught, t("network.error"))); }
    finally { setBusy(false); }
  };
  const tagEntry = useTagEntry({ tags, setTags, input: tag, setInput: setTag });
  const addTag = tagEntry.commit;
  return <><form {...draft.formProps} ref={form} noValidate onSubmit={event => void submit(event)} className="grid min-w-0 grid-cols-1 gap-6">
    <FormErrorSummary issues={validation.issues} />
    <fieldset className="grid min-w-0 gap-y-[var(--field-row-gap)]"><legend className="mb-4 text-base font-semibold">{t("creation.identity")}</legend>
    <FormField className="form-field"><Label htmlFor="network-name">{t("network.name")}</Label><Input id="network-name" placeholder={t(templateMode ? "templates.templateName" : type === "dns" ? "network.dnsName" : "network.tcpName")} {...fieldProps("name")} value={name} maxLength={templateMode ? 80 : 255} required disabled={busy} onChange={event => setName(event.target.value)} className="min-h-11" />{fieldError("name")}</FormField>
    <FormField className="form-field"><Label htmlFor="network-type">{t("network.type")}</Label><Select value={type} disabled={busy || lockType} onValueChange={next => setType(next as "dns" | "tcp")}><SelectTrigger id="network-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dns">DNS</SelectItem><SelectItem value="tcp">TCP</SelectItem></SelectContent></Select>{lockType && <p className="text-sm text-muted-foreground">{t("creation.immutableType")}</p>}</FormField>
    <FormField className="form-field"><Label htmlFor="network-hostname">{t("network.hostname")}</Label><Input id="network-hostname" placeholder={t("formUX.example", { value: "api.example.com" })} {...fieldProps("hostname")} value={hostname} required maxLength={253} dir="ltr" disabled={busy} onChange={event => setHostname(event.target.value)} className="min-h-11" />{fieldError("hostname")}</FormField>
    {type === "tcp" ? <><p className="text-sm text-muted-foreground">{t("network.tcpMeaning")} <DocsHelpLink docPath="dns-tcp" /></p><FormField className="form-field"><Label htmlFor="network-port">{t("network.port")}</Label><Input id="network-port" {...fieldProps("port")} type="number" min={1} max={65535} required value={port} disabled={busy} onChange={event => setPort(event.target.value)} className="min-h-11" />{fieldError("port")}</FormField></> : <>
      <FormField className="form-field"><Label htmlFor="network-record">{t("network.recordType")}</Label><Select value={recordType} disabled={busy} onValueChange={next => setRecordType(next as DnsConfiguration["recordType"])}><SelectTrigger id="network-record"><SelectValue /></SelectTrigger><SelectContent>{["A", "AAAA", "CNAME", "MX", "TXT"].map(value => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></FormField>
      <FormField className="form-field"><Label htmlFor="network-mode">{t("network.mode")}</Label><Select value={mode} disabled={busy} onValueChange={next => setMode(next as "exists" | "matches")}><SelectTrigger id="network-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="exists">{t("network.exists")}</SelectItem><SelectItem value="matches">{t("network.matches")}</SelectItem></SelectContent></Select><p className="text-sm text-muted-foreground">{t("network.dnsMeaning")} <DocsHelpLink docPath="dns-tcp" /></p></FormField>
      {mode === "matches" && <><FormField className="form-field"><Label htmlFor="network-expected">{t("network.expected")}</Label><textarea id="network-expected" {...fieldProps("expected")} value={expected} dir="ltr" maxLength={65536} disabled={busy} onChange={event => setExpected(event.target.value)} className="min-h-32 w-full min-w-0 rounded-md border border-input bg-background p-3 font-mono text-sm" />{fieldError("expected")}<p className="break-words text-sm text-muted-foreground">{t(recordType === "MX" ? "network.mxExample" : recordType === "TXT" ? "network.txtExample" : "network.addressExample")}</p></FormField></>}
    </>}
    </fieldset>
    <fieldset className="grid min-w-0 gap-y-[var(--field-row-gap)]"><legend className="mb-4 text-base font-medium">{t("creation.checkBehavior")}</legend>
    <div className="form-grid grid-cols-1"><FormField className="form-field"><Label htmlFor="network-interval">{t("network.interval")}</Label><Select value={interval} disabled={busy} onValueChange={next => setInterval(next)}><SelectTrigger id="network-interval" {...fieldProps("interval")}><SelectValue /></SelectTrigger><SelectContent>{[30, 60, 300, 600, 1800, 3600].map(value => <SelectItem key={value} value={String(value)}>{formatInterval(value, t, i18n.language)}</SelectItem>)}</SelectContent></Select>{fieldError("interval")}</FormField>
    <FormField className="form-field"><Label htmlFor="network-timeout">{t("network.timeout")}</Label><Input id="network-timeout" {...fieldProps("timeout")} type="number" min={1000} max={MAX_MONITOR_TIMEOUT_MS} value={timeout} required disabled={busy} aria-describedby={["network-timeout-help", fieldProps("timeout")["aria-describedby"]].filter(Boolean).join(" ")} onChange={event => setTimeoutValue(event.target.value)} className="min-h-11" /><p id="network-timeout-help" className="text-sm text-muted-foreground">{t("network.timeoutHelp", { max: new Intl.NumberFormat(formattingLocale(i18n.language)).format(MAX_MONITOR_TIMEOUT_MS) })}</p>{fieldError("timeout")}</FormField>
    <FormField className="form-field"><Label htmlFor="network-failures">{t("network.failures")}</Label><Input id="network-failures" {...fieldProps("failures")} type="number" min={1} max={10} value={failures} required disabled={busy} aria-describedby={["network-failures-help", fieldProps("failures")["aria-describedby"]].filter(Boolean).join(" ")} onChange={event => setFailures(event.target.value)} className="min-h-11" /><p id="network-failures-help" className="text-sm text-muted-foreground">{t("network.failuresHelp")}</p>{fieldError("failures")}</FormField></div>
    </fieldset>
    <fieldset className="grid min-w-0 gap-y-[var(--field-row-gap)]"><legend className="mb-4 text-base font-medium">{t("creation.tagsAndAlerts")}</legend>
    {!templateMode && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={active} disabled={busy} onChange={event => setActive(event.target.checked)} />{t("network.active")}</label>}
    <FormField className="form-field"><Label htmlFor="network-tag">{t("network.tags")}</Label><div className="flex min-w-0 gap-2"><Input id="network-tag" placeholder={t("tags.placeholder")} value={tag} maxLength={50} disabled={busy || tags.length >= 10} onChange={tagEntry.onChange} onKeyDown={tagEntry.onKeyDown} aria-describedby="network-tag-feedback" className="min-h-11 min-w-0" /><Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy || !tag.trim() || tags.length >= 10} onClick={addTag}>{t("network.addTag")}</Button></div><p id="network-tag-feedback" role="status" className="text-sm text-muted-foreground">{tagEntry.feedback}</p></FormField>
    <div className="flex flex-wrap gap-2">{tags.map(value => <Button key={value} type="button" variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal" disabled={busy} aria-label={t("network.removeTag", { tag: value })} onClick={() => setTags(values => values.filter(item => item !== value))}><bdi className="break-all">{value}</bdi><span aria-hidden> ×</span></Button>)}</div>
    {channels?.map(channel => <label key={channel.id} className="flex min-h-11 min-w-0 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={channelIds.includes(channel.id)} disabled={busy} onChange={event => setChannelIds(ids => event.target.checked ? [...ids, channel.id] : ids.filter(id => id !== channel.id))} /><TemplateChannelLabel channel={channel} /></label>)}
    </fieldset>
    <fieldset className="grid min-w-0 gap-4"><legend className="mb-4 text-base font-medium">{t("creation.alertPolicy")}</legend><LatencyPolicyEditor value={latencyPolicy} onChange={setLatencyPolicy} monitorType={type} /></fieldset>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}<DialogFooter>{onCancel && <Button type="button" variant="outline" data-dialog-discard disabled={busy} onClick={onCancel}>{t("actions.cancel")}</Button>}<Button type="submit" disabled={busy || (!onCancel && !draft.dirty)} className="min-h-11 h-auto max-w-full whitespace-normal">{label}</Button></DialogFooter>
  </form></>;
}
export function NetworkCreateControl() { const { t, i18n } = useTranslation("uptimeMonitor"); const [open, setOpen] = useState(false); return <><Button variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal" onClick={() => setOpen(true)}>{t("network.create")}</Button>{open && <NetworkMonitorDialog open onOpenChange={setOpen} />}</>; }
export function NetworkMonitorDialog({ open, onOpenChange, initial, templateMode = false, fromTemplate = false, templateId, channelOptions, onTemplateSaved }: MonitorCreateDialogProps) {
  const { t, i18n } = useTranslation("uptimeMonitor"); const client = useQueryClient(); const configuration = initial?.configuration;
  const input: NetworkMonitorInput = initial ? { name: fromTemplate ? "" : initial.name, configuration: configuration?.networkConfig ?? blank.configuration, interval: configuration!.interval as NetworkMonitorInput["interval"], timeout: configuration!.timeout, failureThreshold: configuration!.failureThreshold, active: !templateMode, tags: configuration!.tags, latencyPolicy: configuration!.latencyPolicy, channelIds: configuration!.channelIds } : blank;
  const save = async (values: NetworkMonitorInput) => {
    if (templateMode) {
      const saved = await MonitorTemplatesService.save({ id: templateId, name: values.name, needsRequestValues: false, configuration: { monitorType: values.configuration.type, networkConfig: values.configuration, method: "GET", expectedStatus: 200, timeout: values.timeout, interval: values.interval, failureThreshold: values.failureThreshold, tags: values.tags, latencyPolicy: values.latencyPolicy, channelIds: values.channelIds } });
      if (!isSessionClientActive(client)) return;
      onTemplateSaved?.(saved);
    } else await NetworkMonitorService.create(values);
    await client.invalidateQueries({ queryKey: uptimeKeys.all() }); onOpenChange(false);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-[var(--dialog-standard)]"><DialogHeader><DialogTitle>{t(templateMode ? templateId ? "templates.editTitle" : "templates.newTitle" : fromTemplate ? "templates.createTitle" : "network.create")}</DialogTitle><DialogDescription>{t(templateMode ? templateId ? "templates.editDescription" : "templates.futureOnly" : "network.description")}</DialogDescription></DialogHeader><NetworkForm initial={input} onSave={save} onCancel={() => onOpenChange(false)} label={t(templateMode ? "templates.save" : "network.save")} lockType={Boolean(initial)} templateMode={templateMode} channels={channelOptions} /></DialogContent></Dialog>;
}
export function NetworkPanel({ monitor }: { monitor: UptimeMonitor }) {
  const { t, i18n } = useTranslation("uptimeMonitor"); const client = useQueryClient(); const [saved, setSaved] = useState(false);
  const input: NetworkMonitorInput = { name: monitor.name, configuration: monitor.networkConfig ?? blank.configuration, interval: monitor.interval as NetworkMonitorInput["interval"], timeout: monitor.timeout, failureThreshold: monitor.failureThreshold, active: monitor.active, tags: monitor.tags ?? [], latencyPolicy: monitor.latencyPolicy, channelIds: monitor.referencedChannels?.map(channel => channel.id) };
  return <SectionCard title={<>{t("network.settings")}</>}><div className="grid min-w-0 gap-4"><MaintenanceControls monitorIds={[monitor.uptimeMonitorId]} />{saved && <p role="status" className="text-sm">{t("network.saved")}</p>}<NetworkForm initial={input} lockType label={t("network.update")} onSave={async values => { await NetworkMonitorService.update(monitor.uptimeMonitorId, values); await client.invalidateQueries({ queryKey: uptimeKeys.all() }); setSaved(true); }} /></div></SectionCard>;
}
