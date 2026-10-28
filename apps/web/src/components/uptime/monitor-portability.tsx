import { isSessionClientActive } from "@/lib/session-query-client";
import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { FormField } from "@/components/ui/form-field";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_FAILURE_THRESHOLD } from "@pulsy/db/monitor-defaults";
import { jsonDiagnostic } from "@pulsy/db/json-diagnostic";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import { useUptimeMonitors } from "@/hooks/uptime/useUptimeMonitors";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { MonitorPortabilityService, type ConfigurationPreview } from "@/services/uptime/monitorPortabilityService";

export function MonitorPortability() {
  const { t } = useTranslation("uptimeMonitor"); const id = useId(); const client = useQueryClient(); const query = useUptimeMonitors();
  const [search, setSearch] = useState(""); const submitting = useRef(false);
  const [selected, setSelected] = useState<string[]>([]); const [text, setText] = useState("");
  const [preview, setPreview] = useState<ConfigurationPreview | null>(null); const [previewText, setPreviewText] = useState("");
  const [safeText, setSafeText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const draftValues = { text, file: file ? { name: file.name, size: file.size, lastModified: file.lastModified } : null };
  const draft = useDraftComparison(draftValues);
  const validation = useFormValidation();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const inlineError = (field: string) => { const issue = validation.issues.find(issue => issue.id === `${id}-${field}`); return issue ? <p className="text-sm text-destructive">{issue.message}</p> : null; };
  const changeText = (value: string) => { setText(value); setSafeText(""); setPreview(null); setPreviewText(""); setMessage(""); validation.clear(); };
  const act = async (work: () => Promise<void>, area: "manifest" | "file" | "export" = "manifest") => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); validation.clear(); setMessage("");
    try { await work(); } catch (caught) { if (!isSessionClientActive(client)) return;
      if (!validation.server(caught, { text: `${id}-manifest`, revision: `${id}-manifest`, monitorIds: `${id}-export` })) {
        validation.show([{ id: `${id}-${area}`, label: t(area === "file" ? "portability.file" : area === "export" ? "portability.export" : "portability.manifest"), message: extractErrorMessage(caught, t("portability.error")) }]);
      }
    } finally { submitting.current = false; setBusy(false); }
  };
  const validBytes = (value: string) => new TextEncoder().encode(value).byteLength <= 262144;
  // Indentation must not make an accepted manifest impossible to import again.
  const serializeManifest = (manifest: unknown) => {
    const readable = JSON.stringify(manifest, null, 2);
    return validBytes(readable) ? readable : JSON.stringify(manifest);
  };
  const runPreview = () => act(async () => {
    setPreview(null); setPreviewText(""); setSafeText("");
    if (!validBytes(text)) throw new Error(t("portability.tooLarge"));
    try { JSON.parse(text); } catch (caught) { if (!isSessionClientActive(client)) return;
      const diagnostic = jsonDiagnostic(text, caught);
      throw new Error(t("portability.jsonError", { ...diagnostic, reason: t(`portability.jsonReason.${diagnostic.reason}`) }));
    }
    const result = await MonitorPortabilityService.preview(text); if (!isSessionClientActive(client)) return;
    // Never keep imported secret values in the editor after successful preview.
    const safe = serializeManifest(result.manifest); setText(safe); setSafeText(safe); setPreviewText(safe); setPreview(result);
  });
  const apply = () => act(async () => {
    if (!preview || previewText !== text || preview.counts.rejected) return;
    setPreview(null);
    await MonitorPortabilityService.apply(previewText, preview.revision); if (!isSessionClientActive(client)) return;
    draft.accept();
    setPreview(null); setPreviewText(""); setMessage(t("portability.applied"));
    await client.invalidateQueries({ queryKey: uptimeKeys.all() });
  });
  const download = (content = text, filename = "pulsy-monitor-configuration.json") => {
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" })); const link = document.createElement("a");
    link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  };
  const matching = (query.data ?? []).filter(monitor => monitor.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const eligible = matching.filter(monitor => monitor.monitorType !== "server").slice(0, 200);
  const outsideCount = selected.filter(id => !matching.some(monitor => monitor.uptimeMonitorId === id)).length;
  const sample = () => download(JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors: [{ key: "example-http", type: "http", name: "Example website", url: "https://example.com/", method: "GET", expectedStatus: 200, redirectPolicy: "follow", timeout: 10000, failureThreshold: DEFAULT_FAILURE_THRESHOLD, interval: 300, active: false, tags: [] }] }, null, 2), "pulsy-monitor-sample.json");
  return <form {...draft.formProps} ref={validation.formRef} noValidate onSubmit={event => event.preventDefault()} className="grid min-w-0 grid-cols-1 gap-6">
    <p className="text-sm text-muted-foreground">{t("portability.description")}</p>
    <FormErrorSummary issues={validation.issues} />{message && <p role="status" className="text-sm">{message}</p>}
    <SectionCard title={t("portability.selection")}><div className="grid min-w-0 gap-3">
      <p className="text-sm text-muted-foreground">{t("portability.exportHint")}</p>
      {query.isPending && <p role="status">{t("portability.loading")}</p>}
      {query.error && <div role="alert"><p className="text-sm text-destructive">{t("portability.error")}</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>{t("communication.retry")}</Button></div>}
      {!query.isPending && !query.error && !query.data?.length && <p className="text-sm text-muted-foreground">{t("portability.empty")}</p>}
      <FormField className="form-field"><Label htmlFor={`${id}-search`}>{t("portability.searchLabel")}</Label>
      <Input id={`${id}-search`} type="search" value={search} placeholder={t("portability.searchPlaceholder")} onChange={event => setSearch(event.target.value)} /></FormField>
      <label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox disabled={busy || !eligible.length} checked={eligible.length > 0 && eligible.every(monitor => selected.includes(monitor.uptimeMonitorId)) ? true : eligible.some(monitor => selected.includes(monitor.uptimeMonitorId)) ? "indeterminate" : false} onCheckedChange={checked => { setSelected(checked === true ? eligible.map(monitor => monitor.uptimeMonitorId) : []); setSafeText(""); setPreview(null); }} />{t("portability.selectMatching", { count: eligible.length })}</label>
      <ul className="grid min-w-0 grid-cols-1 gap-1">
        {matching.map(monitor => <li key={monitor.uptimeMonitorId}><label className="flex min-h-11 min-w-0 items-center gap-3 text-sm"><Checkbox className="shrink-0" aria-label={monitor.name} aria-describedby={monitor.monitorType === "server" ? `${id}-${monitor.uptimeMonitorId}-unsupported` : undefined} disabled={busy || monitor.monitorType === "server" || selected.length >= 200 && !selected.includes(monitor.uptimeMonitorId)} checked={selected.includes(monitor.uptimeMonitorId)} onCheckedChange={checked => { setSelected(ids => checked === true ? [...new Set([...ids, monitor.uptimeMonitorId])] : ids.filter(value => value !== monitor.uptimeMonitorId)); setSafeText(""); setPreview(null); }} /><span className="min-w-0"><bdi className="break-words">{monitor.name}</bdi>{monitor.monitorType === "server" && <span id={`${id}-${monitor.uptimeMonitorId}-unsupported`} className="block text-xs text-muted-foreground">{t("portability.serverUnsupported")}</span>}</span></label></li>)}
      </ul>
      <p className="text-sm text-muted-foreground">{t("portability.selected", { count: selected.length })}</p>
      <Button type="button" variant="ghost" disabled={busy || !selected.length} onClick={() => { setSelected([]); setSafeText(""); setPreview(null); }}>{t("portability.clearSelection")}</Button>
      {outsideCount > 0 && <p role="status" className="text-sm text-warning">{t("portability.outsideSelection", { count: outsideCount, total: selected.length })}</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" id={`${id}-export`} {...validation.field(`${id}-export`)} variant="outline" className="min-h-11 h-auto w-fit max-w-full whitespace-normal" disabled={busy || !selected.length || !!query.error} onClick={() => void act(async () => { const result = await MonitorPortabilityService.export(selected); if (!isSessionClientActive(client)) return; const safe = serializeManifest(result.manifest); changeText(safe); draft.reset({ ...draftValues, text: safe }); setSafeText(safe); setMessage(t("portability.exported")); }, "export")}>{t("portability.export")}</Button><Button type="button" variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal" disabled={busy || !text.trim() || safeText !== text} onClick={() => download()}>{t("portability.download")}</Button></div>{inlineError("export")}
    </div></SectionCard>
    <SectionCard title={t("portability.importHeading")}><div className="grid min-w-0 gap-3">
      <p className="text-sm text-muted-foreground">{t("portability.importHint")} <a href="/dashboard/help/configuration-portability" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline hover:text-foreground">{t("portability.formatLink")}</a></p>
      <FormField className="form-field"><Label id={`${id}-manifest-label`} htmlFor={`${id}-manifest`}>{t("portability.manifest")}</Label>
      <textarea {...validation.field(`${id}-manifest`)} id={`${id}-manifest`} className="h-64 max-h-96 min-h-48 w-full min-w-0 resize-y overflow-auto rounded-md border border-input bg-background p-3 font-mono text-base leading-5 sm:text-[13px]" dir="ltr" value={text} maxLength={262144} disabled={busy} onChange={event => changeText(event.target.value)} />{inlineError("manifest")}</FormField>
      <FormField className="form-field"><Label htmlFor={`${id}-file`}>{t("portability.file")}</Label>
      <FileDropzone id={`${id}-file`} value={file} accept="application/json,.json" disabled={busy} {...validation.field(`${id}-file`)} onChange={selectedFile => { setFile(selectedFile); changeText(""); if (!selectedFile) return; void act(async () => { if (selectedFile.size > 262144) throw new Error(t("portability.tooLarge")); changeText(await selectedFile.text()); }, "file"); }} />{inlineError("file")}</FormField>
      <p className="text-sm text-muted-foreground">{t("portability.limits")}</p>
      <p className="text-sm text-muted-foreground">{t("portability.scheduledWarning")}</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={sample}>{t("portability.downloadSample")}</Button><Button type="button" variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal" disabled={busy || !text.trim()} onClick={() => void runPreview()}>{t("portability.preview")}</Button></div>
    </div></SectionCard>
    {preview && <SectionCard title={t("portability.previewTitle")}><div className="grid min-w-0 grid-cols-1 gap-3"><p className="text-sm">{t("portability.zeroWrites")}</p>
      {preview.counts.rejected > 0 && <p role="alert" className="break-words rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{t("portability.rejectedSummary", { count: preview.counts.rejected })}</p>}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">{Object.entries({ ...preview.counts, rejected: preview.entries.filter(entry => entry.action === "rejected" && !entry.reasons.includes("typeChange")).length, unsupported: preview.entries.filter(entry => entry.action === "rejected" && entry.reasons.includes("typeChange")).length }).map(([key, value]) => <div key={key}><dt className="break-words text-sm text-muted-foreground">{t(`portability.action.${key}`)}</dt><dd>{value}</dd></div>)}</dl>
      {preview.warnings.length > 0 && <ul className="grid gap-1">{preview.warnings.map((warning, index) => <li key={index} className="break-words text-sm"><bdi>{warning.key}</bdi>: {t(`portability.warning.${warning.field}`)}</li>)}</ul>}
      {preview.entries.length > 0 && <ul className="grid min-w-0 gap-3">{preview.entries.map(entry => <li key={entry.key} className="min-w-0"><Collapsible className="min-w-0 rounded-md border" defaultOpen={entry.action === "rejected"}><CollapsibleTrigger className="ps-4 break-words"><bdi>{entry.key}</bdi> · {t(`portability.action.${entry.action}`)}</CollapsibleTrigger><CollapsibleContent><div className="grid min-w-0 gap-2">{entry.reasons.map(reason => <p key={reason} className="text-sm text-destructive">{t(`portability.reason.${reason}`)}</p>)}{entry.changes.map(change => <div key={change.field} className={`min-w-0 rounded-md text-sm ${["active", "method"].includes(change.field) ? "border border-warning/50 bg-warning/10 p-3" : ""}`}><p className="font-medium">{t(`portability.field.${change.field}`)}</p><pre dir="ltr" className="min-w-0 whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(change.before)} → {JSON.stringify(change.after)}</pre></div>)}</div></CollapsibleContent></Collapsible></li>)}</ul>}
      <p className="text-sm text-muted-foreground">{t("portability.atomic")}</p><Button type="button" className="min-h-11 h-auto w-fit max-w-full whitespace-normal" disabled={busy || !!preview.counts.rejected || text !== previewText || preview.counts.create + preview.counts.update === 0} onClick={() => void apply()}>{t("portability.apply")}</Button>
    </div></SectionCard>}
  </form>;
}
