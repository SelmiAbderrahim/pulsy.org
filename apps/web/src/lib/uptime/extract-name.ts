/**
 * Derive a friendly monitor name from a URL's hostname.
 *
 * Shared by the Quick Add and Bulk Add dialogs so a monitor created without an
 * explicit name falls back to its hostname (e.g. "api.example.com").
 *
 * @module lib/uptime/extract-name
 */

export function extractNameFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname;
	} catch {
		return "";
	}
}
