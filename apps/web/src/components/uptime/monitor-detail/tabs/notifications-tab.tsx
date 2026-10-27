import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { WebhookSecretDialog, RotateWebhookSecret } from "@/components/uptime/webhook-secret-dialog";
import { SectionCard } from "@/components/ui/section-card";
import { requestConfirmation } from "@/lib/confirmation";
import { parseRecipients } from "@/lib/uptime/recipients";
import { channelDestination } from "@/lib/uptime/channel-destination";
import { MonitorTemplatesService } from "@/services/uptime/monitorTemplatesService";
import { Bell, Info, Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useConfirmation } from "@/hooks/use-confirmation";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	ChannelFormDialog,
	parseWebhookHeaders,
} from "@/components/uptime/channel-form-dialog";
import {
	useCreateUptimeNotificationChannel,
	useDeleteUptimeNotificationChannel,
	useUpdateUptimeNotificationChannel,
	useTestUptimeNotificationChannel,
	useUptimeDefaultChannels,
	useUptimeEmailProviders,
	useUptimeNotificationChannels,
} from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { NotificationLogTable } from "@/components/uptime/notification-log-table";
import type {
	UptimeNotificationChannel,
	UptimeNotificationChannelType,
} from "@/types/uptime";
import { EmailProvidersSection } from "./email-providers-section";

function DeliveryHistorySection({ monitorId, effectiveChannelCount }: { monitorId: string; effectiveChannelCount?: number }) {
	const { t } = useTranslation("uptimeMonitor");
 const client = useQueryClient();
	return (
<SectionCard title={t("notifications.history.title")} description={t("notifications.history.description")}>
      <NotificationLogTable monitorId={monitorId} effectiveChannelCount={effectiveChannelCount} />
    </SectionCard>
	);
}

interface NotificationsTabProps {
 supportsTls?: boolean;
  referencedChannels?: Array<{ id: string; type: UptimeNotificationChannelType }>;
	monitorId: string;
}

function DefaultChannelsNotice() {
	const { t } = useTranslation("uptimeMonitor");
 const client = useQueryClient();
	const { data: defaultChannels } = useUptimeDefaultChannels();

	if (!defaultChannels || defaultChannels.length === 0) {
		return null;
	}

	return (
		<div className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
			<Info className="h-4 w-4 mt-0.5 shrink-0" />
			<p>
				{t("notifications.defaultsNotice", {
					count: defaultChannels.length,
				})}<span className="mt-2 block">{t("notificationUX.defaultPolicy")}</span><DocsHelpLink docPath="saved-views" />
			</p>
		</div>
	);
}

export function NotificationsTab({ monitorId, supportsTls = true, referencedChannels = [] }: NotificationsTabProps) {
	const { t } = useTranslation("uptimeMonitor");
 const client = useQueryClient();
	const { data: channels, isPending: channelsLoading, error: channelsError, refetch: retryChannels } = useUptimeNotificationChannels(monitorId);
	const { data: emailProviders } = useUptimeEmailProviders();
  const { data: inheritedChannels } = useUptimeDefaultChannels();
	const createMutation = useCreateUptimeNotificationChannel();
	const updateMutation = useUpdateUptimeNotificationChannel();
	const deleteMutation = useDeleteUptimeNotificationChannel();
	const testMutation = useTestUptimeNotificationChannel();
	const { confirm, dialog: testDialog } = useConfirmation();
	const testing = useRef(false);
	const [testPending, setTestPending] = useState(false);
  const [detached, setDetached] = useState<string[]>([]); const [detaching, setDetaching] = useState(false);
  const referenceKey = referencedChannels.map(channel => channel.id).sort().join("\u0000");
  useEffect(() => { setDetached([]); }, [monitorId, referenceKey]);
  const references = referencedChannels.filter(channel => !detached.includes(channel.id));
  const referenceSection = references.length > 0 ? <SectionCard title={t("templates.linkedChannels")} description={t("templates.linkedDescription")}><div className="grid gap-2">{references.map(channel => <div key={channel.id} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words text-sm"><bdi>{channel.type} · {channel.id}</bdi></span><Button variant="outline" className="min-h-11" disabled={detaching} onClick={async () => { if (!await requestConfirmation(t("templates.detachConfirm"), { title: t("templates.detach"), action: t("templates.detach") })) return; if (!isSessionClientActive(client)) return; setDetaching(true); try { await MonitorTemplatesService.detachChannel(monitorId, channel.id); await Promise.all([client.invalidateQueries({ queryKey: uptimeKeys.monitors.detail(monitorId) }), client.invalidateQueries({ queryKey: uptimeKeys.monitors.lists() })]); if (!isSessionClientActive(client)) return; setDetached(ids => [...ids, channel.id]); } catch (error) {
 if (!isSessionClientActive(client)) return; toast.error(extractErrorMessage(error, t("templates.error"))); } finally { setDetaching(false); } }}>{t("templates.detach")}</Button></div>)}</div></SectionCard> : null;
	const [signingSecret, setSigningSecret] = useState<string | null>(null);
	const editorGeneration = useRef(0);
 const [createOpen, setCreateOpen] = useState(false);
	const [editChannel, setEditChannel] =
		useState<UptimeNotificationChannel | null>(null);

	// Create form state
	const [channelType, setChannelType] =
		useState<UptimeNotificationChannelType>("webhook");
	const [emailProviderId, setEmailProviderId] = useState("");
	const [webhookUrl, setWebhookUrl] = useState("");
	const [webhookHeaders, setWebhookHeaders] = useState("");
  const [submissionError, setSubmissionError] = useState<unknown>(null);
	const [recipients, setRecipients] = useState("");
	const [notifyOnDown, setNotifyOnDown] = useState(true);
	const [notifyOnDegraded, setNotifyOnDegraded] = useState(false);
	const [notifyOnRecovery, setNotifyOnRecovery] = useState(true);
	const [notifyOnTlsExpiry, setNotifyOnTlsExpiry] = useState(false);
	const [tlsExpiryThresholdDays, setTlsExpiryThresholdDays] = useState("14");

	const resetForm = () => {
    setSubmissionError("");
		setChannelType("webhook");
		setEmailProviderId("");
		setWebhookUrl("");
		setWebhookHeaders("");
		setRecipients("");
		setNotifyOnDown(true);
		setNotifyOnDegraded(false);
		setNotifyOnRecovery(true);
		setNotifyOnTlsExpiry(false);
		setTlsExpiryThresholdDays("14");
	};
	const handleChannelTypeChange = (type: UptimeNotificationChannelType) => {
		setChannelType(type);
	};

	const openCreateDialog = () => {
 editorGeneration.current++;
		resetForm();
		setCreateOpen(true);
	};

	const openEditDialog = (channel: UptimeNotificationChannel) => {
 editorGeneration.current++;
    setSubmissionError("");
		setEditChannel(channel);
		setChannelType(channel.channelType);
		setEmailProviderId(channel.emailProviderId ?? "");
		setWebhookUrl("");
		setWebhookHeaders("");
		setRecipients(channel.recipientAddresses?.join(", ") ?? "");
		setNotifyOnDown(channel.notifyOnDown);
		setNotifyOnDegraded(channel.notifyOnDegraded ?? false);
		setNotifyOnRecovery(channel.notifyOnRecovery);
		setNotifyOnTlsExpiry(channel.notifyOnTlsExpiry);
		setTlsExpiryThresholdDays(String(channel.tlsExpiryThresholdDays));
	};

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
 const requestGeneration = editorGeneration.current;
    setSubmissionError("");
		if (channelType === "email" && !emailProviderId) {
			setSubmissionError(
				t(
					"notifications.create.emailProviderRequired",
					"Select an email provider before adding an email channel",
				),
			);
			return;
		}
		const parsedWebhookHeaders = channelType !== "webhook" ? undefined : parseWebhookHeaders(webhookHeaders);
		if (parsedWebhookHeaders === false) {
			setSubmissionError(
				t(
					"notifications.fields.webhookHeadersInvalid",
					"Headers must be a JSON object with string values",
				),
			);
			return;
		}
		try {
			const created = await createMutation.mutateAsync({
				uptimeMonitorId: monitorId,
				channelType,
				emailProviderId: channelType === "email" ? emailProviderId : undefined,
				webhookUrl: channelType !== "email" ? webhookUrl : undefined,
				webhookHeaders:
					channelType === "webhook" ? parsedWebhookHeaders : undefined,
				recipientAddresses:
					channelType === "email"
						? parseRecipients(recipients).recipients
						: undefined,
				notifyOnDown,
				notifyOnDegraded,
				notifyOnRecovery,
				notifyOnTlsExpiry,
				tlsExpiryThresholdDays: Number(tlsExpiryThresholdDays),
			});
			if (!isSessionClientActive(client)) return;
 setSigningSecret(created?.signingSecret ?? null);
      createMutation.reset?.();
			if (!isSessionClientActive(client)) return;
 toast.success(t("notifications.create.success"));
 if (requestGeneration !== editorGeneration.current) return;
			resetForm();
			setCreateOpen(false);
		} catch (error) {
 if (requestGeneration !== editorGeneration.current) return;
 if (!isSessionClientActive(client)) return;
			setSubmissionError(error);
		}
	};

	const handleEdit = async (e: React.FormEvent) => {
		e.preventDefault();
 const requestGeneration = editorGeneration.current;
    setSubmissionError("");
		// defensive: the edit form only renders when `editChannel` is set, so this
		// guard's early-return is unreachable from the UI.
		/* v8 ignore next */
		if (!editChannel) return;
		if (channelType === "email" && !emailProviderId) {
			setSubmissionError(
				t(
					"notifications.create.emailProviderRequired",
					"Select an email provider before saving an email channel",
				),
			);
			return;
		}
		const parsedWebhookHeaders = channelType !== "webhook" ? undefined : parseWebhookHeaders(webhookHeaders);
		if (parsedWebhookHeaders === false) {
			setSubmissionError(
				t(
					"notifications.fields.webhookHeadersInvalid",
					"Headers must be a JSON object with string values",
				),
			);
			return;
		}
		try {
			await updateMutation.mutateAsync({
				channelId: editChannel.channelId,
				uptimeMonitorId: monitorId,
				channelType,
				emailProviderId: channelType === "email" ? emailProviderId : null,
				...(channelType === "email" ? { webhookUrl: null, webhookHeaders: null } : {
          ...(webhookUrl.trim() ? { webhookUrl } : {}),
          ...(channelType === "webhook" && parsedWebhookHeaders !== undefined ? { webhookHeaders: parsedWebhookHeaders } : {}),
        }),
				recipientAddresses:
					channelType === "email"
						? parseRecipients(recipients).recipients
						: undefined,
				notifyOnDown,
				notifyOnDegraded,
				notifyOnRecovery,
				notifyOnTlsExpiry,
				tlsExpiryThresholdDays: Number(tlsExpiryThresholdDays),
			});
			if (!isSessionClientActive(client)) return;
 toast.success(
				t("notifications.edit.success", "Channel updated successfully"),
			);
 if (requestGeneration !== editorGeneration.current) return;
			setEditChannel(null);
			resetForm();
		} catch (error) {
 if (requestGeneration !== editorGeneration.current) return;
 if (!isSessionClientActive(client)) return;
			setSubmissionError(error);
		}
	};

	const handleDelete = async (channelId: string) => {
 if (!await requestConfirmation(t("notificationUX.deleteChannel"), { title: t("notificationUX.deleteChannelTitle"), action: t("common:actions.delete") })) return;
		try {
			await deleteMutation.mutateAsync({
				channelId,
				uptimeMonitorId: monitorId,
			});
			if (!isSessionClientActive(client)) return;
 toast.success(t("notifications.delete.success"));
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			toast.error(extractErrorMessage(error, t("notifications.delete.error")));
		}
	};

	// A test is a real send: name the destination first, and report only what the provider actually accepted.
	const handleTest = async (channel: UptimeNotificationChannel) => {
		if (testing.current) return;
		testing.current = true;
		const destination = channelDestination(channel);
		try {
			if (!await confirm({ title: t("notificationUX.testTitle"), description: t("notificationUX.confirmTest", { destination }), action: t("actions.test") })) return;
			setTestPending(true);
			await testMutation.mutateAsync(channel.channelId);
			if (!isSessionClientActive(client)) return;
 toast.success(t("notificationUX.testAccepted", { destination }));
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			toast.error(extractErrorMessage(error, t("notifications.test.error")));
		} finally {
			testing.current = false;
			setTestPending(false);
		}
	};

 if (channelsLoading) return <SectionCard title={t("notifications.title")}><p role="status">{t("notificationUX.loadingChannels")}</p></SectionCard>;
 if (channelsError && !channels) return <SectionCard title={t("notifications.title")}><div role="alert"><p>{t("notificationUX.errorChannels")}</p><Button variant="outline" onClick={() => void retryChannels()}>{t("workspace.retry")}</Button></div></SectionCard>;

	if (!channels || channels.length === 0) {
		return (
			<div className="flex min-w-0 flex-col gap-4">
				<DefaultChannelsNotice />
        {referenceSection}
				<SectionCard title={t("notifications.title")}><div className="flex flex-col items-center justify-center text-center">
					<Bell className="h-6 w-6 text-muted-foreground mb-2" />
					<p className="font-medium">{t(inheritedChannels?.length || references.length ? "notificationUX.noOverrides" : "notifications.empty")}</p>
					<p className="text-sm text-muted-foreground mt-1">
						{t(inheritedChannels?.length || references.length ? "notificationUX.inheritedActive" : "notifications.emptyDescription")}
					</p>
					<Button
						onClick={openCreateDialog}
						className="mt-4 h-[44px]"
					>
						<Plus className="h-4 w-4 me-2" />
						{t("actions.addChannel")}
					</Button>
				</div></SectionCard>
				<WebhookSecretDialog secret={signingSecret} onClose={() => setSigningSecret(null)} />
      <ChannelFormDialog supportsTls={supportsTls}
					open={createOpen}
					onOpenChange={open => { if (!open) editorGeneration.current++; setCreateOpen(open); }}
					channelType={channelType}
					setChannelType={handleChannelTypeChange}
					emailProviders={emailProviders ?? []}
					emailProviderId={emailProviderId}
					setEmailProviderId={setEmailProviderId}
					webhookUrl={webhookUrl}
					setWebhookUrl={setWebhookUrl}
					webhookHeaders={webhookHeaders}
					setWebhookHeaders={setWebhookHeaders}
					recipients={recipients}
					setRecipients={setRecipients}
					notifyOnDown={notifyOnDown}
					notifyOnDegraded={notifyOnDegraded}
					setNotifyOnDegraded={setNotifyOnDegraded}
					setNotifyOnDown={setNotifyOnDown}
					notifyOnRecovery={notifyOnRecovery}
					setNotifyOnRecovery={setNotifyOnRecovery}
					notifyOnTlsExpiry={notifyOnTlsExpiry}
					setNotifyOnTlsExpiry={setNotifyOnTlsExpiry}
					tlsExpiryThresholdDays={tlsExpiryThresholdDays}
					setTlsExpiryThresholdDays={setTlsExpiryThresholdDays}
					onSubmit={handleCreate}
					isPending={createMutation.isPending} error={submissionError || undefined}
				/>

				{/* Email providers */}
				<EmailProvidersSection />

				{/* Delivery history */}
				<DeliveryHistorySection monitorId={monitorId} effectiveChannelCount={channels && inheritedChannels ? new Set([...channels.map(channel => channel.channelId), ...inheritedChannels.map(channel => channel.channelId), ...references.map(channel => channel.id)]).size : undefined} />

			</div>
		);
	}

	return (
		<div className="flex min-w-0 flex-col gap-4">
			{testDialog}
      <WebhookSecretDialog secret={signingSecret} onClose={() => setSigningSecret(null)} />
			<DefaultChannelsNotice />
        {referenceSection}
<SectionCard title={t("notifications.title")} description={t("notificationUX.monitorScope")} headerEnd={<Button
					onClick={openCreateDialog}
					size="sm"
					className="max-w-full whitespace-normal"
				>
					<Plus className="h-4 w-4 me-2" />
					{t("actions.addChannel")}
				</Button>}>

			<div className="w-full min-w-0 overflow-x-auto rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="text-start">
								{t("notifications.fields.channelType")}
							</TableHead>
							<TableHead className="text-start">
								{t("notifications.fields.target")}
							</TableHead>
							<TableHead className="text-start">
								{t("notifications.fields.notifyOnDown")}
							</TableHead>
							<TableHead className="text-start">{t("notifications.fields.notifyOnDegraded")}</TableHead>
							<TableHead className="text-start">
								{t("notifications.fields.notifyOnRecovery")}
							</TableHead>
							<TableHead className="text-start">
								{t("notifications.fields.notifyOnTlsExpiry")}
							</TableHead>
							<TableHead className="text-end">
								{t("list.columns.actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{channels.map((ch) => (
							<TableRow key={ch.channelId}>
								<TableCell>
									<Badge variant="outline">
										{t(
											`notifications.channelTypes.${ch.channelType}`,
											ch.channelType,
										)}
									</Badge>
								</TableCell>
								<TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
									{channelDestination(ch)}
								</TableCell>
								<TableCell>
									{ch.notifyOnDown
										? t("notifications.fields.yes")
										: t("notifications.fields.no")}
								</TableCell>
								<TableCell>{ch.notifyOnDegraded ? t("notifications.fields.yes") : t("notifications.fields.no")}</TableCell>
								<TableCell>
									{ch.notifyOnRecovery
										? t("notifications.fields.yes")
										: t("notifications.fields.no")}
								</TableCell>
								<TableCell>
									{ch.notifyOnTlsExpiry
										? t("notifications.fields.yes")
										: t("notifications.fields.no")}
								</TableCell>
								<TableCell className="text-end">
									<div className="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											aria-label={`${t("actions.test")} ${t(
												`notifications.channelTypes.${ch.channelType}`,
												ch.channelType,
											)}`}
											onClick={() => handleTest(ch)}
											disabled={testMutation.isPending || testPending}
											className="h-[44px] min-w-[44px]"
										>
											{testMutation.isPending || testPending ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : (
												<Send className="h-3.5 w-3.5" />
											)}
										</Button>
										{ch.channelType === "webhook" && <RotateWebhookSecret channelId={ch.channelId} onSecret={setSigningSecret} />}
<Button
											variant="ghost"
											size="sm"
											aria-label={`${t("actions.edit")} ${t(
												`notifications.channelTypes.${ch.channelType}`,
												ch.channelType,
											)}`}
											onClick={() => openEditDialog(ch)}
											disabled={updateMutation.isPending}
											className="h-[44px] min-w-[44px]"
										>
											<Pencil className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											aria-label={`${t("actions.delete")} ${t(
												`notifications.channelTypes.${ch.channelType}`,
												ch.channelType,
											)}`}
											onClick={() => handleDelete(ch.channelId)}
											disabled={deleteMutation.isPending}
											className="h-[44px] min-w-[44px] text-destructive hover:text-destructive"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div></SectionCard>

			<ChannelFormDialog supportsTls={supportsTls}
				open={createOpen}
				onOpenChange={open => { if (!open) editorGeneration.current++; setCreateOpen(open); }}
				channelType={channelType}
				setChannelType={handleChannelTypeChange}
				emailProviders={emailProviders ?? []}
				emailProviderId={emailProviderId}
				setEmailProviderId={setEmailProviderId}
				webhookUrl={webhookUrl}
				setWebhookUrl={setWebhookUrl}
				webhookHeaders={webhookHeaders}
				setWebhookHeaders={setWebhookHeaders}
				recipients={recipients}
				setRecipients={setRecipients}
				notifyOnDown={notifyOnDown}
					notifyOnDegraded={notifyOnDegraded}
					setNotifyOnDegraded={setNotifyOnDegraded}
				setNotifyOnDown={setNotifyOnDown}
				notifyOnRecovery={notifyOnRecovery}
				setNotifyOnRecovery={setNotifyOnRecovery}
				notifyOnTlsExpiry={notifyOnTlsExpiry}
				setNotifyOnTlsExpiry={setNotifyOnTlsExpiry}
				tlsExpiryThresholdDays={tlsExpiryThresholdDays}
				setTlsExpiryThresholdDays={setTlsExpiryThresholdDays}
				onSubmit={handleCreate}
				isPending={createMutation.isPending} error={submissionError || undefined}
			/>

			<ChannelFormDialog supportsTls={supportsTls}
				open={Boolean(editChannel)}
				onOpenChange={(open) => {
					if (!open) {
 editorGeneration.current++;
						setEditChannel(null);
						resetForm();
					}
				}}
				isEdit storedTargetLabel={editChannel?.webhookUrlMasked} storedHeaderNames={editChannel?.webhookHeaderNames} storedChannelType={editChannel?.channelType} hasStoredTarget={Boolean(editChannel?.hasWebhookUrl)}
				channelType={channelType}
				setChannelType={handleChannelTypeChange}
				emailProviders={emailProviders ?? []}
				emailProviderId={emailProviderId}
				setEmailProviderId={setEmailProviderId}
				webhookUrl={webhookUrl}
				setWebhookUrl={setWebhookUrl}
				webhookHeaders={webhookHeaders}
				setWebhookHeaders={setWebhookHeaders}
				recipients={recipients}
				setRecipients={setRecipients}
				notifyOnDown={notifyOnDown}
					notifyOnDegraded={notifyOnDegraded}
					setNotifyOnDegraded={setNotifyOnDegraded}
				setNotifyOnDown={setNotifyOnDown}
				notifyOnRecovery={notifyOnRecovery}
				setNotifyOnRecovery={setNotifyOnRecovery}
				notifyOnTlsExpiry={notifyOnTlsExpiry}
				setNotifyOnTlsExpiry={setNotifyOnTlsExpiry}
				tlsExpiryThresholdDays={tlsExpiryThresholdDays}
				setTlsExpiryThresholdDays={setTlsExpiryThresholdDays}
				onSubmit={handleEdit}
				isPending={updateMutation.isPending} error={submissionError || undefined}
			/>

			{/* Email providers */}
			<EmailProvidersSection />

			{/* Delivery history */}
			<DeliveryHistorySection monitorId={monitorId} effectiveChannelCount={channels && inheritedChannels ? new Set([...channels.map(channel => channel.channelId), ...inheritedChannels.map(channel => channel.channelId), ...references.map(channel => channel.id)]).size : undefined} />

		</div>
	);
}
