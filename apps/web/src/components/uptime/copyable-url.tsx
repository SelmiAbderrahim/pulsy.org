import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

/** One wrappable URL with a deliberate copy action; announces the outcome and never claims a copy that failed. */
export function CopyableUrl({ url, label, truncateMiddle = false, actions, resolveCopy }: { url: string; label: string; truncateMiddle?: boolean; actions?: ReactNode; resolveCopy?: () => Promise<string> }) {
  const { t } = useTranslation("uptimeMonitor");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [copying, setCopying] = useState(false);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    setCopying(true);
    try { const value = resolveCopy ? await resolveCopy() : url; if (!mounted.current) return; await navigator.clipboard.writeText(value); setState("copied"); } catch { setState("failed"); } finally { setCopying(false); }
  };
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    {truncateMiddle ? <TooltipProvider delayDuration={150}><Tooltip><TooltipTrigger asChild><span data-status-page-url tabIndex={0} aria-label={url} title={url} dir="ltr" className="flex min-w-40 max-w-full flex-1 basis-40 rounded-xs text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 truncate">{url.slice(0, -16)}</span><span className="shrink-0">{url.slice(-16)}</span></span></TooltipTrigger><TooltipContent className="max-w-[calc(100vw-2rem)] break-all" dir="ltr">{url}</TooltipContent></Tooltip></TooltipProvider> : <p className="min-w-0 break-all text-sm" dir="ltr">{url}</p>}
    <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={copying} onClick={() => void copy()} aria-label={`${t("statusUX.copyUrl")}: ${label}`}>{state === "copied" ? <Check aria-hidden className="me-1 h-4 w-4" /> : <Copy aria-hidden className="me-1 h-4 w-4" />}{t("statusUX.copyUrl")}</Button>
    {actions}
    <span role="status" className="text-xs text-muted-foreground">{state === "copied" ? t("statusUX.urlCopied") : state === "failed" ? t("statusUX.urlCopyFailed") : ""}</span>
  </div>;
}
