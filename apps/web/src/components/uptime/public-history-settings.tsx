import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { SectionCard } from "@/components/ui/section-card";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { StatusCommunicationService } from "@/services/uptime/statusCommunicationService";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { PublicHistoryPreview } from "@/types/status-communication";
export function PublicHistorySettings({ pageId, enabled: initial, changed, onDirtyChange }: { pageId: string; enabled: boolean; changed: () => Promise<void>; onDirtyChange?: (dirty: boolean) => void }) {
  const client = useQueryClient();
  const { t } = useTranslation("uptimeMonitor"), id = useId(); const [enabled, setEnabled] = useState(initial), [preview, setPreview] = useState<PublicHistoryPreview>(), [busy, setBusy] = useState(false), [error, setError] = useState(""); const current = useRef(enabled); current.current = enabled;
  useEffect(() => { onDirtyChange?.(enabled !== initial); }, [enabled, initial, onDirtyChange]);
  const prepare = async () => { const requested = enabled; setBusy(true); setError(""); setPreview(undefined); try { const value = await StatusCommunicationService.historyPreview(pageId, requested); if (requested === current.current) setPreview(value); } catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("reliability.error"))); } finally { setBusy(false); } };
  const apply = async () => { if (!preview || preview.enabled !== current.current) return; setBusy(true); setError(""); try { await StatusCommunicationService.historyApply(pageId, enabled, preview.revision); setPreview(undefined); if (!isSessionClientActive(client)) return; await changed(); } catch (caught) { if (!isSessionClientActive(client)) return; setError(extractErrorMessage(caught, t("reliability.error"))); setPreview(undefined); } finally { setBusy(false); } };
  const action = "w-full sm:w-auto sm:justify-self-start min-h-11 h-auto max-w-full whitespace-normal break-words py-2";
  return <SectionCard title={t("reliability.publicTitle")} headerEnd={<DocsHelpLink docPath="reliability" />}><div className="grid min-w-0 gap-4"><p className="text-sm text-muted-foreground">{t("reliability.historyDisclosure")}</p><div className="flex min-h-11 items-center justify-between gap-3"><Label htmlFor={`${id}-enabled`}>{t("reliability.enableHistory")}</Label><Switch id={`${id}-enabled`} checked={enabled} disabled={busy} onCheckedChange={value => { setEnabled(value); setPreview(undefined); }} /></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button variant="outline" className={action} disabled={busy} onClick={() => void prepare()}>{t("reliability.previewHistory")}</Button>{preview && preview.enabled === enabled && <SectionCard headingLevel="h3" title={t("reliability.historyPreview")}><div className="grid min-w-0 gap-3"><p className="break-words"><bdi>{preview.page.title}</bdi></p><p className="text-sm"><bdi>{preview.from.slice(0, 10)} → {preview.to.slice(0, 10)} · UTC</bdi></p><p className="text-sm">{t(preview.enabled ? "reliability.enablingHistory" : "reliability.disablingHistory")}</p><p className="text-sm">{t(preview.page.published ? "communication.liveDisclosure" : "communication.draftDisclosure")}</p><ul className="grid min-w-0 gap-1 text-sm">{preview.components.map(component => <li key={component.componentId} className="break-words"><bdi>{component.name}</bdi></li>)}</ul><Button className={action} disabled={busy} onClick={() => void apply()}>{t("reliability.applyHistory")}</Button></div></SectionCard>}</div></SectionCard>;
}
