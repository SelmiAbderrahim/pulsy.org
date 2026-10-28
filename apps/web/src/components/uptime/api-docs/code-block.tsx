import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
/**
 * Copy-able monospace code block for the API docs.
 *
 * Code content is literal (never translated); the copy affordance is the only
 * interactive element. Uncodixify: flat `rounded-md` surface, `shadow`-free,
 * no hover lift — the copy icon swaps Copy→Check on success.
 *
 * @module components/uptime/api-docs/code-block
 */

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";

interface CodeBlockProps {
	code: string;
	/** Optional caption shown above the block (already translated). */
	label?: string;
  language?: "bash" | "json" | "yaml" | "http" | "text";
}

export function CodeBlock({ code, label, language = "http" }: CodeBlockProps) {
  const client = useQueryClient();
	const { t } = useTranslation("apiDocs");
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try { await navigator.clipboard.writeText(code); if (!isSessionClientActive(client)) return;
		setCopied(true);
		if (!isSessionClientActive(client)) return; toast.success(t("copy.copied", "Copied"));
		window.setTimeout(() => setCopied(false), 2000);
    } catch { if (!isSessionClientActive(client)) return; toast.error(t("ux.copyFailed")); }
	};

	return (
		<div data-code-block className="flex min-w-0 max-w-full flex-col overflow-hidden rounded-md border bg-muted">
			<div data-code-header className="flex min-w-0 items-center gap-2 border-b bg-muted px-3"><span className="font-mono text-xs text-muted-foreground" dir="ltr">{language.toUpperCase()}</span>
      {label ? (
				<span className="min-w-0 break-words text-xs font-medium text-muted-foreground">
					{label}
				</span>
			) : null}
				<Button
					variant="ghost"
					size="icon"
					onClick={handleCopy}
					type="button"
					className="ms-auto size-11 shrink-0 bg-muted"
					aria-label={`${t("copy.label", "Copy code")}${label ? ` — ${label}` : ""}`}
				>
					{copied ? (
						<Check className="h-4 w-4" />
					) : (
						<Copy className="h-4 w-4" />
					)}
				</Button>
			</div>
			<pre
				dir="ltr"
				tabIndex={0} role="region" aria-label={`${label ?? t("copy.label")} (${language.toUpperCase()})`}
				className="max-h-96 min-w-0 max-w-full overflow-auto p-4 pe-12 text-start font-mono text-[13px] leading-5 text-foreground"
			>
				<code>{code}</code>
			</pre>
		</div>
	);
}
