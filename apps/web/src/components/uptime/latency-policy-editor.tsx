import { formattingLocale } from "@/lib/formatting-locale";
import { FormField } from "@/components/ui/form-field";
import { formatCount } from "@/lib/count-format";
import { formatInterval } from "@/lib/uptime/format";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { LatencyPolicy } from "@/types/uptime";

const defaultPolicy: LatencyPolicy = { thresholdMs: null, recoveryThresholdMs: null, slowCount: 2, recoveryCount: 2, importance: "critical", cooldownSeconds: 0 };

export function LatencyPolicyEditor({ value, onChange, monitorType = "http" }: { value: LatencyPolicy | null; onChange: (value: LatencyPolicy | null) => void; monitorType?: "http" | "dns" | "tcp" }) {
  const { t, i18n } = useTranslation("uptimeMonitor"); const grouped = (n: number | null) => n === null ? "—" : new Intl.NumberFormat(formattingLocale(i18n.language)).format(n);
  const id = useId();
  const recovery = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const numeric = (field: "thresholdMs" | "recoveryThresholdMs" | "slowCount" | "recoveryCount" | "cooldownSeconds", fallback: number | null) => ({
    value: drafts[field] ?? String(fallback ?? 0),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const draft = event.target.value;
      setDrafts(current => ({ ...current, [field]: draft }));
      if (draft !== "" && Number.isFinite(Number(draft))) patch({ [field]: Number(draft) });
    },
  });
  useEffect(() => {
    recovery.current?.setCustomValidity(value?.thresholdMs != null && value.recoveryThresholdMs != null && value.recoveryThresholdMs > value.thresholdMs ? t("latency.invalidRecovery") : "");
  }, [value, t]);
  const patch = (next: Partial<LatencyPolicy>) => onChange({ ...(value ?? defaultPolicy), ...next });
  return <Collapsible className="min-w-0 rounded-md border">
    <CollapsibleTrigger className="ps-4 break-words">{t("latency.title")}</CollapsibleTrigger><CollapsibleContent>
    <div className="grid min-w-0 gap-4">
      <p className="text-sm text-muted-foreground">{t(monitorType === "http" ? "latency.description" : `latency.description_${monitorType}`)} <DocsHelpLink docPath="latency-alerts" /></p>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Label htmlFor={`${id}-enabled`}>{t("latency.enabled")}</Label>
        <Switch id={`${id}-enabled`} checked={value !== null} onCheckedChange={enabled => { setDrafts({}); onChange(enabled ? { ...defaultPolicy } : null); }} />
      </div>
      {value && <>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Label htmlFor={`${id}-slow-enabled`}>{t("latency.slowEnabled")}</Label>
          <Switch id={`${id}-slow-enabled`} checked={value.thresholdMs !== null} onCheckedChange={enabled => { setDrafts({}); patch({ thresholdMs: enabled ? 500 : null, recoveryThresholdMs: enabled ? 300 : null }); }} />
        </div>
        {value.thresholdMs !== null && <div className="form-grid grid-cols-1 sm:grid-cols-2">
          <FormField className="form-field"><Label htmlFor={`${id}-threshold`}>{t("latency.threshold")}</Label><Input id={`${id}-threshold`} type="number" min={1} max={60000} step={1} required {...numeric("thresholdMs", value.thresholdMs)} /></FormField>
          <FormField className="form-field"><Label htmlFor={`${id}-slow-count`}>{t("latency.slowCount")}</Label><Input id={`${id}-slow-count`} type="number" min={1} max={10} step={1} required {...numeric("slowCount", value.slowCount)} /></FormField>
          <FormField className="form-field"><Label htmlFor={`${id}-recovery-threshold`}>{t("latency.recoveryThreshold")}</Label><Input ref={recovery} id={`${id}-recovery-threshold`} type="number" min={0} max={value.thresholdMs} step={1} required {...numeric("recoveryThresholdMs", value.recoveryThresholdMs)} /></FormField>
        </div>}
        <div className="form-grid grid-cols-1 sm:grid-cols-2">
          <FormField className="form-field"><Label htmlFor={`${id}-recovery-count`}>{t("latency.recoveryCount")}</Label><Input id={`${id}-recovery-count`} type="number" min={1} max={10} step={1} required {...numeric("recoveryCount", value.recoveryCount)} /></FormField>
          <FormField className="form-field"><Label htmlFor={`${id}-cooldown`}>{t("latency.cooldown")}</Label><Input id={`${id}-cooldown`} type="number" min={0} max={3600} step={1} required {...numeric("cooldownSeconds", value.cooldownSeconds)} /></FormField>
        </div>
        <FormField className="form-field"><Label htmlFor={`${id}-importance`}>{t("latency.importance")}</Label><Select value={value.importance} onValueChange={next => patch({ importance: next as LatencyPolicy["importance"] })}><SelectTrigger id={`${id}-importance`}><SelectValue /></SelectTrigger><SelectContent>{["critical", "warning", "informational"].map(importance => <SelectItem key={importance} value={String(importance)}>{t(`latency.${importance}`)}</SelectItem>)}</SelectContent></Select></FormField>
        <p className="rounded-md border bg-muted/30 p-3 text-sm">{t(value.thresholdMs === null ? "creation.recoverySummary" : "creation.policySummary", { threshold: grouped(value.thresholdMs), slow: formatCount(t, "creation.checkCount", value.slowCount, i18n.language), recovery: grouped(value.recoveryThresholdMs ?? value.thresholdMs), healthy: formatCount(t, "creation.healthyCheckCount", value.recoveryCount, i18n.language), importance: t(`latency.${value.importance}`), cooldown: formatInterval(value.cooldownSeconds, t, i18n.language) })}</p>
        <p className="text-sm text-muted-foreground">{t("latency.rules")}</p>
        <p className="text-sm text-muted-foreground">{t("latency.delivery")}</p>
      </>}
    </div>
  </CollapsibleContent></Collapsible>;
}
