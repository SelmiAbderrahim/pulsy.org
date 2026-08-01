/**
 * Small formatting helpers for the admin panel.
 *
 * @module components/admin/format
 */

export function formatDate(value: string | Date | null | undefined): string {
	if (!value) return "—";
	const date = typeof value === "string" ? new Date(value) : value;
	if (Number.isNaN(date.getTime())) return "—";
	return date.toLocaleDateString();
}
