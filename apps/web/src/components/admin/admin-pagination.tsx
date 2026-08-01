/**
 * Shared pagination footer for admin tables (offset/limit based).
 *
 * @module components/admin/admin-pagination
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

interface AdminPaginationProps {
	offset: number;
	limit: number;
	total: number;
	onChange: (offset: number) => void;
}

export function AdminPagination({
	offset,
	limit,
	total,
	onChange,
}: AdminPaginationProps) {
	const { t } = useTranslation("admin");
	const page = Math.floor(offset / limit) + 1;
	const hasPrev = offset > 0;
	const hasNext = offset + limit < total;

	return (
		<div className="flex items-center justify-between gap-2 pt-3">
			<span className="text-xs text-muted-foreground">
				{t("common.showing", {
					count: Math.min(total, offset + limit),
					total,
				})}
			</span>
			<div className="flex items-center gap-2">
				<span className="text-xs text-muted-foreground">
					{t("common.page", { page })}
				</span>
				<Button
					variant="outline"
					size="sm"
					className="h-[44px]"
					disabled={!hasPrev}
					onClick={() => onChange(Math.max(0, offset - limit))}
				>
					<ChevronLeft className="h-4 w-4 rtl:scale-x-[-1]" />
					<span className="hidden sm:inline">{t("common.previous")}</span>
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-[44px]"
					disabled={!hasNext}
					onClick={() => onChange(offset + limit)}
				>
					<span className="hidden sm:inline">{t("common.next")}</span>
					<ChevronRight className="h-4 w-4 rtl:scale-x-[-1]" />
				</Button>
			</div>
		</div>
	);
}
