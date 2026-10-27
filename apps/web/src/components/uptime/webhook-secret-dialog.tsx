import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { UptimeService } from "@/services/uptime/uptimeService";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";

export function WebhookSecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const { t } = useTranslation("uptimeMonitor");
  return <Dialog open={Boolean(secret)} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent><DialogHeader><DialogTitle>{t("notificationUX.signingSecret")}</DialogTitle><DialogDescription>{t("notificationUX.secretOnce")}</DialogDescription></DialogHeader>
      <code dir="ltr" className="block select-all break-all rounded-md border p-3">{secret}</code>
      <DialogFooter><Button onClick={onClose}>{t("notificationUX.secretSaved")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function RotateWebhookSecret({ channelId, onSecret }: { channelId: string; onSecret: (value: string) => void }) {
  const { t } = useTranslation("uptimeMonitor");
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  return <Button variant="outline" className="min-h-11" disabled={pending} onClick={async () => {
    setPending(true);
    try { const result = await UptimeService.rotateChannelSecret(channelId); if (!isSessionClientActive(client)) return; onSecret(result.signingSecret); }
    catch (error) { if (!isSessionClientActive(client)) return; toast.error(extractErrorMessage(error, t("notifications.create.error"))); }
    finally { setPending(false); }
  }}>{t("notificationUX.rotateSecret")}</Button>;
}
