import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { formattingLocale } from "@/lib/formatting-locale";
import { MAX_MONITOR_TIMEOUT_MS } from "@pulsy/db/monitor-defaults";
import { FormFooter } from "@/components/ui/form-footer";
import { FormField } from "@/components/ui/form-field";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { formatInterval } from "@/lib/uptime/format";
import { Switch } from "@/components/ui/switch";
import { expectedStatusFields } from "@pulsy/db/http-status-rule";
import { ExpectedStatusInput } from "@/components/uptime/expected-status-input";
import { DEFAULT_FAILURE_THRESHOLD } from "@pulsy/db/monitor-defaults";
import { LatencyPolicyEditor } from "@/components/uptime/latency-policy-editor";
import { useTranslation } from "react-i18next";
import { useId, useState, useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateUptimeMonitor } from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { UptimeMonitor, UptimeMonitorMethod } from "@/types/uptime";
import { HttpConfigurationEditor } from "@/components/uptime/http-configuration-editor";
import { UptimeService } from "@/services/uptime/uptimeService";
import type { HttpConfigurationPatch, LatencyPolicy } from "@/types/uptime";
import { MaintenanceControls } from "@/components/uptime/maintenance-controls";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

interface SettingsTabProps {
  monitor: UptimeMonitor;
}

const ALL_INTERVALS = ["30", "60", "300", "600", "1800", "3600"];

const METHODS: UptimeMonitorMethod[] = ["GET", "HEAD", "POST"];

export function SettingsTab({ monitor }: SettingsTabProps) {
  return <SettingsForm key={monitor.uptimeMonitorId} monitor={monitor} />;
}

function SettingsForm({ monitor }: SettingsTabProps) {
  const client = useQueryClient();
  const { t, i18n } = useTranslation("uptimeMonitor");
  const fieldId = useId();
  const dirty = useRef(false);
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const validation = useFormValidation();
  const updateMutation = useUpdateUptimeMonitor();
  const busy = saving || updateMutation.isPending;


  const [latencyPolicy, setLatencyPolicy] = useState<LatencyPolicy | null>(monitor.latencyPolicy ?? null);
  const [httpPatch, setHttpPatch] = useState<HttpConfigurationPatch>({ httpAssertions: monitor.httpAssertions ?? [], redirectPolicy: monitor.redirectPolicy ?? "follow" });
  const [tlsMonitoringEnabled, setTlsMonitoringEnabled] = useState(monitor.tlsMonitoringEnabled ?? true);
  const [name, setName] = useState(monitor.name);
  const [url, setUrl] = useState(monitor.url);
  const [method, setMethod] = useState<UptimeMonitorMethod>(monitor.method);
  const [interval, setInterval] = useState(String(monitor.interval));
  const [expectedStatus, setExpectedStatus] = useState(String(monitor.expectedStatuses ?? monitor.expectedStatus));
  const [timeout, setTimeout] = useState(String(monitor.timeout));
  const [failureThreshold, setFailureThreshold] = useState(String(monitor.failureThreshold));

  const draft = { latencyPolicy, httpPatch, tlsMonitoringEnabled, name, url, method, interval, expectedStatus, timeout, failureThreshold };
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const isDirty = JSON.stringify(draft) !== baseline;
  dirty.current = isDirty;
  useUnsavedChangesGuard(isDirty);

  useEffect(() => {
    if (dirty.current) return;
    setBaseline(JSON.stringify({
      latencyPolicy: monitor.latencyPolicy ?? null,
      httpPatch: { httpAssertions: monitor.httpAssertions ?? [], redirectPolicy: monitor.redirectPolicy ?? "follow" },
      tlsMonitoringEnabled: monitor.tlsMonitoringEnabled ?? true,
      name: monitor.name, url: monitor.url, method: monitor.method,
      interval: String(monitor.interval), expectedStatus: String(monitor.expectedStatuses ?? monitor.expectedStatus),
      timeout: String(monitor.timeout), failureThreshold: String(monitor.failureThreshold),
    }));
    setLatencyPolicy(monitor.latencyPolicy ?? null);
    setHttpPatch({ httpAssertions: monitor.httpAssertions ?? [], redirectPolicy: monitor.redirectPolicy ?? "follow" });
    setTlsMonitoringEnabled(monitor.tlsMonitoringEnabled ?? true);
    setName(monitor.name);
    setUrl(monitor.url);
    setMethod(monitor.method);
    setInterval(String(monitor.interval));
    setExpectedStatus(String(monitor.expectedStatuses ?? monitor.expectedStatus));
    setTimeout(String(monitor.timeout));
    setFailureThreshold(String(monitor.failureThreshold));
  }, [monitor]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || updateMutation.isPending || !validation.validate()) return;
    const statusFields = expectedStatusFields(expectedStatus);
    if (!statusFields) { validation.show([{ id: "settings-expected", message: t("httpStatuses.invalid") }]); return; }

    try {
      submitting.current = true;
      setSaving(true);
      await updateMutation.mutateAsync({
        ...httpPatch,
        tlsMonitoringEnabled,
      latencyPolicy,
        uptimeMonitorId: monitor.uptimeMonitorId,
        name,
        url,
        method,
        interval: Number(interval),
        ...statusFields,
        timeout: Number(timeout),
        failureThreshold: Number(failureThreshold),
      });
      if (!isSessionClientActive(client)) return;
      const savedPatch = { httpAssertions: httpPatch.httpAssertions, redirectPolicy: httpPatch.redirectPolicy };
      setBaseline(JSON.stringify({ ...draft, httpPatch: savedPatch }));
      setHttpPatch(savedPatch);
      validation.clear();
      toast.success(t("edit.success", "Settings saved. The next scheduled check will use them."));
    } catch (error) {
      if (!isSessionClientActive(client)) return;

      if (!validation.server(error, { name: "settings-name", url: "settings-url", method: `${fieldId}-method`, interval: `${fieldId}-interval`, expectedStatus: "settings-expected", expectedStatuses: "settings-expected", timeout: "settings-timeout", failureThreshold: "settings-threshold" })) toast.error(extractErrorMessage(error, t("edit.error", "Failed to update monitor")));
    } finally { submitting.current = false; setSaving(false); }
  };

  return (
    <>
    <form ref={validation.formRef} noValidate onSubmit={handleSave}>
      <fieldset disabled={busy} className="contents">
      <SectionCard title={<>
            {t("edit.title", "Edit monitor")}
          </>}><div className="grid gap-y-[var(--field-row-gap)]">
          <FormErrorSummary issues={validation.issues} />
          <p className="text-sm text-muted-foreground">{t("creation.immutableType")}</p>
          <FormField className="form-field">
            <Label htmlFor="settings-name">{t("create.fields.name")}</Label>
            <Input
              id="settings-name" {...validation.field("settings-name")} validateOnBlur maxLength={255}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </FormField>

          <FormField className="form-field">
            <Label htmlFor="settings-url">{t("create.fields.url")}</Label>
            <Input
              id="settings-url" {...validation.field("settings-url")} validateOnBlur dir="ltr"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </FormField>

          <div className="form-grid grid-cols-1 sm:grid-cols-2">
            <FormField className="form-field">
              <Label htmlFor={`${fieldId}-method`}>{t("create.fields.method")}</Label>
              <Select value={method} onValueChange={(v) => { setMethod(v as UptimeMonitorMethod); }}>
                <SelectTrigger id={`${fieldId}-method`} {...validation.field(`${fieldId}-method`)}>
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
              <Label htmlFor={`${fieldId}-interval`}>{t("create.fields.interval")}</Label>
              <Select value={interval} onValueChange={v => { setInterval(v); }}>
                <SelectTrigger id={`${fieldId}-interval`} {...validation.field(`${fieldId}-interval`)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_INTERVALS.map((seconds) => (
                    <SelectItem key={seconds} value={seconds}>
                      {formatInterval(Number(seconds), t, i18n.language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <div className="form-grid grid-cols-1 sm:grid-cols-3">
            <FormField label={t("create.fields.expectedStatus")} control={<ExpectedStatusInput
                id="settings-expected" {...validation.field("settings-expected")} required
                value={expectedStatus}
                onChange={(e) => setExpectedStatus(e.target.value)}
              />} />

            <FormField label={t("create.fields.timeout")} control={<Input
                id="settings-timeout" {...validation.field("settings-timeout")} validateOnBlur required
                type="number"
                min={1000}
                max={MAX_MONITOR_TIMEOUT_MS}
                step={1}
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
              />} helper={t("create.fields.timeoutDescription")} />

            <FormField label={t("create.fields.failureThreshold")} control={<Input
                id="settings-threshold" {...validation.field("settings-threshold")} validateOnBlur required
                type="number"
                min={1}
                max={10}
                value={failureThreshold}
                onChange={(e) => setFailureThreshold(e.target.value)}
              />} helper={t("create.fields.failureThresholdDescription", { default: new Intl.NumberFormat(formattingLocale(i18n.language)).format(DEFAULT_FAILURE_THRESHOLD) })} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3"><div className="grid gap-1"><Label htmlFor={`${fieldId}-tls`}>{t("tlsMonitoring.title")}</Label><p id={`${fieldId}-tls-help`} className="text-sm text-muted-foreground">{t("tlsMonitoring.description")}</p></div><Switch id={`${fieldId}-tls`} aria-describedby={`${fieldId}-tls-help`} checked={tlsMonitoringEnabled} onCheckedChange={value => { setTlsMonitoringEnabled(value); }} /></div>
          <LatencyPolicyEditor value={latencyPolicy} onChange={v => { setLatencyPolicy(v); }} />
          <HttpConfigurationEditor value={httpPatch} onChange={v => { setHttpPatch(v); }} configured={monitor.requestConfigured} method={method} expectedStatus={expectedStatus} onTest={allowPost => UptimeService.testConfiguration({ uptimeMonitorId: monitor.uptimeMonitorId, allowPost, configuration: { ...httpPatch, latencyPolicy, name, url, method, ...expectedStatusFields(expectedStatus)!, timeout: Number(timeout) } })} />
        </div>
        <FormFooter sticky className="px-4 sm:px-6">
          <Button
            type="submit"
            disabled={busy || !isDirty}
            className="h-[44px]"
          >
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            )}
            {t("actions.save", "Save")}
          </Button>
        </FormFooter>
      </SectionCard>
      </fieldset>
    </form>
    <MaintenanceControls monitorIds={[monitor.uptimeMonitorId]} />

    </>
  );
}
