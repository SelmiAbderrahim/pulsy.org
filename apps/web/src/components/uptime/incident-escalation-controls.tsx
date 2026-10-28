import { formattingLocale } from "@/lib/formatting-locale";
import { FormField } from "@/components/ui/form-field";
import { SectionCard } from "@/components/ui/section-card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatIncidentTimestamp } from "@/lib/uptime/incident-time";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { useSession } from "@/lib/auth-client";
import { IncidentWorkspaceService } from "@/services/uptime/incidentWorkspaceService";
import type { IncidentResponseDetail } from "@/types/incident-workspace";
export type EscalationDraft = { dirty?: boolean; primary?: { id: string; label: string }; fallback?: { id: string; label: string }; delay?: string; fallbackDelay?: string };
type Props = { draft?: EscalationDraft; onDirty?: (dirty: boolean) => void; detail: IncidentResponseDetail; busy: boolean; perform: (action: () => Promise<unknown>) => Promise<void> };

function ConfigureEscalation({ detail, busy, perform, draft, onDirty }: Props) {
  const accountTimezone = useAccountTimezone();
  const { t, i18n } = useTranslation("uptimeMonitor"); const { data: session } = useSession();
  const [cursor, setCursor] = useState<string>(); const [delay, setDelay] = useState(draft?.delay ?? "300"); const [fallbackDelay, setFallbackDelay] = useState(draft?.fallbackDelay ?? "900");
  const [primary, setPrimary] = useState(draft?.primary ?? { id: "", label: "" }); const [fallback, setFallback] = useState(draft?.fallback ?? { id: "", label: "" });
  useEffect(() => { if (draft) Object.assign(draft, { primary, fallback, delay, fallbackDelay }); }, [draft, primary, fallback, delay, fallbackDelay]);
  const query = useQuery({ queryKey: uptimeKeys.incidents.responseChannels(session?.user.id, cursor), queryFn: () => IncidentWorkspaceService.channels(cursor), enabled: !!session?.user.id });
  const options = query.data?.items.filter(channel => detail.monitor.status === "degraded" ? channel.notifyOnDegraded : channel.notifyOnDown) ?? [];
  const delaySummary = (value: string) => {
    const seconds = Number(value);
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) return t("incidentUX.delayBounds");
    return t("incidentUX.delaySummary", { duration: new Intl.NumberFormat(formattingLocale(i18n.language), { style: "unit", unit: seconds >= 3600 ? "hour" : "minute", unitDisplay: "long", maximumFractionDigits: 2 }).format(seconds / (seconds >= 3600 ? 3600 : 60)), time: formatIncidentTimestamp(Date.parse(detail.incident.startedAt) + seconds * 1000, i18n.language, accountTimezone) });
  };
  const markDirty = () => { if (draft) draft.dirty = true; onDirty?.(true); };
  const channelLabel = (channel: typeof options[number], index: number) => [t(`workspace.channelTypes.${channel.type}`), channel.host, channel.monitorName ?? t("workspace.escalation.accountChannel"), index + 1].filter(Boolean).join(" · ");
  const select = (id: string, value: typeof primary, setValue: (value: typeof primary) => void, required: boolean) => (
    <Select value={value.id || "__none"} required={required} disabled={busy || query.isPending || !!query.error} onValueChange={selected => {
      const channelId = selected === "__none" ? "" : selected;
      const index = options.findIndex(option => option.id === channelId);
      setValue({ id: channelId, label: index >= 0 ? channelLabel(options[index]!, index) : channelId ? value.label : "" });
      markDirty();
    }}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="__none">{t(required ? "workspace.escalation.choose" : "workspace.escalation.none")}</SelectItem>
        {value.id && !options.some(option => option.id === value.id) && <SelectItem value={value.id}>{value.label}</SelectItem>}
        {options.map((channel, index) => <SelectItem key={channel.id} value={channel.id} disabled={!required && channel.id === primary.id || channel.type === "email" && ((channel.recipientCount ?? 0) === 0 || (channel.recipientCount ?? 0) > 20)}>{channelLabel(channel, index)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  return <form className="grid min-w-0 gap-3" onChange={markDirty} onSubmit={event => {
    event.preventDefault();
    const steps = [{ channelId: primary.id, afterSeconds: Number(delay) }, ...(fallback.id ? [{ channelId: fallback.id, afterSeconds: Number(fallbackDelay) }] : [])];
    void perform(() => IncidentWorkspaceService.escalation(detail.incident.incidentId, steps));
  }}>
    <p className="text-sm text-muted-foreground">{t("workspace.escalation.hint")}</p><p className="text-xs text-muted-foreground">{t("workspace.escalation.timing")}</p>
    {query.isPending && <p role="status">{t("workspace.escalation.loadingChannels")}</p>}
    {query.error && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{t("workspace.escalation.channelsError")}</p><Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start" type="button" onClick={() => void query.refetch()}>{t("workspace.retry")}</Button></div>}
    <FormField className="form-field"><Label htmlFor="incident-primary">{t("workspace.escalation.primary")}</Label>{select("incident-primary", primary, value => { setPrimary(value); if (value.id === fallback.id) setFallback({ id: "", label: "" }); }, true)}</FormField>
    <FormField className="form-field"><Label htmlFor="incident-primary-delay">{t("workspace.escalation.delay")}</Label><Input validateOnBlur aria-describedby="incident-primary-timing" id="incident-primary-delay" className="min-h-11" type="number" min={60} max={86400} step={1} required disabled={busy} value={delay} onChange={event => setDelay(event.target.value)} /><p id="incident-primary-timing" className="text-sm text-muted-foreground">{delaySummary(delay)}</p></FormField>
    <FormField className="form-field"><Label htmlFor="incident-fallback">{t("workspace.escalation.fallback")}</Label>{select("incident-fallback", fallback, setFallback, false)}</FormField>
    {fallback.id && <FormField className="form-field"><Label htmlFor="incident-fallback-delay">{t("workspace.escalation.fallbackDelay")}</Label><Input validateOnBlur aria-describedby="incident-fallback-timing" id="incident-fallback-delay" className="min-h-11" type="number" min={Math.max(60, Number(delay) + 1)} max={86400} step={1} required disabled={busy} value={fallbackDelay} onChange={event => setFallbackDelay(event.target.value)} /><p id="incident-fallback-timing" className="text-sm text-muted-foreground">{delaySummary(fallbackDelay)}</p></FormField>}
    <div className="flex flex-wrap gap-2">{cursor && <Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start" type="button" onClick={() => setCursor(undefined)}>{t("workspace.escalation.firstChannels")}</Button>}{query.data?.nextCursor && <Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start" type="button" onClick={() => setCursor(query.data.nextCursor!)}>{t("workspace.escalation.moreChannels")}</Button>}</div>
    {!query.isPending && !options.length && <Link to="/dashboard" search={{ panel: "notifications" }} className="inline-flex min-h-11 items-center text-sm underline">{t("incidentUX.repairChannels")}</Link>}
    <Button type="submit" className="min-h-11 w-full sm:w-auto sm:justify-self-start" disabled={busy || !primary.id || query.isPending || !!query.error}>{t("workspace.escalation.configure")}</Button>
  </form>;
}
export function IncidentEscalationControls({ detail, busy, perform, draft, onDirty }: Props) {
  const accountTimezone = useAccountTimezone();
  const { t, i18n } = useTranslation("uptimeMonitor");
  useEffect(() => { if (detail.response.escalationSteps) { if (draft) draft.dirty = false; onDirty?.(false); } }, [detail.response.escalationSteps, draft, onDirty]);
  return <SectionCard headingLevel="h3" title={t("workspace.escalation.title")}><div className="grid min-w-0 gap-3">
    {detail.response.escalationSteps ? <><p className="text-sm text-muted-foreground">{t("workspace.escalation.immutable")}</p>{(detail.escalationJobs ?? []).map(job => <div key={job.step} className="grid gap-1 text-sm"><p>{t(job.step === 0 ? "workspace.escalation.primary" : "workspace.escalation.fallback")} · {t(`workspace.escalation.states.${job.state}`)}</p><p><bdi>{t("workspace.escalation.eligibleAt", { time: formatIncidentTimestamp(job.dueAt, i18n.language, accountTimezone) })}</bdi></p><p>{t("workspace.escalation.receipts", { attempts: job.attempts, count: job.deliveredCount })}</p></div>)}<Button variant="outline" className="min-h-11 w-full sm:w-auto sm:justify-self-start" disabled={busy || detail.response.escalationDisabled} onClick={() => void perform(() => IncidentWorkspaceService.cancelEscalation(detail.incident.incidentId))}>{t(detail.response.escalationDisabled ? "workspace.escalation.cancelled" : "workspace.escalation.cancel")}</Button></> : detail.incident.status === "ongoing" && !detail.response.acknowledgedAt && detail.monitor.active !== false ? <ConfigureEscalation draft={draft} onDirty={onDirty} detail={detail} busy={busy} perform={perform} /> : <p className="text-sm text-muted-foreground">{t("workspace.escalation.unavailable")}</p>}
  </div></SectionCard>;
}
