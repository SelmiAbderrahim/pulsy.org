/**
 * Bulk-edit monitor settings dialog.
 *
 * Opened from the monitor list's bulk-selection toolbar. Applies the same
 * config patch (method, interval, expected status, timeout, failure threshold,
 * tags) to every selected monitor in a single server call. Each field is
 * opt-in via an "Apply" checkbox — only enabled fields are sent, so disabled
 * fields keep each monitor's current value. Tags replace existing tags.
 *
 * @module components/uptime/bulk-edit-settings-dialog
 */

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useBulkUpdateUptimeSettings } from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type {
	BulkUpdateUptimeMonitorPatch,
	UptimeMonitor,
	UptimeMonitorMethod,
} from "@/types/uptime";

const METHODS: UptimeMonitorMethod[] = ["GET", "HEAD", "POST"];
const INTERVALS = ["30", "60", "300", "600", "1800", "3600"] as const;

type FieldKey =
	| "method"
	| "interval"
	| "expectedStatus"
	| "timeout"
	| "failureThreshold"
	| "tags";

interface BulkEditSettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	monitors: UptimeMonitor[];
	/** Called after a successful bulk update (e.g. to clear selection). */
	onUpdated?: () => void;
}

export function BulkEditSettingsDialog({
	open,
	onOpenChange,
	monitors,
	onUpdated,
}: BulkEditSettingsDialogProps) {
	const { t } = useTranslation("uptimeMonitor");
	const updateMutation = useBulkUpdateUptimeSettings();

	// Which fields are enabled ("Apply"). Disabled fields are never sent.
	const [enabled, setEnabled] = useState<Record<FieldKey, boolean>>({
		method: false,
		interval: false,
		expectedStatus: false,
		timeout: false,
		failureThreshold: false,
		tags: false,
	});

	const [method, setMethod] = useState<UptimeMonitorMethod>("GET");
	const [interval, setInterval] = useState<string>("300");
	const [expectedStatus, setExpectedStatus] = useState("200");
	const [timeout, setTimeout] = useState("10000");
	const [failureThreshold, setFailureThreshold] = useState("3");
	const [tags, setTags] = useState<string[]>([]);
	const [tagInput, setTagInput] = useState("");

	// Reset the form each time the dialog opens.
	useEffect(() => {
		if (open) {
			setEnabled({
				method: false,
				interval: false,
				expectedStatus: false,
				timeout: false,
				failureThreshold: false,
				tags: false,
			});
			setMethod("GET");
			setInterval("300");
			setExpectedStatus("200");
			setTimeout("10000");
			setFailureThreshold("3");
			setTags([]);
			setTagInput("");
		}
	}, [open]);

	const toggleField = (key: FieldKey) =>
		setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));

	const handleAddTag = () => {
		const trimmed = tagInput.trim();
		// Backend Zod caps tags at 10 and surfaces an error toast if exceeded.
		if (trimmed && !tags.includes(trimmed)) {
			setTags([...tags, trimmed]);
			setTagInput("");
		}
	};

	const handleTagKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleAddTag();
		}
	};

	const anyEnabled = Object.values(enabled).some(Boolean);

	const buildPatch = (): BulkUpdateUptimeMonitorPatch => {
		const patch: BulkUpdateUptimeMonitorPatch = {};
		if (enabled.method) patch.method = method;
		if (enabled.interval) patch.interval = Number(interval);
		if (enabled.expectedStatus) patch.expectedStatus = Number(expectedStatus);
		if (enabled.timeout) patch.timeout = Number(timeout);
		if (enabled.failureThreshold)
			patch.failureThreshold = Number(failureThreshold);
		// Tags replace existing tags on each monitor (may be an empty array).
		if (enabled.tags) patch.tags = tags;
		return patch;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!anyEnabled) return;
		try {
			const updated = await updateMutation.mutateAsync({
				monitorIds: monitors.map((m) => m.uptimeMonitorId),
				patch: buildPatch(),
			});
			toast.success(
				t("bulk.edit.success", "Updated {{count}} monitors", {
					count: updated.length,
				}),
			);
			onUpdated?.();
			onOpenChange(false);
		} catch (error) {
			toast.error(
				extractErrorMessage(
					error,
					t("bulk.edit.error", "Failed to update monitors"),
				),
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>
							{t("bulk.edit.title", "Edit settings")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"bulk.edit.description",
								"Apply these settings to {{count}} selected monitors. Only the fields you enable are changed.",
								{ count: monitors.length },
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						{/* Method */}
						<FieldRow
							id="bulk-method"
							label={t("create.fields.method", "Method")}
							checked={enabled.method}
							onToggle={() => toggleField("method")}
							toggleLabel={t("bulk.edit.apply", "Apply")}
						>
							<Select
								value={method}
								onValueChange={(v) => setMethod(v as UptimeMonitorMethod)}
								disabled={!enabled.method}
							>
								<SelectTrigger id="bulk-method">
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
						</FieldRow>

						{/* Interval */}
						<FieldRow
							id="bulk-interval"
							label={t("create.fields.interval", "Check interval")}
							checked={enabled.interval}
							onToggle={() => toggleField("interval")}
							toggleLabel={t("bulk.edit.apply", "Apply")}
						>
							<Select
								value={interval}
								onValueChange={setInterval}
								disabled={!enabled.interval}
							>
								<SelectTrigger id="bulk-interval">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{INTERVALS.map((i) => (
										<SelectItem key={i} value={i}>
											{t(`intervals.${i}`, `${i} seconds`)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</FieldRow>

						{/* Expected status */}
						<FieldRow
							id="bulk-expected"
							label={t("create.fields.expectedStatus", "Expected status")}
							checked={enabled.expectedStatus}
							onToggle={() => toggleField("expectedStatus")}
							toggleLabel={t("bulk.edit.apply", "Apply")}
						>
							<Input
								id="bulk-expected"
								type="number"
								min={100}
								max={599}
								value={expectedStatus}
								onChange={(e) => setExpectedStatus(e.target.value)}
								disabled={!enabled.expectedStatus}
							/>
						</FieldRow>

						{/* Timeout */}
						<FieldRow
							id="bulk-timeout"
							label={t("create.fields.timeout", "Timeout (ms)")}
							checked={enabled.timeout}
							onToggle={() => toggleField("timeout")}
							toggleLabel={t("bulk.edit.apply", "Apply")}
						>
							<Input
								id="bulk-timeout"
								type="number"
								min={1000}
								max={60000}
								step={1000}
								value={timeout}
								onChange={(e) => setTimeout(e.target.value)}
								disabled={!enabled.timeout}
							/>
						</FieldRow>

						{/* Failure threshold */}
						<FieldRow
							id="bulk-threshold"
							label={t("create.fields.failureThreshold", "Failure threshold")}
							checked={enabled.failureThreshold}
							onToggle={() => toggleField("failureThreshold")}
							toggleLabel={t("bulk.edit.apply", "Apply")}
						>
							<Input
								id="bulk-threshold"
								type="number"
								min={1}
								max={10}
								value={failureThreshold}
								onChange={(e) => setFailureThreshold(e.target.value)}
								disabled={!enabled.failureThreshold}
							/>
						</FieldRow>

						{/* Tags (replace) */}
						<FieldRow
							id="bulk-tags"
							label={t("tags.label", "Tags")}
							checked={enabled.tags}
							onToggle={() => toggleField("tags")}
							toggleLabel={t("bulk.edit.apply", "Apply")}
						>
							<>
								<Input
									id="bulk-tags"
									value={tagInput}
									onChange={(e) => setTagInput(e.target.value)}
									onKeyDown={handleTagKeyDown}
									onBlur={handleAddTag}
									placeholder={t("tags.placeholder", "Add a tag...")}
									disabled={!enabled.tags}
								/>
								{enabled.tags && (
									<p className="text-xs text-muted-foreground">
										{t(
											"bulk.edit.tagsReplaceHint",
											"Replaces existing tags on every selected monitor.",
										)}
									</p>
								)}
								{enabled.tags && tags.length > 0 && (
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
													onClick={() =>
														setTags(tags.filter((x) => x !== tag))
													}
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
							</>
						</FieldRow>
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
							disabled={!anyEnabled || updateMutation.isPending}
							className="h-[44px] w-full sm:w-auto"
						>
							{updateMutation.isPending && (
								<Loader2 className="h-4 w-4 me-2 animate-spin" />
							)}
							{t("bulk.edit.submit", "Apply to {{count}} monitors", {
								count: monitors.length,
							})}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface FieldRowProps {
	id: string;
	label: string;
	toggleLabel: string;
	checked: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}

function FieldRow({
	id,
	label,
	toggleLabel,
	checked,
	onToggle,
	children,
}: FieldRowProps) {
	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={id} className={checked ? "" : "text-muted-foreground"}>
					{label}
				</Label>
				<label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
					<Checkbox checked={checked} onCheckedChange={onToggle} />
					{toggleLabel}
				</label>
			</div>
			{children}
		</div>
	);
}
