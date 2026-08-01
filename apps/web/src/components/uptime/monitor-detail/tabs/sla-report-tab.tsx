/**
 * SLA Report tab — on-demand report view + PDF download + monthly-email
 * subscription controls. Available to every account.
 *
 * @module components/uptime/monitor-detail/tabs/sla-report-tab
 */

import { Download, FileText, Loader2, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
	useUptimeSlaReportSubscriptions,
	useUpsertUptimeSlaReportSubscription,
} from "@/hooks/uptime";
import { UptimeService } from "@/services/uptime/uptimeService";
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

function fmtMs(value: number | null): string {
	return value === null ? "—" : `${value} ms`;
}

export function SlaReportTab({ monitorId }: { monitorId: string }) {
	return <SlaReportContent monitorId={monitorId} />;
}

function SlaReportContent({ monitorId }: { monitorId: string }) {
	const { t } = useTranslation("uptimeMonitor");
	const { data: report, isLoading } = useUptimeSlaReport(monitorId, REPORT_DAYS);
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
				<p className="font-medium">{t("slaReport.empty")}</p>
				<p className="mt-1 text-sm text-muted-foreground">
					{t("slaReport.emptyDescription")}
				</p>
			</div>
		);
	}

	const existing = (subscriptions ?? []).find(
		(s) => s.uptimeMonitorId === monitorId,
	);

	return (
		<div className="flex flex-col gap-6">
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
			<span className="text-lg font-semibold tabular-nums">{value}</span>
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
	const { t } = useTranslation("uptimeMonitor");
	return (
		<Card>
			<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-col gap-1">
					<CardTitle className="text-lg font-semibold">
						{t("slaReport.title")}
					</CardTitle>
					<p className="text-sm text-muted-foreground">
						{report.windowFrom.slice(0, 10)} – {report.windowTo.slice(0, 10)}
					</p>
				</div>
				<Button asChild variant="outline" className="h-[44px] shrink-0">
					<a
						href={UptimeService.slaReportPdfUrl(monitorId, REPORT_DAYS)}
						download
						data-testid="sla-download"
					>
						<Download className="me-2 h-4 w-4" />
						{t("slaReport.download")}
					</a>
				</Button>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
					<Stat
						label={t("slaReport.uptime")}
						value={`${report.stats.uptimePercentage}%`}
					/>
					<Stat
						label={t("slaReport.totalChecks")}
						value={String(report.stats.totalChecks)}
					/>
					<Stat
						label={t("slaReport.failedChecks")}
						value={String(report.stats.failedChecks)}
					/>
					<Stat
						label={t("slaReport.avgResponseTime")}
						value={fmtMs(report.stats.avgResponseTime)}
					/>
					<Stat
						label={t("slaReport.p95ResponseTime")}
						value={fmtMs(report.stats.p95ResponseTime)}
					/>
					<Stat
						label={t("slaReport.incidents")}
						value={String(report.incidents.count)}
					/>
				</div>
			</CardContent>
		</Card>
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
	const [active, setActive] = useState(existing?.active ?? true);

	const parsed = recipients
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const recipientsValid =
		parsed.length > 0 && parsed.every((value) => EMAIL_RE.test(value));
	const canSave =
		recipientsValid && emailProviderId.length > 0 && !upsert.isPending;

	const handleSave = () => {
		upsert.mutate(
			{
				slaReportSubscriptionId: existing?.slaReportSubscriptionId,
				uptimeMonitorId: monitorId,
				recipientAddresses: parsed,
				emailProviderId,
				active,
			},
			{
				onSuccess: () => toast.success(t("slaReport.email.saved")),
				onError: () => toast.error(t("slaReport.email.saveError")),
			},
		);
	};

	const handleRemove = () => {
		/* v8 ignore next -- defensive: the remove button only renders when `existing` is set */
		if (!existing) return;
		remove.mutate(existing.slaReportSubscriptionId, {
			onSuccess: () => toast.success(t("slaReport.email.removed")),
			onError: () => toast.error(t("slaReport.email.removeError")),
		});
	};

	const handleSendNow = () => {
		/* v8 ignore next -- defensive: the send-now button only renders when `existing` is set */
		if (!existing) return;
		sendNow.mutate(existing.slaReportSubscriptionId, {
			onSuccess: () => toast.success(t("slaReport.email.sent")),
			onError: () => toast.error(t("slaReport.email.sendError")),
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base font-semibold">
					{t("slaReport.email.title")}
				</CardTitle>
				<p className="text-sm text-muted-foreground">
					{t("slaReport.email.description")}
				</p>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="sla-recipients">
						{t("slaReport.email.recipients")}
					</Label>
					<Input
						id="sla-recipients"
						value={recipients}
						onChange={(event) => setRecipients(event.target.value)}
						placeholder="ops@example.com, sre@example.com"
					/>
					{!recipientsValid && recipients.length > 0 && (
						<p className="text-xs text-destructive">
							{t("slaReport.email.invalidRecipients")}
						</p>
					)}
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="sla-provider">{t("slaReport.email.provider")}</Label>
					{providers.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("slaReport.email.noProviders")}
						</p>
					) : (
						<Select
							value={emailProviderId}
							onValueChange={setEmailProviderId}
						>
							<SelectTrigger id="sla-provider">
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
				</div>

				<div className="flex items-center justify-between rounded-md border p-3">
					<Label htmlFor="sla-active" className="cursor-pointer">
						{t("slaReport.email.active")}
					</Label>
					<Switch
						id="sla-active"
						checked={active}
						onCheckedChange={setActive}
					/>
				</div>

				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<Button onClick={handleSave} disabled={!canSave} className="h-[44px]">
						{upsert.isPending && (
							<Loader2 className="me-2 h-4 w-4 animate-spin" />
						)}
						{t("slaReport.email.save")}
					</Button>

					{existing && (
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								onClick={handleSendNow}
								disabled={sendNow.isPending}
								className="h-[44px]"
							>
								<Send className="me-2 h-4 w-4" />
								{t("slaReport.email.sendNow")}
							</Button>
							<Button
								variant="ghost"
								onClick={handleRemove}
								disabled={remove.isPending}
								className="h-[44px] text-destructive"
							>
								<Trash2 className="me-2 h-4 w-4" />
								{t("slaReport.email.remove")}
							</Button>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
