// ---------------------------------------------------------------------------
// HTML escaping for values interpolated into outbound email/markup.
//
// Monitor names/URLs (and provider names) are free-form, user-controlled
// strings. Via the share→clone flow a monitor's name/url can even originate
// from a *different* user, so every value placed into an HTML email body must
// be escaped to prevent stored HTML/script injection that would render in the
// recipient's mail client. Centralized here so every email-building path
// (notifications, channel tests, provider tests) shares one implementation.
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
