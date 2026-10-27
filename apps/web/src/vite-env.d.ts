/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Server origin override for the auth/tRPC client (optional). */
	readonly VITE_SERVER_URL?: string;
	/** Google Analytics 4 measurement ID (e.g. `G-XXXXXXX`). Unset = analytics off. */
	readonly VITE_GA_MEASUREMENT_ID?: string;
	/** Canonical app origin used to distinguish custom status-page domains. */
	readonly VITE_APP_URL?: string;
	/** DNS target advertised for custom status-page CNAME records. */
	readonly VITE_CUSTOM_DOMAIN_CNAME_TARGET?: string;
	/** IP target advertised for custom status-page A records. */
	readonly VITE_CUSTOM_DOMAIN_IP?: string;
	/** Optional operator notice shown on the login page. */
	readonly VITE_DEMO_NOTICE?: string;
	/** Public corresponding-source URL for the exact deployed web build. */
	readonly VITE_SOURCE_CODE_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

/** Repository guides compiled at build time, with raw HTML disabled. */
declare module "*.md?help" {
	const document: import("../help-markdown").HelpDocument;
	export default document;
}
