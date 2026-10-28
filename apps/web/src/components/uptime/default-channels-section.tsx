import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { WebhookSecretDialog, RotateWebhookSecret } from "@/components/uptime/webhook-secret-dialog";
import { SectionCard } from "@/components/ui/section-card";
import { requestConfirmation } from "@/lib/confirmation";
import { parseRecipients } from "@/lib/uptime/recipients";
import { channelDestination } from "@/lib/uptime/channel-destination";
import { Bell, Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	ChannelFormDialog,
	parseWebhookHeaders,
} from "@/components/uptime/channel-form-dialog";
import {
	useCreateUptimeDefaultChannel,
	useDeleteUptimeNotificationChannel,
	useTestUptimeNotificationChannel,
	useUpdateUptimeNotificationChannel,
	useUptimeChannelHealth,
	useUptimeDefaultChannels,
	useUptimeEmailProviders,
} from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type {
	UptimeNotificationChannel,
	UptimeNotificationChannelType,
} from "@/types/uptime";
import { CHANNEL_UNHEALTHY_THRESHOLD } from "@/types/uptime";

/**
 * Account-level default notification channels. These apply to every monitor
 * the user owns — including monitors created later — without per-monitor
 * setup. Monitor-specific channels take precedence for the same target.
 */
export function DefaultChannelsSection() {
	const { t } = useTranslation("uptimeMonitor");
 const client = useQueryClient();
	const { data: channels, isPending: channelsLoading, error: channelsError, refetch: retryChannels } = useUptimeDefaultChannels();
	const { data: channelHealth } = useUptimeChannelHealth();
	const { data: emailProviders } = useUptimeEmailProviders();
	const createMutation = useCreateUptimeDefaultChannel();
	const updateMutation = useUpdateUptimeNotificationChannel();
	const deleteMutation = useDeleteUptimeNotificationChannel();
	const testMutation = useTestUptimeNotificationChannel();
	const [signingSecret, setSigningSecret] = useState<string | null>(null);
	const editorGeneration = useRef(0);
 const [createOpen, setCreateOpen] = useState(false);
	const [editChannel, setEditChannel] =
		useState<UptimeNotificationChannel | null>(null);

	// Form state (shared by create + edit dialogs)
	const [channelType, setChannelType] =
		useState<UptimeNotificationChannelType>("email");
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
		setChannelType("email");
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
				uptimeMonitorId: null,
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
			await deleteMutation.mutateAsync({ channelId, uptimeMonitorId: null });
			if (!isSessionClientActive(client)) return;
 toast.success(t("notifications.delete.success"));
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			toast.error(extractErrorMessage(error, t("notifications.delete.error")));
		}
	};

	// A test is a real send: name the destination first, and report only what the provider actually accepted.
	const handleTest = async (channel: UptimeNotificationChannel) => {
		const destination = channelDestination(channel);
		if (!await requestConfirmation(t("notificationUX.confirmTest", { destination }), { title: t("notificationUX.testTitle"), action: t("notificationUX.sendTestAction"), destructive: false })) return;
		try {
			await testMutation.mutateAsync(channel.channelId);
			if (!isSessionClientActive(client)) return;
 toast.success(t("notificationUX.testAccepted", { destination }));
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			toast.error(extractErrorMessage(error, t("notifications.test.error")));
		}
	};

	// Channels failing every recent delivery, so a dead target is visible right
	// where it is managed — not only in the per-monitor delivery log.
	const healthByChannel = new Map(
		(channelHealth ?? [])
			.filter(
				(entry) => entry.consecutiveFailures >= CHANNEL_UNHEALTHY_THRESHOLD,
			)
			.map((entry) => [entry.channelId, entry]),
	);

 if (channelsLoading) return <p role="status">{t("notificationUX.loadingChannels")}</p>;
 if (channelsError && !channels) return <div role="alert"><p>{t("notificationUX.errorChannels")}</p><Button variant="outline" onClick={() => void retryChannels()}>{t("workspace.retry")}</Button></div>;

	return (
    <SectionCard title={t("notificationSettings.defaults.title", "Default channels")} description={t("notificationSettings.defaults.description", "Alert channels that apply to all your monitors automatically, including ones you create later.")}>
      <div className="flex flex-col gap-3">
        <Button onClick={openCreateDialog} size="sm" className="w-full self-end sm:w-auto"><Plus className="h-4 w-4" aria-hidden="true" />{t("notificationSettings.defaults.add", "Add default channel")}</Button>

			{!channels || channels.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-lg border p-8 text-center">
					<Bell className="h-8 w-8 text-muted-foreground mb-2" aria-hidden="true" />
					<p className="text-sm text-muted-foreground">
						{t(
							"notificationSettings.defaults.empty",
							"No default channels yet. Add one to alert every monitor without per-monitor setup.",
						)}
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{channels.map((ch) => (
						<div
							key={ch.channelId}
							className="flex items-center justify-between gap-3 rounded-lg border p-3"
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<Badge variant="outline">
										{t(
											`notifications.channelTypes.${ch.channelType}`,
											ch.channelType,
										)}
									</Badge>
									<span className="text-xs text-muted-foreground">
										{t(
											"notificationSettings.defaults.appliesToAll",
											"All monitors",
										)}
									</span>
									{healthByChannel.get(ch.channelId) ? (
										<Badge
											variant="outline"
											className="border-destructive/40 text-destructive"
										>
											{t("channelHealth.failing", "Failing")}
										</Badge>
									) : null}
								</div>
								<p className="text-sm text-muted-foreground break-words mt-1">
									{channelDestination(ch)}
								</p>
							</div>
							<div className="flex items-center gap-1 shrink-0">
								<Button
									variant="ghost"
									size="sm"
									aria-label={`${t("actions.test")} ${t(
										`notifications.channelTypes.${ch.channelType}`,
										ch.channelType,
									)}`}
									onClick={() => handleTest(ch)}
									disabled={testMutation.isPending}
									className="h-[44px] min-w-[44px]"
								>
									{testMutation.isPending ? (
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
						</div>
					))}
				</div>
			)}

			<WebhookSecretDialog secret={signingSecret} onClose={() => setSigningSecret(null)} />
      <ChannelFormDialog
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

			<ChannelFormDialog
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

		</div>
    </SectionCard>
	);
}
