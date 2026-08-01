import { useTranslation } from "react-i18next";

/** Canonical upstream used when an operator does not set a build-specific URL. */
export const DEFAULT_SOURCE_CODE_URL =
	"https://github.com/SelmiAbderrahim/pulsy";

/**
 * Resolve the public corresponding-source URL baked into this web build.
 *
 * Only HTTP(S) links are accepted. A missing or malformed build argument falls
 * back to the canonical upstream instead of rendering an unsafe link scheme.
 */
export function getSourceCodeUrl(
	configuredUrl = import.meta.env.VITE_SOURCE_CODE_URL,
): string {
	const candidate = configuredUrl?.trim();
	if (!candidate) return DEFAULT_SOURCE_CODE_URL;

	try {
		const parsed = new URL(candidate);
		if (parsed.protocol === "https:" || parsed.protocol === "http:") {
			return candidate;
		}
	} catch {
		// Fall through to the canonical upstream.
	}

	return DEFAULT_SOURCE_CODE_URL;
}

/** A global, unobtrusive corresponding-source offer for the deployed app. */
export function SourceCodeOffer() {
	const { t } = useTranslation("common");

	return (
		<footer className="h-[45px] shrink-0 border-t bg-background px-4 text-center text-xs text-muted-foreground">
			<a
				href={getSourceCodeUrl()}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex min-h-[44px] items-center underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
			>
				{t("source.offer", "Source code for this version")}
			</a>
		</footer>
	);
}
