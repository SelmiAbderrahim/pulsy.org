import { requestConfirmation } from "@/lib/confirmation";
/**
 * Share links management sheet.
 *
 * Lists the user's share links with copy and revoke actions. Opened from the
 * dashboard header, mirroring the notification-settings sheet.
 *
 * @module components/uptime/share/share-links-sheet
 */

import { Copy, Link2, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	useRevokeUptimeShareLink,
	useUptimeShareLinks,
} from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { UptimeShareLink } from "@/types/uptime";

interface ShareLinksSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function isExpired(link: UptimeShareLink): boolean {
	return new Date(link.expiresAt).getTime() <= Date.now();
}

export function ShareLinksSheet({ open, onOpenChange }: ShareLinksSheetProps) {
	const { t } = useTranslation("uptimeMonitor");
	const { data, isLoading } = useUptimeShareLinks({ enabled: open });
	const revokeMutation = useRevokeUptimeShareLink();
	const links = data ?? [];

	const handleCopy = async (link: UptimeShareLink) => {
		await navigator.clipboard.writeText(
			`${window.location.origin}/share/${link.token}`,
		);
		toast.success(t("share.dialog.copied", "Link copied"));
	};

	const handleRevoke = async (link: UptimeShareLink) => {
		if (!await requestConfirmation(t("share.manage.revokeConfirm", "Revoke this share link? Anyone holding it will lose access."), {
      title: t("share.manage.revoke", "Revoke"), action: t("share.manage.revoke", "Revoke"),
    })) return;
		try {
			await revokeMutation.mutateAsync({ shareLinkId: link.shareLinkId });
			toast.success(t("share.manage.revokeSuccess", "Share link revoked"));
		} catch (error) {
			toast.error(
				extractErrorMessage(
					error,
					t("share.manage.revokeError", "Failed to revoke share link"),
				),
			);
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
				<SheetHeader>
					<SheetTitle>{t("share.manage.title", "Share Links")}</SheetTitle>
					<SheetDescription>
						{t(
							"share.manage.description",
							"Links you created to share monitor configurations.",
						)}
					</SheetDescription>
				</SheetHeader>

				<div className="mt-6 flex flex-col gap-2">
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						</div>
					) : links.length === 0 ? (
						<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
							<Link2 className="h-8 w-8 text-muted-foreground mb-2" />
							<p className="text-sm text-muted-foreground">
								{t("share.manage.empty", "No share links yet.")}
							</p>
						</div>
					) : (
						links.map((link) => (
							<div
								key={link.shareLinkId}
								className="flex items-center justify-between gap-3 rounded-lg border p-3"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">
										{link.monitorNames.join(", ")}
									</p>
									<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
										<span>
											{t("share.manage.monitors", "{{count}} monitors", {
												count: link.monitorCount,
											})}
										</span>
										{isExpired(link) ? (
											<Badge variant="outline" className="text-muted-foreground">
												{t("share.manage.expired", "Expired")}
											</Badge>
										) : (
											<span>
												{t("share.manage.expires", "Expires {{date}}", {
													date: new Date(link.expiresAt).toLocaleDateString(),
												})}
											</span>
										)}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleCopy(link)}
										className="h-[44px] w-[44px]"
										aria-label={t("share.dialog.copy", "Copy link")}
									>
										<Copy className="h-4 w-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleRevoke(link)}
										disabled={revokeMutation.isPending}
										className="h-[44px] w-[44px] text-destructive hover:text-destructive"
										aria-label={t("share.manage.revoke", "Revoke")}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</div>
						))
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
