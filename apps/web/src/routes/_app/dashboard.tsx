import { FormField } from "@/components/ui/form-field";
import { useControlReady } from "@/components/ui/control-readiness";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ResponsiveFilters } from "@/components/ui/responsive-filters";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatDate } from "@/lib/date-format";
import { ServerCreateControl } from "@/components/uptime/server-health-controls";
import { NetworkMonitorDialog } from "@/components/uptime/network-controls";
import { MonitorTemplatesControls } from "@/components/uptime/monitor-reuse-controls";
import { HeartbeatCreateControl } from "@/components/uptime/heartbeat-controls";
/**
 * Monitor dashboard route.
 *
 * Stats cards + monitor table + create/quick-add dialogs + notification settings sheet.
 *
 * @module routes/_app/dashboard
 */

import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
	ChevronDown,
  Globe, Network, Server, HeartPulse, Zap, ListPlus, LayoutTemplate,
  Loader2,
	SlidersHorizontal,
	MoreHorizontal,
	Plus,
	Rows2,
	Rows3,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChannelHealthBanner } from "@/components/uptime/channel-health-banner";
import { MonitorBulkAddDialog } from "@/components/uptime/monitor-bulk-add-dialog";
import { MonitorCreateDialog } from "@/components/uptime/monitor-create-dialog";
import { MonitorViewsControls } from "@/components/uptime/monitor-views-controls";
import { decodeViewTags, encodeViewTags } from "@/lib/uptime/monitor-views";
import type { MonitorView, MonitorViewFilters } from "@/types/monitor-views";
import { MonitorList } from "@/components/uptime/monitor-list";
import { filterMonitorList } from "@/lib/uptime/monitor-list-filter";
import { MonitorActiveFilters } from "@/components/uptime/monitor-active-filters";
import { MonitorQuickAdd } from "@/components/uptime/monitor-quick-add";
import { MonitorSearchInput } from "@/components/uptime/monitor-search-input";
import { NotificationSettingsSheet } from "@/components/uptime/notification-settings-sheet";
import { ShareLinksSheet } from "@/components/uptime/share/share-links-sheet";
import { StatusPagesSheet } from "@/components/uptime/status-pages-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { UptimeStatsCards } from "@/components/uptime/uptime-stats-cards";
import { Button } from "@/components/ui/button";
import {
	useMonitorListUpdating,
	useUptimeMonitors,
} from "@/hooks/uptime";
import { summarizeMonitors } from "@/lib/uptime/monitor-summary";
import { useSession } from "@/lib/auth-client";
import { carrySearch, STATUS_FILTERS, SORT_FIELDS, toStatusFilter, toSortField, toSortDir, type DashboardSearch, type StatusFilter } from "@/lib/uptime/dashboard-search";
import type { SortDir, SortField } from "@/lib/uptime/format";
export type { DashboardSearch } from "@/lib/uptime/dashboard-search";

export const Route = createFileRoute("/_app/dashboard")({
	component: DashboardPage,
  validateSearch: carrySearch,
});

function DashboardPage() {
	const { t, i18n } = useTranslation(["uptimeMonitor", "common"]);
  const accountTimezone = useAccountTimezone();
  const controlsReady = useControlReady();
	const navigate = useNavigate();
	const collectionSearchRef = useRef<HTMLInputElement>(null);
	const routeSearch = Route.useSearch();
	const {
		tags: tagsParam,
		q: searchQuery,
		status: selectedStatus,
		sort,
		dir,
		view, tagMode, group, viewId,
	} = routeSearch;
	const selectedTags = useMemo(
		() => decodeViewTags(tagsParam),
		[tagsParam],
	);
	const { data: session } = useSession();
	const [localCreateOpen, setLocalCreateOpen] = useState(false);
  const createOpen = localCreateOpen || routeSearch.panel === "create";
  const setCreateOpen = useCallback((open: boolean) => {
    setLocalCreateOpen(open);
    if (!open && routeSearch.panel === "create") void navigate({ to: "/dashboard", search: previous => ({ ...carrySearch(previous), panel: undefined }), replace: true });
  }, [navigate, routeSearch.panel]);
	useEffect(() => { const open = () => setCreateOpen(true); window.addEventListener("pulsy:open-create-monitor", open); return () => window.removeEventListener("pulsy:open-create-monitor", open); }, [setCreateOpen]);
  const [quickDraft, setQuickDraft] = useState<{ url: string; name: string }>();
	const [quickAddOpen, setQuickAddOpen] = useState(false);
	const [bulkAddOpen, setBulkAddOpen] = useState(false);
	const notifSettingsOpen = routeSearch.panel === "notifications";
  const setPanel = (panel: DashboardSearch["panel"]) => navigate({ to: "/dashboard", search: prev => ({ ...carrySearch(prev), panel }) });
  const setNotifSettingsOpen = (open: boolean) => setPanel(open ? "notifications" : undefined);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [heartbeatOpen, setHeartbeatOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterTags, setFilterTags] = useState<string[]>([]);
	const shareLinksOpen = routeSearch.panel === "share-links";
  const setShareLinksOpen = (open: boolean) => setPanel(open ? "share-links" : undefined);
	const statusPagesOpen = routeSearch.panel === "status-pages";
  const setStatusPagesOpen = (open: boolean) => setPanel(open ? "status-pages" : undefined);
	const monitorQuery = useUptimeMonitors();
	const { data: monitors, isLoading, error: monitorError } = monitorQuery;
	// Counters come from the same rows as the list (one snapshot): they cannot
	// disagree, and optimistic list patches move both together.
	const summary = useMemo(() => monitors ? summarizeMonitors(monitors) : undefined, [monitors]);
	const summaryUpdating = useMonitorListUpdating();

	const userId = session?.user.id;
	const hasPublicMonitors = monitors?.some((m) => m.isPublic) ?? false;

	// Every handler rebuilds the search from `prev` via carrySearch (which
	// re-narrows the sibling-route `status` union and drops foreign keys),
	// touching only its own field so the other filters persist.
	const handleTagsChange = useCallback(
		(nextTags: string[]) => {
			navigate({
				to: "/dashboard",
				search: (prev) => ({
					...carrySearch(prev), noDefault: true,
					tags: encodeViewTags(nextTags),
				}),
				replace: false,
			});
		},
		[navigate],
	);

	const handleQueryChange = useCallback(
		(q: string) => {
			navigate({
				to: "/dashboard",
				search: (prev) => ({
					...carrySearch(prev), noDefault: true,
					q: q.trim() ? q : undefined,
				}),
				replace: true,
			});
		},
		[navigate],
	);

	const handleStatusChange = useCallback(
		(status: StatusFilter | undefined) => {
			navigate({
				to: "/dashboard",
				search: (prev) => ({
					...carrySearch(prev), noDefault: true,
					status: status || undefined,
				}),
				replace: false,
			});
		},
		[navigate],
	);

	// Cycle a column: unsorted → asc → desc → back to the default health sort.
	const handleSortChange = useCallback(
		(field: SortField) => {
			navigate({
				to: "/dashboard",
				search: (prev) => {
					const carried = carrySearch(prev);
					const prevDir = carried.dir ?? "asc";
					let nextSort: SortField | undefined;
					let nextDir: SortDir | undefined;
					if (carried.sort !== field) {
						nextSort = field;
						nextDir = "asc";
					} else if (prevDir === "asc") {
						nextSort = field;
						nextDir = "desc";
					} else {
						nextSort = undefined;
						nextDir = undefined;
					}
					return { ...carried, sort: nextSort, dir: nextDir };
				},
				replace: false,
			});
		},
		[navigate],
	);

	const handleViewChange = useCallback(
		(nextView: "compact" | undefined) => {
			navigate({
				to: "/dashboard",
				search: (prev) => ({ ...carrySearch(prev), view: nextView }),
				replace: false,
			});
		},
		[navigate],
	);

  const filters: MonitorViewFilters = { search: searchQuery ?? "", tags: selectedTags, tagMode: tagMode ?? "any", health: selectedStatus ?? "all", sort: sort ?? "status", direction: dir ?? "asc", density: view === "compact" ? "compact" : "comfortable", group: group ?? "none" };
  const applySavedView = useCallback((saved: MonitorView, replace = false) => {
    const f = saved.filters;
    navigate({ to: "/dashboard", search: previous => ({ panel: carrySearch(previous).panel, notificationTab: carrySearch(previous).notificationTab, q: f.search || undefined, tags: encodeViewTags(f.tags), status: f.health === "all" ? undefined : f.health, sort: f.sort, dir: f.direction, view: f.density === "compact" ? "compact" : undefined, tagMode: f.tagMode === "all" ? "all" : undefined, group: f.group === "none" ? undefined : f.group, viewId: saved.id }), replace });
  }, [navigate]);
  const clearView = useCallback(() => { navigate({ to: "/dashboard", search: previous => ({ panel: carrySearch(previous).panel, notificationTab: carrySearch(previous).notificationTab, noDefault: true }) }); }, [navigate]);
  const hasFilters = Boolean(searchQuery || selectedStatus || selectedTags.length || tagMode === "all");
  const resetFilters = () => navigate({ to: "/dashboard", search: previous => ({ ...carrySearch(previous), noDefault: true, q: undefined, tags: undefined, status: undefined, tagMode: undefined, viewId: undefined }) });
  const changeViewFilters = (next: { tagMode?: "all"; group?: "tag" | "environment"; status?: StatusFilter }) => navigate({ to: "/dashboard", search: prev => ({ ...carrySearch(prev), noDefault: true, ...next }), replace: false });

	return (
		<div className="flex min-w-0 flex-col gap-4">

			<ChannelHealthBanner
				onManageChannels={() => setNotifSettingsOpen(true)}
			/>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><h1 className="app-title">{t("common:nav.monitors")}</h1><p className="text-sm text-muted-foreground">{t("description")}</p></div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0"><Button disabled={isLoading || !controlsReady} aria-busy={!controlsReady || undefined} className="min-w-0 whitespace-normal rounded-e-none text-start" onClick={() => setCreateOpen(true)}>{isLoading || !controlsReady ? <Loader2 aria-hidden className="animate-spin" /> : <Plus />}{t("common:nav.addMonitor")}<span className="sr-only"> — <bdi>HTTP / HTTPS</bdi></span></Button><DropdownMenu><DropdownMenuTrigger asChild><Button disabled={isLoading} size="icon" className="shrink-0 rounded-s-none border-s border-primary-foreground/30" aria-label={t("actions.chooseMonitorType")}><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("actions.monitorType")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setCreateOpen(true)}><Globe aria-hidden /><bdi>HTTP / HTTPS</bdi></DropdownMenuItem>
            <DropdownMenuItem onClick={() => setNetworkOpen(true)}><Network aria-hidden />{t("network.create")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setServerOpen(true)}><Server aria-hidden />{t("server.title")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHeartbeatOpen(true)}><HeartPulse aria-hidden />{t("heartbeat.title")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("actions.otherWaysToAdd")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setQuickAddOpen(true)}><Zap aria-hidden />{t("quickAdd.button")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setBulkAddOpen(true)}><ListPlus aria-hidden />{t("bulkAdd.button")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPanel("templates")}><LayoutTemplate aria-hidden />{t("templates.use")}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu></div>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="shrink-0" aria-label={t("actions.moreActions")}><MoreHorizontal /><span className="hidden sm:inline">{t("actions.moreActions")}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShareLinksOpen(true)}>{t("share.manageButton")}</DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/dashboard/import-export">{t("common:nav.portability")}</Link></DropdownMenuItem>
            {hasPublicMonitors && userId && <DropdownMenuItem asChild><a href={`/status/${userId}`} target="_blank" rel="noopener noreferrer">{t("statusPage.viewStatusPage")}</a></DropdownMenuItem>}
          </DropdownMenuContent></DropdownMenu>
        </div>
      </div>

			{summary && (
        <section aria-label={t("workspace.allMonitors")} aria-busy={summaryUpdating} className="grid gap-2" data-monitor-summary>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-medium text-muted-foreground">{t("workspace.allMonitors")}</h2>
            {summaryUpdating && <span role="status" className="text-xs text-muted-foreground">{t("metrics.updating", "Updating…")}</span>}</div>
				<UptimeStatsCards
					summary={summary}
					selectedStatus={selectedStatus}
					onStatusChange={handleStatusChange}
				/>
        </section>
			)}

      <div className="flex min-w-0 flex-wrap items-center gap-2" role="region" aria-label={t("common:nav.filters")}>
        <div className="min-w-0 basis-full lg:basis-56 lg:flex-1"><MonitorSearchInput inputRef={collectionSearchRef} value={searchQuery ?? ""} onChange={handleQueryChange} /></div>
        <div className="min-w-0 flex-1 lg:w-64 lg:flex-none" data-saved-views-control><MonitorViewsControls pickerOpen={routeSearch.panel === "saved-views"} onPickerOpenChange={open => setPanel(open ? "saved-views" : undefined)} filters={filters} selectedId={viewId} allowDefault={!routeSearch.noDefault && !Object.keys(routeSearch).some(key => key !== "panel" && key !== "notificationTab")} onApply={applySavedView} onClear={clearView} /></div>
        <Button variant="outline" className="w-36 shrink-0" onClick={() => {
          if (!filtersOpen) setFilterTags([...new Set([...(monitors ?? []).flatMap(m => m.tags ?? []), ...selectedTags])].sort());
          setFiltersOpen(value => !value);
        }} aria-expanded={filtersOpen} aria-controls="monitor-filters"><SlidersHorizontal />{t("common:nav.filters")}{selectedTags.length + (selectedStatus ? 1 : 0) > 0 && <span className="ms-1.5 rounded-full bg-primary/10 px-1.5 text-xs tabular-nums">{selectedTags.length + (selectedStatus ? 1 : 0)}</span>}</Button>
        <FormField className="hidden min-w-0 items-center gap-2 lg:flex lg:w-72" data-monitor-group-control><label className="sr-only" htmlFor="monitor-group">{t("views.group")}</label><Select value={group ?? "none"} onValueChange={value => changeViewFilters({ group: value === "tag" || value === "environment" ? value : undefined })}><SelectTrigger className="min-w-0 flex-1" id="monitor-group" aria-label={t("views.group")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("views.ungrouped")}</SelectItem><SelectItem value="tag">{t("views.byTag")}</SelectItem><SelectItem value="environment">{t("views.byEnvironment")}</SelectItem></SelectContent></Select>
        <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary" onClick={() => handleViewChange(view === "compact" ? undefined : "compact")} aria-pressed={view === "compact"} aria-label={t("list.view.compactRows")}>{view === "compact" ? <Rows3 /> : <Rows2 />}</Button></TooltipTrigger><TooltipContent>{t("list.view.compactRows")}</TooltipContent></Tooltip></TooltipProvider></FormField>
      </div>
      <ResponsiveFilters id="monitor-filters" open={filtersOpen} onOpenChange={setFiltersOpen}><fieldset className="form-grid min-w-0 sm:grid-cols-2"><legend className="mb-2 text-sm font-medium">{t("views.filterSection")}</legend><label className="form-field text-sm">{t("views.health")}<Select value={selectedStatus ?? "all"} onValueChange={value => changeViewFilters({ status: toStatusFilter(value) })}><SelectTrigger aria-label={t("views.health")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("views.allHealth")}</SelectItem>{STATUS_FILTERS.map(status => <SelectItem key={status} value={status}>{t(`status.${status}`)}</SelectItem>)}</SelectContent></Select></label><label className="form-field text-sm">{t("views.tagMode")}<Select value={tagMode ?? "any"} onValueChange={value => changeViewFilters({ tagMode: value === "all" ? "all" : undefined })}><SelectTrigger aria-label={t("views.tagMode")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">{t("views.any")}</SelectItem><SelectItem value="all">{t("views.all")}</SelectItem></SelectContent></Select></label><fieldset className="min-w-0 sm:col-span-2"><legend className="mb-2 text-sm">{t("tags.label")}</legend><div className="flex flex-wrap gap-2">{filterTags.map(tag => <Button key={tag} variant={selectedTags.includes(tag) ? "default" : "outline"} aria-pressed={selectedTags.includes(tag)} disabled={!selectedTags.includes(tag) && selectedTags.length >= 50} onClick={() => handleTagsChange(selectedTags.includes(tag) ? selectedTags.filter(value => value !== tag) : [...selectedTags, tag])}><bdi>{tag}</bdi></Button>)}</div></fieldset><p className="text-sm text-muted-foreground sm:col-span-2">{t("views.tagRules")}</p></fieldset><fieldset className="form-grid min-w-0 sm:grid-cols-2 lg:hidden"><legend className="mb-2 text-sm font-medium">{t("views.displaySection")}</legend><div className="grid gap-3 lg:hidden"><label className="form-field text-sm">{t("views.group")}<Select value={group ?? "none"} onValueChange={value => changeViewFilters({ group: value === "tag" || value === "environment" ? value : undefined })}><SelectTrigger aria-label={t("views.group")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("views.ungrouped")}</SelectItem><SelectItem value="tag">{t("views.byTag")}</SelectItem><SelectItem value="environment">{t("views.byEnvironment")}</SelectItem></SelectContent></Select></label><TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" className="aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary" aria-pressed={view === "compact"} onClick={() => handleViewChange(view === "compact" ? undefined : "compact")}>{view === "compact" ? <Rows3 /> : <Rows2 />}{t("list.view.compactRows")}</Button></TooltipTrigger><TooltipContent>{t("list.view.compactRows")}</TooltipContent></Tooltip></TooltipProvider></div><div className="grid gap-3 lg:hidden"><label className="form-field text-sm">{t("views.sort")}<Select value={sort ?? "status"} onValueChange={value => navigate({ to: "/dashboard", search: previous => ({ ...carrySearch(previous), noDefault: true, sort: toSortField(value), dir: "asc" }) })}><SelectTrigger aria-label={t("views.sort")}><SelectValue /></SelectTrigger><SelectContent>{SORT_FIELDS.map(field => <SelectItem key={field} value={field}>{t(`list.columns.${field === "response" ? "responseTime" : field}`)}</SelectItem>)}</SelectContent></Select></label><label className="form-field text-sm">{t("views.direction")}<Select value={dir ?? "asc"} onValueChange={value => navigate({ to: "/dashboard", search: previous => ({ ...carrySearch(previous), noDefault: true, sort: sort ?? "status", dir: toSortDir(value) }) })}><SelectTrigger aria-label={t("views.direction")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="asc">{t("views.ascending")}</SelectItem><SelectItem value="desc">{t("views.descending")}</SelectItem></SelectContent></Select></label></div></fieldset><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={!hasFilters} onClick={resetFilters}>{t("views.reset")}</Button><Button onClick={() => setFiltersOpen(false)}>{t("views.showResults")}</Button></div></ResponsiveFilters>

      {/* One reserved row holds the result count and chips, so applying or clearing a filter never shifts the list. */}
      <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-active-filters-row>
        {monitors && <p role="status" className="text-sm text-muted-foreground">{t("list.results", { count: filterMonitorList(monitors, { tags: selectedTags, tagMode: tagMode ?? "any", status: selectedStatus, search: searchQuery }).length })}</p>}
      <MonitorActiveFilters search={searchQuery ?? ""} status={selectedStatus} tags={selectedTags} allTags={tagMode === "all"} onSearchChange={handleQueryChange} onStatusClear={() => handleStatusChange(undefined)} onTagsChange={handleTagsChange} onClear={clearView} onEmpty={() => collectionSearchRef.current?.focus()} />
      </div>

			{monitorError && (
				<div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
					<p>{monitors ? t("common:resource.staleAt", { time: formatDate(monitorQuery.dataUpdatedAt, i18n.language, accountTimezone) }) : t("metrics.listError", "Monitors unavailable. Try again.")}</p>
					<Button variant="outline" className="min-h-[44px]" onClick={() => monitorQuery.refetch()}>{t("metrics.retryList", "Retry monitors")}</Button>
				</div>
			)}
			{isLoading ? (
				<div role="status" className="grid gap-3">
					<span className="sr-only">{t("common:states.loading")}</span>
					{[0, 1, 2].map(index => <Skeleton key={index} className="h-36 w-full rounded-lg md:h-20" />)}
				</div>
			) : monitors ? (
				<>

					<MonitorList
						monitors={monitors ?? []}
            filtersInToolbar
						selectedTags={selectedTags}
            tagMode={tagMode ?? "any"} group={group ?? "none"}
						searchQuery={searchQuery}
						selectedStatus={selectedStatus}
						sort={sort}
						dir={dir}
						dense={view === "compact"}
						onTagsChange={handleTagsChange}
						onStatusChange={handleStatusChange}
						onSortChange={handleSortChange}
						onCreateMonitor={() => setCreateOpen(true)}
            onClearFilters={resetFilters}
					/>
				</>
			) : null}

			<MonitorTemplatesControls hideTrigger open={routeSearch.panel === "templates"} onOpenChange={open => setPanel(open ? "templates" : undefined)} />
      <ServerCreateControl open={serverOpen} onOpenChange={setServerOpen} />
      <HeartbeatCreateControl hideTrigger open={heartbeatOpen} onOpenChange={setHeartbeatOpen} />
      {networkOpen && <NetworkMonitorDialog open onOpenChange={setNetworkOpen} />}
      {createOpen && <MonitorCreateDialog open quickDraft={quickDraft} onOpenChange={open => { setCreateOpen(open); if (!open) setQuickDraft(undefined); }} />}

			{quickAddOpen && <MonitorQuickAdd open onOpenChange={setQuickAddOpen} onAdvanced={draft => { setQuickDraft(draft); setQuickAddOpen(false); setCreateOpen(true); }} />}

			{bulkAddOpen && <MonitorBulkAddDialog open onOpenChange={setBulkAddOpen} />}

			<NotificationSettingsSheet
				open={notifSettingsOpen}
				onOpenChange={setNotifSettingsOpen}
        tab={routeSearch.notificationTab ?? "providers"}
        onTabChange={notificationTab => navigate({ to: "/dashboard", search: previous => ({ ...carrySearch(previous), notificationTab }), replace: true })}
				monitors={monitors ?? []}
			/>

			<ShareLinksSheet open={shareLinksOpen} onOpenChange={setShareLinksOpen} />

			<StatusPagesSheet
				open={statusPagesOpen}
				onOpenChange={setStatusPagesOpen}
			/>
		</div>
	);
}
