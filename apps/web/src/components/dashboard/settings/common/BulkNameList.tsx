/**
 * Scrollable list of every item a bulk action affects. Up to
 * BULK_NAME_LIST_VIRTUAL_THRESHOLD names render directly; longer lists render
 * only the rows in view while keeping list semantics (setsize/posinset).
 *
 * @module components/dashboard/settings/common/BulkNameList
 */

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

export const BULK_NAME_LIST_VIRTUAL_THRESHOLD = 100;
const ROW_HEIGHT = 28;
const VIEWPORT_HEIGHT = 240;
const OVERSCAN = 6;

export interface BulkNameListItem {
	id: string;
	name: string;
	detail?: string | null;
}

export function BulkNameList({ items, label, showLabel = false, className }: { items: BulkNameListItem[]; label: string; showLabel?: boolean; className?: string }) {
	const [scrollTop, setScrollTop] = useState(0);
	const labelId = useId();
	const virtual = items.length > BULK_NAME_LIST_VIRTUAL_THRESHOLD;
	const first = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
	const last = virtual ? Math.min(items.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN) : items.length;
	const rows = items.slice(first, last);
	return (
		<div className={cn("grid min-w-0 gap-2", className)}>
		{showLabel && <p id={labelId} className="text-sm font-medium">{label}</p>}
		<div
			tabIndex={0}
			role="region"
			aria-label={showLabel ? undefined : label}
			aria-labelledby={showLabel ? labelId : undefined}
			data-bulk-name-list
			className={cn("overflow-y-auto rounded-md border bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring")}
			style={{ maxHeight: VIEWPORT_HEIGHT }}
			onScroll={virtual ? event => setScrollTop(event.currentTarget.scrollTop) : undefined}
		>
			<ul
				className="px-3 text-sm"
				style={virtual ? { height: items.length * ROW_HEIGHT, paddingTop: first * ROW_HEIGHT, boxSizing: "border-box" } : undefined}
			>
				{rows.map((item, index) => (
					<li
						key={item.id}
						aria-setsize={virtual ? items.length : undefined}
						aria-posinset={virtual ? first + index + 1 : undefined}
						className={cn("flex min-w-0 items-center gap-2", virtual ? "h-7 truncate" : "py-1")}
					>
						<bdi className={cn("min-w-0", virtual ? "truncate" : "break-words")}>{item.name}</bdi>
						{item.detail && <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>}
					</li>
				))}
			</ul>
		</div>
		</div>
	);
}
