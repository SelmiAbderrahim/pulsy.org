import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatDate } from "@/lib/date-format";
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
import { toast } from "@/lib/toast";

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
  const client = useQueryClient();
	const { t, i18n } = useTranslation("uptimeMonitor");
  const accountTimezone = useAccountTimezone();
	const { data, isLoading, error, refetch } = useUptimeShareLinks({ enabled: open });
	const revokeMutation = useRevokeUptimeShareLink();
	const links = data ?? [];

	const handleCopy = async (link: UptimeShareLink) => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/share/${link.token}`); if (!isSessionClientActive(client)) return; toast.success(t("share.dialog.copied", "Link copied")); }
    catch { if (!isSessionClientActive(client)) return; toast.error(t("detailUX.copyFailed")); }
	};

	const handleRevoke = async (link: UptimeShareLink) => {
		if (
			!await requestConfirmation(
				t(
					"share.manage.revokeConfirm",
					"Revoke this share link? Anyone holding it will lose access.",
				),
				{ title: t("share.manage.revokeTitle"), action: t("share.manage.revoke") },
			)
		)
			return;
		try {
			await revokeMutation.mutateAsync({ shareLinkId: link.shareLinkId });
			if (!isSessionClientActive(client)) return; toast.success(t("share.manage.revokeSuccess", "Share link revoked"));
		} catch (error) { if (!isSessionClientActive(client)) return;
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
			<SheetContent side="right" className={`flex flex-col overflow-hidden ${layoutTokens.listDrawer}`}>
				<SheetHeader>
					<SheetTitle>{t("share.manage.title", "Share links")}</SheetTitle>
					<SheetDescription>
						{t(
							"share.manage.description",
							"Links you created to share monitor configurations.",
						)}
					</SheetDescription>
				</SheetHeader>

				<div className="mt-6 flex min-h-0 flex-col gap-3 overflow-y-auto">
          <Collapsible className="rounded-md border"><CollapsibleTrigger className="ps-4">{t("shareUX.whatsShared")}</CollapsibleTrigger><CollapsibleContent><p className="text-sm text-muted-foreground">{t("shareUX.disclosure")}</p></CollapsibleContent></Collapsible>
          <p className="text-sm text-muted-foreground">{t("shareUX.entryHint")}</p><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" variant="outline" asChild><a href="/dashboard">{t("shareUX.selectMonitors")}</a></Button>
          {error && <div role="alert"><p className="text-sm text-destructive">{t("communication.error")}</p><Button variant="outline" onClick={() => void refetch()}>{t("communication.retry")}</Button></div>}
          {isLoading ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						</div>
					) : !error && links.length === 0 ? (
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
									<p className="break-words text-sm font-medium" dir="auto">
										{link.monitorNames.join(", ")}
									</p>
									<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
										<span>
											{t("share.manage.monitors", "{{count}} monitors", {
												count: link.monitorCount,
											})}
										</span>
                    <span>{t("shareUX.created", { date: formatDate(link.createdAt, i18n.language, accountTimezone) })}</span>
                    {isExpired(link) ? (
											<Badge variant="outline" className="text-muted-foreground">
												{t("share.manage.expired", "Expired")}
											</Badge>
										) : (
											<span>
												{t("share.manage.expires", "Expires on {{date}}", {
													date: formatDate(link.expiresAt, i18n.language, accountTimezone),
												})}
											</span>
										)}
										{link.showSharerName && <span>{t("share.manage.nameShown", "Your name is shown")}</span>}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleCopy(link)}
										className="h-[44px] w-[44px]"
										aria-label={`${t("share.dialog.copy", "Copy link")} ${link.monitorNames.join(", ")}`}
									>
										<Copy className="h-4 w-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleRevoke(link)}
										disabled={revokeMutation.isPending}
										className="h-[44px] w-[44px] text-destructive hover:text-destructive"
										aria-label={`${t("share.manage.revoke", "Revoke")} ${link.monitorNames.join(", ")}`}
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
