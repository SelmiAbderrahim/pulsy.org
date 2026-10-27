import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { Unit } from "@/components/ui/unit";
import { formattingLocale } from "@/lib/formatting-locale";
import { FormField } from "@/components/ui/form-field";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useAccountTimezone } from "@/components/account-timezone";
import { dateTimeFormat, formatTimezone } from "@/lib/date-format";
/**
 * SLA Report tab — on-demand report view + PDF download + monthly-email
 * subscription controls. Available to every account.
 *
 * @module components/uptime/monitor-detail/tabs/sla-report-tab
 */

import { formatMilliseconds, formatPercent } from "@/lib/uptime/number-format";
import { Download, FileJson, FileSpreadsheet, FileText, Loader2, RefreshCw, Send, Trash2 } from "lucide-react";
import { downloadText, slaReportToCsv, slaReportToJson } from "@/lib/uptime/sla-report-export";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

import { EmailProvidersSection } from "./email-providers-section";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	useRemoveUptimeSlaReportSubscription,
	useSendUptimeSlaReportNow,
	useUptimeEmailProviders,
	useUptimeSlaReport,
	useDownloadUptimeSlaReport,
	useUptimeSlaReportSubscriptions,
	useUpsertUptimeSlaReportSubscription,
} from "@/hooks/uptime";
import type {
	SlaReport,
	SlaReportSubscription,
	UptimeEmailProvider,
} from "@/types/uptime";

const REPORT_DAYS = 30;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function LoaderBlock() {
	return (
		<div className="flex items-center justify-center py-12">
			<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
		</div>
	);
}

function fmtMs(value: number | null, locale: string): string {
	return formatMilliseconds(value, locale) ?? "—";
}

export function SlaReportTab({ monitorId }: { monitorId: string }) {
  return <SlaReportContent monitorId={monitorId} />;
}

function SlaReportContent({ monitorId }: { monitorId: string }) {
  const accountTimezone = useAccountTimezone();
	const { t, i18n } = useTranslation("uptimeMonitor");
	const { data: report, isLoading, isFetching, error, refetch } = useUptimeSlaReport(monitorId, REPORT_DAYS);
	const { data: subscriptions, isLoading: subsLoading } =
		useUptimeSlaReportSubscriptions();
	const { data: providers } = useUptimeEmailProviders();

	if (isLoading || subsLoading) {
		return <LoaderBlock />;
	}

	if (!report) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
				<FileText className="mb-3 h-10 w-10 text-muted-foreground" />
				<p className="font-medium">{t(error ? "slaReport.refreshError" : "slaReport.empty")}</p>
				<p className="mt-1 text-sm text-muted-foreground">
					{t("slaReport.emptyDescription")}
				</p>
				{error && <Button variant="outline" onClick={() => void refetch()}>{t("slaReport.refresh")}</Button>}
			</div>
		);
	}

	const existing = (subscriptions ?? []).find(
		(s) => s.uptimeMonitorId === monitorId,
	);

	return (
		<div className="flex flex-col gap-6">
			{error && <p role="alert" className="text-sm text-destructive">{t("slaReport.refreshError")}</p>}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">{t("slaReport.snapshot", { time: dateTimeFormat(i18n.language, accountTimezone, { dateStyle: "medium", timeStyle: "long" }).format(new Date(report.generatedAt)) })} · {formatTimezone(accountTimezone, i18n.language, new Date(report.generatedAt))}</p>
				<Button variant="outline" className="min-h-11" disabled={isFetching} onClick={() => void refetch()}><RefreshCw aria-hidden className={`me-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />{t(isFetching ? "slaReport.refreshing" : "slaReport.refresh")}</Button>
			</div>
			<ReportCard report={report} monitorId={monitorId} />
			<EmailMonthlyCard
				key={existing?.slaReportSubscriptionId ?? "new"}
				monitorId={monitorId}
				existing={existing}
				providers={providers ?? []}
			/>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-1 rounded-lg border p-3">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="text-lg font-semibold tabular-nums"><Unit>{value}</Unit></span>
		</div>
	);
}

function ReportCard({
	report,
	monitorId,
}: {
	report: SlaReport;
	monitorId: string;
}) {
	const { t, i18n } = useTranslation("uptimeMonitor");
	const accountTimezone = useAccountTimezone();
	const [exported, setExported] = useState<string | null>(null);
	const number = new Intl.NumberFormat(formattingLocale(i18n.language));
	// The window is computed in UTC; its bounds are shown in the account zone, and the label says both.
	const date = dateTimeFormat(i18n.language, accountTimezone, { dateStyle: "medium", timeStyle: "short" });
	const timezone = formatTimezone(accountTimezone, i18n.language, new Date(report.generatedAt));
	const download = useDownloadUptimeSlaReport(monitorId, REPORT_DAYS, accountTimezone);
	const exportAs = (format: "csv" | "json") => {
		const file = `sla-report-${report.periodLabel}.${format}`;
		if (format === "csv") downloadText(slaReportToCsv(report, accountTimezone), file, "text/csv;charset=utf-8");
		else downloadText(slaReportToJson(report, accountTimezone), file, "application/json");
		setExported(file);
	};
	return (
		<SectionCard title={t("slaReport.title")} description={<>{t("slaReport.window", { days: REPORT_DAYS, count: REPORT_DAYS })}: {date.format(new Date(report.windowFrom))} – {date.format(new Date(report.windowTo))} · {t("slaReport.timezoneBasis", { timezone })}</>}>
        <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal w-full sm:w-auto" disabled={download.isPending}
          data-testid="sla-download" onClick={() => download.mutate()}>
          {download.isPending ? <Loader2 aria-hidden className="me-2 h-4 w-4 animate-spin" /> : <Download aria-hidden className="me-2 h-4 w-4" />}
          {t("slaReport.download")}
        </Button>
        <Button variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal w-full sm:w-auto" data-testid="sla-download-csv" onClick={() => exportAs("csv")}>
          <FileSpreadsheet aria-hidden className="me-2 h-4 w-4" />{t("slaReport.downloadCsv")}
        </Button>
        <Button variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal w-full sm:w-auto" data-testid="sla-download-json" onClick={() => exportAs("json")}>
          <FileJson aria-hidden className="me-2 h-4 w-4" />{t("slaReport.downloadJson")}
        </Button>
        </div>
        {exported && <p role="status" className="mb-3 text-sm">{t("slaReport.exported", { file: exported })}</p>}
        <p className="mb-4 text-sm text-muted-foreground">{t("historyUX.reportBasis")} {t("metrics.responseBasis")}</p>
				{download.error && <p role="alert" className="mb-3 text-sm text-destructive">{t("slaReport.downloadError")}</p>}
				{download.isSuccess && !download.isPending && <p role="status" className="mb-3 text-sm">{t("slaReport.downloaded", { file: `sla-report-${download.data.report.periodLabel}.pdf` })}</p>}
				<div data-report-stats className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<Stat
						label={t("slaReport.uptime")}
						value={formatPercent(report.stats.uptimePercentage, i18n.language) ?? t("metrics.noData", "No data")}
					/>
					<Stat
						label={t("slaReport.totalChecks")}
						value={number.format(report.stats.totalChecks)}
					/>
          <Stat label={t("slaReport.successfulChecks")} value={number.format(report.stats.successfulChecks)} />
					<Stat
						label={t("slaReport.degradedChecks")}
						value={number.format(report.stats.degradedChecks)}
					/>
					<Stat
						label={t("slaReport.failedChecks")}
						value={number.format(report.stats.failedChecks)}
					/>
					<Stat
						label={t("slaReport.avgResponseTime", { count: report.windowDays })}
						value={fmtMs(report.stats.avgResponseTime, i18n.language)}
					/>
					<Stat
						label={t("slaReport.p95ResponseTime")}
						value={fmtMs(report.stats.p95ResponseTime, i18n.language)}
					/>
					<Stat
						label={t("slaReport.incidents")}
						value={number.format(report.incidents.count)}
					/>
				</div>
			</SectionCard>
	);
}

function EmailMonthlyCard({
	monitorId,
	existing,
	providers,
}: {
	monitorId: string;
	existing?: SlaReportSubscription;
	providers: UptimeEmailProvider[];
}) {
  const client = useQueryClient();
	const { t } = useTranslation("uptimeMonitor");
	const upsert = useUpsertUptimeSlaReportSubscription();
	const remove = useRemoveUptimeSlaReportSubscription();
	const sendNow = useSendUptimeSlaReportNow();

	const [recipients, setRecipients] = useState(
		existing?.recipientAddresses.join(", ") ?? "",
	);
	const [emailProviderId, setEmailProviderId] = useState(
		existing?.emailProviderId ?? "",
	);
	const [active, setActive] = useState(existing?.active ?? false);
	const [providerSetupOpen, setProviderSetupOpen] = useState(false);
  const [deliveryResult, setDeliveryResult] = useState<{ ok: boolean; accepted: number } | null>(null);

	const parsed = recipients
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const recipientsValid =
		parsed.length > 0 && parsed.every((value) => EMAIL_RE.test(value));

	const chosenProvider = providers.find(provider => provider.emailProviderId === emailProviderId);
	const providerReady = Boolean(chosenProvider?.verified);
  const effectiveActive = providerReady && active;
  const savedProviderReady = providers.some(provider => provider.emailProviderId === existing?.emailProviderId && provider.verified);
  const changedValues = recipients !== (existing?.recipientAddresses.join(", ") ?? "") || emailProviderId !== (existing?.emailProviderId ?? "") || effectiveActive !== (existing?.active ?? false);
  const draft = useDraftComparison({ recipients, emailProviderId, active: effectiveActive }, {
    recipients: existing?.recipientAddresses.join(", ") ?? "", emailProviderId: existing?.emailProviderId ?? "", active: Boolean(existing?.active && savedProviderReady),
  });
  const dirty = changedValues && draft.dirty;
  const busy = upsert.isPending || remove.isPending || sendNow.isPending;
	const blocked = !recipientsValid ? "slaReport.email.blockedRecipients" : !chosenProvider ? "slaReport.email.blockedProvider" : null;
	const scheduled = existing?.active && savedProviderReady;

  const validation = useFormValidation(() => [
    ...(!recipientsValid ? [{ id: "sla-recipients", label: t("slaReport.email.recipients"), message: t("slaReport.email.invalidRecipients") }] : []),
    ...(!chosenProvider ? [{ id: "sla-provider", label: t("slaReport.email.provider"), message: t("slaReport.email.blockedProvider") }] : []),
  ]);
	const handleSave = () => {
    if (busy || !validation.validate()) return;
		upsert.mutate(
			{
				slaReportSubscriptionId: existing?.slaReportSubscriptionId,
				uptimeMonitorId: monitorId,
				recipientAddresses: parsed,
				emailProviderId,
				active: effectiveActive,
			},
			{
				onSuccess: () => { if (!isSessionClientActive(client)) return; setActive(effectiveActive); draft.accept(); toast.success(t("slaReport.email.saved")); },
				onError: error => { if (!isSessionClientActive(client)) return; validation.server(error, { recipientAddresses: "sla-recipients", emailProviderId: "sla-provider" }); toast.error(t("slaReport.email.saveError")); },
			},
		);
	};

	const handleRemove = () => {
		/* v8 ignore next -- defensive: the remove button only renders when `existing` is set */
		if (!existing) return;
		remove.mutate(existing.slaReportSubscriptionId, {
			onSuccess: () => { if (!isSessionClientActive(client)) return; toast.success(t("slaReport.email.removed")); },
			onError: () => { if (isSessionClientActive(client)) toast.error(t("slaReport.email.removeError")); },
		});
	};

	const handleSendNow = () => {
		/* v8 ignore next -- defensive: the send-now button only renders when `existing` is set */
		if (!existing) return;
		setDeliveryResult(null);
		sendNow.mutate(existing.slaReportSubscriptionId, {
			onSuccess: (result) => { if (!isSessionClientActive(client)) return;
				const ok = !result.skipped && result.emailsSent > 0 && result.emailsSent === result.monitorsReported * existing.recipientAddresses.length;
				setDeliveryResult({ ok, accepted: result.emailsSent });
				if (ok) toast.success(t("slaReport.email.sent"));
				else toast.error(t("slaReport.email.sendError"));
			},
			onError: () => { if (!isSessionClientActive(client)) return; setDeliveryResult({ ok: false, accepted: 0 }); toast.error(t("slaReport.email.sendError")); },
		});
	};

	return (
		<SectionCard title={t("slaReport.email.title")} description={t("slaReport.email.description")}><form ref={validation.formRef} noValidate onSubmit={event => { event.preventDefault(); handleSave(); }} className="flex flex-col gap-y-[var(--field-row-gap)]">
        <FormErrorSummary issues={validation.issues} />
				<p className="text-sm" role="status">{t(scheduled ? "slaReport.email.scheduled" : "slaReport.email.notScheduled")}</p>
				<p id="sla-draft-help" className="text-sm text-muted-foreground">{t("slaReport.email.draftHelp")}</p>
				{dirty && <p role="status" className="text-sm font-medium">{t("slaReport.email.unsaved")}</p>}
				{deliveryResult && <p role={deliveryResult.ok ? "status" : "alert"} className={deliveryResult.ok ? "text-sm" : "text-sm text-destructive"}>{t("slaReport.email.acceptedCount", { count: deliveryResult.accepted })} {!deliveryResult.ok && t("slaReport.email.sendError")}</p>}
				<FormField className="form-field">
					<Label htmlFor="sla-recipients">
						{t("slaReport.email.recipients")}
					</Label>
					<Input
						disabled={busy} id="sla-recipients"
 aria-invalid={validation.field("sla-recipients")["aria-invalid"]}
 aria-describedby={validation.issues.some(issue => issue.id === "sla-recipients") ? "sla-recipients-error" : undefined}
						value={recipients}
						onChange={(event) => setRecipients(event.target.value)}
						placeholder={t("formUX.example", { value: "ops@example.com, sre@example.com" })}
					/>
					{(!recipientsValid && recipients.length > 0) && (
						<p id="sla-recipients-error" role="alert" className="text-sm text-destructive">
							{t("slaReport.email.invalidRecipients")}
						</p>
					)}
				</FormField>

				<FormField className="form-field">
					<Label htmlFor="sla-provider">{t("slaReport.email.provider")}</Label>
					{providers.length === 0 ? (
						<div id="sla-provider" tabIndex={-1} className="space-y-2 text-sm text-muted-foreground">
							{t("slaReport.email.noProviders")}

						</div>
					) : (
						<Select
              disabled={busy}
							value={emailProviderId}
							onValueChange={setEmailProviderId}
						>
							<SelectTrigger id="sla-provider" aria-invalid={validation.field("sla-provider")["aria-invalid"]} aria-describedby={validation.issues.some(issue => issue.id === "sla-provider") ? "sla-provider-error" : undefined}>
								<SelectValue
									placeholder={t("slaReport.email.selectProvider")}
								/>
							</SelectTrigger>
							<SelectContent>
								{providers.map((provider) => (
									<SelectItem
										key={provider.emailProviderId}
										value={provider.emailProviderId}
									>
										{provider.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{validation.issues.some(issue => issue.id === "sla-provider") && <p id="sla-provider-error" role="alert" className="text-sm text-destructive">{t("slaReport.email.blockedProvider")}</p>}
          {chosenProvider && !chosenProvider.verified && <p className="text-sm text-muted-foreground">{t("notificationUX.providerUntestedHint")}</p>}
				</FormField>

				<div className="flex items-center justify-between rounded-md border p-3">
					<Label htmlFor="sla-active" className="cursor-pointer">
						{t("slaReport.email.active")}
					</Label>
					<Switch
						id="sla-active"
						aria-describedby={providerReady ? "sla-draft-help" : "sla-provider-required"}
            disabled={busy || !providerReady}
						checked={effectiveActive}
						onCheckedChange={setActive}
					/>
				</div>

        {!providerReady && <p id="sla-provider-required" className="text-sm text-muted-foreground">{t("slaReport.email.verifiedProviderRequired")} {existing?.active && !savedProviderReady && t("slaReport.email.savedInactiveProvider")} <a className="text-primary underline underline-offset-4" href="#sla-email-provider-setup" onClick={() => setProviderSetupOpen(true)}>{t("slaReport.email.setupProvider")}</a></p>}

				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<Button type="submit" disabled={busy || blocked !== null} aria-describedby={blocked ? "sla-save-blocked" : undefined} className="h-[44px]">
						{upsert.isPending && (
							<Loader2 className="me-2 h-4 w-4 animate-spin" />
						)}
						{t("slaReport.email.save")}
					</Button>

					{existing && (
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="outline"
								type="button" onClick={handleSendNow}
								disabled={busy || !savedProviderReady}
								className="h-[44px]"
							>
								<Send className="me-2 h-4 w-4" />
								{t("slaReport.email.sendNow")}
							</Button>
							{dirty && <p className="basis-full text-sm text-muted-foreground">{t("slaReport.email.sendNowSaved")}</p>}
							<Button
								variant="ghost"
								type="button" onClick={handleRemove}
								disabled={busy}
								className="h-[44px] text-destructive"
							>
								<Trash2 className="me-2 h-4 w-4" />
								{t("slaReport.email.remove")}
							</Button>
						</div>
					)}
				</div>
				{blocked && <p id="sla-save-blocked" className="text-sm text-muted-foreground">{t(blocked)}</p>}
			</form><Collapsible id="sla-email-provider-setup" open={providerSetupOpen} onOpenChange={setProviderSetupOpen}><CollapsibleTrigger>{t("emailProviders.title")}</CollapsibleTrigger><CollapsibleContent><EmailProvidersSection /></CollapsibleContent></Collapsible></SectionCard>
	);
}
