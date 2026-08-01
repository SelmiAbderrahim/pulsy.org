/**
 * Google Analytics 4 (gtag.js) loader and event layer.
 *
 * Reads the measurement ID from `import.meta.env.VITE_GA_MEASUREMENT_ID` and
 * injects the gtag script exactly once on app mount. When the ID is unset
 * (dev/CI) every function is a graceful no-op — nothing is loaded and no events
 * are sent. All access to `window`/`document` is guarded so the module is safe
 * to import in tests and other non-browser contexts.
 *
 * @module lib/analytics/gtag
 */

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as
	| string
	| undefined;

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
	}
}

let initialized = false;

/** A stable per-tab session id attached to every event. */
let sessionId = "";

function getSessionId(): string {
	if (sessionId) return sessionId;
	if (typeof window === "undefined") return "";
	try {
		const existing = window.sessionStorage.getItem("pulsy_session_id");
		if (existing) {
			sessionId = existing;
			return sessionId;
		}
	} catch {
		/* sessionStorage unavailable (private mode) — fall through */
	}
	// Avoid Math.random for determinism concerns; a timestamp + counter is plenty
	// of entropy for a client analytics session key.
	sessionId = `s-${Date.now().toString(36)}-${(performance.now() | 0).toString(36)}`;
	try {
		window.sessionStorage.setItem("pulsy_session_id", sessionId);
	} catch {
		/* ignore */
	}
	return sessionId;
}

/** Coarse device class derived from viewport width. */
function getDeviceType(): "mobile" | "tablet" | "desktop" {
	if (typeof window === "undefined") return "desktop";
	const w = window.innerWidth;
	if (w < 640) return "mobile";
	if (w < 1024) return "tablet";
	return "desktop";
}

/**
 * Inject the gtag.js script once and configure the property. Safe to call
 * multiple times; subsequent calls are ignored. No-ops without a measurement ID
 * or outside the browser.
 */
export function initAnalytics(): void {
	if (initialized) return;
	if (typeof window === "undefined" || typeof document === "undefined") return;
	if (!MEASUREMENT_ID) return;

	initialized = true;

	window.dataLayer = window.dataLayer || [];
	window.gtag = function gtag() {
		// gtag.js only processes `arguments` objects pushed to dataLayer —
		// a plain array (e.g. from a rest parameter) is silently ignored.
		window.dataLayer?.push(arguments);
	};

	const script = document.createElement("script");
	script.async = true;
	script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
	document.head.appendChild(script);

	window.gtag("js", new Date());
	// Page views are sent manually (router subscription in main.tsx) so SPA
	// route changes are tracked correctly, including the initial load.
	window.gtag("config", MEASUREMENT_ID, { send_page_view: false });
}

/** Properties attached to every event for consistent downstream analysis. */
function baseProps(): Record<string, unknown> {
	return {
		session_id: getSessionId(),
		device_type: getDeviceType(),
		timestamp: new Date().toISOString(),
	};
}

/** Send a SPA page view. No-ops when analytics is disabled. */
export function trackPageView(path: string): void {
	if (typeof window === "undefined" || !window.gtag || !MEASUREMENT_ID) return;
	window.gtag("event", "page_view", {
		page_path: path,
		page_location: window.location.href,
		page_title: document.title,
		...baseProps(),
	});
}
