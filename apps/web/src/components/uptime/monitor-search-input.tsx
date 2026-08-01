/**
 * Inline monitor search/filter box for the dashboard. Live-filters the monitor
 * table by name / url / tag. The value is owned by the route (persisted to the
 * `?q=` URL param), so this is a controlled component.
 *
 * @module components/uptime/monitor-search-input
 */

import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MonitorSearchInputProps {
	value: string;
	onChange: (value: string) => void;
}

export function MonitorSearchInput({
	value,
	onChange,
}: MonitorSearchInputProps) {
	const { t } = useTranslation("uptimeMonitor");

	return (
		<div className="relative w-full sm:max-w-sm">
			<Search
				className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				type="search"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={t("search.placeholder", "Search monitors...")}
				aria-label={t("search.placeholder", "Search monitors...")}
				className="ps-9 pe-10"
			/>
			{value && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={() => onChange("")}
					aria-label={t("search.clear", "Clear search")}
					className="absolute end-1 top-1/2 h-9 w-9 -translate-y-1/2"
				>
					<X className="h-4 w-4" />
				</Button>
			)}
		</div>
	);
}
