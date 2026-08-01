/**
 * Global command palette (⌘K / Ctrl+K) for the dashboard. Searches monitors
 * (client-side, from the cached list) and incidents (server-side, scoped to the
 * user) and jumps to the relevant monitor detail page.
 *
 * @module components/uptime/global-search-dialog
 */

import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Activity, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUptimeMonitors, useIncidentSearch } from "@/hooks/uptime";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { filterMonitors } from "@/lib/uptime/search";
import { cn } from "@/lib/utils";

const MAX_PER_GROUP = 6;

interface SearchItem {
	key: string;
	monitorId: string;
	label: string;
	sublabel: string;
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
	const debouncedQuery = useDebouncedValue(query, 200);

	const { data: monitors } = useUptimeMonitors({ enabled: open });
	const { data: incidents, isFetching: incidentsFetching } = useIncidentSearch(
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
		if (!trimmed) return [];
		return filterMonitors(monitors ?? [], trimmed)
			.slice(0, MAX_PER_GROUP)
			.map((m) => ({
				key: `monitor:${m.uptimeMonitorId}`,
				monitorId: m.uptimeMonitorId,
				label: m.name,
				sublabel: m.url,
			}));
	}, [monitors, debouncedQuery]);

	const incidentItems = useMemo<SearchItem[]>(() => {
		return (incidents ?? []).slice(0, MAX_PER_GROUP).map((inc) => ({
			key: `incident:${inc.incidentId}`,
			monitorId: inc.uptimeMonitorId,
			label: inc.monitorName,
			sublabel:
				inc.cause ??
				t("search.incidentFallback", "Incident"),
			tab: "incidents",
		}));
	}, [incidents, t]);

	const items = useMemo(
		() => [...monitorItems, ...incidentItems],
		[monitorItems, incidentItems],
	);

	// Keep the active index in range as results change.
	useEffect(() => {
		setActiveIndex((i) => (i >= items.length ? 0 : i));
	}, [items.length]);

	const select = (item: SearchItem | undefined) => {
		if (!item) return;
		onOpenChange(false);
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

	const hasQuery = debouncedQuery.trim().length > 0;
	const showEmpty =
		hasQuery && items.length === 0 && !incidentsFetching;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl gap-0 p-0" aria-describedby={undefined}>
				<DialogTitle className="sr-only">
					{t("search.paletteTitle", "Search")}
				</DialogTitle>
				<div className="flex items-center gap-2 border-b px-3">
					<Search className="h-4 w-4 shrink-0 text-muted-foreground" />
					{/** biome-ignore lint/a11y/noAutofocus: command palette focuses its input on open by design */}
					<Input
						autoFocus
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder={t(
							"search.palettePlaceholder",
							"Search monitors and incidents...",
						)}
						aria-label={t("search.paletteTitle", "Search")}
						className="border-0 px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
					/>
				</div>

				<div className="max-h-[60vh] overflow-y-auto p-2">
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

					{hasQuery && incidentsFetching && incidentItems.length === 0 && (
						<div className="flex items-center justify-center py-6">
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
		<div className="mb-1">
			<p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
				{heading}
			</p>
			{items.map((item, i) => {
				const index = offset + i;
				return (
					<button
						key={item.key}
						type="button"
						onClick={() => onSelect(item)}
						onMouseMove={() => onHover(index)}
						className={cn(
							"flex w-full items-center gap-3 rounded-md px-2 py-2 text-start transition-colors duration-150",
							index === activeIndex
								? "bg-accent text-accent-foreground"
								: "hover:bg-muted/50",
						)}
					>
						<Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm font-medium">
								{item.label}
							</span>
							<span className="block truncate text-xs text-muted-foreground">
								{item.sublabel}
							</span>
						</span>
					</button>
				);
			})}
		</div>
	);
}
