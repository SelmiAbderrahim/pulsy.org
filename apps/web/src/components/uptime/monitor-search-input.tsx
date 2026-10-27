/**
 * Inline monitor search/filter box for the dashboard. Live-filters the monitor
 * table by name / url / tag. The value is owned by the route (persisted to the
 * `?q=` URL param), so this is a controlled component.
 *
 * @module components/uptime/monitor-search-input
 */

import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRef, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MonitorSearchInputProps {
	value: string;
	onChange: (value: string) => void;
	inputRef?: RefObject<HTMLInputElement | null>;
}

export function MonitorSearchInput({
	value,
	onChange,
	inputRef,
}: MonitorSearchInputProps) {
	const { t } = useTranslation("uptimeMonitor");
	const localRef = useRef<HTMLInputElement | null>(null);
	const ref = inputRef ?? localRef;

	return (
		<div className="relative w-full">
			<Search
				className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				ref={ref}
				type="search"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape" && value) {
						event.preventDefault();
						onChange("");
					}
				}}
				placeholder={t("search.shortPlaceholder", "Search…")}
				aria-label={t("notificationUX.searchMonitors", "Search monitors")}
				className="ps-9 pe-10 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:appearance-none"
			/>
			{value && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={() => { ref.current?.focus(); onChange(""); }}
					aria-label={t("search.clear", "Clear search")}
					className="absolute end-0 top-1/2 h-11 w-11 -translate-y-1/2"
				>
					<X aria-hidden="true" className="h-4 w-4" />
				</Button>
			)}
		</div>
	);
}
