import type { SortDir, SortField } from "./format";
import { decodeViewTags, encodeViewTags } from "./monitor-views";

export type StatusFilter = "up" | "down" | "degraded" | "pending";

export const STATUS_FILTERS: readonly StatusFilter[] = ["up", "down", "degraded", "pending"];

export const SORT_FIELDS: readonly SortField[] = [
	"status",
	"name",
	"response",
	"uptime",
];

/** Narrow a sibling route’s status value to this route’s monitor filter. */
export function toStatusFilter(value: unknown): StatusFilter | undefined {
	return STATUS_FILTERS.includes(value as StatusFilter)
		? (value as StatusFilter)
		: undefined;
}

export function toSortField(value: unknown): SortField | undefined {
	return SORT_FIELDS.includes(value as SortField)
		? (value as SortField)
		: undefined;
}

export function toSortDir(value: unknown): SortDir | undefined {
	return value === "desc" ? "desc" : value === "asc" ? "asc" : undefined;
}

export type NotificationTab = "providers" | "defaults" | "monitors";

export interface DashboardSearch {
  notificationTab?: NotificationTab;
  panel?: "create" | "notifications" | "status-pages" | "templates" | "share-links" | "saved-views";
	tags?: string[];
	q?: string;
	status?: StatusFilter;
	sort?: SortField;
	dir?: SortDir;
	view?: "compact";
	tagMode?: "all";
	group?: "tag" | "environment";
	viewId?: string;
	noDefault?: boolean;
}

/**
 * Rebuild a clean {@link DashboardSearch} from a (possibly wider, sibling-route)
 * previous search object — re-narrowing `status` and dropping foreign keys so
 * navigate() updaters can spread it and override a single field.
 */
export function carrySearch(prev: unknown): DashboardSearch {
	const search = typeof prev === "object" && prev !== null
		? prev as Record<string, unknown>
		: {};
	const tags = encodeViewTags(decodeViewTags(search.tags));
	const q = typeof search.q === "string" && search.q ? search.q.slice(0, 100) : undefined;
	const status = toStatusFilter(search.status);
	const sort = toSortField(search.sort);
	const dir = sort ? toSortDir(search.dir) : undefined;
	const view = search.view === "compact" ? "compact" : undefined;
	return {
	    ...(search.panel === "create" || search.panel === "notifications" || search.panel === "status-pages" || search.panel === "templates" || search.panel === "share-links" || search.panel === "saved-views" ? { panel: search.panel } : {}),
		...(search.notificationTab === "providers" || search.notificationTab === "defaults" || search.notificationTab === "monitors" ? { notificationTab: search.notificationTab } : {}),
		...(tags ? { tags } : {}),
		...(q ? { q } : {}),
		...(status ? { status } : {}),
		...(sort ? { sort } : {}),
		...(dir ? { dir } : {}),
		...(view ? { view } : {}),
	    ...(search.tagMode === "all" ? { tagMode: "all" as const } : {}),
	    ...(search.group === "tag" || search.group === "environment" ? { group: search.group } : {}),
	    ...(typeof search.viewId === "string" && search.viewId.length <= 64 ? { viewId: search.viewId } : {}),
	    ...(search.noDefault === true || search.noDefault === "true" ? { noDefault: true } : {}),
	};
}
