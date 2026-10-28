import { isSessionClientActive } from "@/lib/session-query-client";
import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { FormField } from "@/components/ui/form-field";
import { EmailProviderDialog } from "./monitor-detail/tabs/email-providers-section";
import { UptimeService } from "@/services/uptime/uptimeService";
import { useQueryClient } from "@tanstack/react-query";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { FormErrorSummary, useFormValidation, type FormIssue } from "@/components/ui/form-validation";
import { parseRecipients } from "@/lib/uptime/recipients";
import { useId, useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
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
 error?: unknown;
 supportsTls?: boolean;
	onOpenChange: (open: boolean) => void;
	isEdit?: boolean;
 storedChannelType?: UptimeNotificationChannelType;
 hasStoredTarget?: boolean;
 storedTargetLabel?: string | null;
 storedHeaderNames?: string[];
	channelType: UptimeNotificationChannelType;
	setChannelType: (type: UptimeNotificationChannelType) => void;
	emailProviders: UptimeEmailProvider[];
	emailProviderId: string;
	setEmailProviderId: (providerId: string) => void;
	webhookUrl: string;
	setWebhookUrl: (url: string) => void;
	webhookHeaders: string;
	setWebhookHeaders: (headers: string) => void;
	recipients: string;
	setRecipients: (r: string) => void;
	notifyOnDown: boolean;
	notifyOnDegraded: boolean;
	setNotifyOnDegraded: (v: boolean) => void;
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
	recipients,
	setRecipients,
	notifyOnDown,
	notifyOnDegraded,
	setNotifyOnDegraded,
	setNotifyOnDown,
	notifyOnRecovery,
	setNotifyOnRecovery,
	notifyOnTlsExpiry,
	setNotifyOnTlsExpiry,
	tlsExpiryThresholdDays,
	setTlsExpiryThresholdDays,
	onSubmit,
	isPending,
 storedChannelType, hasStoredTarget, storedTargetLabel, storedHeaderNames = [], supportsTls = true, error,
}: ChannelFormDialogProps) {
	const { t } = useTranslation("uptimeMonitor");
 const fieldId = useId();
 const [providerOpen, setProviderOpen] = useState(false);
 const canRetainTarget = Boolean(isEdit && hasStoredTarget && channelType === storedChannelType);
 const [targetMode, setTargetMode] = useState(canRetainTarget ? "retain" : "replace");
 const [headersMode, setHeadersMode] = useState(isEdit ? "retain" : "replace");
 const [headersTouched, setHeadersTouched] = useState(false);
 const draftValues = { targetMode, headersMode, channelType, emailProviderId, webhookUrl, webhookHeaders, recipients, notifyOnDown, notifyOnDegraded, notifyOnRecovery, notifyOnTlsExpiry, tlsExpiryThresholdDays };
 const draft = useDraftComparison(draftValues, { ...draftValues, targetMode: canRetainTarget ? "retain" : "replace", headersMode: isEdit ? "retain" : "replace" }, open);
 const invalidHeaders = channelType === "webhook" && (!isEdit || headersMode === "replace") && parseWebhookHeaders(webhookHeaders) === false;
 useEffect(() => { if (open) { setTargetMode(canRetainTarget ? "retain" : "replace"); setHeadersMode(isEdit ? "retain" : "replace"); setRecipientsTouched(false); setHeadersTouched(false); } }, [open, canRetainTarget, isEdit]);
 const [recipientsTouched, setRecipientsTouched] = useState(false);
 const parsedRecipients = parseRecipients(recipients);
 const noProvider = channelType === "email" && emailProviders.length === 0;
 const chosenProvider = emailProviders.find(provider => provider.emailProviderId === emailProviderId);
 const invalidRecipients = recipientsTouched ? parsedRecipients.invalid : [];
 const validation = useFormValidation(() => {
   if (canRetainTarget && targetMode === "retain") return [];
   const issues: FormIssue[] = [];
   if (channelType === "telegram") {
     if (!/^\d+:[A-Za-z0-9_-]+$/.test(telegramBot)) issues.push({ id: "channel-target", message: t("notificationUX.telegramBotHelp") });
     if (!/^(?:-?\d+|@[A-Za-z0-9_]+)$/.test(telegramChat)) issues.push({ id: "telegram-chat", message: t("notificationUX.telegramChatHelp") });
   }
   return issues;
 }, { nonEmptyBlurOnly: true });
 const [telegramBot, setTelegramBot] = useState("");
 const [telegramChat, setTelegramChat] = useState("");
 useEffect(() => { if (open) { setTelegramBot(""); setTelegramChat(""); } }, [open, channelType]);
 useEffect(() => { if (!open) validation.clear(); }, [open]);
 useEffect(() => { if (error) validation.server(error, { webhookUrl: "channel-target", webhookHeaders: `${fieldId}-headers`, recipientAddresses: `${fieldId}-recipients`, recipients: `${fieldId}-recipients`, emailProviderId: `${fieldId}-provider`, tlsExpiryThresholdDays: "tls-expiry-threshold" }); }, [error]);

	return (
		<><Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent hasUnsavedChanges={draft.dirty} className="sm:max-w-[var(--dialog-standard)]">
				<form {...draft.formProps} ref={validation.formRef} onChangeCapture={event => validation.clear((event.target as HTMLElement).id)} noValidate className="dialog-form" onSubmit={event => {
 if (isPending) { event.preventDefault(); return; }
 const extra: FormIssue[] = [];
 if (!(canRetainTarget && targetMode === "retain")) {
   if (channelType === "telegram") {
     if (!/^\d+:[A-Za-z0-9_-]+$/.test(telegramBot)) extra.push({ id: "channel-target", message: t("notificationUX.telegramBotHelp") });
     if (!/^(?:-?\d+|@[A-Za-z0-9_]+)$/.test(telegramChat)) extra.push({ id: "telegram-chat", message: t("notificationUX.telegramChatHelp") });
   }
 }
 if (invalidHeaders) extra.push({ id: `${fieldId}-headers`, message: t("notifications.fields.webhookHeadersInvalid") });
 if (channelType === "email") {
   if (!emailProviderId) extra.push({ id: `${fieldId}-provider`, message: t("notificationUX.chooseProvider") });
   if (parsedRecipients.invalid.length || !parsedRecipients.recipients.length) extra.push({ id: `${fieldId}-recipients`, message: t("notificationUX.emailExample") });
 }
 setHeadersTouched(true); setRecipientsTouched(true);
 if (!validation.validate(extra)) { event.preventDefault(); return; }
 void onSubmit(event);
 }}>
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

					<div className="dialog-body grid gap-y-[var(--field-row-gap)]"><fieldset disabled={isPending} className="contents">
 <div className="h-32 overflow-y-auto"><FormErrorSummary issues={validation.issues} />
 {Boolean(error) && !validation.issues.length && <p role="alert" className="text-sm text-destructive">{typeof error === "string" ? error : extractErrorMessage(error, t("notifications.create.error"))}</p>}</div>
 {isEdit && <p className="text-sm text-muted-foreground">{t("notificationUX.retainSecrets")}</p>}
						<FormField className="form-field">
							<Label htmlFor={`${fieldId}-type`}>{t("notifications.fields.channelType")}</Label>
							<Select
								value={channelType}
								onValueChange={(v) =>
									{ validation.clear(); setWebhookUrl(""); setWebhookHeaders(""); setChannelType(v as UptimeNotificationChannelType); }
								}
							>
								<SelectTrigger id={`${fieldId}-type`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CHANNEL_TYPES.map((ct) => (
										<SelectItem key={ct} value={ct}>
											<span className="flex items-center gap-2">
												{t(`notifications.channelTypes.${ct}`, ct)}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</FormField>

						{channelType === "email" ? (
							<>
								<FormField className="form-field">
									<Label htmlFor={`${fieldId}-provider`}>{t("notifications.fields.emailProvider")}</Label>
									<Select
										value={emailProviderId}
										onValueChange={setEmailProviderId}
									>
										<SelectTrigger {...validation.field(`${fieldId}-provider`)} id={`${fieldId}-provider`}>
											<SelectValue
												placeholder={t(
													emailProviders.length ? "notificationUX.chooseProvider" : "notificationUX.noProviderOption",
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
									{noProvider && <div id={`${fieldId}-provider-help`} className="grid gap-1 rounded-md border bg-muted/50 p-3 text-sm"><p className="font-medium">{t("notificationUX.noProviderTitle")}</p><p className="text-muted-foreground">{t("notificationUX.noProviderBody")}</p></div>}
									<Button type="button" variant="outline" onClick={() => setProviderOpen(true)}>{t("actions.addProvider")}</Button>
									{chosenProvider && !chosenProvider.verified && <p className="text-sm text-muted-foreground">{t("notificationUX.providerUntestedHint")}</p>}
								</FormField>

								<FormField className="form-field">
									<Label htmlFor={`${fieldId}-recipients`}>{t("notifications.fields.recipients")}</Label>
									<Input id={`${fieldId}-recipients`}
										value={recipients}
										onChange={(e) => setRecipients(e.target.value)}
 dir="ltr" inputMode="email" autoComplete="off" onBlur={() => setRecipientsTouched(true)}
 {...validation.field(`${fieldId}-recipients`, `${fieldId}-recipients-help`)} aria-invalid={invalidRecipients.length > 0 || validation.field(`${fieldId}-recipients`)["aria-invalid"]}
										placeholder={t(
											"notifications.fields.recipientsPlaceholder",
										)}
										required
									/>
 <div id={`${fieldId}-recipients-help`} className="text-sm"><p className="text-muted-foreground">{t("notificationUX.recipientsHint")}</p>{invalidRecipients.length > 0 && <ul role="alert" className="text-destructive">{invalidRecipients.map((value, index) => <li key={index}>{t("notificationUX.invalidRecipient", { address: value })}</li>)}</ul>}</div>
								</FormField>
							</>
						) : (
							<FormField className="form-field">
								<Label htmlFor="channel-target">
									{ channelType === "telegram"
											? t(
													"notificationUX.telegramBotToken",
												)
											: t("notifications.fields.webhookUrl")}
								</Label>
								{canRetainTarget && <Select value={targetMode} onValueChange={value => { setTargetMode(value); setWebhookUrl(""); setTelegramBot(""); setTelegramChat(""); validation.clear("channel-target"); validation.clear("telegram-chat"); }}><SelectTrigger aria-label={t("notificationUX.targetAction")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="retain">{t("notificationUX.retain")}</SelectItem><SelectItem value="replace">{t("notificationUX.replace")}</SelectItem></SelectContent></Select>}
 <Input
									{...validation.field("channel-target", validation.issues.some(issue => issue.id === "channel-target") ? "channel-target-inline-error" : undefined)} id="channel-target"
									type={
										 channelType === "telegram"
												? "password"
												: "url"
									}
									inputMode={
										 undefined
									}
									dir="ltr" autoComplete="off" disabled={canRetainTarget && targetMode === "retain"}
									value={channelType === "telegram" ? telegramBot : webhookUrl}
									onChange={(e) => { if (channelType === "telegram") { setTelegramBot(e.target.value); setWebhookUrl(`${e.target.value}:${telegramChat}`); } else setWebhookUrl(e.target.value); }}
									placeholder={isEdit && targetMode === "retain" && storedTargetLabel ? storedTargetLabel : (
										 channelType === "telegram"
												? "123456:ABC"
												: channelType === "slack" ? "https://hooks.slack.com/services/…"
                      : channelType === "discord" ? "https://discord.com/api/webhooks/…"
                      : t("notifications.fields.webhookUrlPlaceholder")
									)}
 required={!canRetainTarget || targetMode === "replace"}
								/>
                <p id="channel-target-inline-error" className="min-h-10 text-sm text-destructive">{validation.issues.find(issue => issue.id === "channel-target")?.message}</p>
                {channelType === "telegram" && <>
                  <Label htmlFor="telegram-chat">{t("notificationUX.telegramChatId")}</Label>
                  <Input id="telegram-chat" {...validation.field("telegram-chat")} dir="ltr" autoComplete="off" disabled={canRetainTarget && targetMode === "retain"} value={telegramChat} required={!canRetainTarget || targetMode === "replace"} onChange={event => { setTelegramChat(event.target.value); setWebhookUrl(`${telegramBot}:${event.target.value}`); }} placeholder="-100123456789 / @channel" />
                  <p className="min-h-10 text-sm text-muted-foreground">{t("notificationUX.telegramChatHelp")}</p>
                </>}
							</FormField>
						)}

						{channelType === "webhook" && (
							<FormField className="form-field">
								<Label htmlFor={`${fieldId}-headers`}>
									{t(
										"notifications.fields.webhookHeaders",
										"Headers / options (JSON)",
									)}
								</Label>
								{isEdit && <Select value={headersMode} onValueChange={value => { validation.clear(`${fieldId}-headers`); setHeadersTouched(false); setHeadersMode(value); setWebhookHeaders(value === "clear" ? "{}" : ""); }}><SelectTrigger aria-label={t("notificationUX.headersAction")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="retain">{t("notificationUX.retain")}</SelectItem><SelectItem value="replace">{t("notificationUX.replace")}</SelectItem><SelectItem value="clear">{t("notificationUX.clear")}</SelectItem></SelectContent></Select>}
 <Textarea disabled={isEdit && headersMode !== "replace"} dir="ltr"
									id={`${fieldId}-headers`}
									value={webhookHeaders}
									onChange={(e) => { setWebhookHeaders(e.target.value); setHeadersTouched(false); }}
                  onBlur={() => setHeadersTouched(true)}
                  {...validation.field(`${fieldId}-headers`, `${fieldId}-headers-help${headersTouched && invalidHeaders ? ` ${fieldId}-headers-error` : ""}`)} aria-invalid={headersTouched && invalidHeaders || validation.field(`${fieldId}-headers`)["aria-invalid"]}
									placeholder={isEdit && headersMode === "retain" && storedHeaderNames.length ? JSON.stringify(Object.fromEntries(storedHeaderNames.map(name => [name, "••••••••"])), null, 2) : t(
										"notifications.fields.webhookHeadersPlaceholder",
										'{ "X-Pulsy-Test": "true" }',
									)}
									className="min-h-[88px] resize-y font-mono text-xs"
								/>
								<p id={`${fieldId}-headers-help`} className="text-xs text-muted-foreground">
									{t("notifications.fields.webhookHeadersHint")}
								</p>
                <p id={`${fieldId}-headers-error`} role={headersTouched && invalidHeaders ? "alert" : undefined} className="min-h-10 text-sm text-destructive">{headersTouched && invalidHeaders ? t("notifications.fields.webhookHeadersInvalid") : null}</p>
							</FormField>
						)}

<fieldset className="grid min-w-0 gap-3"><legend className="mb-3 text-sm font-medium">{t("notificationUX.events")}</legend>
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

                        <div className="flex min-h-11 items-center justify-between gap-3 rounded-md bg-muted/50 p-3">
                            <Label htmlFor="notifyDegraded">{t("notifications.fields.notifyOnDegraded")}</Label>
                            <Switch id="notifyDegraded" checked={notifyOnDegraded} onCheckedChange={setNotifyOnDegraded} />
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

						{!supportsTls && <p className="text-sm text-muted-foreground">{t("notificationUX.tlsUnavailable")}</p>}
						{supportsTls && <><div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
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
							<FormField className="form-field">
								<Label htmlFor="tls-expiry-threshold">
									{t("notifications.fields.tlsExpiryThresholdDays")}
								</Label>
								<Input
									{...validation.field("tls-expiry-threshold")} id="tls-expiry-threshold"
									type="number"
									min={1}
									max={90}
									value={tlsExpiryThresholdDays}
									onChange={(e) => setTlsExpiryThresholdDays(e.target.value)}
									required
								/>
							</FormField>
						)}</>}
</fieldset></fieldset>
					</div>

					<DialogFooter className="border-t pt-3">
						<Button
							type="button"
							variant="outline"
							data-dialog-discard onClick={() => onOpenChange(false)}
							className="h-[44px] w-full sm:w-auto"
						>
							{t("actions.cancel")}
						</Button>
						<Button
							type="submit"
							disabled={isPending || noProvider}
							aria-describedby={noProvider ? `${fieldId}-provider-help` : undefined}
							className="h-[44px] w-full sm:w-auto"
						>
							{isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
							{isEdit ? t("actions.save") : t("actions.addChannel")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>{providerOpen && <InlineProvider onClose={() => setProviderOpen(false)} onCreated={setEmailProviderId} />}</>
	);
}

function InlineProvider({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const client = useQueryClient(); const [busy, setBusy] = useState(false);
  return <EmailProviderDialog open onOpenChange={open => { if (!open) onClose(); }} isPending={busy} onSubmit={async input => { setBusy(true); try { const provider = await UptimeService.createEmailProvider(input); await client.invalidateQueries({ queryKey: uptimeKeys.emailProviders.all() }); if (!isSessionClientActive(client)) return; onCreated(provider.emailProviderId); onClose(); } finally { setBusy(false); } }} />;
}
