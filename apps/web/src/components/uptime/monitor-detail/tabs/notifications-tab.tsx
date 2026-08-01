import { Bell, Info, Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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

function DeliveryHistorySection({ monitorId }: { monitorId: string }) {
	const { t } = useTranslation("uptimeMonitor");
	return (
		<div className="flex flex-col gap-3">
			<div>
				<h3 className="text-lg font-medium">
					{t("notifications.history.title")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t("notifications.history.description")}
				</p>
			</div>
			<NotificationLogTable monitorId={monitorId} />
		</div>
	);
}

interface NotificationsTabProps {
	monitorId: string;
}

function DefaultChannelsNotice() {
	const { t } = useTranslation("uptimeMonitor");
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
				})}
			</p>
		</div>
	);
}

export function NotificationsTab({ monitorId }: NotificationsTabProps) {
	const { t } = useTranslation("uptimeMonitor");
	const { data: channels } = useUptimeNotificationChannels(monitorId);
	const { data: emailProviders } = useUptimeEmailProviders();
	const createMutation = useCreateUptimeNotificationChannel();
	const updateMutation = useUpdateUptimeNotificationChannel();
	const deleteMutation = useDeleteUptimeNotificationChannel();
	const testMutation = useTestUptimeNotificationChannel();
	const [createOpen, setCreateOpen] = useState(false);
	const [editChannel, setEditChannel] =
		useState<UptimeNotificationChannel | null>(null);

	// Create form state
	const [channelType, setChannelType] =
		useState<UptimeNotificationChannelType>("webhook");
	const [emailProviderId, setEmailProviderId] = useState("");
	const [webhookUrl, setWebhookUrl] = useState("");
	const [webhookHeaders, setWebhookHeaders] = useState("");
	const [recipients, setRecipients] = useState("");
	const [notifyOnDown, setNotifyOnDown] = useState(true);
	const [notifyOnRecovery, setNotifyOnRecovery] = useState(true);
	const [notifyOnTlsExpiry, setNotifyOnTlsExpiry] = useState(false);
	const [tlsExpiryThresholdDays, setTlsExpiryThresholdDays] = useState("14");

	const resetForm = () => {
		setChannelType("webhook");
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
		// Secret values are write-only. A blank edit field means "keep the stored
		// value"; the masked DTO fields are used only as placeholders below.
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
				uptimeMonitorId: monitorId,
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
				uptimeMonitorId: monitorId,
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
			await deleteMutation.mutateAsync({
				channelId,
				uptimeMonitorId: monitorId,
			});
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

	if (!channels || channels.length === 0) {
		return (
			<div className="flex min-w-0 flex-col gap-4">
				<DefaultChannelsNotice />
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
					<Bell className="h-10 w-10 text-muted-foreground mb-3" />
					<p className="font-medium">{t("notifications.empty")}</p>
					<p className="text-sm text-muted-foreground mt-1">
						{t("notifications.emptyDescription")}
					</p>
					<Button
						onClick={openCreateDialog}
						className="mt-4 h-[44px]"
					>
						<Plus className="h-4 w-4 me-2" />
						{t("actions.addChannel")}
					</Button>
				</div>
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

				{/* Email Providers */}
				<EmailProvidersSection />

				{/* Delivery history */}
				<DeliveryHistorySection monitorId={monitorId} />
			</div>
		);
	}

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<DefaultChannelsNotice />
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h3 className="text-lg font-medium">{t("notifications.title")}</h3>
				<Button
					onClick={openCreateDialog}
					size="sm"
					className="h-[44px] w-full sm:w-auto"
				>
					<Plus className="h-4 w-4 me-2" />
					{t("actions.addChannel")}
				</Button>
			</div>

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
									{ch.channelType === "email"
										? ch.recipientAddresses?.join(", ")
										: ch.webhookUrlMasked}
								</TableCell>
								<TableCell>
									{ch.notifyOnDown
										? t("notifications.fields.yes")
										: t("notifications.fields.no")}
								</TableCell>
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
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

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

			{/* Email Providers */}
			<EmailProvidersSection />

			{/* Delivery history */}
			<DeliveryHistorySection monitorId={monitorId} />
		</div>
	);
}
