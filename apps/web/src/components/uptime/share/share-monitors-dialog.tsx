import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { FormField } from "@/components/ui/form-field";
import { formatCount } from "@/lib/count-format";
import { formatInterval } from "@/lib/uptime/format";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatDate } from "@/lib/date-format";
import { formatMilliseconds } from "@/lib/uptime/number-format";
/**
 * Share monitors dialog.
 *
 * Opened from the monitor list's bulk-selection toolbar. Creates an expiring
 * share link for the selected monitors, then shows the copyable URL.
 *
 * @module components/uptime/share/share-monitors-dialog
 */

import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

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
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCreateUptimeShareLink } from "@/hooks/uptime";
import { UptimeService } from "@/services/uptime/uptimeService";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { CreatedUptimeShareLink, SharedMonitorConfig, UptimeMonitor } from "@/types/uptime";

const EXPIRY_OPTIONS = ["7", "30", "90"] as const;

interface ShareMonitorsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	monitors: UptimeMonitor[];
	/** Called when the dialog closes after a link was created. */
	onCreated?: () => void;
}

export function ShareMonitorsDialog({
	open,
	onOpenChange,
	monitors,
	onCreated,
}: ShareMonitorsDialogProps) {
  const client = useQueryClient();
	const { t, i18n } = useTranslation("uptimeMonitor");
  const accountTimezone = useAccountTimezone();
	const createMutation = useCreateUptimeShareLink();
  const creating = useRef(false);
	const [expiresInDays, setExpiresInDays] = useState<string>("30");
	const [showSharerName, setShowSharerName] = useState(false);
	const [createdLink, setCreatedLink] = useState<CreatedUptimeShareLink | null>(
		null,
	);
	const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<SharedMonitorConfig[] | null>(null), [error, setError] = useState("");
  const ids = JSON.stringify([...new Set(monitors.map(monitor => monitor.uptimeMonitorId))]);
  useEffect(() => {
    let current = true; setPreview(null); setError("");
    if (open && monitors.length) void UptimeService.previewShareLink(JSON.parse(ids) as string[]).then(value => { if (current) setPreview(value); }).catch(caught => { if (current) setError(extractErrorMessage(caught, t("share.dialog.error"))); });
    return () => { current = false; };
  }, [open, ids, t]);

	const shareUrl = createdLink
		? `${window.location.origin}/share/${createdLink.token}`
		: "";

	// The dialog has no trigger of its own (the parent controls `open`), so any
	// onOpenChange callback from Radix is a close request.
	const handleClose = () => {
    if (creating.current) return;
		if (createdLink) {
			onCreated?.();
		}
		setCreatedLink(null);
		setCopied(false);
		setExpiresInDays("30");
		setShowSharerName(false);
		onOpenChange(false);
	};

	const handleCreate = async () => {
    if (creating.current || !preview || error) return;
    creating.current = true;
		try {
			const link = await createMutation.mutateAsync({
				uptimeMonitorIds: JSON.parse(ids) as string[],
				expiresInDays: Number(expiresInDays) as 7 | 30 | 90,
				showSharerName,
			});
			if (!isSessionClientActive(client)) return; setCreatedLink(link);
		} catch (error) { if (!isSessionClientActive(client)) return;
			toast.error(
				extractErrorMessage(
					error,
					t("share.dialog.error", "Failed to create share link"),
				),
			);
		}
    finally { creating.current = false; }
	};

	const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (!isSessionClientActive(client)) return; toast.success(t("share.dialog.copied", "Link copied"));
    } catch { if (!isSessionClientActive(client)) return; toast.error(t("detailUX.copyFailed")); }
	};

	const listedMonitors = preview ?? monitors;

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-[var(--dialog-simple)]">
				<DialogHeader>
					<DialogTitle>
						{t("share.dialog.title", "Share {{count}} monitors", {
							count: monitors.length,
						})}
					</DialogTitle>
					<DialogDescription>
						{t(
							"share.dialog.description",
							"Anyone with the link can copy these monitor configurations into their own account.",
						)}
					</DialogDescription>
				</DialogHeader>

				{createdLink ? (
					<div className="flex flex-col gap-3">
						<Label htmlFor="share-link-url">
							{t("share.dialog.linkLabel", "Share link")}
						</Label>
						<div className="flex items-center gap-2">
							<Input id="share-link-url" dir="ltr" value={shareUrl} readOnly />
							<Button
								variant="outline"
								size="icon"
								onClick={handleCopy}
								className="h-[44px] w-[44px] shrink-0"
								aria-label={t("share.dialog.copy", "Copy link")}
							>
								{copied ? (
									<Check className="h-4 w-4" />
								) : (
									<Copy className="h-4 w-4" />
								)}
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							{t("share.dialog.expiresOn", "Expires on {{date}}", {
								date: formatDate(createdLink.expiresAt, i18n.language, accountTimezone),
							})}
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-4">
						<FormField className="form-field">
							<Label htmlFor="share-expiry">
								{t("share.dialog.expiry", "Link expires in")}
							</Label>
							<Select value={expiresInDays} onValueChange={setExpiresInDays}>
								<SelectTrigger id="share-expiry">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{EXPIRY_OPTIONS.map((days) => (
										<SelectItem key={days} value={days}>
											{formatCount((key, options) => t(key, { ...options, defaultValue: `${days} days` }), "common:format.day", Number(days), i18n.language)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{t("share.dialog.expiryPreview", "The link will expire on {{date}}.", {
									date: formatDate(new Date(Date.now() + Number(expiresInDays) * 86_400_000).toISOString(), i18n.language, accountTimezone),
								})}
							</p>
						</FormField>
						<div className="flex min-h-[44px] items-center justify-between gap-3">
							<Label htmlFor="share-show-name" className="grid gap-1 font-normal">
								<span className="text-sm font-medium">{t("share.dialog.showName", "Show my name to recipients")}</span>
								<span className="text-xs text-muted-foreground">{t("share.dialog.showNameHint", "Off by default. Recipients otherwise see “A Pulsy user”.")}</span>
							</Label>
							<Switch id="share-show-name" checked={showSharerName} onCheckedChange={setShowSharerName} />
						</div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {!preview && !error && monitors.length > 0 && <p role="status">{t("common:states.loading")}</p>}
            <ul className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm">
							{listedMonitors.map((monitor) => (
								<li key={monitor.uptimeMonitorId} className="break-words">
                  <p className="font-medium" dir="auto">{monitor.name}</p>
                  {preview && <><p dir="ltr" className="break-all">{monitor.method} {monitor.url}</p><p>{t("shareUX.settings", { status: monitor.expectedStatuses ?? monitor.expectedStatus, interval: formatInterval(monitor.interval, t, i18n.language), timeout: formatMilliseconds(monitor.timeout, i18n.language) ?? "—", failures: monitor.failureThreshold })}</p><p dir="auto">{monitor.tags?.join(", ")}</p></>}
								</li>
							))}
						</ul>

					</div>
				)}

				<DialogFooter>
					{createdLink ? (
						<Button onClick={handleClose} className="h-[44px]">
							{t("share.dialog.done", "Done")}
						</Button>
					) : (
						<>
							<Button
								variant="outline"
								onClick={handleClose}
								className="h-[44px]"
							>
								{t("share.dialog.cancel", "Cancel")}
							</Button>
							<Button
								onClick={handleCreate}
								disabled={createMutation.isPending || monitors.length === 0 || !preview || !!error}
								className="h-[44px]"
							>
								{createMutation.isPending && (
									<Loader2 className="h-4 w-4 me-2 animate-spin" />
								)}
								{createMutation.isPending
									? t("share.dialog.creating", "Creating...")
									: t("share.dialog.create", "Create link")}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
