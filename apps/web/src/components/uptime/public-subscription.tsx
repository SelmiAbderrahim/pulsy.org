import { FormField } from "@/components/ui/form-field";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { SectionCard } from "@/components/ui/section-card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicStatusPage } from "@/types/uptime";
import { clearSubscriptionCapability, readSubscriptionCapability } from "@/lib/uptime/public-subscription-capability";
import { PublicSubscriptionService } from "@/services/uptime/publicSubscriptionService";
const actionClass = "w-full sm:w-auto sm:justify-self-start min-h-11 h-auto whitespace-normal break-words py-2";
export function PublicSubscription({ data }: { data?: PublicStatusPage }) {
  const { t, i18n } = useTranslation("uptimeMonitor");
  const validation = useFormValidation();
  const [capability, setCapability] = useState(readSubscriptionCapability), [email, setEmail] = useState(""), [scope, setScope] = useState("page"), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(false);
  const mounted = useRef(true), generation = useRef(0), pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const read = () => {
      generation.current += 1;
      pending.current = false;
      setCapability(readSubscriptionCapability());
      setBusy(false); setMessage(""); setError(false);
    };
    window.addEventListener("pulsy-subscription-capability", read);
    return () => { mounted.current = false; generation.current += 1; window.removeEventListener("pulsy-subscription-capability", read); };
  }, []);
  const pageKey = capability?.pageKey ?? data?.publicKey;
  const redeem = async () => {
    if (!capability || !pageKey || pending.current) return;
    pending.current = true; const active = generation.current;
    const current = () => mounted.current && generation.current === active;
    setBusy(true); setMessage(""); setError(false);
    try { await PublicSubscriptionService.redeem(pageKey, capability); if (!current()) return; clearSubscriptionCapability(); setCapability(null); setMessage(t("subscriptions.linkProcessed")); }
    catch { if (current()) { setError(true); setMessage(t("subscriptions.error")); } } finally { if (current()) { pending.current = false; setBusy(false); } }
  };
  const request = async (event: React.FormEvent) => {
    event.preventDefault(); if (pending.current || !validation.validate() || !pageKey) return;
    pending.current = true; const active = generation.current;
    const current = () => mounted.current && generation.current === active;
    setBusy(true); setMessage(""); setError(false);
    const language = ["en", "ar", "fr", "de", "es"].includes(i18n.language) ? i18n.language as "en" | "ar" | "fr" | "de" | "es" : "en";
    try { await PublicSubscriptionService.request(pageKey, { email, componentIds: scope === "page" ? [] : selected, language }); if (!current()) return; setEmail(""); validation.clear(); setMessage(t("subscriptions.requested")); }
    catch { if (current()) { setError(true); setMessage(t("subscriptions.error")); } } finally { if (current()) { pending.current = false; setBusy(false); } }
  };
  if ((!pageKey || !data?.emailSubscriptionsEnabled && !capability) && !message) return null;
  return <SectionCard title={t("subscriptions.title")}><div className="space-y-3">
    {message && <p role={error ? "alert" : "status"} className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>}
    {capability ? <><p className="text-sm text-muted-foreground">{t(`subscriptions.${capability.action}Hint`)}</p><Button disabled={busy} className={actionClass} onClick={() => void redeem()}>{t(`subscriptions.${capability.action}Action`)}</Button></> : data?.emailSubscriptionsEnabled && <Collapsible>
      <CollapsibleTrigger>{t("subscriptions.subscribe")}</CollapsibleTrigger><CollapsibleContent>
      <form ref={validation.formRef} noValidate className="grid min-w-0 gap-3 pt-3" onSubmit={event => void request(event)}>
        <FormErrorSummary issues={validation.issues} />
        <p className="text-sm text-muted-foreground">{t("subscriptions.optInHint")}</p>
        <FormField error={validation.issues.find(issue => issue.id === "subscriber-email")?.message} label={t("subscriptions.email")} control={<Input id="subscriber-email" type="email" dir="ltr" autoComplete="email" maxLength={254} required className="min-h-11" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} />} />

        <Label htmlFor="subscriber-scope">{t("subscriptions.scope")}</Label><Select disabled={busy} value={scope} onValueChange={setScope}><SelectTrigger id="subscriber-scope"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="page">{t("subscriptions.wholePage")}</SelectItem><SelectItem value="selected">{t("subscriptions.selected")}</SelectItem></SelectContent></Select>
        {scope === "selected" && <fieldset className="grid gap-2"><legend className="text-sm font-medium">{t("communication.affected")}</legend>{data!.monitors.filter(monitor => monitor.componentId).map(monitor => <label key={monitor.componentId} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={selected.includes(monitor.componentId!)} disabled={busy} onChange={event => setSelected(ids => event.target.checked ? [...ids, monitor.componentId!] : ids.filter(id => id !== monitor.componentId))} /><bdi className="break-words">{monitor.name}</bdi></label>)}</fieldset>}
        <Button type="submit" className={actionClass} disabled={busy || scope === "selected" && !selected.length}>{t("subscriptions.request")}</Button>
      </form>
    </CollapsibleContent></Collapsible>}
  </div></SectionCard>;
}
