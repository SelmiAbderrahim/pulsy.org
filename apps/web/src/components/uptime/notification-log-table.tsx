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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUptimeNotificationLogs } from "@/hooks/uptime";
import type { UptimeNotificationLog } from "@/types/uptime";

const PAGE_SIZE = 25;

interface NotificationLogTableProps {
	/** Scope to one monitor's deliveries; omit for the account-wide history. */
	monitorId?: string;
}

function OutcomeBadge({ outcome }: { outcome: UptimeNotificationLog["outcome"] }) {
	const { t } = useTranslation("uptimeMonitor");
	if (outcome === "sent") {
		return (
			<Badge
				variant="outline"
				className="gap-1.5 bg-green-50 text-green-900 border-green-200 dark:bg-green-900/20 dark:text-green-300"
			>
				{t("notifications.history.outcome.sent")}
			</Badge>
		);
	}
	return (
		<Badge variant="outline" className="gap-1.5 text-destructive border-destructive/40">
			{t("notifications.history.outcome.failed")}
		</Badge>
	);
}

export function NotificationLogTable({ monitorId }: NotificationLogTableProps) {
	const { t } = useTranslation("uptimeMonitor");
	const [page, setPage] = useState(0);
	const offset = page * PAGE_SIZE;

	const { data, isFetching } = useUptimeNotificationLogs(monitorId, {
		limit: PAGE_SIZE,
		offset,
	});

	const rows = data?.data ?? [];
	const total = data?.total ?? 0;
	const hasNext = offset + PAGE_SIZE < total;

	if (total === 0 && !isFetching) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
				<Bell className="h-10 w-10 text-muted-foreground mb-3" />
				<p className="font-medium">{t("notifications.history.empty")}</p>
				<p className="text-sm text-muted-foreground mt-1">
					{t("notifications.history.emptyDescription")}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="w-full min-w-0 overflow-x-auto rounded-lg border">
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
									{new Date(row.createdAt).toLocaleString()}
								</TableCell>
								<TableCell>
									<Badge variant="outline">
										{t(
											`notifications.channelTypes.${row.channelType}`,
											row.channelType,
										)}
									</Badge>
								</TableCell>
								<TableCell className="text-sm text-muted-foreground max-w-[220px] truncate">
									{row.target}
								</TableCell>
								<TableCell className="text-sm">
									{t(`notifications.history.event.${row.event}`, row.event)}
								</TableCell>
								<TableCell>
									{row.outcome === "failed" && row.error ? (
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger asChild>
													<span className="inline-flex cursor-help">
														<OutcomeBadge outcome={row.outcome} />
													</span>
												</TooltipTrigger>
												<TooltipContent className="max-w-[320px] break-words">
													{row.error}
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									) : (
										<OutcomeBadge outcome={row.outcome} />
									)}
								</TableCell>
								<TableCell className="tabular-nums text-sm">
									{row.attempts}
									{row.providerMessageId ? (
										<span className="ms-2 text-xs text-muted-foreground">
											{t("notifications.history.messageId", {
												id: row.providerMessageId,
											})}
										</span>
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
							onClick={() => setPage((p) => Math.max(0, p - 1))}
							disabled={page === 0}
							className="h-[44px]"
						>
							<ChevronLeft className="h-4 w-4 rtl:scale-x-[-1]" />
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage((p) => p + 1)}
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
