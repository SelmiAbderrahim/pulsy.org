import { Loader2, Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
	const { data: providers } = useUptimeEmailProviders();
	const createMutation = useCreateUptimeEmailProvider();
	const updateMutation = useUpdateUptimeEmailProvider();
	const deleteMutation = useDeleteUptimeEmailProvider();
	const testMutation = useTestUptimeEmailProvider();

	const [createOpen, setCreateOpen] = useState(false);
	const [editProvider, setEditProvider] = useState<UptimeEmailProvider | null>(
		null,
	);

	const handleDelete = async (provider: UptimeEmailProvider) => {
		try {
			await deleteMutation.mutateAsync(provider.emailProviderId);
			toast.success(t("emailProviders.delete.success"));
		} catch (error) {
			toast.error(extractErrorMessage(error, t("emailProviders.delete.error")));
		}
	};

	const handleTest = async (providerId: string) => {
		try {
			await testMutation.mutateAsync(providerId);
			toast.success(t("emailProviders.test.success"));
		} catch (error) {
			toast.error(extractErrorMessage(error, t("emailProviders.test.error")));
		}
	};

	if (!providers || providers.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center p-12 text-center">
					<Mail className="h-10 w-10 text-muted-foreground mb-3" />
					<p className="font-medium">{t("emailProviders.empty")}</p>
					<p className="text-sm text-muted-foreground mt-1">
						{t("emailProviders.emptyDescription")}
					</p>
					<Button onClick={() => setCreateOpen(true)} className="mt-4 h-[44px]">
						<Plus className="h-4 w-4 me-2" />
						{t("actions.addProvider")}
					</Button>
				</CardContent>

				<EmailProviderDialog
					open={createOpen}
					onOpenChange={setCreateOpen}
					onSubmit={async (input) => {
						await createMutation.mutateAsync(input);
						toast.success(t("emailProviders.create.success"));
						setCreateOpen(false);
					}}
					isPending={createMutation.isPending}
				/>
			</Card>
		);
	}

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<h3 className="text-lg font-medium">{t("emailProviders.title")}</h3>
					<p className="text-sm text-muted-foreground">
						{t("emailProviders.description")}
					</p>
				</div>
				<Button
					onClick={() => setCreateOpen(true)}
					size="sm"
					className="h-[44px] w-full sm:w-auto"
				>
					<Plus className="h-4 w-4 me-2" />
					{t("actions.addProvider")}
				</Button>
			</div>

			<div className="w-full min-w-0 overflow-x-auto rounded-lg border">
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
								<TableCell className="font-medium">{provider.name}</TableCell>
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
						toast.success(t("emailProviders.edit.success"));
						setEditProvider(null);
					}}
					isPending={updateMutation.isPending}
				/>
			)}
		</div>
	);
}

interface EmailProviderDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	provider?: UptimeEmailProvider;
	onSubmit: (input: CreateUptimeEmailProviderInput) => Promise<void>;
	isPending: boolean;
}

function EmailProviderDialog({
	open,
	onOpenChange,
	provider,
	onSubmit,
	isPending,
}: EmailProviderDialogProps) {
	const { t } = useTranslation("uptimeMonitor");
	const isEdit = Boolean(provider);

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

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			await onSubmit({
				name,
				providerType,
				apiKey:
					providerType !== "smtp" && (!isEdit || apiKey)
						? apiKey
						: undefined,
				fromAddress,
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
			<DialogContent className="sm:max-w-[420px]">
				<form onSubmit={handleSubmit}>
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

					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label>{t("emailProviders.fields.name")}</Label>
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={t("emailProviders.fields.namePlaceholder")}
								required
							/>
						</div>

						<div className="grid gap-2">
							<Label>{t("emailProviders.fields.providerType")}</Label>
							<Select
								value={providerType}
								onValueChange={(v) =>
									setProviderType(v as UptimeEmailProviderType)
								}
							>
								<SelectTrigger>
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
						</div>

						<div className="grid gap-2">
							<Label>{t("emailProviders.fields.fromAddress")}</Label>
							<Input
								type="email"
								value={fromAddress}
								onChange={(e) => setFromAddress(e.target.value)}
								placeholder={t("emailProviders.fields.fromAddressPlaceholder")}
								required
							/>
						</div>

						{providerType !== "smtp" ? (
							<div className="grid gap-2">
								<Label>{t("emailProviders.fields.apiKey")}</Label>
								<Input
									type="password"
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									placeholder={t("emailProviders.fields.apiKeyPlaceholder")}
									required={!isEdit}
								/>
							</div>
						) : (
							<>
								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<div className="grid gap-2">
										<Label>{t("emailProviders.fields.smtpHost")}</Label>
										<Input
											value={smtpHost}
											onChange={(e) => setSmtpHost(e.target.value)}
											placeholder={t(
												"emailProviders.fields.smtpHostPlaceholder",
											)}
											required
										/>
									</div>
									<div className="grid gap-2">
										<Label>{t("emailProviders.fields.smtpPort")}</Label>
										<Input
											type="number"
											value={smtpPort}
											onChange={(e) => setSmtpPort(e.target.value)}
											min={1}
											max={65535}
											required
										/>
									</div>
								</div>

								<div className="grid gap-2">
									<Label>{t("emailProviders.fields.smtpUsername")}</Label>
									<Input
										value={smtpUsername}
										onChange={(e) => setSmtpUsername(e.target.value)}
									/>
								</div>

								<div className="grid gap-2">
									<Label>{t("emailProviders.fields.smtpPassword")}</Label>
									<Input
										type="password"
										value={smtpPassword}
										onChange={(e) => setSmtpPassword(e.target.value)}
										required={!isEdit}
									/>
								</div>

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
							{isEdit ? t("actions.save") : t("actions.addProvider")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
