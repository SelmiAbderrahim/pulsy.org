/**
 * Share monitors dialog.
 *
 * Opened from the monitor list's bulk-selection toolbar. Creates an expiring
 * share link for the selected monitors, then shows the copyable URL.
 *
 * @module components/uptime/share/share-monitors-dialog
 */

import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCreateUptimeShareLink } from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { CreatedUptimeShareLink, UptimeMonitor } from "@/types/uptime";

const EXPIRY_OPTIONS = ["7", "30", "90"] as const;
const MAX_LISTED_MONITORS = 5;

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
	const { t } = useTranslation("uptimeMonitor");
	const createMutation = useCreateUptimeShareLink();
	const [expiresInDays, setExpiresInDays] = useState<string>("30");
	const [createdLink, setCreatedLink] = useState<CreatedUptimeShareLink | null>(
		null,
	);
	const [copied, setCopied] = useState(false);

	const shareUrl = createdLink
		? `${window.location.origin}/share/${createdLink.token}`
		: "";

	// The dialog has no trigger of its own (the parent controls `open`), so any
	// onOpenChange callback from Radix is a close request.
	const handleClose = () => {
		if (createdLink) {
			onCreated?.();
		}
		setCreatedLink(null);
		setCopied(false);
		setExpiresInDays("30");
		onOpenChange(false);
	};

	const handleCreate = async () => {
		try {
			const link = await createMutation.mutateAsync({
				uptimeMonitorIds: monitors.map((m) => m.uptimeMonitorId),
				expiresInDays: Number(expiresInDays) as 7 | 30 | 90,
			});
			setCreatedLink(link);
		} catch (error) {
			toast.error(
				extractErrorMessage(
					error,
					t("share.dialog.error", "Failed to create share link"),
				),
			);
		}
	};

	const handleCopy = async () => {
		await navigator.clipboard.writeText(shareUrl);
		setCopied(true);
		toast.success(t("share.dialog.copied", "Link copied"));
	};

	const listedMonitors = monitors.slice(0, MAX_LISTED_MONITORS);
	const overflowCount = monitors.length - listedMonitors.length;

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-md">
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
							<Input id="share-link-url" value={shareUrl} readOnly />
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
							{t("share.dialog.expiresOn", "Expires {{date}}", {
								date: new Date(createdLink.expiresAt).toLocaleDateString(),
							})}
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-4">
						<ul className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
							{listedMonitors.map((monitor) => (
								<li key={monitor.uptimeMonitorId} className="truncate">
									{monitor.name}
								</li>
							))}
							{overflowCount > 0 && (
								<li className="text-muted-foreground">
									{t("share.dialog.moreItems", "+{{count}} more", {
										count: overflowCount,
									})}
								</li>
							)}
						</ul>
						<div className="grid gap-2">
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
											{t(`share.dialog.expiry${days}`, `${days} days`)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
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
								disabled={createMutation.isPending || monitors.length === 0}
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
