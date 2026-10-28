import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { FormField } from "@/components/ui/form-field";
import { SectionCard } from "@/components/ui/section-card";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { requestConfirmation } from "@/lib/confirmation";
import { Loader2, Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	useCreateUptimeEmailProvider,
	useDeleteUptimeEmailProvider,
	useTestUptimeEmailProvider,
	useUpdateUptimeEmailProvider,
	useUptimeEmailProviders,
} from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type {
	CreateUptimeEmailProviderInput,
	UptimeEmailProvider,
	UptimeEmailProviderType,
} from "@/types/uptime";

const PROVIDER_TYPES: UptimeEmailProviderType[] = [
	"resend",
	"sendgrid",
	"smtp",
];

export function EmailProvidersSection() {
	const { t } = useTranslation("uptimeMonitor");
 const client = useQueryClient();
	const { data: providers, isPending: loading, error: loadError, refetch } = useUptimeEmailProviders();
 const [testResult, setTestResult] = useState("");
	const createMutation = useCreateUptimeEmailProvider();
	const updateMutation = useUpdateUptimeEmailProvider();
	const deleteMutation = useDeleteUptimeEmailProvider();
	const testMutation = useTestUptimeEmailProvider();

	const [createOpen, setCreateOpen] = useState(false);
	const [editProvider, setEditProvider] = useState<UptimeEmailProvider | null>(
		null,
	);

	const handleDelete = async (provider: UptimeEmailProvider) => {
 if (!await requestConfirmation(t("notificationUX.deleteProvider", { name: provider.name }), { title: t("notificationUX.deleteProviderTitle"), action: t("common:actions.delete") })) return;
		try {
			await deleteMutation.mutateAsync(provider.emailProviderId);
			if (!isSessionClientActive(client)) return;
 toast.success(t("emailProviders.delete.success"));
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			toast.error(extractErrorMessage(error, t("emailProviders.delete.error")));
		}
	};

	const handleTest = async (providerId: string) => {
 setTestResult("");
		try {
			await testMutation.mutateAsync(providerId);
			if (!isSessionClientActive(client)) return;
 toast.success(t("emailProviders.test.success"));
 setTestResult(t("emailProviders.test.success"));
		} catch (error) {
 if (!isSessionClientActive(client)) return;
			const message = extractErrorMessage(error, t("emailProviders.test.error"));
 toast.error(message); setTestResult(message);
		}
	};

 if (loading) return <SectionCard title={t("emailProviders.title")}><p role="status">{t("notificationUX.loadingProviders")}</p></SectionCard>;
 if (loadError && !providers) return <SectionCard title={t("emailProviders.title")}><div role="alert" className="grid gap-2"><p>{t("notificationUX.errorProviders")}</p><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" variant="outline" onClick={() => void refetch()}>{t("workspace.retry")}</Button></div></SectionCard>;
	if (!providers || providers.length === 0) {
		return (
			<SectionCard title={t("emailProviders.title")} >
				<div className="flex flex-col items-center justify-center text-center">
					<Mail className="h-6 w-6 text-muted-foreground mb-2" />
					<p className="font-medium">{t("emailProviders.empty")}</p>
					<p className="text-sm text-muted-foreground mt-1">
						{t("emailProviders.emptyDescription")}
					</p>
					<Button onClick={() => setCreateOpen(true)} className="mt-4 h-[44px]">
						<Plus className="h-4 w-4 me-2" />
						{t("actions.addProvider")}
					</Button>
				</div>

				<EmailProviderDialog
					open={createOpen}
					onOpenChange={setCreateOpen}
					onSubmit={async (input) => {
						await createMutation.mutateAsync(input);
 if (!isSessionClientActive(client)) return;
 toast.success(t("emailProviders.create.success"));
						setCreateOpen(false);
					}}
					isPending={createMutation.isPending}
				/>
			</SectionCard>
		);
	}

	return (
<SectionCard title={t("emailProviders.title")} description={t("emailProviders.description")} headerEnd={<Button
					onClick={() => setCreateOpen(true)}
					size="sm"
					className="max-w-full whitespace-normal"
				>
					<Plus className="h-4 w-4 me-2" />
					{t("actions.addProvider")}
				</Button>}><div className="grid gap-4">

			<p className="text-sm text-muted-foreground">{t("notificationUX.providerTestDestination")}</p>{testResult && <p role="status" className="break-words text-sm">{testResult}</p>}
 <div role="region" tabIndex={0} aria-label={t("emailProviders.title")} className="w-full min-w-0 overflow-x-auto rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="text-start">
								{t("emailProviders.fields.name")}
							</TableHead>
							<TableHead className="text-start">
								{t("emailProviders.fields.providerType")}
							</TableHead>
							<TableHead className="text-start">
								{t("emailProviders.fields.fromAddress")}
							</TableHead>
							<TableHead className="text-end">
								{t("list.columns.actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{providers.map((provider) => (
							<TableRow key={provider.emailProviderId}>
								<TableCell className="font-medium"><span className="block break-words">{provider.name}</span><Badge variant="outline">{t(provider.verified ? "notificationUX.providerVerified" : "notificationUX.providerUntested")}</Badge></TableCell>
								<TableCell>
									<Badge variant="outline">
										{t(
											`emailProviders.providerTypes.${provider.providerType}`,
											provider.providerType,
										)}
									</Badge>
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{provider.fromAddress}
								</TableCell>
								<TableCell className="text-end">
									<div className="flex items-center justify-end gap-1">
										<Button
											variant="outline"
											size="sm"
											onClick={() => handleTest(provider.emailProviderId)}
											disabled={testMutation.isPending}
											className="h-[44px]"
										>
											{testMutation.isPending ? (
												<>
													<Loader2 className="h-4 w-4 me-1 animate-spin" />
													{t("emailProviders.testCredentials.testing")}
												</>
											) : (
												<>
													<Send className="h-4 w-4 me-1 rtl:scale-x-[-1]" />
													{t("emailProviders.testCredentials.label")}
												</>
											)}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											aria-label={`${t("actions.edit")} ${provider.name}`}
											onClick={() => setEditProvider(provider)}
											className="h-[44px] min-w-[44px]"
										>
											<Pencil className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											aria-label={`${t("actions.delete")} ${provider.name}`}
											onClick={() => handleDelete(provider)}
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

			{/* Create Dialog */}
			<EmailProviderDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onSubmit={async (input) => {
					await createMutation.mutateAsync(input);
 if (!isSessionClientActive(client)) return;
 toast.success(t("emailProviders.create.success"));
					setCreateOpen(false);
				}}
				isPending={createMutation.isPending}
			/>

			{/* Edit Dialog */}
			{editProvider && (
				<EmailProviderDialog
					open={Boolean(editProvider)}
					onOpenChange={(open) => {
						if (!open) setEditProvider(null);
					}}
					provider={editProvider}
					onSubmit={async (input) => {
						await updateMutation.mutateAsync({
							emailProviderId: editProvider.emailProviderId,
							...input,
						});
						if (!isSessionClientActive(client)) return;
 toast.success(t("emailProviders.edit.success"));
						setEditProvider(null);
					}}
					isPending={updateMutation.isPending}
				/>
			)}
		</div></SectionCard>
	);
}

interface EmailProviderDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	provider?: UptimeEmailProvider;
	onSubmit: (input: CreateUptimeEmailProviderInput) => Promise<void>;
	isPending: boolean;
}

export function EmailProviderDialog({
	open,
	onOpenChange,
	provider,
	onSubmit,
	isPending,
}: EmailProviderDialogProps) {
	const { t } = useTranslation("uptimeMonitor");
 const client = useQueryClient();
	const isEdit = Boolean(provider);
 const [errorMessage, setErrorMessage] = useState("");
  const fieldId = useId();
  const validation = useFormValidation();
  const fieldMessage = (field: string) => { const issue = validation.issues.find(issue => issue.id === `${fieldId}-${field}`); return issue ? <p className="text-sm text-destructive">{issue.message}</p> : null; };

	const [name, setName] = useState(provider?.name ?? "");
	const [providerType, setProviderType] = useState<UptimeEmailProviderType>(
		provider?.providerType ?? "resend",
	);
	const [apiKey, setApiKey] = useState("");
	const [fromAddress, setFromAddress] = useState(provider?.fromAddress ?? "");
	const [smtpHost, setSmtpHost] = useState(provider?.smtpHost ?? "");
	const [smtpPort, setSmtpPort] = useState(String(provider?.smtpPort ?? 587));
	const [smtpUsername, setSmtpUsername] = useState(
		provider?.smtpUsername ?? "",
	);
	const [smtpPassword, setSmtpPassword] = useState("");
	const [smtpSecure, setSmtpSecure] = useState(provider?.smtpSecure ?? true);
  const draftValues = { name, providerType, apiKey, fromAddress, smtpHost, smtpPort, smtpUsername, smtpPassword, smtpSecure };
  const draft = useDraftComparison(draftValues, draftValues, open);

  useEffect(() => {
    if (open) return;
    setName(provider?.name ?? ""); setProviderType(provider?.providerType ?? "resend");
    setApiKey(""); setFromAddress(provider?.fromAddress ?? "");
    setSmtpHost(provider?.smtpHost ?? ""); setSmtpPort(String(provider?.smtpPort ?? 587));
    setSmtpUsername(provider?.smtpUsername ?? ""); setSmtpPassword(""); setSmtpSecure(provider?.smtpSecure ?? true);
    setErrorMessage(""); validation.clear();
  }, [open]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
 if (isPending) return;
 setErrorMessage("");
 if (!validation.validate()) return;
		try {
			await onSubmit({
				name: name.trim(),
				providerType,
				apiKey:
					providerType !== "smtp" && (!isEdit || apiKey)
						? apiKey
						: undefined,
				fromAddress: fromAddress.trim(),
				smtpHost: providerType === "smtp" ? smtpHost : undefined,
				smtpPort: providerType === "smtp" ? Number(smtpPort) : undefined,
				smtpUsername: providerType === "smtp" ? smtpUsername : undefined,
				smtpPassword:
					providerType === "smtp" && (!isEdit || smtpPassword)
						? smtpPassword
						: undefined,
				smtpSecure: providerType === "smtp" ? smtpSecure : undefined,
			});
		} catch (error) {
 if (!isSessionClientActive(client)) return;
      if (validation.server(error, Object.fromEntries(["name", "fromAddress", "providerType", "apiKey", "smtpHost", "smtpPort", "smtpUsername", "smtpPassword"].map(key => [key, `${fieldId}-${key}`])))) return;
      setErrorMessage(extractErrorMessage(error, t("emailProviders.test.error")));
			toast.error(
				extractErrorMessage(
					error,
					isEdit
						? t("emailProviders.edit.error")
						: t("emailProviders.create.error"),
				),
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[var(--dialog-standard)]">
				<form {...draft.formProps} ref={validation.formRef} onChangeCapture={event => validation.clear((event.target as HTMLElement).id)} noValidate className="dialog-form" onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>
							{isEdit
								? t("emailProviders.edit.title")
								: t("emailProviders.create.title")}
						</DialogTitle>
						<DialogDescription className="sr-only">
							{t("emailProviders.description")}
						</DialogDescription>
					</DialogHeader>

					<div className="dialog-body grid gap-y-[var(--field-row-gap)] py-6"><fieldset disabled={isPending} className="contents">
 <FormErrorSummary issues={validation.issues} />
 {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
 {isEdit && <div id={`${fieldId}-secret-help`} className="grid gap-1 text-sm text-muted-foreground"><p>{t("notificationUX.retainSecrets")}</p><p>{t("notificationUX.reverifyHint")}</p></div>}
						<FormField className="form-field">
							<Label htmlFor={`${fieldId}-name`}>{t("emailProviders.fields.name")}</Label>
							<Input {...validation.field(`${fieldId}-name`)} id={`${fieldId}-name`}
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={t("emailProviders.fields.namePlaceholder")}
								required
							/>
              {fieldMessage("name")}
						</FormField>

						<FormField className="form-field">
							<Label htmlFor={`${fieldId}-providerType`}>{t("emailProviders.fields.providerType")}</Label>
							<Select
								value={providerType}
								onValueChange={(v) =>
									setProviderType(v as UptimeEmailProviderType)
								}
							>
								<SelectTrigger id={`${fieldId}-providerType`} {...validation.field(`${fieldId}-providerType`)}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PROVIDER_TYPES.map((pt) => (
										<SelectItem key={pt} value={pt}>
											{t(`emailProviders.providerTypes.${pt}`, pt)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
              {fieldMessage("providerType")}
						</FormField>

						<FormField className="form-field">
							<Label htmlFor={`${fieldId}-fromAddress`}>{t("emailProviders.fields.fromAddress")}</Label>
							<Input {...validation.field(`${fieldId}-fromAddress`)} id={`${fieldId}-fromAddress`}
								type="email"
								value={fromAddress}
								onChange={(e) => setFromAddress(e.target.value)}
								placeholder={t("emailProviders.fields.fromAddressPlaceholder")}
								required
							/>
              {fieldMessage("fromAddress")}
						</FormField>

						{providerType !== "smtp" ? (
							<FormField className="form-field">
								<Label htmlFor={`${fieldId}-apiKey`}>{t("emailProviders.fields.apiKey")}</Label>
								<Input {...validation.field(`${fieldId}-apiKey`, isEdit ? `${fieldId}-secret-help` : undefined)} id={`${fieldId}-apiKey`}
									type="password" autoComplete="new-password"
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									placeholder={isEdit ? t("notificationUX.storedSecretPlaceholder") : t("emailProviders.fields.apiKeyPlaceholder")}
									required={!isEdit}
								/>
              {fieldMessage("apiKey")}
							</FormField>
						) : (
							<>
								<div className="form-grid grid-cols-1 sm:grid-cols-2">
									<FormField className="form-field">
										<Label htmlFor={`${fieldId}-smtpHost`}>{t("emailProviders.fields.smtpHost")}</Label>
										<Input {...validation.field(`${fieldId}-smtpHost`)} id={`${fieldId}-smtpHost`}
											value={smtpHost}
											onChange={(e) => setSmtpHost(e.target.value)}
											placeholder={t(
												"emailProviders.fields.smtpHostPlaceholder",
											)}
											required
										/>
              {fieldMessage("smtpHost")}
									</FormField>
									<FormField className="form-field">
										<Label htmlFor={`${fieldId}-smtpPort`}>{t("emailProviders.fields.smtpPort")}</Label>
										<Input {...validation.field(`${fieldId}-smtpPort`)} id={`${fieldId}-smtpPort`}
											type="number"
											value={smtpPort}
											onChange={(e) => setSmtpPort(e.target.value)}
											min={1}
											max={65535}
											required
										/>
              {fieldMessage("smtpPort")}
									</FormField>
								</div>

								<FormField className="form-field">
									<Label htmlFor={`${fieldId}-smtpUsername`}>{t("emailProviders.fields.smtpUsername")}</Label>
									<Input {...validation.field(`${fieldId}-smtpUsername`)} id={`${fieldId}-smtpUsername`}
										required value={smtpUsername}
										onChange={(e) => setSmtpUsername(e.target.value)}
									/>
              {fieldMessage("smtpUsername")}
								</FormField>

								<FormField className="form-field">
									<Label htmlFor={`${fieldId}-smtpPassword`}>{t("emailProviders.fields.smtpPassword")}</Label>
									<Input {...validation.field(`${fieldId}-smtpPassword`, isEdit ? `${fieldId}-secret-help` : undefined)} id={`${fieldId}-smtpPassword`}
										type="password" autoComplete="new-password"
										value={smtpPassword} placeholder={isEdit ? t("notificationUX.storedSecretPlaceholder") : undefined}
										onChange={(e) => setSmtpPassword(e.target.value)}
										required={!isEdit}
									/>
              {fieldMessage("smtpPassword")}
								</FormField>

								<div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
									<Label htmlFor="smtp-secure">
										{t("emailProviders.fields.smtpSecure")}
									</Label>
									<Switch
										id="smtp-secure"
										checked={smtpSecure}
										onCheckedChange={setSmtpSecure}
									/>
								</div>
							</>
						)}
					</fieldset></div>

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
							disabled={isPending}
							className="h-[44px] w-full sm:w-auto"
						>
							{isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
							{isEdit ? t("actions.save") : t("actions.addProvider")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
