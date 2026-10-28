import { isSessionClientActive } from "@/lib/session-query-client";
import { formattingLocale } from "@/lib/formatting-locale";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { StatusCommunicationService } from "@/services/uptime/statusCommunicationService";
import { UptimeService } from "@/services/uptime/uptimeService";
import type { SubscriptionReadiness } from "@/types/status-communication";
import type { UptimeEmailProvider } from "@/types/uptime";
const actionClass = "w-full sm:w-auto sm:justify-self-start min-h-11 h-auto whitespace-normal break-words py-2";
function SettingsForm({ pageId, data, providers, changed, published, onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void; published: boolean; pageId: string; data: SubscriptionReadiness; providers: UptimeEmailProvider[]; changed: () => Promise<void> }) {
  const client = useQueryClient();
  const { t, i18n } = useTranslation("uptimeMonitor");
  const [enabled, setEnabled] = useState(data.enabled), [providerId, setProviderId] = useState(data.providerId ?? ""), [rate, setRate] = useState(String(data.messagesPerMinute)), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const saved = JSON.stringify([data.enabled, data.providerId ?? "", String(data.messagesPerMinute)]), [baseline, setBaseline] = useState(saved);
  const snapshot = JSON.stringify([enabled, providerId, rate]), dirty = snapshot !== baseline, submitting = useRef(false);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!dirty) { setEnabled(data.enabled); setProviderId(data.providerId ?? ""); setRate(String(data.messagesPerMinute)); setBaseline(saved); } }, [saved, dirty]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (submitting.current) return; submitting.current = true; setBusy(true); setError("");
    try { await StatusCommunicationService.subscriptionsConfigure({ statusPageId: pageId, enabled, providerId: providerId || null, messagesPerMinute: Number(rate), confirmChange: confirmed }); setConfirmed(false); if (!isSessionClientActive(client)) return; await changed(); setBaseline(snapshot); }
    catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("subscriptions.error"))); } finally { submitting.current = false; setBusy(false); }
  };
  const providerReady = providers.some(provider => provider.emailProviderId === providerId && provider.verified), rateValid = Number.isInteger(Number(rate)) && Number(rate) >= 1 && Number(rate) <= 60;
  const blocked = !confirmed ? "subscriptions.blockedConfirm" : enabled && !providerReady ? "subscriptions.blockedProvider" : !rateValid ? "subscriptions.blockedRate" : null;
  return <form className="grid min-w-0 grid-cols-1 gap-4" onSubmit={event => void save(event)}>
    <p className="text-sm text-muted-foreground">{t("subscriptions.ownerHint")}</p>
    <p className="text-sm font-medium">{t(data.ready ? "subscriptions.ready" : "subscriptions.notReady")}</p>
    {(!published || !data.providerReady) && <ul className="grid gap-2 text-sm" data-subscription-prerequisites>
      {!published && <li>{t("subscriptions.needsPublication")} <a className="underline" href="?tab=general">{t("statusUX.tabs.general")}</a></li>}
      {!data.providerReady && <li>{t("subscriptions.needsProvider")} <a className="underline" href={providers.some(provider => provider.verified) ? "#status-subscription-provider" : "/dashboard?panel=notifications"}>{t(providers.some(provider => provider.verified) ? "subscriptions.chooseProvider" : "statusUX.configureProviders")}</a></li>}
    </ul>}
    {dirty && <p className="text-sm">{t("statusUX.unsaved")}</p>}
    {dirty && saved !== baseline && <p role="alert" className="text-sm">{t("statusUX.stale")}</p>}
    <dl className="grid grid-cols-2 gap-2 text-sm">{(["confirmed", "pending", "queued", "delivered"] as const).map(key => <div key={key}><dt className="text-muted-foreground">{t(`subscriptions.${key}`)}</dt><dd className="tabular-nums">{new Intl.NumberFormat(formattingLocale(i18n.language)).format(data[key])}</dd></div>)}</dl>
    {data.failures.map(failure => <p key={failure.reason ?? "unknown"} className="text-sm text-destructive">{t(`subscriptions.failures.${failure.reason ?? "delivery_failed"}`)}: {failure.count}</p>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

    <FormField className="form-field"><Label htmlFor="status-subscription-provider">{t("subscriptions.provider")}</Label><Select value={providerId || "__none"} disabled={busy} onValueChange={value => { setProviderId(value === "__none" ? "" : value); setConfirmed(false); }}><SelectTrigger id="status-subscription-provider"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">{t(providers.some(provider => provider.verified) ? "subscriptions.chooseProvider" : "subscriptions.noVerifiedOption")}</SelectItem>{providers.filter(provider => provider.verified || provider.emailProviderId === data.providerId).map(provider => <SelectItem key={provider.emailProviderId} value={provider.emailProviderId} disabled={!provider.verified}>{provider.name}</SelectItem>)}</SelectContent></Select>{!providers.some(provider => provider.verified) && <p className="text-sm text-muted-foreground">{t("subscriptions.noVerifiedProvider")}</p>}</FormField>
    <fieldset className="grid min-w-0 gap-4 rounded-md border p-4">
      <legend className="px-1 text-sm font-medium">{t("subscriptions.controlsLegend")}</legend>
      <div className="grid gap-1.5"><label className="flex min-h-11 items-center gap-2 text-sm"><input aria-describedby="status-subscription-enable-help" type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={enabled} disabled={busy} onChange={event => { setEnabled(event.target.checked); setConfirmed(false); }} />{t("subscriptions.enable")}</label><p id="status-subscription-enable-help" className="ps-7 text-sm text-muted-foreground">{t("subscriptions.enableHelp")}</p></div>
      <div className="grid gap-1.5"><label className="flex min-h-11 items-start gap-2 text-sm"><input aria-describedby="status-subscription-confirm-help" type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{t("subscriptions.confirmChange")}</label><p id="status-subscription-confirm-help" className="ps-7 text-sm text-muted-foreground">{t("subscriptions.confirmChangeHelp")}</p></div>
    </fieldset>
    <Collapsible className="rounded-md border"><CollapsibleTrigger className="ps-4">{t("statusUX.advancedDelivery")}</CollapsibleTrigger><CollapsibleContent><FormField className="form-field"><Label htmlFor="status-subscription-rate">{t("subscriptions.rate")}</Label><Input id="status-subscription-rate" type="number" min={1} max={60} required className="min-h-11" value={rate} disabled={busy} onChange={event => { setRate(event.target.value); setConfirmed(false); }} /><p className="text-xs text-muted-foreground">{t("subscriptions.rateHint")}</p></FormField></CollapsibleContent></Collapsible>

    <Button type="submit" className={actionClass} aria-describedby={blocked ? "status-subscription-blocked" : undefined} disabled={busy || blocked !== null}>{t("subscriptions.save")}</Button>{blocked && <p id="status-subscription-blocked" className="text-sm text-muted-foreground">{t(blocked)}</p>}
  </form>;
}
export function StatusSubscriptionSettings({ pageId, published = true, onDirtyChange }: { pageId: string; published?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useTranslation("uptimeMonitor"), { data: session } = useSession(), client = useQueryClient();
  const key = uptimeKeys.statusPages.subscriptions(session?.user.id, pageId);
  const query = useQuery({ queryKey: key, queryFn: () => StatusCommunicationService.subscriptions(pageId), enabled: !!session?.user.id });
  const providers = useQuery({ queryKey: [...uptimeKeys.emailProviders.lists(), session?.user.id, "subscriptions"], queryFn: () => UptimeService.listEmailProviders(), enabled: !!session?.user.id });
  return <SectionCard title={t("subscriptions.title")}>
    {(query.isPending || providers.isPending) && <p role="status">{t("common:states.loading")}</p>}
    {(query.error || providers.error) && <div className="grid gap-2" role="alert"><p className="text-sm text-destructive">{t("subscriptions.error")}</p><Button variant="outline" className={actionClass} onClick={() => { void query.refetch(); void providers.refetch(); }}>{t("communication.retry")}</Button></div>}
    {query.data && providers.data && <SettingsForm key={pageId} pageId={pageId} published={published} onDirtyChange={onDirtyChange} data={query.data} providers={providers.data} changed={async () => { await client.invalidateQueries({ queryKey: key }); }} />}
  </SectionCard>;
}
