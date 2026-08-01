import { Globe, Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
	useUptimeDefaultChannels,
	useUptimeEmailProviders,
} from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type {
	UptimeNotificationChannel,
	UptimeNotificationChannelType,
} from "@/types/uptime";

/**
 * Account-level default notification channels. These apply to every monitor
 * the user owns — including monitors created later — without per-monitor
 * setup. Monitor-specific channels take precedence for the same target.
 */
export function DefaultChannelsSection() {
	const { t } = useTranslation("uptimeMonitor");
	const { data: channels } = useUptimeDefaultChannels();
	const { data: emailProviders } = useUptimeEmailProviders();
	const createMutation = useCreateUptimeDefaultChannel();
	const updateMutation = useUpdateUptimeNotificationChannel();
	const deleteMutation = useDeleteUptimeNotificationChannel();
	const testMutation = useTestUptimeNotificationChannel();
	const [createOpen, setCreateOpen] = useState(false);
	const [editChannel, setEditChannel] =
		useState<UptimeNotificationChannel | null>(null);

	// Form state (shared by create + edit dialogs)
	const [channelType, setChannelType] =
		useState<UptimeNotificationChannelType>("email");
	const [emailProviderId, setEmailProviderId] = useState("");
	const [webhookUrl, setWebhookUrl] = useState("");
	const [webhookHeaders, setWebhookHeaders] = useState("");
	const [recipients, setRecipients] = useState("");
	const [notifyOnDown, setNotifyOnDown] = useState(true);
	const [notifyOnRecovery, setNotifyOnRecovery] = useState(true);
	const [notifyOnTlsExpiry, setNotifyOnTlsExpiry] = useState(false);
	const [tlsExpiryThresholdDays, setTlsExpiryThresholdDays] = useState("14");

	const resetForm = () => {
		setChannelType("email");
		setEmailProviderId("");
		setWebhookUrl("");
		setWebhookHeaders("");
		setRecipients("");
		setNotifyOnDown(true);
		setNotifyOnRecovery(true);
		setNotifyOnTlsExpiry(false);
		setTlsExpiryThresholdDays("14");
	};

	const openCreateDialog = () => {
		resetForm();
		setCreateOpen(true);
	};

	const openEditDialog = (channel: UptimeNotificationChannel) => {
		setEditChannel(channel);
		setChannelType(channel.channelType);
		setEmailProviderId(channel.emailProviderId ?? "");
		// Secret values are write-only. Blank fields preserve the encrypted values;
		// masked metadata is passed to the dialog as placeholder text.
		setWebhookUrl("");
		setWebhookHeaders("");
		setRecipients(channel.recipientAddresses?.join(", ") ?? "");
		setNotifyOnDown(channel.notifyOnDown);
		setNotifyOnRecovery(channel.notifyOnRecovery);
		setNotifyOnTlsExpiry(channel.notifyOnTlsExpiry);
		setTlsExpiryThresholdDays(String(channel.tlsExpiryThresholdDays));
	};

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (channelType === "email" && !emailProviderId) {
			toast.error(
				t(
					"notifications.create.emailProviderRequired",
					"Select an email provider before adding an email channel",
				),
			);
			return;
		}
		const parsedWebhookHeaders =
			channelType === "email"
				? undefined
				: parseWebhookHeaders(webhookHeaders);
		if (parsedWebhookHeaders === false) {
			toast.error(
				t(
					"notifications.fields.webhookHeadersInvalid",
					"Headers must be a JSON object with string values",
				),
			);
			return;
		}
		try {
			await createMutation.mutateAsync({
				channelType,
				emailProviderId: channelType === "email" ? emailProviderId : undefined,
				webhookUrl: channelType !== "email" ? webhookUrl : undefined,
				webhookHeaders:
					channelType !== "email" ? parsedWebhookHeaders : undefined,
				recipientAddresses:
					channelType === "email"
						? recipients
								.split(",")
								.map((s) => s.trim())
								.filter(Boolean)
						: undefined,
				notifyOnDown,
				notifyOnRecovery,
				notifyOnTlsExpiry,
				tlsExpiryThresholdDays: Number(tlsExpiryThresholdDays),
			});
			toast.success(t("notifications.create.success"));
			resetForm();
			setCreateOpen(false);
		} catch (error) {
			toast.error(extractErrorMessage(error, t("notifications.create.error")));
		}
	};

	const handleEdit = async (e: React.FormEvent) => {
		e.preventDefault();
		// defensive: the edit form only renders when `editChannel` is set, so this
		// guard's early-return is unreachable from the UI.
		/* v8 ignore next */
		if (!editChannel) return;
		if (channelType === "email" && !emailProviderId) {
			toast.error(
				t(
					"notifications.create.emailProviderRequired",
					"Select an email provider before saving an email channel",
				),
			);
			return;
		}
		const parsedWebhookHeaders =
			channelType === "email"
				? undefined
				: parseWebhookHeaders(webhookHeaders);
		if (parsedWebhookHeaders === false) {
			toast.error(
				t(
					"notifications.fields.webhookHeadersInvalid",
					"Headers must be a JSON object with string values",
				),
			);
			return;
		}
		const secretUpdates =
			channelType === "email"
				? { webhookUrl: null, webhookHeaders: null }
				: {
						...(webhookUrl.trim() ? { webhookUrl } : {}),
						...(parsedWebhookHeaders !== undefined
							? { webhookHeaders: parsedWebhookHeaders }
							: {}),
					};
		try {
			await updateMutation.mutateAsync({
				channelId: editChannel.channelId,
				uptimeMonitorId: null,
				channelType,
				emailProviderId: channelType === "email" ? emailProviderId : null,
				...secretUpdates,
				recipientAddresses:
					channelType === "email"
						? recipients
								.split(",")
								.map((s) => s.trim())
								.filter(Boolean)
						: undefined,
				notifyOnDown,
				notifyOnRecovery,
				notifyOnTlsExpiry,
				tlsExpiryThresholdDays: Number(tlsExpiryThresholdDays),
			});
			toast.success(
				t("notifications.edit.success", "Channel updated successfully"),
			);
			setEditChannel(null);
			resetForm();
		} catch (error) {
			toast.error(
				extractErrorMessage(
					error,
					t("notifications.edit.error", "Failed to update channel"),
				),
			);
		}
	};

	const handleDelete = async (channelId: string) => {
		try {
			await deleteMutation.mutateAsync({ channelId, uptimeMonitorId: null });
			toast.success(t("notifications.delete.success"));
		} catch (error) {
			toast.error(extractErrorMessage(error, t("notifications.delete.error")));
		}
	};

	const handleTest = async (channelId: string) => {
		try {
			await testMutation.mutateAsync(channelId);
			toast.success(t("notifications.test.success"));
		} catch (error) {
			toast.error(extractErrorMessage(error, t("notifications.test.error")));
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h3 className="text-lg font-medium">
						{t("notificationSettings.defaults.title", "Default Channels")}
					</h3>
					<p className="text-sm text-muted-foreground">
						{t(
							"notificationSettings.defaults.description",
							"Alert channels that apply to all your monitors automatically, including ones you create later.",
						)}
					</p>
				</div>
				<Button
					onClick={openCreateDialog}
					size="sm"
					className="h-[44px] shrink-0"
				>
					<Plus className="h-4 w-4 me-2" />
					{t("notificationSettings.defaults.add", "Add default channel")}
				</Button>
			</div>

			{!channels || channels.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
					<Globe className="h-8 w-8 text-muted-foreground mb-2" />
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
								</div>
								<p className="text-xs text-muted-foreground truncate mt-1">
									{ch.channelType === "email"
										? ch.recipientAddresses?.join(", ")
										: ch.webhookUrlMasked}
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
									onClick={() => handleTest(ch.channelId)}
									disabled={testMutation.isPending}
									className="h-[44px] min-w-[44px]"
								>
									{testMutation.isPending ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Send className="h-3.5 w-3.5" />
									)}
								</Button>
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

			<ChannelFormDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				channelType={channelType}
				setChannelType={setChannelType}
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
				setNotifyOnDown={setNotifyOnDown}
				notifyOnRecovery={notifyOnRecovery}
				setNotifyOnRecovery={setNotifyOnRecovery}
				notifyOnTlsExpiry={notifyOnTlsExpiry}
				setNotifyOnTlsExpiry={setNotifyOnTlsExpiry}
				tlsExpiryThresholdDays={tlsExpiryThresholdDays}
				setTlsExpiryThresholdDays={setTlsExpiryThresholdDays}
				onSubmit={handleCreate}
				isPending={createMutation.isPending}
			/>

			<ChannelFormDialog
				open={Boolean(editChannel)}
				onOpenChange={(open) => {
					if (!open) {
						setEditChannel(null);
						resetForm();
					}
				}}
				isEdit
				channelType={channelType}
				setChannelType={setChannelType}
				emailProviders={emailProviders ?? []}
				emailProviderId={emailProviderId}
				setEmailProviderId={setEmailProviderId}
				webhookUrl={webhookUrl}
				setWebhookUrl={setWebhookUrl}
				webhookHeaders={webhookHeaders}
				setWebhookHeaders={setWebhookHeaders}
				hasStoredWebhookUrl={editChannel?.hasWebhookUrl}
				webhookUrlMasked={editChannel?.webhookUrlMasked}
				hasStoredWebhookHeaders={editChannel?.hasWebhookHeaders}
				webhookHeaderNames={editChannel?.webhookHeaderNames}
				recipients={recipients}
				setRecipients={setRecipients}
				notifyOnDown={notifyOnDown}
				setNotifyOnDown={setNotifyOnDown}
				notifyOnRecovery={notifyOnRecovery}
				setNotifyOnRecovery={setNotifyOnRecovery}
				notifyOnTlsExpiry={notifyOnTlsExpiry}
				setNotifyOnTlsExpiry={setNotifyOnTlsExpiry}
				tlsExpiryThresholdDays={tlsExpiryThresholdDays}
				setTlsExpiryThresholdDays={setTlsExpiryThresholdDays}
				onSubmit={handleEdit}
				isPending={updateMutation.isPending}
			/>
		</div>
	);
}
