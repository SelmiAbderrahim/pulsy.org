/**
 * Bulk Add dialog — create many monitors at once from a list of URLs.
 *
 * The user pastes one URL per line; each monitor's name is auto-derived from its
 * hostname. A single shared settings panel (method, interval, expected status,
 * timeout, failure threshold, tags) is applied to every monitor in the batch.
 *
 * @module components/uptime/monitor-bulk-add-dialog
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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

interface ParsedUrls {
	/** Unique, valid URLs with an auto-derived name. */
	valid: { url: string; name: string }[];
	/** Lines that aren't valid URLs (kept for inline feedback). */
	invalidLines: string[];
	/** Count of duplicate URLs that were collapsed. */
	duplicateCount: number;
}

function parseUrls(raw: string): ParsedUrls {
	const seen = new Set<string>();
	const valid: { url: string; name: string }[] = [];
	const invalidLines: string[] = [];
	let duplicateCount = 0;

	for (const token of raw.split(/\s+/)) {
		const trimmed = token.trim();
		if (!trimmed) continue;

		const name = extractNameFromUrl(trimmed);
		if (!name) {
			// extractNameFromUrl returns "" only when `new URL()` throws.
			invalidLines.push(trimmed);
			continue;
		}

		const normalized = new URL(trimmed).href;
		if (seen.has(normalized)) {
			duplicateCount += 1;
			continue;
		}
		seen.add(normalized);
		valid.push({ url: normalized, name });
	}

	return { valid, invalidLines, duplicateCount };
}

export function MonitorBulkAddDialog({
	open,
	onOpenChange,
}: MonitorBulkAddDialogProps) {
	const { t } = useTranslation("uptimeMonitor");
	const bulkMutation = useCreateUptimeMonitorsBulk();

	const [urlsText, setUrlsText] = useState("");
	const [method, setMethod] = useState<UptimeMonitorMethod>("GET");
	const [interval, setInterval] = useState("300");
	const [expectedStatus, setExpectedStatus] = useState("200");
	const [timeout, setTimeout] = useState("10000");
	const [failureThreshold, setFailureThreshold] = useState("3");
	const [tags, setTags] = useState<string[]>([]);
	const [tagInput, setTagInput] = useState("");

	const parsed = useMemo(() => parseUrls(urlsText), [urlsText]);
	const validCount = parsed.valid.length;
	const skippedCount = parsed.invalidLines.length + parsed.duplicateCount;
	const tooMany = validCount > MAX_BULK;

	const resetForm = () => {
		setUrlsText("");
		setMethod("GET");
		setInterval("300");
		setExpectedStatus("200");
		setTimeout("10000");
		setFailureThreshold("3");
		setTags([]);
		setTagInput("");
	};

	const handleAddTag = () => {
		const trimmed = tagInput.trim();
		if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
			setTags([...tags, trimmed]);
			setTagInput("");
		}
	};

	const handleRemoveTag = (tag: string) => {
		setTags(tags.filter((tg) => tg !== tag));
	};

	const handleTagKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleAddTag();
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (validCount === 0 || tooMany) return;

		const monitors: CreateUptimeMonitorInput[] = parsed.valid.map(
			({ url, name }) => ({
				name,
				url,
				method,
				interval: Number(interval),
				expectedStatus: Number(expectedStatus),
				timeout: Number(timeout),
				failureThreshold: Number(failureThreshold),
				tags: tags.length > 0 ? tags : undefined,
			}),
		);

		try {
			const created = await bulkMutation.mutateAsync(monitors);
			toast.success(
				t("bulkAdd.success", {
					defaultValue: "Created {{count}} monitors",
					count: created.length,
				}),
			);
			resetForm();
			onOpenChange(false);
		} catch (error) {
			toast.error(
				extractErrorMessage(
					error,
					t("bulkAdd.error", "Failed to create monitors"),
				),
			);
		}
	};

	return (
		<>
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[560px]">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{t("bulkAdd.title", "Bulk Add Monitors")}</DialogTitle>
						<DialogDescription>
							{t(
								"bulkAdd.description",
								"Paste one URL per line. Each monitor is named from its hostname and uses the shared settings below.",
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="bulk-urls">
								{t("bulkAdd.urlsLabel", "URLs")}
							</Label>
							<Textarea
								id="bulk-urls"
								value={urlsText}
								onChange={(e) => setUrlsText(e.target.value)}
								placeholder={t("bulkAdd.urlsPlaceholder", {
									defaultValue:
										"https://example.com\nhttps://api.example.com/health\nhttps://blog.example.com",
								})}
								className="min-h-[180px] resize-y font-mono text-sm sm:min-h-[140px]"
								autoFocus
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
							{parsed.invalidLines.length > 0 && (
								<div className="grid gap-1">
									<p className="text-xs font-medium text-muted-foreground">
										{t("bulkAdd.invalidLabel", "Skipped (not valid URLs):")}
									</p>
									<div className="flex flex-wrap gap-1">
										{parsed.invalidLines.slice(0, 8).map((line, i) => (
											<Badge
												key={`${line}-${i}`}
												variant="outline"
												className="max-w-[200px] truncate border-destructive/40 text-destructive"
											>
												{line}
											</Badge>
										))}
										{parsed.invalidLines.length > 8 && (
											<Badge variant="outline">
												+{parsed.invalidLines.length - 8}
											</Badge>
										)}
									</div>
								</div>
							)}
						</div>

						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label>{t("create.fields.method", "HTTP Method")}</Label>
								<Select
									value={method}
									onValueChange={(v) => setMethod(v as UptimeMonitorMethod)}
								>
									<SelectTrigger>
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
							</div>

							<div className="grid gap-2">
								<Label>{t("create.fields.interval", "Check Interval")}</Label>
								<Select value={interval} onValueChange={setInterval}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{ALL_INTERVALS.map((i) => (
											<SelectItem key={i.value} value={i.value}>
												{t(`intervals.${i.value}`, i.label)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<div className="grid gap-2">
								<Label htmlFor="bulk-expectedStatus">
									{t("create.fields.expectedStatus", "Expected Status")}
								</Label>
								<Input
									id="bulk-expectedStatus"
									type="number"
									min={100}
									max={599}
									value={expectedStatus}
									onChange={(e) => setExpectedStatus(e.target.value)}
								/>
							</div>

							<div className="grid gap-2">
								<Label htmlFor="bulk-timeout">
									{t("create.fields.timeout", "Timeout")}
								</Label>
								<Input
									id="bulk-timeout"
									type="number"
									min={1000}
									max={60000}
									step={1000}
									value={timeout}
									onChange={(e) => setTimeout(e.target.value)}
								/>
							</div>

							<div className="grid gap-2">
								<Label htmlFor="bulk-failureThreshold">
									{t("create.fields.failureThreshold", "Threshold")}
								</Label>
								<Input
									id="bulk-failureThreshold"
									type="number"
									min={1}
									max={10}
									value={failureThreshold}
									onChange={(e) => setFailureThreshold(e.target.value)}
								/>
							</div>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="bulk-tags">{t("tags.label", "Tags")}</Label>
							<Input
								id="bulk-tags"
								value={tagInput}
								onChange={(e) => setTagInput(e.target.value)}
								onKeyDown={handleTagKeyDown}
								onBlur={handleAddTag}
								placeholder={t("tags.placeholder", "Add a tag...")}
								disabled={tags.length >= 10}
							/>
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
						</div>
					</div>

					<DialogFooter className="border-t pt-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
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
							{t("bulkAdd.submit", {
								defaultValue: "Add {{count}} Monitors",
								count: validCount,
							})}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
		</>
	);
}
