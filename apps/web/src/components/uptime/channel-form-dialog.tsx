import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
	UptimeEmailProvider,
	UptimeNotificationChannelType,
} from "@/types/uptime";

const CHANNEL_TYPES: UptimeNotificationChannelType[] = [
	"email",
	"webhook",
	"slack",
	"discord",
	"telegram",
];

/**
 * Parse the headers textarea into a header map. Returns `undefined` for an
 * empty input and `false` for anything that is not a JSON object of strings.
 */
export function parseWebhookHeaders(
	value: string,
): Record<string, string> | undefined | false {
	if (!value.trim()) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return false;
		}

		const entries = Object.entries(parsed);
		if (!entries.every(([, entryValue]) => typeof entryValue === "string")) {
			return false;
		}

		return Object.fromEntries(entries) as Record<string, string>;
	} catch {
		return false;
	}
}

export interface ChannelFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isEdit?: boolean;
	channelType: UptimeNotificationChannelType;
	setChannelType: (type: UptimeNotificationChannelType) => void;
	emailProviders: UptimeEmailProvider[];
	emailProviderId: string;
	setEmailProviderId: (providerId: string) => void;
	webhookUrl: string;
	setWebhookUrl: (url: string) => void;
	webhookHeaders: string;
	setWebhookHeaders: (headers: string) => void;
	hasStoredWebhookUrl?: boolean;
	webhookUrlMasked?: string | null;
	hasStoredWebhookHeaders?: boolean;
	webhookHeaderNames?: string[];
	recipients: string;
	setRecipients: (r: string) => void;
	notifyOnDown: boolean;
	setNotifyOnDown: (v: boolean) => void;
	notifyOnRecovery: boolean;
	setNotifyOnRecovery: (v: boolean) => void;
	notifyOnTlsExpiry: boolean;
	setNotifyOnTlsExpiry: (v: boolean) => void;
	tlsExpiryThresholdDays: string;
	setTlsExpiryThresholdDays: (v: string) => void;
	onSubmit: (e: React.FormEvent) => void;
	isPending: boolean;
}

/**
 * Shared create/edit form for notification channels — used by the monitor
 * Notifications tab and the account-level default channels section.
 */
export function ChannelFormDialog({
	open,
	onOpenChange,
	isEdit = false,
	channelType,
	setChannelType,
	emailProviders,
	emailProviderId,
	setEmailProviderId,
	webhookUrl,
	setWebhookUrl,
	webhookHeaders,
	setWebhookHeaders,
	hasStoredWebhookUrl = false,
	webhookUrlMasked = null,
	hasStoredWebhookHeaders = false,
	webhookHeaderNames = [],
	recipients,
	setRecipients,
	notifyOnDown,
	setNotifyOnDown,
	notifyOnRecovery,
	setNotifyOnRecovery,
	notifyOnTlsExpiry,
	setNotifyOnTlsExpiry,
	tlsExpiryThresholdDays,
	setTlsExpiryThresholdDays,
	onSubmit,
	isPending,
}: ChannelFormDialogProps) {
	const { t } = useTranslation("uptimeMonitor");
	const targetPlaceholder =
		isEdit && hasStoredWebhookUrl
			? (webhookUrlMasked ?? "••••••••")
			: channelType === "telegram"
				? t(
						"notifications.fields.telegramTargetPlaceholder",
						"123456:ABC:987654 or https://api.telegram.org/bot...",
					)
				: t("notifications.fields.webhookUrlPlaceholder");
	const headersPlaceholder =
		isEdit && hasStoredWebhookHeaders
			? webhookHeaderNames.length > 0
				? JSON.stringify(
						Object.fromEntries(
							webhookHeaderNames.map((headerName) => [
								headerName,
								"••••••••",
							]),
						),
						null,
						2,
					)
				: "••••••••"
			: t(
					"notifications.fields.webhookHeadersPlaceholder",
					'{ "X-Pulsy-Test": "true" }',
				);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[420px]">
				<form onSubmit={onSubmit}>
					<DialogHeader>
						<DialogTitle>
							{isEdit
								? t("notifications.edit.title", "Edit Notification Channel")
								: t("notifications.create.title")}
						</DialogTitle>
						<DialogDescription className="sr-only">
							{t("notifications.description")}
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label>{t("notifications.fields.channelType")}</Label>
							<Select
								value={channelType}
								onValueChange={(v) =>
									setChannelType(v as UptimeNotificationChannelType)
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CHANNEL_TYPES.map((ct) => (
										<SelectItem key={ct} value={ct}>
											{t(`notifications.channelTypes.${ct}`, ct)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{channelType === "email" ? (
							<>
								<div className="grid gap-2">
									<Label>{t("notifications.fields.emailProvider")}</Label>
									<Select
										value={emailProviderId}
										onValueChange={setEmailProviderId}
									>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"notifications.fields.emailProvider",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{emailProviders.map((provider) => (
												<SelectItem
													key={provider.emailProviderId}
													value={provider.emailProviderId}
												>
													{provider.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								<div className="grid gap-2">
									<Label>{t("notifications.fields.recipients")}</Label>
									<Input
										value={recipients}
										onChange={(e) => setRecipients(e.target.value)}
										placeholder={t(
											"notifications.fields.recipientsPlaceholder",
										)}
										required
									/>
								</div>
							</>
						) : (
							<div className="grid gap-2">
								<Label htmlFor="channel-target">
									{channelType === "telegram"
										? t(
												"notifications.fields.telegramTarget",
												"Telegram Target",
											)
										: t("notifications.fields.webhookUrl")}
								</Label>
								<Input
									id="channel-target"
									type={channelType === "telegram" ? "text" : "url"}
									value={webhookUrl}
									onChange={(e) => setWebhookUrl(e.target.value)}
									placeholder={targetPlaceholder}
									required={!isEdit || !hasStoredWebhookUrl}
								/>
							</div>
						)}

						{channelType !== "email" && (
							<div className="grid gap-2">
								<Label htmlFor="webhook-headers">
									{t(
										"notifications.fields.webhookHeaders",
										"Headers / Options (JSON)",
									)}
								</Label>
								<Textarea
									id="webhook-headers"
									value={webhookHeaders}
									onChange={(e) => setWebhookHeaders(e.target.value)}
									placeholder={headersPlaceholder}
									className="min-h-[88px] resize-y font-mono text-xs"
								/>
								<p className="text-xs text-muted-foreground">
									{channelType === "telegram"
										? t(
												"notifications.fields.telegramHeadersHint",
												'Use { "chat_id": "123456" } when the Telegram API URL does not include chat_id.',
											)
										: t(
												"notifications.fields.webhookHeadersHint",
												"Optional JSON object. Values must be strings.",
											)}
								</p>
							</div>
						)}

						<div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
							<Label htmlFor="notifyDown">
								{t("notifications.fields.notifyOnDown")}
							</Label>
							<Switch
								id="notifyDown"
								checked={notifyOnDown}
								onCheckedChange={setNotifyOnDown}
							/>
						</div>

						<div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
							<Label htmlFor="notifyRecovery">
								{t("notifications.fields.notifyOnRecovery")}
							</Label>
							<Switch
								id="notifyRecovery"
								checked={notifyOnRecovery}
								onCheckedChange={setNotifyOnRecovery}
							/>
						</div>

						<div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
							<Label htmlFor="notifyTlsExpiry">
								{t("notifications.fields.notifyOnTlsExpiry")}
							</Label>
							<Switch
								id="notifyTlsExpiry"
								checked={notifyOnTlsExpiry}
								onCheckedChange={setNotifyOnTlsExpiry}
							/>
						</div>

						{notifyOnTlsExpiry && (
							<div className="grid gap-2">
								<Label htmlFor="tls-expiry-threshold">
									{t("notifications.fields.tlsExpiryThresholdDays")}
								</Label>
								<Input
									id="tls-expiry-threshold"
									type="number"
									min={1}
									max={365}
									value={tlsExpiryThresholdDays}
									onChange={(e) => setTlsExpiryThresholdDays(e.target.value)}
									required
								/>
							</div>
						)}
					</div>

					<DialogFooter className="border-t pt-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							className="h-[44px] w-full sm:w-auto"
						>
							{t("actions.cancel")}
						</Button>
						<Button
							type="submit"
							disabled={isPending}
							className="h-[44px] w-full sm:w-auto"
						>
							{isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
							{isEdit ? t("actions.save") : t("actions.addChannel")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
