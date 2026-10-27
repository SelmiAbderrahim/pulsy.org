import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { FormField } from "@/components/ui/form-field";
import { formatInterval } from "@/lib/uptime/format";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { normalizeMonitorUrl, duplicateMonitor } from "@pulsy/db/monitor-url";
import { useUptimeMonitors } from "@/hooks/uptime/useUptimeMonitors";
import { DEFAULT_FAILURE_THRESHOLD } from "@pulsy/db/monitor-defaults";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "@/lib/toast";

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
import { useCreateUptimeMonitor } from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { extractNameFromUrl } from "@/lib/uptime/extract-name";

interface MonitorQuickAddProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdvanced?: (draft: { url: string; name: string }) => void;
}

export function MonitorQuickAdd({ open, onOpenChange, onAdvanced }: MonitorQuickAddProps) {
	const { t, i18n } = useTranslation("uptimeMonitor");
	const createMutation = useCreateUptimeMonitor();
 const client = useQueryClient();
 const existing = useUptimeMonitors({ enabled: open });
	const navigate = useNavigate();

	const [url, setUrl] = useState("");
	const [name, setName] = useState("");
	const validation = useFormValidation(() => url.trim() && !normalizeMonitorUrl(url) ? [{ id: "quick-url", message: t("creation.invalidUrl") }] : []);
	const [formError, setFormError] = useState("");
	const fieldMessage = (id: string) => { const issue = validation.issues.find(issue => issue.id === id); return issue ? <p className="text-sm text-destructive">{issue.message}</p> : null; };

	const defaultInterval = 300;

	const autoName = extractNameFromUrl(url);
	const effectiveName = name.trim() || autoName;

	const resetForm = () => {
		setUrl("");
		setName("");
		validation.clear(); setFormError("");
	};

	useEffect(() => { if (!open) resetForm(); }, [open]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (createMutation.isPending) return;
    setFormError("");
    if (!validation.validate()) return;
		validation.clear(); setFormError("");

    const normalizedUrl = normalizeMonitorUrl(url);
    if (!normalizedUrl) { validation.show([{ id: "quick-url", message: t("creation.invalidUrl") }]); return; }
    const duplicate = duplicateMonitor(normalizedUrl, existing.data ?? []);
    if (duplicate) { validation.show([{ id: "quick-url", message: t("creation.duplicateUrl", { name: duplicate.name }) }]); return; }
    setUrl(normalizedUrl);
		try {
			const created = await createMutation.mutateAsync({
				name: effectiveName,
				url: normalizedUrl,
				method: "GET",
				expectedStatus: 200,
				timeout: 10000,
				interval: defaultInterval,
				failureThreshold: DEFAULT_FAILURE_THRESHOLD,
			});
 if (!isSessionClientActive(client)) return;
			toast.success(t("create.success", "Monitor created. It stays Pending until its first check completes."), {
				action: {
					label: t("quickAdd.setupNotifications", "Set up notifications"),
					onClick: () => {
 if (!isSessionClientActive(client)) return;
						navigate({
							to: "/dashboard/uptime/$monitorId",
							params: { monitorId: created.uptimeMonitorId },
							search: { tab: "alerts" },
						});
					},
				},
			});
			resetForm();
			onOpenChange(false);
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			if (validation.server(error, { url: "quick-url", name: "quick-name" })) return;
			const message = extractErrorMessage(error, t("create.error", "Failed to create monitor"));
			setFormError(message); toast.error(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={layoutTokens.createDialog}>
				<form ref={validation.formRef} noValidate onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>
							{t("quickAdd.title", "Quick add monitor")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"quickAdd.description",
								"Add a monitor with sensible defaults. Customize settings later.",
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
            <FormErrorSummary issues={validation.issues} />
						{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
						<FormField className="form-field">
							<Label htmlFor="quick-url">
								{t("create.fields.url", "URL")}
							</Label>
							<Input
								id="quick-url" validateOnBlur
								{...validation.field("quick-url")}
								type="text" inputMode="url" onBlur={() => { const normalized = normalizeMonitorUrl(url); if (normalized) setUrl(normalized); }}
								dir="ltr" autoComplete="url"
								value={url}
								onChange={(e) => { setUrl(e.target.value); setFormError(""); }}
								placeholder={t("formUX.example", { defaultValue: "Example: {{value}}", value: "https://example.com/health" })}
								required
							/>
							{url.trim() && fieldMessage("quick-url")}
						</FormField>

						<FormField className="form-field">
							<Label htmlFor="quick-name">
								{t("create.fields.name", "Name")}
							</Label>
							<Input
								id="quick-name" maxLength={255} {...validation.field("quick-name", "quick-name-help")}
								value={name}
								onChange={(e) => { setName(e.target.value); setFormError(""); }}
								placeholder={autoName ? t("formUX.example", { defaultValue: "Example: {{value}}", value: autoName }) : t("quickAdd.namePlaceholder", "Example: Website")}
							/>
							<p id="quick-name-help" className="text-sm text-muted-foreground">{t("creation.nameOptional")}</p>
							{fieldMessage("quick-name")}
						</FormField>

						<p className="text-sm text-muted-foreground">
							{t("quickAdd.defaultsWithInterval", {
								defaultValue: "Checks every {{interval}} · Method: GET · Expect: 200",
								interval: formatInterval(defaultInterval, t, i18n.language),
							})}
							<br />
							{t(
								"creation.quickPolicy",
							)}
						</p>
					</div>

					<DialogFooter className="flex-col items-stretch border-t pt-3 sm:flex-wrap sm:items-center sm:justify-between">
						{onAdvanced && <Button type="button" variant="link" className="max-w-full justify-start whitespace-normal px-0 text-start sm:me-auto" disabled={createMutation.isPending} onClick={() => onAdvanced({ url, name })}>{t("creation.continueAdvanced")}</Button>}
						<div className="flex flex-col-reverse gap-2 sm:ms-auto sm:flex-row sm:items-center">
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
							disabled={createMutation.isPending}
							className="h-[44px] w-full sm:w-auto"
						>
							{createMutation.isPending && (
								<Loader2 className="h-4 w-4 me-2 animate-spin" />
							)}
							{t("quickAdd.submit", "Add monitor")}
						</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
