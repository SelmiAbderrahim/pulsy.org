import { Link, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	ChevronDown,
	ChevronUp,
	Clock,
	Loader2,
	Pause,
	Play,
	Settings2,
	Share2,
	Trash2,
	Wifi,
	WifiOff,
	X,
} from "lucide-react";
import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BulkDeleteConfirmDialog } from "@/components/dashboard/settings/common/BulkDeleteConfirmDialog";
import { SelectableCheckbox } from "@/components/dashboard/settings/common/SelectableCheckbox";
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
import {
	useBulkUptimeActions,
	useCheckNow,
	useDeleteUptimeMonitor,
	useToggleUptimeMonitor,
} from "@/hooks/uptime";
import { useBulkSelection } from "@/hooks/useBulkSelection";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import {
	compareMonitors,
	formatRelativeTime,
	responseTimeTone,
	type SortDir,
	type SortField,
} from "@/lib/uptime/format";
import { filterMonitors } from "@/lib/uptime/search";
import { cn } from "@/lib/utils";
import type { UptimeMonitor } from "@/types/uptime";
import { MonitorEmptyState } from "./monitor-empty-state";
import { ShareMonitorsDialog } from "./share/share-monitors-dialog";
import { BulkEditSettingsDialog } from "./bulk-edit-settings-dialog";

type StatusFilter = "up" | "down" | "degraded";

interface MonitorListProps {
	monitors: UptimeMonitor[];
	selectedTags?: string[];
	searchQuery?: string;
	selectedStatus?: StatusFilter;
	sort?: SortField;
	dir?: SortDir;
	dense?: boolean;
	onTagsChange?: (tags: string[]) => void;
	onStatusChange?: (status: StatusFilter | undefined) => void;
	onSortChange?: (field: SortField) => void;
	onCreateMonitor?: () => void;
}

function StatusBadge({ status }: { status: string }) {
	const { t } = useTranslation("uptimeMonitor");
	switch (status) {
		case "up":
			return (
				<Badge
					variant="outline"
					className="gap-1 border-success/25 bg-success/10 text-success"
				>
					<Wifi className="h-3 w-3" />
					{t("status.up", "Up")}
				</Badge>
			);
		case "down":
			return (
				<Badge
					variant="destructive"
					className="gap-1"
				>
					<WifiOff className="h-3 w-3" />
					{t("status.down", "Down")}
				</Badge>
			);
		case "degraded":
			return (
				<Badge
					variant="outline"
					className="gap-1 border-warning/35 bg-warning/10 text-warning"
				>
					<AlertTriangle className="h-3 w-3" />
					{t("status.degraded", "Degraded")}
				</Badge>
			);
		default:
			return (
				<Badge variant="outline" className="gap-1">
					<Clock className="h-3 w-3" />
					{t("status.pending", "Pending")}
				</Badge>
			);
	}
}

function formatInterval(
	seconds: number,
	t: (key: string, fallback: string) => string,
): string {
	return t(`intervals.${seconds}`, `${seconds}s`);
}

function formatTime(iso: string | null): string {
	if (!iso) return "—";
	return new Date(iso).toLocaleString();
}

const TONE_CLASS: Record<string, string> = {
	good: "text-success",
	warn: "text-warning",
	bad: "text-destructive",
};

/** Clickable column header that cycles the sort via `onSort`. */
function SortableHeader({
	field,
	label,
	active,
	dir,
	onSort,
}: {
	field: SortField;
	label: string;
	active: boolean;
	dir?: SortDir;
	onSort?: (field: SortField) => void;
}) {
	const { t } = useTranslation("uptimeMonitor");
	if (!onSort) return <>{label}</>;
	return (
		<button
			type="button"
			onClick={() => onSort(field)}
			className="inline-flex items-center gap-1 font-medium hover:text-foreground"
			aria-label={t("list.sortBy", {
				column: label,
				defaultValue: "Sort by {{column}}",
			})}
		>
			{label}
			{active ? (
				dir === "desc" ? (
					<ChevronDown className="h-3 w-3" />
				) : (
					<ChevronUp className="h-3 w-3" />
				)
			) : null}
		</button>
	);
}

export function MonitorList({
	monitors,
	selectedTags = [],
	searchQuery,
	selectedStatus,
	sort,
	dir,
	dense = false,
	onTagsChange,
	onStatusChange,
	onSortChange,
	onCreateMonitor,
}: MonitorListProps) {
	const { t, i18n } = useTranslation(["uptimeMonitor", "common"]);
	const navigate = useNavigate();
	const deleteMutation = useDeleteUptimeMonitor();
	const toggleMutation = useToggleUptimeMonitor();
	const checkNowMutation = useCheckNow();
	const { deleteMultiple, setActiveMultiple, isProcessing } =
		useBulkUptimeActions();

	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

	// Collect all unique tags across monitors
	const allTags = useMemo(() => {
		const tagSet = new Set<string>();
		for (const m of monitors) {
			if (m.tags) {
				for (const tag of m.tags) {
					tagSet.add(tag);
				}
			}
		}
		return Array.from(tagSet).sort();
	}, [monitors]);

	// Filter by tags (OR/union — any selected tag matches), status, and the
	// search query (name/url/tag), then order by the active or default sort.
	const filteredMonitors = useMemo(() => {
		const byTag =
			selectedTags.length > 0
				? monitors.filter((m) =>
						m.tags?.some((tag) => selectedTags.includes(tag)),
					)
				: monitors;
		const byStatus = selectedStatus
			? byTag.filter((m) => m.status === selectedStatus)
			: byTag;
		const bySearch = searchQuery
			? filterMonitors(byStatus, searchQuery)
			: byStatus;
		return [...bySearch].sort((a, b) => compareMonitors(a, b, sort, dir));
	}, [monitors, selectedTags, selectedStatus, searchQuery, sort, dir]);

	const selection = useBulkSelection({
		items: filteredMonitors,
		getItemId: (m) => m.uptimeMonitorId,
		canDeleteItem: () => true,
		getItemWarning: (m) =>
			m.status === "up"
				? t("uptimeMonitor:bulk.warningActive", "Currently active")
				: null,
		// useBulkSelection accepts but never invokes getItemDisplayName; the
		// delete dialog derives names via its own getItemName prop instead.
		/* v8 ignore next */
		getItemDisplayName: (m) => m.name,
	});

	const ariaSort = (
		field: SortField,
	): "ascending" | "descending" | "none" =>
		sort === field ? (dir === "desc" ? "descending" : "ascending") : "none";

	// Whole-row navigation to the detail page, except when the click lands on an
	// interactive element (checkbox, action button, or the name link).
	const handleRowClick = useCallback(
		(e: MouseEvent<HTMLTableRowElement>, monitorId: string) => {
			if (
				(e.target as HTMLElement).closest(
					"button,a,input,label,[role=checkbox]",
				)
			)
				return;
			navigate({
				to: "/dashboard/uptime/$monitorId",
				params: { monitorId },
			});
		},
		[navigate],
	);

	const handleDelete = async (monitor: UptimeMonitor) => {
		if (
			!confirm(
				t("uptimeMonitor:delete.description", {
					name: monitor.name,
					defaultValue: `Are you sure you want to delete "${monitor.name}"?`,
				}),
			)
		)
			return;
		try {
			await deleteMutation.mutateAsync({
				uptimeMonitorId: monitor.uptimeMonitorId,
			});
			toast.success(
				t("uptimeMonitor:delete.success", "Monitor deleted successfully"),
			);
		} catch (error) {
			toast.error(extractErrorMessage(error, t("uptimeMonitor:delete.error", "Failed to delete monitor")));
		}
	};

	const handleToggle = async (monitor: UptimeMonitor) => {
		try {
			await toggleMutation.mutateAsync({
				uptimeMonitorId: monitor.uptimeMonitorId,
			});
			toast.success(
				monitor.active
					? t("uptimeMonitor:toggle.disableSuccess", "Monitor disabled")
					: t("uptimeMonitor:toggle.enableSuccess", "Monitor enabled"),
			);
		} catch (error) {
			toast.error(extractErrorMessage(error, t("uptimeMonitor:toggle.error", "Failed to toggle monitor")));
		}
	};

	const handleCheckNow = async (monitor: UptimeMonitor) => {
		try {
			await checkNowMutation.mutateAsync({
				uptimeMonitorId: monitor.uptimeMonitorId,
			});
			toast.success(
				t("uptimeMonitor:checkNow.success", "Check triggered successfully"),
			);
		} catch (error) {
			toast.error(extractErrorMessage(error, t("uptimeMonitor:checkNow.error", "Failed to trigger check")));
		}
	};

	const handleBulkDelete = useCallback(async () => {
		const ids = Array.from(selection.selectedIds);
		const result = await deleteMultiple(ids);

		if (result.failed.length === 0) {
			toast.success(
				t("uptimeMonitor:bulk.deleteSuccess", {
					count: result.successful.length,
					defaultValue: "Successfully deleted {{count}} monitors",
				}),
			);
		} else if (result.successful.length > 0) {
			toast.warning(
				t("uptimeMonitor:bulk.deletePartial", {
					success: result.successful.length,
					total: ids.length,
					failed: result.failed.length,
					defaultValue:
						"Deleted {{success}} of {{total}} monitors. {{failed}} failed.",
				}),
			);
		} else {
			toast.error(
				t("uptimeMonitor:bulk.deleteError", "Failed to delete monitors"),
			);
		}

		setIsDeleteDialogOpen(false);
		selection.clearSelection();
	}, [selection, deleteMultiple, t]);

	const selectedItems = selection.selectedItems;
	const shouldResumeSelection =
		selectedItems.length > 0 && selectedItems.every((monitor) => !monitor.active);
	const bulkActiveTarget = shouldResumeSelection;

	const handleBulkActiveChange = useCallback(async () => {
		const result = await setActiveMultiple(selectedItems, bulkActiveTarget);

		if (result.failed.length === 0) {
			toast.success(
				t(
					bulkActiveTarget
						? "uptimeMonitor:bulk.resumeSuccess"
						: "uptimeMonitor:bulk.pauseSuccess",
					{
					count: result.successful.length,
					defaultValue: bulkActiveTarget
						? "Successfully resumed {{count}} monitors"
						: "Successfully paused {{count}} monitors",
					},
				),
			);
		} else {
			toast.error(
				t(
					bulkActiveTarget
						? "uptimeMonitor:bulk.resumeFailed"
						: "uptimeMonitor:bulk.pauseFailed",
					bulkActiveTarget
						? "Failed to resume some monitors"
						: "Failed to pause some monitors",
				),
			);
		}

		selection.clearSelection();
	}, [selection, selectedItems, setActiveMultiple, bulkActiveTarget, t]);

	if (monitors.length === 0) {
		return (
			<MonitorEmptyState
				onCreateMonitor={onCreateMonitor ?? (() => {})}
			/>
		);
	}

	return (
		<>
			{/* Active status filter (set by clicking a stats card) */}
			{selectedStatus && (
				<div className="flex flex-wrap items-center gap-2 mb-4">
					<span className="text-sm text-muted-foreground">
						{t("uptimeMonitor:status.filterBy", "Filter by status")}:
					</span>
					<Badge variant="default" className="gap-1">
						{t(`uptimeMonitor:status.${selectedStatus}`, selectedStatus)}
						<button
							type="button"
							onClick={() => onStatusChange?.(undefined)}
							className="-me-1 ms-0.5 inline-flex items-center"
							aria-label={t("uptimeMonitor:status.clearFilter", "Clear status filter")}
						>
							<X className="h-3 w-3" />
						</button>
					</Badge>
				</div>
			)}

			{/* Tag filter bar — multi-select (any selected tag matches) */}
			{allTags.length > 0 && (
				<div className="flex flex-wrap items-center gap-2 mb-4">
					<span className="text-sm text-muted-foreground">
						{t("uptimeMonitor:tags.filterBy", "Filter by tag")}:
					</span>
					{allTags.map((tag) => {
						const active = selectedTags.includes(tag);
						return (
							<Badge
								key={tag}
								variant={active ? "default" : "outline"}
								className="cursor-pointer"
								aria-pressed={active}
								onClick={() =>
									onTagsChange?.(
										active
											? selectedTags.filter((x) => x !== tag)
											: [...selectedTags, tag],
									)
								}
							>
								{tag}
							</Badge>
						);
					})}
					{selectedTags.length > 0 && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onTagsChange?.([])}
							className="h-[44px] px-3 text-xs"
						>
							<X className="h-3 w-3 me-1" />
							{t("uptimeMonitor:tags.clearFilter", "Clear filter")}
						</Button>
					)}
				</div>
			)}

			{filteredMonitors.length === 0 ? (
				<div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
					{t(
						"uptimeMonitor:search.noMatches",
						"No monitors match your filters.",
					)}
				</div>
			) : (
			<div className="min-w-0 max-w-full overflow-x-auto rounded-lg border">
				<Table
					className={cn(
						"min-w-[560px] sm:min-w-[720px]",
						dense && "[&_td]:py-1",
					)}
				>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">
								<SelectableCheckbox
									checked={selection.isAllSelected}
									indeterminate={selection.isPartiallySelected}
									onChange={() => selection.toggleAll()}
									label={t("common:bulkSelection.selectAll", "Select all")}
								/>
							</TableHead>
							<TableHead
								className="min-w-[150px] text-start sm:min-w-[200px]"
								aria-sort={ariaSort("name")}
							>
								<SortableHeader
									field="name"
									label={t("uptimeMonitor:list.columns.name", "Name")}
									active={sort === "name"}
									dir={dir}
									onSort={onSortChange}
								/>
							</TableHead>
							<TableHead className="w-[110px] text-start" aria-sort={ariaSort("status")}>
								<SortableHeader
									field="status"
									label={t("uptimeMonitor:list.columns.status", "Status")}
									active={sort === "status"}
									dir={dir}
									onSort={onSortChange}
								/>
							</TableHead>
							<TableHead
								className="text-start hidden sm:table-cell"
								aria-sort={ariaSort("response")}
							>
								<SortableHeader
									field="response"
									label={t(
										"uptimeMonitor:list.columns.responseTime",
										"Response Time",
									)}
									active={sort === "response"}
									dir={dir}
									onSort={onSortChange}
								/>
							</TableHead>
							<TableHead
								className="text-start hidden md:table-cell"
								aria-sort={ariaSort("uptime")}
							>
								<SortableHeader
									field="uptime"
									label={t("uptimeMonitor:list.columns.uptime", "Uptime (30d)")}
									active={sort === "uptime"}
									dir={dir}
									onSort={onSortChange}
								/>
							</TableHead>
							<TableHead className="text-start hidden lg:table-cell">
								{t("uptimeMonitor:list.columns.interval", "Interval")}
							</TableHead>
							<TableHead className="text-start hidden lg:table-cell">
								{t("uptimeMonitor:list.columns.lastChecked", "Last Checked")}
							</TableHead>
							<TableHead className="sticky end-0 z-20 w-[148px] bg-background ps-2 pe-2 text-end">
								{t("uptimeMonitor:list.columns.actions", "Actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filteredMonitors.map((monitor) => (
							<TableRow
								key={monitor.uptimeMonitorId}
								onClick={(e) => handleRowClick(e, monitor.uptimeMonitorId)}
								className={cn(
									"cursor-pointer",
									monitor.status === "down" &&
										"border-s-2 border-s-destructive bg-destructive/5",
									monitor.status === "degraded" &&
										"border-s-2 border-s-warning bg-warning/5",
								)}
							>
								<TableCell className="w-12">
									<SelectableCheckbox
										checked={selection.selectedIds.has(monitor.uptimeMonitorId)}
										onChange={() => selection.toggle(monitor.uptimeMonitorId)}
										label={monitor.name}
									/>
								</TableCell>
								<TableCell className="min-w-[150px] sm:min-w-[200px]">
									<Link
										to="/dashboard/uptime/$monitorId"
										params={{ monitorId: monitor.uptimeMonitorId }}
										className="inline-flex min-h-[44px] max-w-[140px] items-center truncate font-medium hover:underline sm:max-w-[220px]"
									>
										{monitor.name}
									</Link>
									{!dense && (
										<>
											<p className="max-w-[140px] truncate text-xs text-muted-foreground sm:max-w-[220px]">
												{monitor.url}
											</p>
											{monitor.tags && monitor.tags.length > 0 && (
												<div className="flex flex-wrap gap-1 mt-1">
													{monitor.tags.map((tag) => (
														<Badge
															key={tag}
															variant="secondary"
															className="text-[10px] px-1.5 py-0"
														>
															{tag}
														</Badge>
													))}
												</div>
											)}
										</>
									)}
								</TableCell>
								<TableCell className="w-[110px]">
									<StatusBadge status={monitor.status} />
								</TableCell>
								<TableCell
									className={cn(
										"hidden sm:table-cell tabular-nums",
										TONE_CLASS[responseTimeTone(monitor.responseTime) ?? ""],
									)}
								>
									{monitor.responseTime != null
										? `${monitor.responseTime}ms`
										: "—"}
								</TableCell>
								<TableCell className="hidden md:table-cell tabular-nums">
									{monitor.uptimePercentage != null ? (
										`${monitor.uptimePercentage.toFixed(2)}%`
									) : (
										<span className="text-xs text-muted-foreground">
											{t("uptimeMonitor:list.collecting", "collecting…")}
										</span>
									)}
								</TableCell>
								<TableCell className="hidden lg:table-cell">
									{formatInterval(monitor.interval, t)}
								</TableCell>
								<TableCell
									className="hidden lg:table-cell text-muted-foreground text-xs"
									title={formatTime(monitor.lastCheckedAt)}
								>
									{formatRelativeTime(monitor.lastCheckedAt, i18n.language)}
								</TableCell>
								<TableCell className="sticky end-0 z-10 w-[148px] bg-background ps-2 pe-2 text-end">
									<TooltipProvider delayDuration={200}>
										<div className="flex items-center justify-end gap-1">
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														onClick={() => handleCheckNow(monitor)}
														disabled={checkNowMutation.isPending || !monitor.active}
														className="h-[44px] w-[44px]"
														aria-label={t("uptimeMonitor:actions.checkNow", "Check Now")}
														title={t("uptimeMonitor:actions.checkNow", "Check Now")}
													>
														<Play className="h-4 w-4" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{t("uptimeMonitor:actions.checkNow", "Check Now")}
												</TooltipContent>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														onClick={() => handleToggle(monitor)}
														disabled={toggleMutation.isPending}
														className="h-[44px] w-[44px]"
														aria-label={
															monitor.active
																? t("uptimeMonitor:actions.disable", "Disable")
																: t("uptimeMonitor:actions.enable", "Enable")
														}
														title={
															monitor.active
																? t("uptimeMonitor:actions.disable", "Disable")
																: t("uptimeMonitor:actions.enable", "Enable")
														}
													>
														{monitor.active ? (
															<Pause className="h-4 w-4" />
														) : (
															<Play className="h-4 w-4" />
														)}
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{monitor.active
														? t("uptimeMonitor:actions.disable", "Disable")
														: t("uptimeMonitor:actions.enable", "Enable")}
												</TooltipContent>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														onClick={() => handleDelete(monitor)}
														disabled={deleteMutation.isPending}
														className="h-[44px] w-[44px] text-destructive hover:text-destructive"
														aria-label={t(
															"uptimeMonitor:actions.deleteMonitor",
															"Delete Monitor",
														)}
														title={t(
															"uptimeMonitor:actions.deleteMonitor",
															"Delete Monitor",
														)}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{t("uptimeMonitor:actions.deleteMonitor", "Delete Monitor")}
												</TooltipContent>
											</Tooltip>
										</div>
									</TooltipProvider>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			)}

			{/* Bulk selection toolbar */}
			{selection.hasSelection && (
				<div
					className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-40 start-4 end-4 sm:start-auto sm:end-4 animate-in slide-in-from-bottom-4 fade-in duration-200"
					role="toolbar"
					aria-label={t("common:bulkSelection.toolbar", "Selection toolbar")}
				>
					<div className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-3 shadow-xs sm:w-auto sm:gap-3 sm:px-4">
						<div className="flex items-center gap-2">
							<Badge variant="secondary" className="px-2 py-1">
								{selection.selectionCount}
							</Badge>
							<span className="hidden text-sm text-muted-foreground whitespace-nowrap min-[360px]:inline">
								{t("common:bulkSelection.selected", "{{count}} selected", {
									count: selection.selectionCount,
								})}
							</span>
						</div>

						<div className="flex items-center gap-2">
							{/* Clear */}
							<Button
								variant="ghost"
								size="sm"
								onClick={selection.clearSelection}
								disabled={isProcessing}
								className="min-h-[44px] min-w-[44px] sm:min-w-0 sm:px-3"
							>
								<span className="hidden sm:inline">
									{t("common:bulkSelection.clearSelection", "Clear")}
								</span>
								<span className="sm:hidden">✕</span>
							</Button>

							{/* Pause/Resume */}
							<Button
								variant="outline"
								size="sm"
								onClick={handleBulkActiveChange}
								disabled={isProcessing}
								className="min-h-[44px] min-w-[44px] sm:min-w-0 sm:px-3"
							>
								{isProcessing ? (
									<Loader2 className="h-4 w-4 animate-spin sm:me-2" />
								) : shouldResumeSelection ? (
									<Play className="h-4 w-4 sm:me-2" />
								) : (
									<Pause className="h-4 w-4 sm:me-2" />
								)}
								<span className="hidden sm:inline">
									{shouldResumeSelection
										? t("uptimeMonitor:bulk.resume", "Resume")
										: t("uptimeMonitor:bulk.pause", "Pause")}
								</span>
							</Button>

							{/* Edit settings */}
							<Button
								variant="outline"
								size="sm"
								onClick={() => setIsEditDialogOpen(true)}
								disabled={isProcessing}
								className="min-h-[44px] min-w-[44px] sm:min-w-0 sm:px-3"
							>
								<Settings2 className="h-4 w-4 sm:me-2" />
								<span className="hidden sm:inline">
									{t("bulk.edit.button", "Edit settings")}
								</span>
							</Button>

							{/* Share */}
							<Button
								variant="outline"
								size="sm"
								onClick={() => setIsShareDialogOpen(true)}
								disabled={isProcessing}
								className="min-h-[44px] min-w-[44px] sm:min-w-0 sm:px-3"
							>
								<Share2 className="h-4 w-4 sm:me-2" />
								<span className="hidden sm:inline">
									{t("uptimeMonitor:share.button", "Share")}
								</span>
							</Button>

							{/* Delete */}
							<Button
								variant="destructive"
								size="sm"
								onClick={() => setIsDeleteDialogOpen(true)}
								disabled={isProcessing}
								className="min-h-[44px] min-w-[44px] sm:min-w-0 sm:px-4"
							>
								{isProcessing ? (
									<Loader2 className="h-4 w-4 animate-spin sm:me-2" />
								) : (
									<Trash2 className="h-4 w-4 sm:me-2" />
								)}
								<span className="hidden sm:inline">
									{t("common:bulkSelection.deleteCount", "Delete ({{count}})", {
										count: selection.selectionCount,
									})}
								</span>
							</Button>
						</div>
					</div>
				</div>
			)}

			{/* Bulk edit settings dialog */}
			<BulkEditSettingsDialog
				open={isEditDialogOpen}
				onOpenChange={setIsEditDialogOpen}
				monitors={selection.selectedItems}
				onUpdated={() => selection.clearSelection()}
			/>

			{/* Share selected monitors dialog */}
			<ShareMonitorsDialog
				open={isShareDialogOpen}
				onOpenChange={setIsShareDialogOpen}
				monitors={selection.selectedItems}
				onCreated={() => selection.clearSelection()}
			/>

			{/* Bulk delete confirmation dialog */}
			<BulkDeleteConfirmDialog
				open={isDeleteDialogOpen}
				onOpenChange={setIsDeleteDialogOpen}
				items={selection.selectedItems}
				itemType="monitor"
				getItemName={(m) => m.name}
				getItemWarning={(m) =>
					m.status === "up"
						? t("uptimeMonitor:bulk.warningActive", "Currently active")
						: null
				}
				onConfirm={handleBulkDelete}
				isDeleting={isProcessing}
			/>
		</>
	);
}
