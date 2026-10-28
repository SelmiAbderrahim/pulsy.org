import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { formattingLocale } from "@/lib/formatting-locale";
import { formatInterval } from "@/lib/uptime/format";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { formatCount } from "@/lib/count-format";
import { FormField } from "@/components/ui/form-field";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { expectedStatusFields } from "@pulsy/db/http-status-rule";
import { ExpectedStatusInput } from "@/components/uptime/expected-status-input";
import { normalizeMonitorUrl, canonicalMonitorUrl } from "@pulsy/db/monitor-url";
import { useUptimeMonitors } from "@/hooks/uptime/useUptimeMonitors";
import { useTagEntry } from "@/hooks/uptime/useTagEntry";
import { DEFAULT_FAILURE_THRESHOLD, MAX_MONITOR_TIMEOUT_MS } from "@pulsy/db/monitor-defaults";
/**
 * Bulk Add dialog — create many monitors at once from a list of URLs.
 *
 * The user pastes one URL per line; each monitor's name is auto-derived from its
 * hostname. A single shared settings panel (method, interval, expected status,
 * timeout, failure threshold, tags) is applied to every monitor in the batch.
 *
 * @module components/uptime/monitor-bulk-add-dialog
 */

import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateUptimeMonitorsBulk } from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { extractNameFromUrl } from "@/lib/uptime/extract-name";
import type { CreateUptimeMonitorInput, UptimeMonitorMethod } from "@/types/uptime";

interface MonitorBulkAddDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const ALL_INTERVALS = [
	{ value: "30", label: "30 seconds" },
	{ value: "60", label: "1 minute" },
	{ value: "300", label: "5 minutes" },
	{ value: "600", label: "10 minutes" },
	{ value: "1800", label: "30 minutes" },
	{ value: "3600", label: "1 hour" },
];

const METHODS: UptimeMonitorMethod[] = ["GET", "HEAD", "POST"];

/** Max monitors per batch — mirrors the backend `apiCreateUptimeMonitorsBulk` cap. */
const MAX_BULK = 50;

export interface ParsedUrls {
  entries: { line: number; text: string; duplicateName?: string; duplicateLine?: number; state: "valid" | "duplicate" | "invalid" | "unsupported" }[];
  lineCount: number;
	/** Unique, valid URLs with an auto-derived name. */
	valid: { url: string; name: string }[];
	/** Lines that aren't valid URLs (kept for inline feedback). */
	invalidLines: string[];
	/** Count of duplicate URLs that were collapsed. */
	duplicateCount: number;
}

export function parseUrls(raw: string, existing: ReadonlyArray<{ url: string; name: string }> = []): ParsedUrls {
  const seen = new Map(existing.flatMap(monitor => { const url = canonicalMonitorUrl(monitor.url); return url ? [[url, { name: monitor.name }] as const] : []; }));
  const seenLines = new Map<string, number>();
  const valid: ParsedUrls["valid"] = [], invalidLines: string[] = [], entries: ParsedUrls["entries"] = [];
  let duplicateCount = 0;
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, index) => line.trim().split(/\s+/).filter(Boolean).forEach(text => {
    const entry: ParsedUrls["entries"][number] = { line: index + 1, text, state: "invalid" };
    try {
      const normalized = normalizeMonitorUrl(text);
      const url = new URL(normalized ?? text);
      if (!["http:", "https:"].includes(url.protocol)) entry.state = "unsupported";
      else if (url.hostname && !url.username && !url.password && text.length <= 2048) {
        const key = canonicalMonitorUrl(url.href)!;
        entry.text = url.href;
        const previous = seen.get(key);
        if (previous) {
          entry.state = "duplicate";
          entry.duplicateName = previous.name;
          entry.duplicateLine = seenLines.get(key);
          duplicateCount++;
        } else {
          entry.state = "valid";
          seen.set(key, { name: extractNameFromUrl(url.href) });
          seenLines.set(key, index + 1);
          valid.push({ url: url.href, name: extractNameFromUrl(url.href) });
        }
      }
    } catch { /* Invalid partial input stays editable and appears in the preview. */ }
    if (entry.state === "invalid" || entry.state === "unsupported") invalidLines.push(text);
    entries.push(entry);
  }));
  return { valid, invalidLines, duplicateCount, entries, lineCount: raw ? lines.length : 0 };
}

export function MonitorBulkAddDialog({
	open,
	onOpenChange,
}: MonitorBulkAddDialogProps) {
	const client = useQueryClient();
  const { t, i18n } = useTranslation("uptimeMonitor");
  const validation = useFormValidation();
  const fieldId = useId();
	const bulkMutation = useCreateUptimeMonitorsBulk();



	const [urlsText, setUrlsText] = useState("");
	const [method, setMethod] = useState<UptimeMonitorMethod>("GET");
	const [interval, setInterval] = useState("300");
	const [expectedStatus, setExpectedStatus] = useState("200");
	const [timeout, setTimeout] = useState("10000");
	const [failureThreshold, setFailureThreshold] = useState(String(DEFAULT_FAILURE_THRESHOLD));
	const [tags, setTags] = useState<string[]>([]);
	const [tagInput, setTagInput] = useState("");
	const tagEntry = useTagEntry({ tags, setTags, input: tagInput, setInput: setTagInput });
  const values = { urlsText, method, interval, expectedStatus, timeout, failureThreshold, tags, tagInput };
  const draft = useDraftComparison(values, values, open);

	const existing = useUptimeMonitors({ enabled: open });
 const parsed = useMemo(() => parseUrls(urlsText, existing.data ?? []), [urlsText, existing.data]);
	const validCount = parsed.valid.length;
	const skippedCount = parsed.invalidLines.length + parsed.duplicateCount;
	const tooMany = validCount > MAX_BULK;

	const resetForm = () => {
    validation.clear();
		setUrlsText("");
		setMethod("GET");
		setInterval("300");
		setExpectedStatus("200");
		setTimeout("10000");
		setFailureThreshold("3");
		setTags([]);
		setTagInput("");
		tagEntry.reset();
	};

  const changeOpen = (next: boolean) => { if (!next) resetForm(); onOpenChange(next); };

	const handleRemoveTag = (tag: string) => {
		setTags(tags.filter((tg) => tg !== tag));
	};


	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (bulkMutation.isPending || validCount === 0 || tooMany || !validation.validate()) return;
    const statusFields = expectedStatusFields(expectedStatus);
    if (!statusFields) { validation.show([{ id: "bulk-expectedStatus", message: t("httpStatuses.invalid") }]); return; }


		const monitors: CreateUptimeMonitorInput[] = parsed.valid.map(
			({ url, name }) => ({
				name,
				url,
				method,
				interval: Number(interval),
				...statusFields,
				timeout: Number(timeout),
				failureThreshold: Number(failureThreshold),
				tags: tags.length > 0 ? tags : undefined,
			}),
		);

		try {
			const created = await bulkMutation.mutateAsync(monitors);
      if (!isSessionClientActive(client)) return;
			toast.success(
				t("bulkAdd.success", {
					defaultValue: "Created {{count}} monitors",
					count: created.length,
				}),
			);
			resetForm();
			onOpenChange(false);
		} catch (error) {
      if (!isSessionClientActive(client)) return;
      const hasFieldErrors = validation.server(error, { urls: "bulk-urls", expectedStatus: "bulk-expectedStatus", expectedStatuses: "bulk-expectedStatus", timeout: "bulk-timeout", failureThreshold: "bulk-failureThreshold", tags: "bulk-tags", interval: `${fieldId}-interval`, method: `${fieldId}-method` });

			if (!hasFieldErrors) toast.error(
				extractErrorMessage(
					error,
					t("bulkAdd.error", "Failed to create monitors"),
				),
			);
		}
	};

	return (
		<>
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent hasUnsavedChanges={draft.dirty} className={layoutTokens.createDialog}>
				<form {...draft.formProps} ref={validation.formRef} noValidate onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{t("bulkAdd.title", "Bulk add monitors")}</DialogTitle>
						<DialogDescription>
							{t(
								"bulkAdd.description",
								"Paste one URL per line. Each monitor is named from its hostname and uses the shared settings below.",
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-y-[var(--field-row-gap)] py-6">
            <FormErrorSummary issues={validation.issues} />
						<FormField className="form-field">
							<Label htmlFor="bulk-urls">
								{t("bulkAdd.urlsLabel", "URLs")}
							</Label>
							<Textarea
								id="bulk-urls" {...validation.field("bulk-urls")}
								value={urlsText}
								onChange={(e) => setUrlsText(e.target.value)}
								placeholder={t("formUX.example", { defaultValue: "Example: {{value}}", value: "https://example.com\nhttps://api.example.com/health\nhttps://blog.example.com" })}
								dir="ltr" rows={7} maxLength={110000} className="max-h-72 resize-y font-mono text-base leading-5 sm:text-sm"
							/>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
								<span>
									{t("bulkAdd.summary", {
										defaultValue: "{{valid}} valid, {{skipped}} skipped",
										valid: validCount,
										skipped: skippedCount,
									})}
								</span>
								{tooMany && (
									<span className="text-destructive">
										{t("bulkAdd.tooMany", {
											defaultValue: "Maximum {{max}} URLs at once",
											max: MAX_BULK,
										})}
									</span>
								)}
							</div>
              <p className="text-sm text-muted-foreground">{t("bulkUX.lines", { count: parsed.lineCount })} · {t("bulkUX.previewHelp")}</p>
              {parsed.entries.length > 0 && <Collapsible defaultOpen><CollapsibleTrigger>{t("bulkUX.preview")}</CollapsibleTrigger><CollapsibleContent><ol className="max-h-52 space-y-2 overflow-y-auto rounded-md border p-3 text-sm" aria-label={t("bulkUX.preview")}>{parsed.entries.map((entry, index) => <li key={index} className="grid min-w-0 gap-1"><p>{t("bulkUX.line", { number: entry.line })} · <span className={entry.state === "valid" ? "text-foreground" : "text-muted-foreground"}>{t(`bulkUX.${entry.state}`)}</span></p><bdi dir="ltr" className="break-all font-mono text-[13px]">{entry.text}</bdi>{entry.duplicateLine ? <p>{t("bulkUX.duplicateLine", { line: entry.duplicateLine })}</p> : entry.duplicateName ? <p>{t("creation.duplicateUrl", { name: entry.duplicateName })}</p> : null}</li>)}</ol></CollapsibleContent></Collapsible>}

						</FormField>

						<div className="form-grid grid-cols-1 sm:grid-cols-2">
							<FormField className="form-field">
								<Label htmlFor={`${fieldId}-method`}>{t("create.fields.method", "HTTP Method")}</Label>
								<Select
									value={method}
									onValueChange={(v) => setMethod(v as UptimeMonitorMethod)}
								>
									<SelectTrigger id={`${fieldId}-method`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{METHODS.map((m) => (
											<SelectItem key={m} value={m}>
												{m}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FormField>

							<FormField className="form-field">
								<Label htmlFor={`${fieldId}-interval`}>{t("create.fields.interval", "Check Interval")}</Label>
								<Select value={interval} onValueChange={setInterval}>
									<SelectTrigger id={`${fieldId}-interval`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{ALL_INTERVALS.map((i) => (
											<SelectItem key={i.value} value={i.value}>
												{formatInterval(Number(i.value), t, i18n.language)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FormField>
						</div>

						<div className="form-grid grid-cols-1 sm:grid-cols-3">
							<FormField label={t("create.fields.expectedStatus", "Expected Status")} control={<ExpectedStatusInput
									id="bulk-expectedStatus" {...validation.field("bulk-expectedStatus")} required
									value={expectedStatus}
									onChange={(e) => setExpectedStatus(e.target.value)}
								/>} />

							<FormField label={t("create.fields.timeout", "Timeout")} control={<Input
									id="bulk-timeout" {...validation.field("bulk-timeout")} validateOnBlur required
									type="number"
									min={1000}
									max={MAX_MONITOR_TIMEOUT_MS}
									step={1}
									value={timeout}
									onChange={(e) => setTimeout(e.target.value)}
								/>} helper={t("create.fields.timeoutDescription")} />

							<FormField label={t("create.fields.failureThreshold", "Threshold")} control={<Input
									id="bulk-failureThreshold" {...validation.field("bulk-failureThreshold")} validateOnBlur required
									type="number"
									min={1}
									max={10}
									value={failureThreshold}
									onChange={(e) => setFailureThreshold(e.target.value)}
								/>} helper={t("create.fields.failureThresholdDescription", { default: new Intl.NumberFormat(formattingLocale(i18n.language)).format(DEFAULT_FAILURE_THRESHOLD) })} />
						</div>

						<FormField className="form-field">
							<Label htmlFor="bulk-tags">{t("tags.label", "Tags")}</Label>
							<Input
								id="bulk-tags" {...validation.field("bulk-tags")}
								value={tagInput}
								onChange={tagEntry.onChange}
								onKeyDown={tagEntry.onKeyDown}
								onBlur={tagEntry.commit}
								aria-describedby="bulk-add-tags-feedback"
								placeholder={t("tags.placeholder", "Example: production")}
								disabled={tags.length >= 10}
							/>
							<p id="bulk-add-tags-feedback" role="status" className="text-xs text-muted-foreground">{tagEntry.feedback}</p>
							{tags.length > 0 && (
								<div className="flex flex-wrap gap-1">
									{tags.map((tag) => (
										<Badge
											key={tag}
											variant="secondary"
											className="min-h-[44px] gap-1 ps-3 pe-0"
										>
											{tag}
											<button
												type="button"
												onClick={() => handleRemoveTag(tag)}
												className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-md hover:bg-muted"
												aria-label={t("tags.remove", {
													defaultValue: "Remove {{tag}}",
													tag,
												})}
											>
												<X className="h-3 w-3" />
											</button>
										</Badge>
									))}
								</div>
							)}
						</FormField>
					</div>

					<div className="border-t py-3 text-sm text-muted-foreground">
            <p>{t("bulkUX.atomic")}</p>
          </div><DialogFooter>
						<Button
							type="button"
							variant="outline"
							data-dialog-discard onClick={() => changeOpen(false)}
							className="h-[44px] w-full sm:w-auto"
						>
							{t("actions.cancel", "Cancel")}
						</Button>
						<Button
							type="submit"
							disabled={bulkMutation.isPending || validCount === 0 || tooMany}
							className="h-[44px] w-full sm:w-auto"
						>
							{bulkMutation.isPending && (
								<Loader2 className="h-4 w-4 me-2 animate-spin" />
							)}
							{validCount === 0 ? t("bulkAdd.submitEmpty", "Add monitors") : formatCount((key, options) => t(key, { ...options, defaultValue: validCount === 1 ? "Add {{formattedCount}} monitor" : "Add {{formattedCount}} monitors" }), "bulkAdd.submit", validCount, i18n.language)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>

		</>
	);
}
