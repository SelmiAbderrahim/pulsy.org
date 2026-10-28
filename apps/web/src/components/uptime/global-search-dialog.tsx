import { formatLatencyReason } from "@/lib/uptime/format";
/**
 * Global search (⌘K / Ctrl+K) for the dashboard. Searches monitors
 * (client-side, from the cached list) and incidents (server-side, scoped to the
 * user) and jumps to the relevant monitor detail page.
 *
 * @module components/uptime/global-search-dialog
 */

import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Activity, Loader2, Search, X, ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUptimeMonitors, useIncidentSearch } from "@/hooks/uptime";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { filterMonitors } from "@/lib/uptime/search";
import { isStaleObservation } from "@/lib/uptime/format";
import { cn } from "@/lib/utils";

const MAX_PER_GROUP = 6;

interface SearchItem {
	key: string;
	monitorId?: string;
	navigate?: () => void;
	label: string;
	sublabel: string;
	context?: string;
	tab?: "incidents";
}

interface GlobalSearchDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function GlobalSearchDialog({
	open,
	onOpenChange,
}: GlobalSearchDialogProps) {
	const { t } = useTranslation("uptimeMonitor");
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const debouncedQuery = useDebouncedValue(query, 200);
	const queryPending = query.trim() !== debouncedQuery.trim();

	const { data: monitors, isPending: monitorsPending, error: monitorError, refetch: retryMonitors } = useUptimeMonitors({ enabled: open });
	const { data: incidents, isFetching: incidentsFetching, error: incidentError, refetch: retryIncidents } = useIncidentSearch(
		debouncedQuery,
		{ enabled: open },
	);

	// Reset state whenever the palette is closed.
	useEffect(() => {
		if (!open) {
			setQuery("");
			setActiveIndex(0);
		}
	}, [open]);

	const monitorItems = useMemo<SearchItem[]>(() => {
		const trimmed = debouncedQuery.trim();
		if (!trimmed || queryPending) return [];
		return filterMonitors(monitors ?? [], trimmed)
			.slice(0, MAX_PER_GROUP)
			.map((m) => ({
				key: `monitor:${m.uptimeMonitorId}`,
				monitorId: m.uptimeMonitorId,
				label: m.name,
				sublabel: m.networkConfig ? `${m.networkConfig.hostname}${m.networkConfig.type === "tcp" ? `:${m.networkConfig.port}` : ` · ${m.networkConfig.recordType}`}` : m.monitorType === "server" ? t("server.title") : m.monitorType === "heartbeat" ? t("heartbeat.title") : m.url,
				context: [
					m.monitorType === "server" ? t("server.title") : m.monitorType === "heartbeat" ? t("heartbeat.title") : (m.monitorType ?? "http").toUpperCase(),
					!m.active ? t("status.paused") : m.monitorType === "heartbeat" ? t(`heartbeat.${m.status === "pending" ? "new" : m.status === "degraded" ? "late" : m.status}`) : t(`status.${m.status}`),
					isStaleObservation(m) ? t("metrics.stale") : null,
				].filter(Boolean).join(" · "),
			}));
	}, [monitors, debouncedQuery, queryPending, t]);

	const incidentItems = useMemo<SearchItem[]>(() => {
		if (!debouncedQuery.trim() || queryPending) return [];
		return (incidents ?? []).slice(0, MAX_PER_GROUP).map((inc) => ({
			key: `incident:${inc.incidentId}`,
			monitorId: inc.uptimeMonitorId,
			label: inc.monitorName,
			context: t(`incidents.status.${inc.status}`),
			sublabel:
				inc.cause ? formatLatencyReason(inc.cause, t) : t("search.incidentFallback", "Incident"),
			tab: "incidents",
		}));
	}, [incidents, debouncedQuery, queryPending, t]);

	const navigationItems = useMemo<SearchItem[]>(() => {
    const entries = [
      { key: "addMonitor", navigate: () => navigate({ to: "/dashboard", search: { panel: "create" } }) },
      { key: "createStatusPage", navigate: () => navigate({ to: "/dashboard", search: { panel: "status-pages" } }) },
      { key: "addChannel", navigate: () => navigate({ to: "/dashboard", search: { panel: "notifications" } }) },
      { key: "createApiKey", navigate: () => navigate({ to: "/dashboard/api-keys" }) },
      { key: "monitors", navigate: () => navigate({ to: "/dashboard" }) },
      { key: "incidents", navigate: () => navigate({ to: "/dashboard/incidents" }) },
      { key: "templates", navigate: () => navigate({ to: "/dashboard", search: { panel: "templates" } }) },
      { key: "apiDocs", navigate: () => navigate({ to: "/dashboard/api-docs" }) },
      { key: "portability", navigate: () => navigate({ to: "/dashboard/import-export" }) },
      { key: "apiKeys", navigate: () => navigate({ to: "/dashboard/api-keys" }) },
      { key: "statusPages", navigate: () => navigate({ to: "/dashboard", search: { panel: "status-pages" } }) },
      { key: "notifications", navigate: () => navigate({ to: "/dashboard", search: { panel: "notifications" } }) },
      { key: "help", navigate: () => navigate({ to: "/dashboard/help" }) },
    ];
    return entries.map(entry => {
      const labelKey = ["addMonitor", "createStatusPage", "addChannel", "createApiKey"].includes(entry.key) ? `search.action.${entry.key}` : `common:nav.${entry.key}`;
      return { ...entry, key: `navigation:${entry.key}`, label: t(labelKey, labelKey), sublabel: "" };
    })
      .filter(item => !query.trim() || item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  }, [navigate, query, t]);

  const items = useMemo(
		() => [...monitorItems, ...incidentItems, ...navigationItems],
		[monitorItems, incidentItems, navigationItems],
	);

	// Keep the active index in range as results change.
	useEffect(() => {
		setActiveIndex((i) => (i >= items.length ? 0 : i));
	}, [items.length]);

	useEffect(() => { document.getElementById(`search-${items[activeIndex]?.key}`)?.scrollIntoView?.({ block: "nearest" }); }, [activeIndex, items]);

	const clearQuery = () => {
		setQuery("");
		setActiveIndex(0);
		inputRef.current?.focus();
	};

	const select = (item: SearchItem | undefined) => {
		if (!item) return;
		onOpenChange(false);
    if (item.navigate) { item.navigate(); return; }
    if (!item.monitorId) return;
		navigate({
			to: "/dashboard/uptime/$monitorId",
			params: { monitorId: item.monitorId },
			search: item.tab ? { tab: item.tab } : {},
		});
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActiveIndex((i) =>
				items.length ? (i - 1 + items.length) % items.length : 0,
			);
		} else if (e.key === "Enter") {
			e.preventDefault();
			select(items[activeIndex]);
		}
	};

	const hasQuery = query.trim().length > 0;
	const searching = hasQuery && (queryPending || incidentsFetching || monitorsPending);
	const showEmpty =
		hasQuery && items.length === 0 && !searching && !monitorError && !incidentError;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showClose={false}
				className="max-w-[var(--dialog-standard)] gap-0 p-0"
				aria-describedby={undefined}
        onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus({ preventScroll: true }); }}
			>
				<DialogTitle className="sr-only">
					{t("search.paletteTitle", "Search")}
				</DialogTitle>
				<div className="flex min-h-14 items-center gap-2 border-b px-3">
					<Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
					<Input
						ref={inputRef}
						type="search"
            role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="global-search-results" aria-activedescendant={items[activeIndex] ? `search-${items[activeIndex].key}` : undefined}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder={t(
							"search.palettePlaceholder",
							"Search monitors and incidents...",
						)}
						aria-label={t("search.paletteTitle", "Search")}
						// Use one explicitly labeled Clear button across browsers.
						className="min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
					/>
					{query && (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-11 shrink-0"
							onClick={clearQuery}
							aria-label={t("search.clear", "Clear search")}
						>
							<X aria-hidden className="h-4 w-4" />
						</Button>
					)}
				</div>

				<div className="max-h-[60dvh] overflow-y-auto p-2">
					<p role="status" aria-atomic="true" className="sr-only">{searching ? t("metrics.loading") : hasQuery ? showEmpty ? t("search.paletteNoResults") : t("search.resultsSummary", { monitors: monitorItems.length, incidents: incidentItems.length }) : ""}</p>
					{!hasQuery && (
						<p className="px-2 py-6 text-center text-sm text-muted-foreground">
							{t(
								"search.paletteHint",
								"Type to search monitors and incidents.",
							)}
						</p>
					)}

					{showEmpty && (
						<p className="px-2 py-6 text-center text-sm text-muted-foreground">
							{t("search.paletteNoResults", "No results found.")}
						</p>
					)}

					<div id="global-search-results" role="listbox" aria-label={t("search.paletteTitle")}>
          {monitorItems.length > 0 && (
						<SearchGroup
							heading={t("search.groupMonitors", "Monitors")}
							items={monitorItems}
							icon={Activity}
							activeIndex={activeIndex}
							offset={0}
							onHover={setActiveIndex}
							onSelect={select}
						/>
					)}

					{incidentItems.length > 0 && (
						<SearchGroup
							heading={t("search.groupIncidents", "Incidents")}
							items={incidentItems}
							icon={AlertTriangle}
							activeIndex={activeIndex}
							offset={monitorItems.length}
							onHover={setActiveIndex}
							onSelect={select}
						/>
					)}

          {navigationItems.length > 0 && <SearchGroup heading={t("search.groupNavigation")} items={navigationItems} icon={ArrowRight} activeIndex={activeIndex} offset={monitorItems.length + incidentItems.length} onHover={setActiveIndex} onSelect={select} />}
					</div>
          {(monitorError || incidentError) && <div role="alert" className="p-3 text-sm"><p className="text-destructive">{t("search.partialError")}</p><Button variant="outline" onClick={() => { if (monitorError) void retryMonitors(); if (incidentError) void retryIncidents(); }}>{t("common:actions.retry")}</Button></div>}
          {searching && (
						<div aria-hidden="true" className="flex items-center justify-center gap-2 py-6">
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

interface SearchGroupProps {
	heading: string;
	items: SearchItem[];
	icon: typeof Activity;
	activeIndex: number;
	offset: number;
	onHover: (index: number) => void;
	onSelect: (item: SearchItem) => void;
}

function SearchGroup({
	heading,
	items,
	icon: Icon,
	activeIndex,
	offset,
	onHover,
	onSelect,
}: SearchGroupProps) {
	return (
		<div className="mb-1" role="group" aria-label={heading}>
			<p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
				{heading}
			</p>
			{items.map((item, i) => {
				const index = offset + i;
				return (
					<button
						key={item.key}
            id={`search-${item.key}`} role="option" aria-selected={index === activeIndex} tabIndex={-1}
						type="button"
						onClick={() => onSelect(item)}
						onMouseMove={() => onHover(index)}
						className={cn(
							"flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-2 text-start transition-colors duration-150",
							index === activeIndex
								? "bg-accent text-accent-foreground"
								: "hover:bg-muted/50",
						)}
					>
						<Icon className={cn("h-4 w-4 shrink-0 text-muted-foreground", Icon === ArrowRight && "rtl:scale-x-[-1]")} />
						<span className="min-w-0 flex-1">
							<span className="block break-words text-sm font-medium">
								<bdi>{item.label}</bdi>
							</span>
							{item.context && <span className="block text-xs text-muted-foreground">{item.context}</span>}
							<span className="block break-words text-xs text-muted-foreground">
								<bdi className="[overflow-wrap:anywhere]">{item.sublabel}</bdi>
							</span>
						</span>
					</button>
				);
			})}
		</div>
	);
}
