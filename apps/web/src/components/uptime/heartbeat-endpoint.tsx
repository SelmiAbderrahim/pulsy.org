import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SERVER_URL } from "@/lib/api/trpc";
import { heartbeatExamples, heartbeatUrl } from "@/lib/uptime/heartbeat-url";
import { HeartbeatService } from "@/services/uptime/heartbeatService";
import { CopyableUrl } from "./copyable-url";

/** No polling/cache contains credentials; recovery requires a deliberate owner action. */
export function HeartbeatEndpoint({ monitorId, token }: { monitorId?: string; token?: string }) {
  const { t } = useTranslation("uptimeMonitor");
  const [visible, setVisible] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = (value: string) => heartbeatUrl(SERVER_URL, window.location.origin, value);
  const recover = async () => {
    setError("");
    const value = token ?? (monitorId ? (await HeartbeatService.reveal(monitorId)).token : null);
    if (!value) { setError(t("heartbeat.rotateToReveal")); throw new Error("Credential unavailable"); }
    return value;
  };
  const reveal = async () => {
    if (visible) { setVisible(null); return; }
    setBusy(true);
    try { setVisible(await recover()); } catch { setError(message => message || t("heartbeat.error")); } finally { setBusy(false); }
  };
  return <section className="grid min-w-0 gap-3 rounded-md border p-3" aria-label={t("heartbeat.endpoint")}>
    <h3 className="text-sm font-medium">{t("heartbeat.endpoint")}</h3>
    <CopyableUrl url={url(visible ?? "••••••••").replaceAll("%E2%80%A2", "•")} label={t("heartbeat.endpoint")} resolveCopy={async () => url(await recover())} actions={<Button type="button" variant="outline" disabled={busy} onClick={() => void reveal()}>{t(visible ? "heartbeat.hide" : "heartbeat.reveal")}</Button>} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-sm text-muted-foreground">{t("heartbeat.urlSecurity")}</p>
    <Collapsible><CollapsibleTrigger>{t("heartbeat.example")}</CollapsibleTrigger><CollapsibleContent className="p-0">
      <pre dir="ltr" tabIndex={0} role="region" aria-label={t("heartbeat.example")} className="mt-3 max-w-full overflow-x-auto rounded-md bg-muted p-3 text-xs">{heartbeatExamples(SERVER_URL, window.location.origin, visible)}</pre>
    </CollapsibleContent></Collapsible>
  </section>;
}
