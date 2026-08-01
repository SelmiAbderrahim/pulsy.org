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
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface CodeBlockProps {
	code: string;
	/** Optional caption shown above the block (already translated). */
	label?: string;
}

export function CodeBlock({ code, label }: CodeBlockProps) {
	const { t } = useTranslation("apiDocs");
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(code);
		setCopied(true);
		toast.success(t("copy.copied", "Copied"));
		window.setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="flex flex-col gap-1.5">
			{label ? (
				<span className="text-xs font-medium text-muted-foreground">
					{label}
				</span>
			) : null}
			<div className="relative">
				<pre
					dir="ltr"
					className="overflow-x-auto rounded-md border bg-muted p-3 pe-12 text-start font-mono text-xs leading-relaxed text-foreground"
				>
					<code>{code}</code>
				</pre>
				<Button
					variant="ghost"
					size="icon"
					onClick={handleCopy}
					className="absolute end-1.5 top-1.5 h-8 w-8"
					aria-label={t("copy.label", "Copy code")}
				>
					{copied ? (
						<Check className="h-4 w-4" />
					) : (
						<Copy className="h-4 w-4" />
					)}
				</Button>
			</div>
		</div>
	);
}
