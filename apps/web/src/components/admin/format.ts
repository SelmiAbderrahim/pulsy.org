/**
 * Small formatting helpers for the admin panel.
 *
 * @module components/admin/format
 */

import { formattingLocale } from "@/lib/formatting-locale";

export function formatDate(value: string | Date | null | undefined, locale?: string): string {
	if (!value) return "—";
	const date = typeof value === "string" ? new Date(value) : value;
	if (Number.isNaN(date.getTime())) return "—";
	return new Intl.DateTimeFormat(formattingLocale(locale), { dateStyle: "medium" }).format(date);
}
