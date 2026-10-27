import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { formattingLocale } from "@/lib/formatting-locale";
import { formatInterval } from "@/lib/uptime/format";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { TemplateChannelLabel } from "./template-channel-label";
import { FormField } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { expectedStatusFields } from "@pulsy/db/http-status-rule";
import { ExpectedStatusInput } from "@/components/uptime/expected-status-input";
import { normalizeMonitorUrl, duplicateMonitor } from "@pulsy/db/monitor-url";
import { useUptimeMonitors } from "@/hooks/uptime/useUptimeMonitors";
import { useTagEntry } from "@/hooks/uptime/useTagEntry";
import { DEFAULT_FAILURE_THRESHOLD, MAX_MONITOR_TIMEOUT_MS } from "@pulsy/db/monitor-defaults";
import { formatMilliseconds } from "@/lib/uptime/number-format";
import { extractNameFromUrl } from "@/lib/uptime/extract-name";
import { NetworkMonitorDialog } from "./network-controls";
import { MonitorTemplatesService } from "@/services/uptime/monitorTemplatesService";
import type { MonitorCreationDraft, MonitorTemplate, TemplateChannelOption } from "@/types/monitor-templates";
import { LatencyPolicyEditor } from "@/components/uptime/latency-policy-editor";
import { HttpConfigurationEditor } from "@/components/uptime/http-configuration-editor";
import { UptimeService } from "@/services/uptime/uptimeService";
import type { HttpConfigurationPatch, LatencyPolicy } from "@/types/uptime";
import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "@/lib/toast";
import { Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateUptimeMonitor } from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { CreateUptimeMonitorInput, UptimeMonitorMethod } from "@/types/uptime";

export interface MonitorCreateDialogProps {
  initial?: MonitorCreationDraft;
  quickDraft?: { url: string; name: string };
  templateMode?: boolean;
  fromTemplate?: boolean;
  templateId?: string;
  channelOptions?: TemplateChannelOption[];
  onTemplateSaved?: (template: MonitorTemplate) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ALL_INTERVALS = [
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "600", label: "10 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
];

const METHODS: UptimeMonitorMethod[] = ["GET", "HEAD", "POST"];

export function MonitorCreateDialog(props: MonitorCreateDialogProps) {
  return props.initial?.configuration.monitorType ? <NetworkMonitorDialog {...props} /> : <HttpMonitorCreateDialog {...props} />;
}

function HttpMonitorCreateDialog({ open, onOpenChange, initial, quickDraft, templateMode = false, fromTemplate = false, templateId, channelOptions, onTemplateSaved }: MonitorCreateDialogProps) {
  const client = useQueryClient();
  const { t, i18n } = useTranslation("uptimeMonitor");
  const fieldId = useId();
  const validation = useFormValidation();
  const urlInput = useRef<HTMLInputElement>(null);
  const createMutation = useCreateUptimeMonitor();
  const navigate = useNavigate();


  const [latencyPolicy, setLatencyPolicy] = useState<LatencyPolicy | null>(initial?.configuration.latencyPolicy ?? null);
  const [httpPatch, setHttpPatch] = useState<HttpConfigurationPatch>(initial ? { httpAssertions: initial.configuration.httpAssertions, redirectPolicy: initial.configuration.redirectPolicy } : {});
  const [name, setName] = useState(fromTemplate ? "" : initial?.name ?? quickDraft?.name ?? extractNameFromUrl(quickDraft?.url ?? ""));
  const [channelIds, setChannelIds] = useState<string[]>(initial?.configuration.channelIds ?? []);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [nameEdited, setNameEdited] = useState(!fromTemplate && Boolean(initial?.name || quickDraft?.name));
  const [url, setUrl] = useState(quickDraft?.url ?? "");
  const [method, setMethod] = useState<UptimeMonitorMethod>(initial?.configuration.method ?? "GET");
  const [interval, setInterval] = useState(String(initial?.configuration.interval ?? 300));
  const [tlsMonitoringEnabled, setTlsMonitoringEnabled] = useState(initial?.configuration.tlsMonitoringEnabled ?? true);
  const [expectedStatus, setExpectedStatus] = useState(String(initial?.configuration.expectedStatuses ?? initial?.configuration.expectedStatus ?? 200));
  const [timeout, setTimeout] = useState(String(initial?.configuration.timeout ?? 10000));
  const [failureThreshold, setFailureThreshold] = useState(String(initial?.configuration.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD));
  const [tags, setTags] = useState<string[]>(initial?.configuration.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const tagEntry = useTagEntry({ tags, setTags, input: tagInput, setInput: setTagInput });
  const [submitError, setSubmitError] = useState("");
  const values = { latencyPolicy, httpPatch, name, channelIds, url, method, interval, tlsMonitoringEnabled, expectedStatus, timeout, failureThreshold, tags, tagInput };
  const draft = useDraftComparison(values, quickDraft ? { ...values, name: "", url: "" } : values, open);
  const invalidUrlMessage = t("creation.invalidUrl");
  useEffect(() => {
    urlInput.current?.setCustomValidity(url.trim() && !normalizeMonitorUrl(url) ? invalidUrlMessage : "");
  }, [url, invalidUrlMessage]);

  const resetForm = () => {
    validation.clear();
    setNameEdited(false);
    setTlsMonitoringEnabled(true);
    setSubmitError("");
    setChannelIds([]);
    setLatencyPolicy(null);
    setHttpPatch({});
    setName("");
    setUrl("");
    setMethod("GET");
    setInterval("300");
    setExpectedStatus("200");
    setTimeout("10000");
    setFailureThreshold("3");
    setTags([]);
    setTagInput("");
    tagEntry.reset();
  };

  const changeOpen = (next: boolean) => { if (!next) resetForm(); onOpenChange(next); };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };


  const existing = useUptimeMonitors({ enabled: open && !templateMode });
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createMutation.isPending || savingTemplate || !validation.validate()) return;
    const statusFields = expectedStatusFields(expectedStatus);
    if (!statusFields) { validation.show([{ id: "expectedStatus", message: t("httpStatuses.invalid") }]); return; }

    setSubmitError("");
    const normalizedUrl = normalizeMonitorUrl(url);
    if (!templateMode) {
      if (!normalizedUrl) {
        urlInput.current?.setCustomValidity(url.trim() ? invalidUrlMessage : "");
        validation.validate();
        return;
      }
      const duplicate = duplicateMonitor(normalizedUrl, existing.data ?? []);
      if (duplicate) {
        urlInput.current?.setCustomValidity(t("creation.duplicateUrl", { name: duplicate.name }));
        validation.validate();
        return;
      }
      setUrl(normalizedUrl);
    }


    const input: CreateUptimeMonitorInput = {
      ...httpPatch,
      ...(channelIds.length ? { channelIds } : {}),
      ...(latencyPolicy ? { latencyPolicy } : {}),
      name: name.trim() || extractNameFromUrl(normalizedUrl ?? url),
      url: normalizedUrl ?? url,
      method,
      interval: Number(interval),
      ...statusFields,
      tlsMonitoringEnabled,
      timeout: Number(timeout),
      failureThreshold: Number(failureThreshold),
      tags: tags.length > 0 ? tags : undefined,
    };

    try {
      if (templateMode) {
        setSavingTemplate(true);
        const saved = await MonitorTemplatesService.save({ ...(templateId ? { id: templateId } : {}), name, needsRequestValues: initial?.needsRequestValues ?? false, configuration: { method, ...statusFields, tlsMonitoringEnabled, timeout: Number(timeout), interval: Number(interval), failureThreshold: Number(failureThreshold), tags, httpAssertions: httpPatch.httpAssertions ?? [], redirectPolicy: httpPatch.redirectPolicy ?? "follow", latencyPolicy, channelIds } });
        if (!isSessionClientActive(client)) return;
        draft.accept(); onTemplateSaved?.(saved); onOpenChange(false); return;
      }
      const created = await createMutation.mutateAsync(input);
      if (!isSessionClientActive(client)) return;
      toast.success(t("create.success", "Monitor created. It stays Pending until its first check completes."), {
        action: {
          label: t("quickAdd.setupNotifications", "Set up notifications"),
          onClick: () => {
            if (!isSessionClientActive(client)) return;
            navigate({
              to: "/dashboard/uptime/$monitorId",
              params: { monitorId: created.uptimeMonitorId },
              search: { tab: "alerts" },
            });
          },
        },
      });
      draft.accept(); resetForm();
      onOpenChange(false);
    } catch (error) {
      if (!isSessionClientActive(client)) return;

      if (validation.server(error, { url: "url", name: "name" })) return;
      setSubmitError(extractErrorMessage(error, t("create.error", "Failed to create monitor")));
    } finally { setSavingTemplate(false); }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent hasUnsavedChanges={draft.dirty} className={layoutTokens.createDialog}>
        <form {...draft.formProps} ref={validation.formRef} noValidate className="dialog-form" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{templateMode ? t(templateId ? "templates.editTitle" : "templates.newTitle") : fromTemplate ? t("templates.createTitle") : initial ? t("templates.duplicateTitle", "Duplicate monitor") : t("create.title", "Create Monitor")}</DialogTitle>
            <DialogDescription>
              {templateMode ? t(templateId ? "templates.editDescription" : "templates.futureOnly") : t("create.description", "Add a new URL to monitor for availability.")}
            </DialogDescription>
          </DialogHeader>

          <div className="dialog-body grid gap-y-[var(--field-row-gap)]">
            <FormErrorSummary issues={validation.issues} />
            {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
            {initial && !templateMode && <p className="text-sm text-muted-foreground">{t("templates.reentry")}</p>}
            {initial?.needsRequestValues && <p className="text-sm font-medium text-foreground">{t("templates.secretsMissing")}</p>}
            <fieldset className="grid gap-y-[var(--field-row-gap)]"><legend className="mb-4 text-base font-medium">{t("creation.identity")}</legend>
            {!templateMode && <>
            <FormField className="form-field">
              <Label htmlFor="url">{t("create.fields.url", "URL")}</Label>
              <Input
                ref={urlInput} id="url" {...validation.field("url")} validateOnBlur dir="ltr" autoComplete="url"
                type="text" inputMode="url" onBlur={() => { const normalized = normalizeMonitorUrl(url); if (normalized) setUrl(normalized); }}
                value={url}
                onChange={(e) => { e.currentTarget.setCustomValidity(e.target.value.trim() && !normalizeMonitorUrl(e.target.value) ? invalidUrlMessage : ""); setUrl(e.target.value); if (!nameEdited && !templateMode) setName(extractNameFromUrl(e.target.value)); }}
                placeholder={t("create.fields.urlPlaceholder", "Example: https://api.example.com/health")}
                required
              />
            </FormField>

            </>}
            <FormField className="form-field">
              <Label htmlFor="name">{t("create.fields.name", "Name")}</Label>
              <Input
                id="name" {...validation.field("name")} validateOnBlur
                maxLength={templateMode ? 80 : 255}
                value={name}
                onFocus={event => { if (!nameEdited && name) event.currentTarget.select(); }}
                onChange={(e) => { setNameEdited(true); setName(e.target.value); }}
                placeholder={t(templateMode ? "templates.templateName" : "create.fields.namePlaceholder")}
                required={templateMode}
              />
            </FormField>

            </fieldset>
            <fieldset className="grid gap-y-[var(--field-row-gap)]"><legend className="mb-4 text-base font-medium">{t("creation.checkBehavior")}</legend>
            <div className="form-grid grid-cols-1 sm:grid-cols-2">
              <FormField className="form-field">
                <Label htmlFor={`${fieldId}-method`}>{t("create.fields.method", "HTTP Method")}</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as UptimeMonitorMethod)}>
                  <SelectTrigger id={`${fieldId}-method`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField className="form-field">
                <Label htmlFor={`${fieldId}-interval`}>{t("create.fields.interval", "Check Interval")}</Label>
                <Select value={interval} onValueChange={setInterval}>
                  <SelectTrigger id={`${fieldId}-interval`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_INTERVALS.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {formatInterval(Number(i.value), t, i18n.language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <div className="flex items-center justify-between gap-4"><Label htmlFor={`${fieldId}-tls`}>{t("tlsMonitoring.title")}</Label><Switch id={`${fieldId}-tls`} checked={tlsMonitoringEnabled} onCheckedChange={setTlsMonitoringEnabled} /></div>
            <div className="form-grid grid-cols-1 sm:grid-cols-3">
              <FormField label={t("create.fields.expectedStatus", "Expected Status")} control={<ExpectedStatusInput
                  id="expectedStatus" {...validation.field("expectedStatus")} required
                  value={expectedStatus}
                  onChange={(e) => setExpectedStatus(e.target.value)}
                />} />

              <FormField label={t("create.fields.timeout", "Timeout")} control={<Input
                  id="timeout" {...validation.field("timeout")} validateOnBlur required
                  type="number"
                  min={1000}
                  max={MAX_MONITOR_TIMEOUT_MS}
                  step={1}
                  value={timeout}
                  onChange={(e) => setTimeout(e.target.value)}
                />} helper={t("create.fields.timeoutDescription")} />

              <FormField label={t("create.fields.failureThreshold", "Threshold")} control={<Input
                  id="failureThreshold" {...validation.field("failureThreshold")} validateOnBlur required
                  type="number"
                  min={1}
                  max={10}
                  value={failureThreshold}
                  onChange={(e) => setFailureThreshold(e.target.value)}
                />} helper={t("create.fields.failureThresholdDescription", { default: new Intl.NumberFormat(formattingLocale(i18n.language)).format(DEFAULT_FAILURE_THRESHOLD) })} />
            </div>

            <p className="text-sm text-muted-foreground">{t("creation.checkSummary", { interval: formatInterval(Number(interval), t, i18n.language), failures: failureThreshold || "—", timeout: timeout ? formatMilliseconds(Number(timeout), i18n.language) ?? "—" : "—" })}</p>
            </fieldset>
            <FormField className="form-field">
              <Label htmlFor="tags">{t("tags.label", "Tags")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="tags"
                  value={tagInput}
                  onChange={tagEntry.onChange}
                  maxLength={50}
                  aria-describedby={`${fieldId}-tag-feedback`}
                  onKeyDown={tagEntry.onKeyDown}
                  onBlur={tagEntry.commit}
                  placeholder={t("tags.placeholder", "Example: production")}
                  disabled={tags.length >= 10}
                />
              </div>
              <p id={`${fieldId}-tag-feedback`} role="status" className="text-sm text-muted-foreground">{tagEntry.feedback}</p>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="min-h-[44px] gap-1 ps-3 pe-0">
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-md hover:bg-muted"
                        aria-label={t("tags.remove", {
                          defaultValue: "Remove {{tag}}",
                          tag,
                        })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </FormField>

          {channelOptions && <fieldset className="mb-4 grid gap-2 rounded-md border p-3"><legend className="px-1 text-sm">{t("templates.channels")}</legend><p className="text-sm text-muted-foreground">{t("templates.defaults")}</p>{channelOptions.map(channel => <Label key={channel.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={channelIds.includes(channel.id)} disabled={!channelIds.includes(channel.id) && channelIds.length >= 20} onChange={event => setChannelIds(ids => event.target.checked ? [...ids, channel.id] : ids.filter(id => id !== channel.id))} /><TemplateChannelLabel channel={channel} /></Label>)}{!channelOptions.length && <p className="text-sm">{t("templates.noChannels")}</p>}{channelIds.some(id => !channelOptions.some(channel => channel.id === id)) && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{t("templates.missingChannel")}</p><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" type="button" variant="outline" onClick={() => setChannelIds(ids => ids.filter(id => channelOptions.some(channel => channel.id === id)))}>{t("templates.clearMissing")}</Button></div>}</fieldset>}
          <fieldset className="grid gap-y-[var(--field-row-gap)]"><legend className="mb-4 text-base font-medium">{t("creation.alertPolicy")}</legend><LatencyPolicyEditor value={latencyPolicy} onChange={setLatencyPolicy} />
          </fieldset><fieldset className="grid gap-y-[var(--field-row-gap)]"><legend className="mb-4 text-base font-medium">{t("creation.advanced")}</legend><HttpConfigurationEditor isEdit={false} configurationOnly={templateMode} value={httpPatch} onChange={setHttpPatch} method={method} expectedStatus={expectedStatus} onTest={allowPost => UptimeService.testConfiguration({ allowPost, configuration: { ...httpPatch, latencyPolicy, name, url, method, ...expectedStatusFields(expectedStatus)!, timeout: Number(timeout) } })} /></fieldset>
          </div>
          <DialogFooter className="border-t pt-3">
            <Button
              type="button"
              variant="outline"
              data-dialog-discard onClick={() => changeOpen(false)}
              className="h-[44px] w-full sm:w-auto"
            >
              {t("actions.cancel", "Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || savingTemplate}
              className="h-[44px] w-full sm:w-auto"
            >
              {(createMutation.isPending || savingTemplate) && (
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
              )}
              {templateMode ? t("templates.save") : t("create.submit", "Create monitor")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    </>
  );
}
