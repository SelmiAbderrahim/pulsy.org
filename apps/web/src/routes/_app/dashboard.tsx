/**
 * Monitor dashboard route.
 *
 * Stats cards + monitor table + create/quick-add dialogs + notification settings sheet.
 *
 * @module routes/_app/dashboard
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Bell,
	ExternalLink,
	Globe,
	Link2,
	ListPlus,
	Loader2,
	MoreHorizontal,
	Plus,
	Rows2,
	Rows3,
	Zap,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MonitorBulkAddDialog } from "@/components/uptime/monitor-bulk-add-dialog";
import { MonitorCreateDialog } from "@/components/uptime/monitor-create-dialog";
import { MonitorList } from "@/components/uptime/monitor-list";
import { MonitorQuickAdd } from "@/components/uptime/monitor-quick-add";
import { MonitorSearchInput } from "@/components/uptime/monitor-search-input";
import { NotificationSettingsSheet } from "@/components/uptime/notification-settings-sheet";
import { ShareLinksSheet } from "@/components/uptime/share/share-links-sheet";
import { StatusPagesSheet } from "@/components/uptime/status-pages-sheet";
import { UptimeOnboardingHint } from "@/components/uptime/uptime-onboarding-hint";
import { UptimeStatsCards } from "@/components/uptime/uptime-stats-cards";
import { Button } from "@/components/ui/button";
import {
	useUptimeDashboardSummary,
	useUptimeMonitors,
} from "@/hooks/uptime";
import { useSession } from "@/lib/auth-client";
import type { SortDir, SortField } from "@/lib/uptime/format";

type StatusFilter = "up" | "down" | "degraded";

const STATUS_FILTERS: readonly StatusFilter[] = ["up", "down", "degraded"];

const SORT_FIELDS: readonly SortField[] = [
	"status",
	"name",
	"response",
	"uptime",
];

/**
 * Narrow a possibly-foreign `status` search value (sibling routes under the
 * `/dashboard` prefix declare their own `status`, e.g. the API-keys route's
 * "success"|"canceled") down to this route's monitor StatusFilter.
 */
function toStatusFilter(value: unknown): StatusFilter | undefined {
	return STATUS_FILTERS.includes(value as StatusFilter)
		? (value as StatusFilter)
		: undefined;
}

function toSortField(value: unknown): SortField | undefined {
	return SORT_FIELDS.includes(value as SortField)
		? (value as SortField)
		: undefined;
}

function toSortDir(value: unknown): SortDir | undefined {
	return value === "desc" ? "desc" : value === "asc" ? "asc" : undefined;
}

/**
 * Normalize the `tags` param to a comma-joined string of unique, trimmed tags.
 * Accepts either a comma string or an array (defensive against re-validation).
 */
function normalizeTags(value: unknown): string {
	const raw = Array.isArray(value)
		? value.join(",")
		: typeof value === "string"
			? value
			: "";
	const tags = Array.from(
		new Set(
			raw
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean),
		),
	);
	return tags.join(",");
}

export interface DashboardSearch {
	tags?: string;
	q?: string;
	status?: StatusFilter;
	sort?: SortField;
	dir?: SortDir;
	view?: "compact";
}

/**
 * Rebuild a clean {@link DashboardSearch} from a (possibly wider, sibling-route)
 * previous search object — re-narrowing `status` and dropping foreign keys so
 * navigate() updaters can spread it and override a single field.
 */
function carrySearch(prev: Record<string, unknown>): DashboardSearch {
	const tags = typeof prev.tags === "string" && prev.tags ? prev.tags : undefined;
	const q = typeof prev.q === "string" && prev.q ? prev.q : undefined;
	const status = toStatusFilter(prev.status);
	const sort = toSortField(prev.sort);
	const dir = sort ? toSortDir(prev.dir) : undefined;
	const view = prev.view === "compact" ? "compact" : undefined;
	return {
		...(tags ? { tags } : {}),
		...(q ? { q } : {}),
		...(status ? { status } : {}),
		...(sort ? { sort } : {}),
		...(dir ? { dir } : {}),
		...(view ? { view } : {}),
	};
}

export const Route = createFileRoute("/_app/dashboard")({
	component: DashboardPage,
	validateSearch: (search: Record<string, unknown>): DashboardSearch => {
		const tags = normalizeTags(search.tags);
		const q = typeof search.q === "string" ? search.q.slice(0, 100) : "";
		const status = toStatusFilter(search.status);
		const sort = toSortField(search.sort);
		const dir = sort ? toSortDir(search.dir) : undefined;
		const view = search.view === "compact" ? "compact" : undefined;
		return {
			...(tags ? { tags } : {}),
			...(q ? { q } : {}),
			...(status ? { status } : {}),
			...(sort ? { sort } : {}),
			...(dir ? { dir } : {}),
			...(view ? { view } : {}),
		};
	},
});

function DashboardPage() {
	const { t } = useTranslation(["uptimeMonitor", "common"]);
	const navigate = useNavigate();
	const {
		tags: tagsParam,
		q: searchQuery,
		status: selectedStatus,
		sort,
		dir,
		view,
	} = Route.useSearch();
	const selectedTags = useMemo(
		() => (tagsParam ? tagsParam.split(",") : []),
		[tagsParam],
	);
	const { data: session } = useSession();
	const [createOpen, setCreateOpen] = useState(false);
	const [quickAddOpen, setQuickAddOpen] = useState(false);
	const [bulkAddOpen, setBulkAddOpen] = useState(false);
	const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
	const [shareLinksOpen, setShareLinksOpen] = useState(false);
	const [statusPagesOpen, setStatusPagesOpen] = useState(false);
	const { data: monitors, isLoading } = useUptimeMonitors();
	const { data: summary } = useUptimeDashboardSummary();

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
					...carrySearch(prev),
					tags: nextTags.join(",") || undefined,
				}),
				replace: true,
			});
		},
		[navigate],
	);

	const handleQueryChange = useCallback(
		(q: string) => {
			navigate({
				to: "/dashboard",
				search: (prev) => ({
					...carrySearch(prev),
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
					...carrySearch(prev),
					status: status || undefined,
				}),
				replace: true,
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
				replace: true,
			});
		},
		[navigate],
	);

	const handleViewChange = useCallback(
		(nextView: "compact" | undefined) => {
			navigate({
				to: "/dashboard",
				search: (prev) => ({ ...carrySearch(prev), view: nextView }),
				replace: true,
			});
		},
		[navigate],
	);

	const hasMonitors = (monitors ?? []).length > 0;

	return (
		<div className="flex flex-col gap-6">

			{!isLoading && !hasMonitors && (
				<UptimeOnboardingHint onGetStarted={() => setCreateOpen(true)} />
			)}

			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("title", "Uptime Monitor")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"description",
							"Monitor your applications and services availability.",
						)}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{/* Secondary actions: inline from sm up, collapsed into a menu on mobile. */}
					{hasPublicMonitors && userId && (
						<Button
							variant="outline"
							size="sm"
							asChild
							className="hidden h-[44px] sm:inline-flex"
						>
							<a
								href={`/status/${userId}`}
								target="_blank"
								rel="noopener noreferrer"
							>
								<ExternalLink className="h-4 w-4 me-1 rtl:scale-x-[-1]" />
								{t("statusPage.viewStatusPage", "View Status Page")}
							</a>
						</Button>
					)}
					<Button
						variant="outline"
						onClick={() => setNotifSettingsOpen(true)}
						className="hidden h-[44px] min-w-[44px] sm:inline-flex"
					>
						<Bell className="h-4 w-4 me-2" />
						{t("notificationSettings.button", "Notification Settings")}
					</Button>
					<Button
						variant="outline"
						onClick={() => setShareLinksOpen(true)}
						className="hidden h-[44px] min-w-[44px] sm:inline-flex"
					>
						<Link2 className="h-4 w-4 me-2" />
						{t("share.manageButton", "Share Links")}
					</Button>
					<Button
						variant="outline"
						onClick={() => setStatusPagesOpen(true)}
						className="hidden h-[44px] min-w-[44px] sm:inline-flex"
					>
						<Globe className="h-4 w-4 me-2" />
						{t("statusPages.manageButton", "Status pages")}
					</Button>
					<Button
						variant="outline"
						onClick={() => setQuickAddOpen(true)}
						className="hidden h-[44px] min-w-[44px] sm:inline-flex"
					>
						<Zap className="h-4 w-4 me-2" />
						{t("quickAdd.button", "Quick Add")}
					</Button>
					<Button
						variant="outline"
						onClick={() => setBulkAddOpen(true)}
						className="hidden h-[44px] min-w-[44px] sm:inline-flex"
					>
						<ListPlus className="h-4 w-4 me-2" />
						{t("bulkAdd.button", "Bulk Add")}
					</Button>

					{/* Mobile overflow: all secondary actions in one menu. */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								className="h-[44px] min-w-[44px] sm:hidden"
								aria-label={t("actions.moreActions", "More actions")}
							>
								<MoreHorizontal className="h-4 w-4 me-2" />
								{t("actions.moreActions", "More")}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-56">
							{hasPublicMonitors && userId && (
								<DropdownMenuItem asChild>
									<a
										href={`/status/${userId}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										<ExternalLink className="h-4 w-4 me-2 rtl:scale-x-[-1]" />
										{t("statusPage.viewStatusPage", "View Status Page")}
									</a>
								</DropdownMenuItem>
							)}
							<DropdownMenuItem onClick={() => setNotifSettingsOpen(true)}>
								<Bell className="h-4 w-4 me-2" />
								{t("notificationSettings.button", "Notification Settings")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setShareLinksOpen(true)}>
								<Link2 className="h-4 w-4 me-2" />
								{t("share.manageButton", "Share Links")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setStatusPagesOpen(true)}>
								<Globe className="h-4 w-4 me-2" />
								{t("statusPages.manageButton", "Status pages")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setQuickAddOpen(true)}>
								<Zap className="h-4 w-4 me-2" />
								{t("quickAdd.button", "Quick Add")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setBulkAddOpen(true)}>
								<ListPlus className="h-4 w-4 me-2" />
								{t("bulkAdd.button", "Bulk Add")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					{/* Primary action: always visible. */}
					<Button
						onClick={() => setCreateOpen(true)}
						className="h-[44px] min-w-[44px]"
					>
						<Plus className="h-4 w-4 me-2" />
						{t("actions.createMonitor", "New Monitor")}
					</Button>
				</div>
			</div>

			{summary && (
				<UptimeStatsCards
					summary={summary}
					selectedStatus={selectedStatus}
					onStatusChange={handleStatusChange}
				/>
			)}

			{isLoading ? (
				<div className="flex items-center justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : (
				<>
					{hasMonitors && (
						<div className="flex items-center gap-2">
							<div className="flex-1">
								<MonitorSearchInput
									value={searchQuery ?? ""}
									onChange={handleQueryChange}
								/>
							</div>
							<Button
								variant="outline"
								size="icon"
								onClick={() =>
									handleViewChange(view === "compact" ? undefined : "compact")
								}
								aria-pressed={view === "compact"}
								className="h-[44px] w-[44px] shrink-0"
								aria-label={t("list.view.toggle", "Row density")}
								title={
									view === "compact"
										? t("list.view.comfortable", "Comfortable")
										: t("list.view.compact", "Compact")
								}
							>
								{view === "compact" ? (
									<Rows3 className="h-4 w-4" />
								) : (
									<Rows2 className="h-4 w-4" />
								)}
							</Button>
						</div>
					)}
					<MonitorList
						monitors={monitors ?? []}
						selectedTags={selectedTags}
						searchQuery={searchQuery}
						selectedStatus={selectedStatus}
						sort={sort}
						dir={dir}
						dense={view === "compact"}
						onTagsChange={handleTagsChange}
						onStatusChange={handleStatusChange}
						onSortChange={handleSortChange}
						onCreateMonitor={() => setCreateOpen(true)}
					/>
				</>
			)}

			<MonitorCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

			<MonitorQuickAdd open={quickAddOpen} onOpenChange={setQuickAddOpen} />

			<MonitorBulkAddDialog open={bulkAddOpen} onOpenChange={setBulkAddOpen} />

			<NotificationSettingsSheet
				open={notifSettingsOpen}
				onOpenChange={setNotifSettingsOpen}
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
