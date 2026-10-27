import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { formatCount } from "@/lib/count-format";
import { STATS_WINDOW_DAYS } from "@/lib/uptime/stats-window";
import { Unit } from "@/components/ui/unit";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RelativeTime } from "@/components/ui/relative-time";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatIncidentTimestamp } from "@/lib/uptime/incident-time";
import { requestConfirmation } from "@/lib/confirmation";
import { useElapsedClock } from "@/hooks/useElapsedClock";
import { formatMilliseconds, formatPercent } from "@/lib/uptime/number-format";
import { HeartbeatStatusBadge } from "./heartbeat-status-badge";
import { AddSelectedToPage } from "./add-selected-to-page";
import { MonitorReuseActions } from "./monitor-reuse-controls";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	BookmarkPlus,
	ChevronDown,
	ChevronUp,
	Clock,
	Copy,
	Loader2,
	MoreHorizontal,
	Pause,
	Play,
	RefreshCw,
	Settings2,
	Share2,
	Trash2,
	Wifi,
	WifiOff,
	X,
} from "lucide-react";
import { Fragment, type MouseEvent, useCallback, useEffect, useMemo, useRef, useId, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
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
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
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
 isStaleObservation,
	formatRelativeTime,
  formatInterval,
	responseTimeTone,
	measuredLatency,
	isAwaitingFirstCheck,
	type SortDir,
	type SortField,
} from "@/lib/uptime/format";
import { groupViewMonitors } from "@/lib/uptime/monitor-views";
import { filterMonitorList } from "@/lib/uptime/monitor-list-filter";
import { cn } from "@/lib/utils";
import type { UptimeMonitor } from "@/types/uptime";
import { MonitorEmptyState } from "./monitor-empty-state";
import { ShareMonitorsDialog } from "./share/share-monitors-dialog";
import { BulkEditSettingsDialog } from "./bulk-edit-settings-dialog";
import { MaintenanceDialog, SuppressionBadge } from "./maintenance-controls";

/** Rows rendered at once; "Show more" adds another page. Filtering/sorting/searching still cover every monitor. */
export const MONITOR_LIST_PAGE_SIZE = 50;
const mobileQuery = "(max-width: 1023px)";
const subscribeViewport = (callback: () => void) => {
  const media = window.matchMedia?.(mobileQuery);
  media?.addEventListener("change", callback);
  return () => media?.removeEventListener("change", callback);
};
const isMobileViewport = () => window.matchMedia?.(mobileQuery).matches ?? false;
function useBreakpoint(query: string) {
	return useSyncExternalStore(
		(callback) => {
			const media = window.matchMedia?.(query);
			media?.addEventListener("change", callback);
			return () => media?.removeEventListener("change", callback);
		},
		() => window.matchMedia?.(query).matches ?? false,
		() => false,
	);
}

type StatusFilter = "up" | "down" | "degraded" | "pending";

interface MonitorListProps {
  filtersInToolbar?: boolean;
	monitors: UptimeMonitor[];
	selectedTags?: string[];
  tagMode?: "any" | "all";
  group?: "none" | "tag" | "environment";
	searchQuery?: string;
	selectedStatus?: StatusFilter;
	sort?: SortField;
	dir?: SortDir;
	dense?: boolean;
	onTagsChange?: (tags: string[]) => void;
	onStatusChange?: (status: StatusFilter | undefined) => void;
	onSortChange?: (field: SortField) => void;
	onCreateMonitor?: () => void;
  onClearFilters?: () => void;
}

function StatusBadge({ status, monitorType, checking = false }: { status: string; monitorType?: string; checking?: boolean }) {
	const { t } = useTranslation("uptimeMonitor");
	if (monitorType === "heartbeat") return <HeartbeatStatusBadge status={status} />;
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
			return checking ? (
				<Badge variant="outline" className="gap-1">
					<Loader2 aria-hidden className="h-3 w-3 animate-spin" />
					{t("status.checking")}
				</Badge>
			) : (
				<Badge variant="outline" className="gap-1">
					<Clock className="h-3 w-3" />
					{t("status.pending", "Pending")}
				</Badge>
			);
	}
}

function formatTime(iso: string | null, locale: string, timezone: string): string {
	if (!iso) return "—";
	return formatIncidentTimestamp(iso, locale, timezone);
}

const TONE_CLASS: Record<string, string> = {
	good: "text-success",
	warn: "text-warning",
	bad: "text-destructive",
};

/** Disabled push-only checks keep the same action slot, with a focusable explanation. */
function RecheckButton({ monitor, busy, onCheck }: { monitor: UptimeMonitor; busy: boolean; onCheck: () => void }) {
  const { t } = useTranslation("uptimeMonitor");
  const descriptionId = useId();
  const unavailable = monitor.monitorType === "heartbeat" ? t("list.checkNowUnavailableHeartbeat") : monitor.monitorType === "server" ? t("list.checkNowUnavailableServer") : undefined;
  const label = t("actions.checkNow", "Check now");
  return <TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild>
    <span className="inline-flex shrink-0" tabIndex={unavailable ? 0 : undefined} title={unavailable ?? label}>
      <Button variant="ghost" size="icon" disabled={busy || !monitor.active || Boolean(unavailable)} aria-label={`${label} — ${monitor.name}`} aria-describedby={unavailable ? descriptionId : undefined} onClick={onCheck}><RefreshCw aria-hidden="true" /></Button>
    </span>
  </TooltipTrigger><TooltipContent>{unavailable ?? label}</TooltipContent></Tooltip>
  {unavailable && <span id={descriptionId} className="sr-only">{unavailable}</span>}
  </TooltipProvider>;
}

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
			className="inline-flex min-h-11 min-w-11 max-w-full items-center gap-1 text-start font-medium hover:text-foreground"
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
  filtersInToolbar = false,
	monitors,
	selectedTags = [],
  tagMode = "any", group = "none",
	searchQuery,
	selectedStatus,
	sort,
	dir,
	dense = false,
	onTagsChange,
	onStatusChange,
	onSortChange,
	onCreateMonitor,
  onClearFilters,
}: MonitorListProps) {
	const showSm = useBreakpoint("(min-width: 640px)");
	const showMd = useBreakpoint("(min-width: 768px)");
	const showLg = useBreakpoint("(min-width: 1024px)");
	const showXl = useBreakpoint("(min-width: 1280px)");
	const visibleColumnCount = 3 + (showSm ? 2 : 0) + (showMd ? 1 : 0) + (showLg ? 1 : 0) + (showXl ? 1 : 0);
	const { t, i18n } = useTranslation(["uptimeMonitor", "common"]);
  const accountTimezone = useAccountTimezone();
 const client = useQueryClient();
  const now = useElapsedClock(monitors.length > 0);
  const mobile = useSyncExternalStore(subscribeViewport, isMobileViewport, () => false);
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
		const matching = filterMonitorList(monitors, { tags: selectedTags, tagMode, status: selectedStatus, search: searchQuery });
		return [...matching].sort((a, b) => compareMonitors(a, b, sort, dir));
	}, [monitors, selectedTags, tagMode, selectedStatus, searchQuery, sort, dir]);

	const [shown, setShown] = useState(MONITOR_LIST_PAGE_SIZE);
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
	const displayMonitors = useMemo(() => filteredMonitors.slice(0, shown), [filteredMonitors, shown]);

	const rawSelection = useBulkSelection({
		items: displayMonitors,
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

  const filterIdentity = JSON.stringify([selectedTags, tagMode, selectedStatus, searchQuery]);
  useEffect(() => { setShown(MONITOR_LIST_PAGE_SIZE); }, [filterIdentity, sort, dir, group]);
  const { clearSelection } = rawSelection;
  useEffect(() => { clearSelection(); setIsDeleteDialogOpen(false); setIsShareDialogOpen(false); setIsEditDialogOpen(false); }, [filterIdentity, clearSelection]);
  // Never submit IDs hidden by a filter or removed from the current query.
  const visibleSelectedIds = new Set(rawSelection.selectedItems.map(monitor => monitor.uptimeMonitorId));
  const selection = { ...rawSelection, selectedIds: visibleSelectedIds, selectionCount: visibleSelectedIds.size, hasSelection: visibleSelectedIds.size > 0 };
  const monitorGroups = useMemo(() => groupViewMonitors(displayMonitors, group), [displayMonitors, group]);
  // Name each real consequence of deleting the selection and how many monitors it affects.
  const onStatusPages = selection.selectedItems.filter(monitor => (monitor.statusPageCount ?? 0) > 0 || monitor.isPublic).length;
  const withChannels = selection.selectedItems.filter(monitor => (monitor.overrideChannelCount ?? 0) > 0).length;
  const deleteConstraints = [
    ...(onStatusPages ? [{ key: "statusPages", message: t("uptimeMonitor:bulk.constraints.statusPages", { count: onStatusPages }) }] : []),
    ...(withChannels ? [{ key: "channels", message: t("uptimeMonitor:bulk.constraints.channels", { count: withChannels }) }] : []),
  ];
  const toolbarRef = useRef<HTMLDivElement>(null);
  // While the floating toolbar is shown, its measured height is published as
  // --bulk-toolbar-height: the list reserves that much bottom padding, the page
  // scroll padding keeps focused rows above it and toasts stack over it.
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!selection.hasSelection || !toolbar) return;
    const root = document.documentElement;
    const measure = () => {
      const height = Math.ceil(toolbar.getBoundingClientRect().height);
      root.style.setProperty("--bulk-toolbar-height", `${height}px`);
      root.style.setProperty("--toast-bottom-offset", `calc(env(safe-area-inset-bottom) + ${Math.max(96, height + 32)}px)`);
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(toolbar);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); root.style.removeProperty("--bulk-toolbar-height"); root.style.removeProperty("--toast-bottom-offset"); };
  }, [selection.hasSelection]);


	const ariaSort = (
		field: SortField,
	): "ascending" | "descending" | "none" =>
		sort === field ? (dir === "desc" ? "descending" : "ascending") : "none";

	// Whole-row navigation to the detail page, except when the click lands on an
	// interactive element (checkbox, action button, or the name link).
	const handleRowClick = useCallback(
		(e: MouseEvent<HTMLTableRowElement>, monitorId: string) => {
      // Portalled menu events bubble through React, but are not row clicks.
      if (!e.currentTarget.contains(e.target as Node)) return;
      const interactive = (e.target as HTMLElement).closest("button,a,input,label,[tabindex],[role=checkbox],[role=menuitem],[role=menu]");
      if (interactive && e.currentTarget.contains(interactive)) return;
			navigate({
				to: "/dashboard/uptime/$monitorId",
				params: { monitorId },
			});
		},
		[navigate],
	);

	const handleDelete = async (monitor: UptimeMonitor) => {
		if (
			!await requestConfirmation(
				t("uptimeMonitor:delete.description", {
					name: monitor.name,
					defaultValue: `Are you sure you want to delete "${monitor.name}"?`,
				}),
        { title: t("delete.title"), action: t("actions.delete") },
			)
		)
			return;
 if (!isSessionClientActive(client)) return;
		try {
			await deleteMutation.mutateAsync({
				uptimeMonitorId: monitor.uptimeMonitorId,
			});
 if (!isSessionClientActive(client)) return;
			toast.success(
				t("uptimeMonitor:delete.success", "Monitor deleted successfully"),
			);
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			toast.error(extractErrorMessage(error, t("uptimeMonitor:delete.error", "Failed to delete monitor")));
		}
	};

	const handleToggle = async (monitor: UptimeMonitor) => {
		try {
			await toggleMutation.mutateAsync({
				uptimeMonitorId: monitor.uptimeMonitorId,
			});
 if (!isSessionClientActive(client)) return;
			toast.success(
				monitor.active
					? t("uptimeMonitor:toggle.disableSuccess", "Monitor disabled")
					: t("uptimeMonitor:toggle.enableSuccess", "Monitor enabled"),
			);
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			toast.error(extractErrorMessage(error, t("uptimeMonitor:toggle.error", "Failed to toggle monitor")));
		}
	};

	const handleCheckNow = async (monitor: UptimeMonitor) => {
		try {
			await checkNowMutation.mutateAsync({
				uptimeMonitorId: monitor.uptimeMonitorId,
			});
 if (!isSessionClientActive(client)) return;
			toast.success(
				t("uptimeMonitor:checkNow.success", "Check triggered successfully"),
			);
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			toast.error(extractErrorMessage(error, t("uptimeMonitor:checkNow.error", "Failed to trigger check")));
		}
	};

	const failedMonitors = (count: number) => formatCount((key, options) => t(key, { ...options, defaultValue: count === 1 ? "{{formattedCount}} monitor failed and remains selected." : "{{formattedCount}} monitors failed and remain selected." }), "bulk.failed", count, i18n.language);

	const handleBulkDelete = useCallback(async () => {
		const ids = Array.from(selection.selectedIds);
		const result = await deleteMultiple(ids);
 if (!isSessionClientActive(client)) return;

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
					total: ids.length, count: ids.length,
					failed: failedMonitors(result.failed.length),
					defaultValue:
						"Deleted {{success}} of {{total}} monitors. {{failed}}",
				}),
			);
		} else {
			toast.error(
				t("uptimeMonitor:bulk.deleteError", "Failed to delete monitors"),
			);
		}

		setIsDeleteDialogOpen(false);
		for (const id of result.successful) selection.deselect(id);
	}, [selection, deleteMultiple, t, i18n.language, client]);

	const selectedItems = selection.selectedItems;
	const shouldResumeSelection =
		selectedItems.length > 0 && selectedItems.every((monitor) => !monitor.active);
	const bulkActiveTarget = shouldResumeSelection;

	const handleBulkActiveChange = useCallback(async () => {
		const result = await setActiveMultiple(selectedItems, bulkActiveTarget);
 if (!isSessionClientActive(client)) return;

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
      toast.error(t("bulk.partial", { success: result.successful.length, count: result.successful.length, failed: failedMonitors(result.failed.length), defaultValue: result.successful.length === 1 ? "Updated {{success}} monitor. {{failed}}" : "Updated {{success}} monitors. {{failed}}" }));
    }

		for (const id of result.successful) selection.deselect(id);
	}, [selection, selectedItems, setActiveMultiple, bulkActiveTarget, t, i18n.language, client]);

	if (monitors.length === 0) {
		return (
			<MonitorEmptyState
				onCreateMonitor={onCreateMonitor ?? (() => {})}
				hideAction={filtersInToolbar}
			/>
		);
	}

  const actions = (monitor: UptimeMonitor) => <MonitorReuseActions monitorId={monitor.uptimeMonitorId}>{reuse => <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`${t("actions.moreActions", "More actions")} — ${monitor.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
    {monitor.monitorType !== "heartbeat" && monitor.monitorType !== "server" && <DropdownMenuItem disabled={checkNowMutation.isPending || !monitor.active} onClick={() => void handleCheckNow(monitor)}><RefreshCw aria-hidden className="h-4 w-4" />{t("actions.checkNow", "Check now")}</DropdownMenuItem>}
    <DropdownMenuItem asChild><Link to="/dashboard/uptime/$monitorId" params={{ monitorId: monitor.uptimeMonitorId }} search={{ tab: "settings" }}><Settings2 aria-hidden className="h-4 w-4" />{t("tabs.settings")}</Link></DropdownMenuItem>
    <DropdownMenuItem disabled={toggleMutation.isPending} onClick={() => void handleToggle(monitor)}>{monitor.active ? <Pause aria-hidden className="h-4 w-4" /> : <Play aria-hidden className="h-4 w-4" />}{monitor.active ? t("actions.disable", "Disable") : t("actions.enable", "Enable")}</DropdownMenuItem>
    {monitor.monitorType !== "heartbeat" && monitor.monitorType !== "server" && <><DropdownMenuItem disabled={reuse.busy} onClick={reuse.duplicate}><Copy aria-hidden className="h-4 w-4" />{t("templates.duplicate")}</DropdownMenuItem><DropdownMenuItem disabled={reuse.busy} onClick={reuse.saveTemplate}><BookmarkPlus aria-hidden className="h-4 w-4" />{t("templates.fromMonitor")}</DropdownMenuItem></>}
    <DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" disabled={deleteMutation.isPending} onClick={() => void handleDelete(monitor)}><Trash2 aria-hidden className="h-4 w-4" />{t("actions.deleteMonitor", "Delete monitor")}</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>}</MonitorReuseActions>;
  const identity = (monitor: UptimeMonitor) => monitor.monitorType === "server" ? t("server.title") : monitor.monitorType === "heartbeat" ? t("heartbeat.title") : monitor.networkConfig ? `${monitor.networkConfig.type.toUpperCase()} · ${monitor.networkConfig.hostname}${monitor.networkConfig.type === "tcp" ? `:${monitor.networkConfig.port}` : ` · ${monitor.networkConfig.recordType}`}` : `${monitor.method} · ${monitor.url}`;
  const health = (monitor: UptimeMonitor) => <div className="flex flex-wrap items-center gap-1">{!monitor.active ? <Badge variant="secondary"><Pause className="me-1 size-3" />{t("status.paused")}</Badge> : <StatusBadge status={monitor.status} monitorType={monitor.monitorType} checking={isAwaitingFirstCheck(monitor)} />}<SuppressionBadge value={monitor.alertSuppression} />{isStaleObservation(monitor, now) && <Badge variant="secondary" title={t("metrics.staleDescription")}><Clock aria-hidden className="me-1 size-3" />{t("metrics.stale")}</Badge>}</div>;
  const checkedTime = (monitor: UptimeMonitor) => <RelativeTime className="text-xs text-muted-foreground" value={monitor.lastCheckedAt} locale={i18n.language} timezone={accountTimezone} now={now} />;
  const tags = (monitor: UptimeMonitor) => <div className="flex min-w-0 flex-wrap items-center gap-1">{monitor.tags?.slice(0, 2).map(tag => <Badge key={tag} variant="secondary" className="max-w-full"><bdi className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{tag}</bdi></Badge>)}{monitor.tags?.length > 2 && <Collapsible className="text-xs"><CollapsibleTrigger aria-label={`${monitor.tags.length - 2} ${t("tags.label")}`} className={cn("flex min-w-11 cursor-pointer items-center justify-center ps-2 pe-10", "min-h-11")}>+{monitor.tags.length - 2}</CollapsibleTrigger><CollapsibleContent><div className="flex flex-wrap gap-1">{monitor.tags.slice(2).map(tag => <Badge key={tag} variant="secondary" className="max-w-full"><bdi className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{tag}</bdi></Badge>)}</div></CollapsibleContent></Collapsible>}</div>;
  // Heartbeat arrival facts are identity/status facts, not response-time or check-success values.
  const heartbeatDeadline = (monitor: UptimeMonitor) => {
    const deadline = monitor.heartbeat?.deadlineAt;
    const date = formatTime(deadline ?? null, i18n.language, accountTimezone);
    return monitor.active && deadline && Date.parse(deadline) <= now ? t("heartbeat.overdueSince", { date }) : date;
  };
  const heartbeatFacts = (monitor: UptimeMonitor) => monitor.monitorType !== "heartbeat" ? null : <p className="max-w-sm text-xs text-muted-foreground"><span>{t("heartbeat.received")}: <time dateTime={monitor.heartbeat?.lastReceivedAt ?? undefined} className="text-foreground">{monitor.heartbeat?.lastReceivedAt ? formatRelativeTime(monitor.heartbeat.lastReceivedAt, i18n.language, now) : t("heartbeat.never")}</time></span>{" · "}<span>{t("heartbeat.finalDeadline")}: <time dateTime={monitor.heartbeat?.deadlineAt ?? undefined} className="text-foreground">{heartbeatDeadline(monitor)}</time></span></p>;
  // A failed check has no response time to celebrate: never a green latency next to Down.
  const latencyClass = (monitor: UptimeMonitor) => monitor.status === "degraded" ? "text-warning" : TONE_CLASS[responseTimeTone(measuredLatency(monitor, monitor.monitorType), monitor.status) ?? ""];
  const latencyText = (monitor: UptimeMonitor) => { const ms = measuredLatency(monitor, monitor.monitorType); return ms == null ? monitor.status === "down" ? <><span aria-hidden>—</span><span className="sr-only">{t("list.noResponse")}</span></> : "—" : <Unit>{formatMilliseconds(ms, i18n.language) ?? "—"}</Unit>; };
  const checkSuccessText = (monitor: UptimeMonitor) => formatPercent(monitor.uptimePercentage, i18n.language);
	return (
		<div data-monitor-list data-bulk-active={selection.hasSelection || undefined} className="grid min-w-0 gap-4">
			{/* Active status filter (set by clicking a stats card) */}
			{!filtersInToolbar && selectedStatus && (
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

			{/* Tags match the explicit any/all mode; native controls support keyboard. */}
			{selectedTags.length >= 50 && <p role="status" className="text-sm text-muted-foreground">{t("views.tagLimit")}</p>}
			{!filtersInToolbar && allTags.length > 0 && (
				<div className="flex flex-wrap items-center gap-2 mb-4">
					<span className="text-sm text-muted-foreground">
						{t("uptimeMonitor:tags.filterBy", "Filter by tag")}:
					</span>
					{allTags.map((tag) => {
						const active = selectedTags.includes(tag);
						return (
              <Button
                key={tag} type="button" variant={active ? "default" : "outline"}
                className="min-h-11 h-auto px-2.5 text-xs"
                aria-pressed={active} disabled={!active && selectedTags.length >= 50}
                onClick={() => onTagsChange?.(active ? selectedTags.filter(value => value !== tag) : [...selectedTags, tag])}
              ><bdi>{tag}</bdi></Button>
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
				<div className="grid justify-items-center gap-3 rounded-lg border p-8 text-center text-sm text-muted-foreground" data-filtered-empty>
					{t(
						"uptimeMonitor:search.noMatches",
						"No monitors match your filters.",
					)}
          {onClearFilters && <Button variant="outline" onClick={onClearFilters}>{t("views.clear")}</Button>}
				</div>
      ) : mobile ? (
        <div className="grid gap-3">
          <div className="flex items-center gap-2"><SelectableCheckbox checked={selection.isAllSelected} indeterminate={selection.isPartiallySelected} onChange={() => selection.toggleAll()} label={t("common:bulkSelection.selectAll")} /><span className="text-sm text-muted-foreground">{t("list.monitorCount", { count: displayMonitors.length })}</span></div>
          {monitorGroups.map(({ tag, monitors: grouped }) => <section key={JSON.stringify(tag)} className="grid gap-3 md:grid-cols-2" aria-label={tag ?? t("common:nav.monitors")}>
            {group !== "none" && <h2 className="text-sm font-medium md:col-span-2"><bdi>{tag ?? t("views.withoutGroup")}</bdi> ({grouped.length})</h2>}
            {grouped.map(monitor => <article data-monitor-card key={monitor.uptimeMonitorId} className={cn("grid min-w-0 gap-3 rounded-lg border bg-card p-4", selection.selectedIds.has(monitor.uptimeMonitorId) && "border-primary")}>
              <header className="flex min-w-0 items-start gap-2">
                <SelectableCheckbox checked={selection.selectedIds.has(monitor.uptimeMonitorId)} onChange={() => selection.toggle(monitor.uptimeMonitorId)} label={monitor.name} />
                <div className="min-w-0 flex-1"><Link to="/dashboard/uptime/$monitorId" params={{ monitorId: monitor.uptimeMonitorId }} className="inline-flex min-h-11 max-w-full items-center break-words font-medium"><bdi>{monitor.name}</bdi></Link><p dir="ltr" className="break-all text-start text-xs text-muted-foreground">{identity(monitor)}</p>{tags(monitor)}</div>
                {actions(monitor)}
              </header>
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm" aria-label={t("list.columns.status")}> {health(monitor)} {monitor.monitorType !== "heartbeat" && monitor.monitorType !== "server" && <span className={cn("whitespace-nowrap tabular-nums", latencyClass(monitor))}><span className="sr-only">{t("list.columns.responseTime")}: </span>{latencyText(monitor)}</span>}<span className="whitespace-nowrap tabular-nums"><span className="sr-only">{t("list.columns.uptime", { days: STATS_WINDOW_DAYS })}: </span>{monitor.uptimePercentage != null ? <Unit>{checkSuccessText(monitor)}</Unit> : t("metrics.noData")}</span></div>
              <Collapsible className="min-w-0"><CollapsibleTrigger className="min-h-11 justify-start px-0 text-sm text-primary underline">{t("common:actions.details")}</CollapsibleTrigger><CollapsibleContent><dl className="grid grid-cols-2 gap-3 text-sm">{monitor.monitorType === "heartbeat" ? <><div><dt className="text-xs text-muted-foreground">{t("heartbeat.received")}</dt><dd className="tabular-nums">{monitor.heartbeat?.lastReceivedAt ? formatRelativeTime(monitor.heartbeat.lastReceivedAt, i18n.language, now) : t("heartbeat.never")}</dd></div><div><dt className="text-xs text-muted-foreground">{t("heartbeat.finalDeadline")}</dt><dd className="tabular-nums">{heartbeatDeadline(monitor)}</dd></div></> : <div><dt className="text-xs text-muted-foreground">{t("list.columns.lastChecked")}</dt><dd>{checkedTime(monitor)}</dd></div>}<div><dt className="text-xs text-muted-foreground">{t("list.columns.interval")}</dt><dd className="whitespace-nowrap">{formatInterval(monitor.interval, t, i18n.language)}</dd></div></dl></CollapsibleContent></Collapsible>
              <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-2"><RecheckButton monitor={monitor} busy={checkNowMutation.isPending} onCheck={() => void handleCheckNow(monitor)} /></div>
            </article>)}
          </section>)}
        </div>
      ) : (
      <div className="min-w-0 max-w-full rounded-lg border bg-card">

				<Table aria-label={t("common:nav.monitors")} pageScroll containerClassName="scroll-pt-[var(--header-height)]"
					className={cn(
						"min-w-[720px] table-fixed [&_tbody_tr]:h-[72px] [&_td]:px-2 [&_th]:px-2 [&_td]:py-3 [&_th]:leading-tight [&_th]:hyphens-auto [&_th]:[overflow-wrap:anywhere]",
						dense && "[&_tbody_tr]:h-14 [&_td]:py-1",
					)}
				>
					<TableHeader className="relative z-30 bg-muted [&_th]:bg-muted">
						<TableRow>
							<TableHead className="w-[60px]">
								<SelectableCheckbox
									checked={selection.isAllSelected}
									indeterminate={selection.isPartiallySelected}
									onChange={() => selection.toggleAll()}
									label={t("common:bulkSelection.selectAll", "Select all")}
								/>
							</TableHead>
			<TableHead
				className="min-w-[220px] text-start"
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
							<TableHead className="hidden w-[144px] text-start sm:table-cell" aria-sort={ariaSort("status")}>
								<SortableHeader
									field="status"
									label={t("uptimeMonitor:list.columns.status", "Status")}
									active={sort === "status"}
									dir={dir}
									onSort={onSortChange}
								/>
							</TableHead>
							<TableHead
								className="w-[88px] text-start hidden sm:table-cell"
								aria-sort={ariaSort("response")}
							>
								<SortableHeader
									field="response"
									label={t(
										"uptimeMonitor:list.columns.responseTime",
										"Last response",
									)}
									active={sort === "response"}
									dir={dir}
									onSort={onSortChange}
								/>
							</TableHead>
							<TableHead
								className="w-[104px] text-start hidden md:table-cell"
								aria-sort={ariaSort("uptime")}
							>
								<TooltipProvider><Tooltip><TooltipTrigger asChild><span><SortableHeader field="uptime" label={t("uptimeMonitor:list.columns.uptime", "Success ({{days}}d)", { days: STATS_WINDOW_DAYS })} active={sort === "uptime"} dir={dir} onSort={onSortChange} /></span></TooltipTrigger><TooltipContent>{t("uptimeMonitor:list.columns.uptimeTooltip", "Successful checks divided by all recorded checks in the last {{count}} days.", { count: STATS_WINDOW_DAYS })}</TooltipContent></Tooltip></TooltipProvider>
							</TableHead>
							<TableHead className="w-[104px] text-start hidden xl:table-cell">
								{t("uptimeMonitor:list.columns.interval", "Interval")}
							</TableHead>
							<TableHead className="w-[128px] text-start hidden xl:table-cell">
								{t("uptimeMonitor:list.columns.lastChecked", "Last checked")}
							</TableHead>
							<TableHead sticky="end" className="z-30 w-[112px] bg-muted text-end">
								{t("uptimeMonitor:list.columns.actions", "Actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
							{monitorGroups.map(({ tag, monitors: grouped }) => <Fragment key={JSON.stringify(tag)}>
				              {group !== "none" && <TableRow><TableHead colSpan={visibleColumnCount} scope="rowgroup" className="relative z-20 h-auto bg-muted p-0 text-start font-medium"><button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-3 text-start focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={!collapsedGroups.has(String(tag))} onClick={() => setCollapsedGroups(previous => { const next = new Set(previous); const key = String(tag); next.has(key) ? next.delete(key) : next.add(key); return next; })}><bdi>{t("views.groupCount", { name: tag ?? t("views.withoutGroup"), count: grouped.length, defaultValue: "{{name}} ({{count}})" })}</bdi>{collapsedGroups.has(String(tag)) ? <ChevronDown aria-hidden className="size-4" /> : <ChevronUp aria-hidden className="size-4" />}</button></TableHead></TableRow>}
			              {!collapsedGroups.has(String(tag)) && grouped.map((monitor) => (
							<TableRow
								key={monitor.uptimeMonitorId}
								onClick={(e) => handleRowClick(e, monitor.uptimeMonitorId)}
								className={cn(
									"cursor-pointer bg-card hover:bg-[color-mix(in_srgb,hsl(var(--muted))_50%,hsl(var(--card)))]",
									monitor.status === "down" &&
										"border-s-2 border-s-destructive bg-[color-mix(in_srgb,hsl(var(--destructive))_5%,hsl(var(--card)))]",
									monitor.status === "degraded" &&
										"border-s-2 border-s-warning bg-[color-mix(in_srgb,hsl(var(--warning))_5%,hsl(var(--card)))]",
								)}
							>
								<TableCell className="w-[60px]">
									<SelectableCheckbox
										checked={selection.selectedIds.has(monitor.uptimeMonitorId)}
										onChange={() => selection.toggle(monitor.uptimeMonitorId)}
										label={monitor.name}
									/>
								</TableCell>
								<TableCell className="min-w-[220px]">
									<Link
										to="/dashboard/uptime/$monitorId"
										params={{ monitorId: monitor.uptimeMonitorId }}
										className={cn("inline-flex max-w-full items-center break-words font-medium hover:underline", dense ? "min-h-6" : "min-h-11")}
									>
										{monitor.name}
									</Link>
									<div className="flex flex-wrap gap-1 sm:hidden">
										{health(monitor)}
									</div>
									{heartbeatFacts(monitor)}
                  <p className="text-xs text-muted-foreground xl:hidden"><span>{t(monitor.monitorType === "heartbeat" ? "heartbeat.lastEvaluated" : "list.columns.lastChecked")}: </span>{checkedTime(monitor)}<span className="hidden lg:inline"> · {t("list.columns.interval")}: <span className="whitespace-nowrap">{formatInterval(monitor.interval, t, i18n.language)}</span></span></p>
									{!dense && (
										<>
											<p className="max-w-sm text-xs text-muted-foreground [overflow-wrap:anywhere]">
												{monitor.monitorType === "server" ? t("server.title") : monitor.monitorType === "heartbeat" ? t("uptimeMonitor:heartbeat.title") : monitor.networkConfig ? `${monitor.networkConfig.type.toUpperCase()} · ${monitor.networkConfig.hostname}${monitor.networkConfig.type === "tcp" ? `:${monitor.networkConfig.port}` : ` · ${monitor.networkConfig.recordType}`}` : monitor.url}
											</p>
											{tags(monitor)}
										</>
									)}
								</TableCell>
								<TableCell className="hidden w-[112px] sm:table-cell">
									{health(monitor)}
								</TableCell>
								<TableCell
									className={cn(
										"hidden sm:table-cell tabular-nums",
										latencyClass(monitor),
									)}
								>
									{(monitor.monitorType === "heartbeat" || monitor.monitorType === "server") ? <><span aria-hidden>—</span><span className="sr-only">{t("list.notApplicable")}</span></> : latencyText(monitor)}
								</TableCell>
								<TableCell className="hidden md:table-cell tabular-nums">
									{monitor.uptimePercentage != null ? (
										<Unit>{checkSuccessText(monitor)}</Unit>
									) : (
										<span className="text-xs text-muted-foreground">{t("metrics.noData")}<span className="sr-only">
											{monitor.active && !monitor.lastCheckedAt ? t("uptimeMonitor:metrics.collecting", "Waiting for the first check. Check success appears after a recorded result.") : t("uptimeMonitor:metrics.noChecks", "No recorded checks in the last {{count}} days.", { count: STATS_WINDOW_DAYS })}</span>
										</span>
									)}
								</TableCell>
								<TableCell className="hidden xl:table-cell">
									{formatInterval(monitor.interval, t, i18n.language)}
								</TableCell>
								<TableCell
									className="hidden xl:table-cell text-muted-foreground text-xs"
									title={formatTime(monitor.lastCheckedAt, i18n.language, accountTimezone)}
								>
									{checkedTime(monitor)}
								</TableCell>
								<TableCell sticky="end" className="z-10 w-[112px] bg-inherit text-end">
                  <div className="flex items-center justify-end gap-1">
                    <RecheckButton monitor={monitor} busy={checkNowMutation.isPending} onCheck={() => void handleCheckNow(monitor)} />
                    {actions(monitor)}
                  </div>
								</TableCell>
							</TableRow>
						))}</Fragment>)}
					</TableBody>
				</Table>
			</div>
			)}

			{filteredMonitors.length > displayMonitors.length && (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
					<p role="status" className="text-sm text-muted-foreground">{t("uptimeMonitor:list.showing", { shown: displayMonitors.length, total: filteredMonitors.length })}</p>
					<Button variant="outline" onClick={() => setShown(current => current + MONITOR_LIST_PAGE_SIZE)}>{t("uptimeMonitor:list.showMore")}</Button>
				</div>
			)}

      {/* Actionable IDs remain explicit, unique and scoped to the current filter. */}
      {selection.hasSelection && <div ref={toolbarRef} data-bulk-toolbar className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] start-4 end-4 z-40 lg:start-[calc(var(--sidebar-width)+1rem)]" role="toolbar" aria-label={t("common:bulkSelection.toolbar", "Selection toolbar")}>
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-lg border border-input bg-card p-3 shadow-xs [&>button]:max-w-full [&>button]:whitespace-normal">
          <span className="text-sm font-medium">{t("common:bulkSelection.selected", "{{count}} selected", { count: selection.selectionCount })}</span>
          <Button variant="outline" onClick={() => setIsEditDialogOpen(true)} disabled={isProcessing}><Settings2 />{t("bulk.edit.button", "Edit settings")}</Button>
          <Button variant="outline" onClick={handleBulkActiveChange} disabled={isProcessing}>{isProcessing ? <Loader2 className="animate-spin" /> : shouldResumeSelection ? <Play /> : <Pause />}{shouldResumeSelection ? t("bulk.resume", "Resume") : t("bulk.pause", "Pause")}</Button>
          <MaintenanceDialog monitorIds={Array.from(selection.selectedIds)} />
          <AddSelectedToPage monitorIds={Array.from(selection.selectedIds)} onApplied={selection.clearSelection}>{publish => <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" disabled={isProcessing} aria-label={`${t("actions.moreActions", "More actions")} — ${t("common:bulkSelection.selected", "{{count}} selected", { count: selection.selectionCount })}`}><MoreHorizontal />{t("actions.moreActions", "More actions")}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem onClick={publish}>{t("pageSelection.button")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsShareDialogOpen(true)}>{t("share.button", "Share")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => setIsDeleteDialogOpen(true)}>{t("common:bulkSelection.deleteCount", "Delete ({{count}})", { count: selection.selectionCount })}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>}</AddSelectedToPage>
          <Button variant="ghost" size="icon" disabled={isProcessing} onClick={selection.clearSelection} aria-label={t("common:bulkSelection.clearSelection", "Clear")}><X /></Button>
        </div>
      </div>}

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
				getItemId={(m) => m.uptimeMonitorId}
				description={t("uptimeMonitor:bulk.deleteConsequence")}
				constraints={deleteConstraints}
				onConfirm={handleBulkDelete}
				isDeleting={isProcessing}
			/>
		</div>
	);
}
