import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatDate } from "@/lib/date-format";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, ChevronLeft, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useUptimeNotificationLogs } from "@/hooks/uptime";
import type { UptimeNotificationLog } from "@/types/uptime";

const PAGE_SIZE = 25;

interface NotificationLogTableProps {
	/** Scope to one monitor's deliveries; omit for the account-wide history. */
	monitorId?: string;
  effectiveChannelCount?: number;
}

function OutcomeBadge({ outcome }: { outcome: UptimeNotificationLog["outcome"] }) {
	const { t } = useTranslation("uptimeMonitor");
	if (outcome === "sent") {
		return (
			<Badge
				variant="outline"
				className="gap-1.5 bg-success/10 text-success border-success/40"
			>
				{t("notifications.history.outcome.sent")}
			</Badge>
		);
	}
	return (
		<Badge variant="outline" className="gap-1.5 text-destructive border-destructive/40">
			{t(outcome === "failed" ? "notifications.history.outcome.failed" : "status.unknown")}
		</Badge>
	);
}

export function NotificationLogTable({ monitorId, effectiveChannelCount }: NotificationLogTableProps) {
	const { t, i18n } = useTranslation("uptimeMonitor");
  const accountTimezone = useAccountTimezone();
	const [page, setPage] = useState(0);
	const offset = page * PAGE_SIZE;

	const { data, isFetching, isPending, error, refetch } = useUptimeNotificationLogs(monitorId, {
		limit: PAGE_SIZE,
		offset,
	});

	const rows = data?.data ?? [];
	const total = data?.total ?? 0;
	const hasNext = offset + PAGE_SIZE < total;

 if (isPending) return <p role="status">{t("notificationUX.loadingLog")}</p>;
 if (error && !data) return <div role="alert"><p>{t("notificationUX.errorLog")}</p><Button variant="outline" onClick={() => void refetch()}>{t("workspace.retry")}</Button></div>;
	if (total === 0 && !isFetching) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
				<Bell className="h-6 w-6 text-muted-foreground mb-2" />
				<p className="font-medium">{t("notifications.history.empty")}</p>
				<p className="text-sm text-muted-foreground mt-1">
					{t(effectiveChannelCount === 0 ? "notificationUX.noEffectiveChannels" : effectiveChannelCount ? "notificationUX.noAttempts" : "notifications.history.emptyDescription")}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">{t("notificationUX.historyScope")}</p>
 <div role="region" tabIndex={0} aria-label={t("notifications.history.title")} className="w-full min-w-0 overflow-x-auto rounded-lg border">
				<Table className="min-w-[720px]">
					<TableHeader>
						<TableRow>
							<TableHead className="text-start">
								{t("notifications.history.columns.time")}
							</TableHead>
							<TableHead className="text-start">
								{t("notifications.history.columns.channel")}
							</TableHead>
							<TableHead className="text-start">
								{t("notifications.history.columns.target")}
							</TableHead>
							<TableHead className="text-start">
								{t("notifications.history.columns.event")}
							</TableHead>
							<TableHead className="text-start">
								{t("notifications.history.columns.outcome")}
							</TableHead>
							<TableHead className="text-start">
								{t("notifications.history.columns.attempts")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.notificationLogId}>
								<TableCell className="text-xs text-muted-foreground whitespace-nowrap">
									{formatDate(row.createdAt, i18n.language, accountTimezone)}
								</TableCell>
								<TableCell>
									<Badge variant="outline">
										{t(
											`notifications.channelTypes.${row.channelType}`,
											row.channelType,
										)}
									</Badge>
								</TableCell>
								<TableCell className="text-sm text-muted-foreground max-w-[220px] break-words">
									{row.target}
								</TableCell>
								<TableCell className="text-sm">
									{t(`notifications.history.event.${row.event}`, row.event)}
								</TableCell>
								<TableCell>
									{row.outcome === "failed" && row.error ? (
										<><OutcomeBadge outcome={row.outcome} /><p className="max-w-80 whitespace-pre-wrap break-words text-sm">{row.error}</p></>
									) : (
										<OutcomeBadge outcome={row.outcome} />
									)}
								</TableCell>
								<TableCell className="tabular-nums text-sm">
									{row.attempts}
									{row.providerMessageId ? (
										<Collapsible><CollapsibleTrigger className="min-h-11 text-xs underline">{t("notificationUX.technicalDetails")}</CollapsibleTrigger><CollapsibleContent className="max-w-64 break-all text-xs text-muted-foreground">
											{t("notifications.history.messageId", {
												id: row.providerMessageId,
											})}
										</CollapsibleContent></Collapsible>
									) : null}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{total > PAGE_SIZE ? (
				<div className="flex items-center justify-between">
					<p className="text-xs text-muted-foreground">
						{t("notifications.history.pageInfo", {
							from: offset + 1,
							to: Math.min(offset + PAGE_SIZE, total),
							total,
						})}
					</p>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							aria-label={t("actions.previous")} onClick={() => setPage((p) => Math.max(0, p - 1))}
							disabled={page === 0}
							className="h-[44px]"
						>
							<ChevronLeft className="h-4 w-4 rtl:scale-x-[-1]" />
						</Button>
						<Button
							variant="outline"
							size="sm"
							aria-label={t("actions.next")} onClick={() => setPage((p) => p + 1)}
							disabled={!hasNext}
							className="h-[44px]"
						>
							<ChevronRight className="h-4 w-4 rtl:scale-x-[-1]" />
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
