import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { FormField } from "@/components/ui/form-field";
import { formattingLocale } from "@/lib/formatting-locale";
import { formatInterval } from "@/lib/uptime/format";
import { formatMilliseconds } from "@/lib/uptime/number-format";
import { BulkNameList } from "@/components/dashboard/settings/common/BulkNameList";
import { MAX_MONITOR_TIMEOUT_MS } from "@pulsy/db/monitor-defaults";
import { expectedStatusFields } from "@pulsy/db/http-status-rule";
import { ExpectedStatusInput } from "@/components/uptime/expected-status-input";
import { DEFAULT_FAILURE_THRESHOLD } from "@pulsy/db/monitor-defaults";
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
import { toast } from "@/lib/toast";

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
import { useTagEntry } from "@/hooks/uptime/useTagEntry";
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
	const client = useQueryClient();
  const { t, i18n } = useTranslation("uptimeMonitor");
	const updateMutation = useBulkUpdateUptimeSettings();
  const validation = useFormValidation();

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
	const [failureThreshold, setFailureThreshold] = useState(String(DEFAULT_FAILURE_THRESHOLD));
	const [tags, setTags] = useState<string[]>([]);
	const [tagInput, setTagInput] = useState("");
	const tagEntry = useTagEntry({ tags, setTags, input: tagInput, setInput: setTagInput });

	const draft = useDraftComparison({ enabled, method, interval, expectedStatus, timeout, failureThreshold, tags, tagInput }, { enabled: { method: false, interval: false, expectedStatus: false, timeout: false, failureThreshold: false, tags: false }, method: "GET", interval: "300", expectedStatus: "200", timeout: "10000", failureThreshold: String(DEFAULT_FAILURE_THRESHOLD), tags: [] as string[], tagInput: "" }, open);

	// Reset the form each time the dialog opens.
	useEffect(() => {
		if (open) {
      validation.clear();
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
			tagEntry.reset();
		}
	}, [open]);

	const toggleField = (key: FieldKey) =>
		setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));

	const anyEnabled = Object.values(enabled).some(Boolean);
  const uniqueMonitors = [...new Map(monitors.map(monitor => [monitor.uptimeMonitorId, monitor])).values()];
  const supportsField = (monitor: UptimeMonitor, field: FieldKey) => {
    if (field === "tags") return true;
    if (field === "interval" || field === "timeout" || field === "failureThreshold") return monitor.monitorType !== "heartbeat" && monitor.monitorType !== "server";
    return monitor.monitorType === undefined || monitor.monitorType === "http";
  };
  const applicable = (field: FieldKey) => uniqueMonitors.filter(monitor => supportsField(monitor, field));
  const fieldApplicable = (field: FieldKey) => applicable(field).length > 0;
  const appliedCount = uniqueMonitors.filter(monitor => (Object.keys(enabled) as FieldKey[]).some(field => enabled[field] && supportsField(monitor, field))).length;
  const resultLabel = (applied: number, skipped: number) => t("bulk.edit.result", "Updated: {{applied}} · Skipped: {{skipped}}", { applied: new Intl.NumberFormat(formattingLocale(i18n.language)).format(applied), skipped: new Intl.NumberFormat(formattingLocale(i18n.language)).format(skipped) });
  const fieldLabels: Record<FieldKey, string> = { method: t("create.fields.method"), interval: t("create.fields.interval"), expectedStatus: t("create.fields.expectedStatus"), timeout: t("create.fields.timeout"), failureThreshold: t("create.fields.failureThreshold"), tags: t("tags.label") };

  const changedFields = (Object.keys(enabled) as FieldKey[]).filter(field => enabled[field] && fieldApplicable(field));
  // Human-readable value for each field that will change (never raw JSON).
  const fieldValue = (field: FieldKey) => {
    if (field === "method") return method;
    if (field === "interval") return formatInterval(Number(interval), t, i18n.language);
    if (field === "expectedStatus") return expectedStatus;
    if (field === "timeout") return formatMilliseconds(Number(timeout), i18n.language) ?? timeout;
    if (field === "failureThreshold") return new Intl.NumberFormat(formattingLocale(i18n.language)).format(Number(failureThreshold));
    return tags.length ? tags.join(", ") : t("tags.noTags");
  };

	const buildPatch = (): BulkUpdateUptimeMonitorPatch => {
		const patch: BulkUpdateUptimeMonitorPatch = {};
		if (enabled.method) patch.method = method;
		if (enabled.interval) patch.interval = Number(interval);
		if (enabled.expectedStatus) Object.assign(patch, expectedStatusFields(expectedStatus));
		if (enabled.timeout) patch.timeout = Number(timeout);
		if (enabled.failureThreshold)
			patch.failureThreshold = Number(failureThreshold);
		// Tags replace existing tags on each monitor (may be an empty array).
		if (enabled.tags) patch.tags = tags;
		return patch;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!anyEnabled || appliedCount === 0 || updateMutation.isPending || !validation.validate()) return;
    if (enabled.expectedStatus && !expectedStatusFields(expectedStatus)) { validation.show([{ id: "bulk-expected", message: t("httpStatuses.invalid") }]); return; }
		try {
			const result = await updateMutation.mutateAsync({
				monitorIds: uniqueMonitors.map((m) => m.uptimeMonitorId),
				patch: buildPatch(),
			});
			if (!isSessionClientActive(client)) return;
      const rejected = result.results.filter(item=>item.status === "rejected");
			if (result.updated.length) toast.success(resultLabel(result.updated.length, uniqueMonitors.length - result.updated.length));
			if (rejected.length) {
        toast.error([...new Set(rejected.map(item=>item.reason ?? t("bulk.edit.error")))].join(" "));
        return;
      }
			onUpdated?.();
			onOpenChange(false);
		} catch (error) {
      if (!isSessionClientActive(client)) return;
      const hasFieldErrors = validation.server(error, { expectedStatus: "bulk-expected", expectedStatuses: "bulk-expected", timeout: "bulk-timeout", failureThreshold: "bulk-threshold", tags: "bulk-tags", interval: "bulk-interval", method: "bulk-method" });
			if (!hasFieldErrors) toast.error(
				extractErrorMessage(
					error,
					t("bulk.edit.error", "Failed to update monitors"),
				),
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent hasUnsavedChanges={draft.dirty} className="sm:max-w-[var(--dialog-standard)]">
				<form {...draft.formProps} ref={validation.formRef} noValidate onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>
							{t("bulk.edit.title", "Edit settings")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"bulk.edit.description",
								"Apply these settings to {{count}} selected monitors. Only the fields you enable are changed.",
								{ count: uniqueMonitors.length },
							)}
						</DialogDescription>
					</DialogHeader>

					<BulkNameList
						className="mt-4"
						showLabel
						label={t("bulk.edit.affected", { count: uniqueMonitors.length })}
						items={uniqueMonitors.map(monitor => ({ id: monitor.uptimeMonitorId, name: monitor.name, detail: monitor.monitorType === "heartbeat" ? t("heartbeat.title") : monitor.monitorType === "server" ? t("server.title") : (monitor.monitorType ?? "http").toUpperCase() }))}
					/>

					<div className="grid gap-y-[var(--field-row-gap)] py-6">
            <FormErrorSummary issues={validation.issues} />
						{/* Method */}
						{fieldApplicable("method") &&
						<FieldRow
							id="bulk-method"
							label={t("create.fields.method", "Method")}
							checked={enabled.method}
							onToggle={() => toggleField("method")}
							toggleLabel={t("bulk.edit.change")}
						>
							<Select
								value={method}
								onValueChange={(v) => setMethod(v as UptimeMonitorMethod)}
								disabled={!enabled.method}
							>
								<SelectTrigger id="bulk-method" {...validation.field("bulk-method")}>
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
						</FieldRow>}

						{/* Interval */}
						{fieldApplicable("interval") &&
						<FieldRow
							id="bulk-interval"
							label={t("create.fields.interval", "Check interval")}
							checked={enabled.interval}
							onToggle={() => toggleField("interval")}
							toggleLabel={t("bulk.edit.change")}
						>
							<Select
								value={interval}
								onValueChange={setInterval}
								disabled={!enabled.interval}
							>
								<SelectTrigger id="bulk-interval" {...validation.field("bulk-interval")}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{INTERVALS.map((i) => (
										<SelectItem key={i} value={i}>
											{formatInterval(Number(i), t, i18n.language)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</FieldRow>}

						{/* Expected status */}
						{fieldApplicable("expectedStatus") &&
						<FieldRow
							id="bulk-expected"
							label={t("create.fields.expectedStatus", "Expected status")}
							checked={enabled.expectedStatus}
							onToggle={() => toggleField("expectedStatus")}
							toggleLabel={t("bulk.edit.change")}
						>
							<ExpectedStatusInput
								id="bulk-expected" {...validation.field("bulk-expected")}
								value={expectedStatus}
								onChange={(e) => setExpectedStatus(e.target.value)}
								disabled={!enabled.expectedStatus}
							/>
						</FieldRow>}

						{/* Timeout */}
						{fieldApplicable("timeout") &&
						<FieldRow
							id="bulk-timeout"
							label={t("create.fields.timeout", "Timeout (ms)")}
							checked={enabled.timeout}
							onToggle={() => toggleField("timeout")}
							toggleLabel={t("bulk.edit.change")}
						>
							<Input
								id="bulk-timeout" {...validation.field("bulk-timeout")} required
								type="number"
								min={1000}
								max={MAX_MONITOR_TIMEOUT_MS}
								step={1000}
								value={timeout}
								onChange={(e) => setTimeout(e.target.value)}
								disabled={!enabled.timeout}
							/>
						</FieldRow>}

						{/* Failure threshold */}
						{fieldApplicable("failureThreshold") &&
						<FieldRow
							id="bulk-threshold"
							label={t("create.fields.failureThreshold", "Failure threshold")}
							checked={enabled.failureThreshold}
							onToggle={() => toggleField("failureThreshold")}
							toggleLabel={t("bulk.edit.change")}
						>
							<Input
								id="bulk-threshold" {...validation.field("bulk-threshold")} required
								type="number"
								min={1}
								max={10}
								value={failureThreshold}
								onChange={(e) => setFailureThreshold(e.target.value)}
								disabled={!enabled.failureThreshold}
							/>
						</FieldRow>}

						{/* Tags (replace) */}
						{fieldApplicable("tags") &&
						<FieldRow
							id="bulk-tags"
							label={t("tags.label", "Tags")}
							checked={enabled.tags}
							onToggle={() => toggleField("tags")}
							toggleLabel={t("bulk.edit.change")}
						>
							<>
								<Input
									id="bulk-tags" {...validation.field("bulk-tags")}
									value={tagInput}
									onChange={tagEntry.onChange}
									onKeyDown={tagEntry.onKeyDown}
									onBlur={tagEntry.commit}
									aria-describedby="bulk-tags-feedback"
									placeholder={t("tags.placeholder", "Example: production")}
									disabled={!enabled.tags}
								/>
								<p id="bulk-tags-feedback" role="status" className="text-xs text-muted-foreground">{tagEntry.feedback}</p>
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
						</FieldRow>}
					</div>

					<section aria-label={t("bulk.edit.preview")} className="mb-4 grid gap-3 rounded-md border p-4">
            <h3 className="font-medium">{t("bulk.edit.changesHeading")}</h3>
            {changedFields.length === 0 ? <p className="text-sm text-muted-foreground">{t("bulk.edit.noChanges")}</p> : <dl className="grid gap-2 text-sm">{changedFields.map(field => <div key={field} className="grid gap-0.5"><div className="flex flex-wrap justify-between gap-2"><dt className="font-medium">{fieldLabels[field]}</dt><dd dir="auto" className="break-words">{fieldValue(field)}</dd></div><p className="text-xs text-muted-foreground">{t("bulk.edit.appliesTo", "Applies to {{count}} of {{total}} selected", { count: applicable(field).length, total: uniqueMonitors.length })}</p></div>)}</dl>}
          </section>
          <DialogFooter className="border-t pt-3">
						<Button
							type="button"
							variant="outline"
							data-dialog-discard onClick={() => onOpenChange(false)}
							className="h-[44px] w-full sm:w-auto"
						>
							{t("actions.cancel", "Cancel")}
						</Button>
						<Button
							type="submit"
							disabled={!anyEnabled || appliedCount === 0 || updateMutation.isPending}
							className="h-[44px] w-full sm:w-auto"
						>
							{updateMutation.isPending && (
								<Loader2 className="h-4 w-4 me-2 animate-spin" />
							)}
							{t("bulk.edit.submit", "Apply to {{count}} monitors", {
								count: uniqueMonitors.length,
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
		<FormField className="form-field">
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={id} className={checked ? "" : "text-muted-foreground"}>
					{label}
				</Label>
				<label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
					<Checkbox aria-label={`${toggleLabel}: ${label}`} checked={checked} onCheckedChange={onToggle} />
					{toggleLabel}
				</label>
			</div>
			{children}
		</FormField>
	);
}
