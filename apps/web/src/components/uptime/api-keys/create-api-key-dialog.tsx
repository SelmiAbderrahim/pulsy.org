/**
 * Create API key dialog.
 *
 * Two states: a name form, then a one-time reveal of the plaintext key with a
 * copy button. The secret is never shown again, so the reveal is explicit.
 *
 * @module components/uptime/api-keys/create-api-key-dialog
 */

import { Link } from "@tanstack/react-router";
import { BookOpen, Check, Copy, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
import { useCreateApiKey } from "@/hooks/apiKeys/useApiKeys";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { CreatedApiKey } from "@/types/apiKey";

interface CreateApiKeyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CreateApiKeyDialog({
	open,
	onOpenChange,
}: CreateApiKeyDialogProps) {
	const { t } = useTranslation("uptimeMonitor");
	const createMutation = useCreateApiKey();
	const [name, setName] = useState("");
	const [created, setCreated] = useState<CreatedApiKey | null>(null);
	const [copied, setCopied] = useState(false);

	const handleClose = () => {
		setName("");
		setCreated(null);
		setCopied(false);
		onOpenChange(false);
	};

	const handleCreate = async () => {
		try {
			const key = await createMutation.mutateAsync({ name: name.trim() });
			setCreated(key);
		} catch (error) {
			toast.error(
				extractErrorMessage(
					error,
					t("apiKeys.create.error", "Failed to create API key"),
				),
			);
		}
	};

	const handleCopy = async (value: string) => {
		await navigator.clipboard.writeText(value);
		setCopied(true);
		toast.success(t("apiKeys.create.copied", "Copied"));
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{t("apiKeys.create.title", "Create API key")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"apiKeys.create.description",
							"Give your key a name. The secret is shown once — store it somewhere safe.",
						)}
					</DialogDescription>
				</DialogHeader>

				{created ? (
					<div className="flex flex-col gap-3">
						<Label htmlFor="api-key-secret">
							{t("apiKeys.create.secretLabel", "Your API key")}
						</Label>
						<div className="flex items-center gap-2">
							<Input
								id="api-key-secret"
								value={created.plaintext}
								readOnly
								className="font-mono"
							/>
							<Button
								variant="outline"
								size="icon"
								onClick={() => handleCopy(created.plaintext)}
								className="h-[44px] w-[44px] shrink-0"
								aria-label={t("apiKeys.create.copy", "Copy")}
							>
								{copied ? (
									<Check className="h-4 w-4" />
								) : (
									<Copy className="h-4 w-4" />
								)}
							</Button>
						</div>
						<p className="flex items-start gap-2 text-xs text-muted-foreground">
							<TriangleAlert
								className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
								aria-hidden="true"
							/>
							{t(
								"apiKeys.create.secretHint",
								"Copy this now. You won't be able to see it again.",
							)}
						</p>
						<Link
							to="/dashboard/api-docs"
							onClick={handleClose}
							className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
						>
							<BookOpen className="h-4 w-4" />
							{t("apiKeys.create.docsLink", "How to use this key")}
						</Link>
					</div>
				) : (
					<div className="grid gap-2">
						<Label htmlFor="api-key-name">
							{t("apiKeys.create.nameLabel", "Name")}
						</Label>
						<Input
							id="api-key-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder={t(
								"apiKeys.create.namePlaceholder",
								"e.g. CI pipeline",
							)}
							maxLength={100}
						/>
					</div>
				)}

				<DialogFooter>
					{created ? (
						<Button onClick={handleClose} className="h-[44px]">
							{t("apiKeys.create.done", "Done")}
						</Button>
					) : (
						<>
							<Button
								variant="outline"
								onClick={handleClose}
								className="h-[44px]"
							>
								{t("apiKeys.create.cancel", "Cancel")}
							</Button>
							<Button
								onClick={handleCreate}
								disabled={createMutation.isPending || name.trim().length === 0}
								className="h-[44px]"
							>
								{createMutation.isPending && (
									<Loader2 className="h-4 w-4 me-2 animate-spin" />
								)}
								{createMutation.isPending
									? t("apiKeys.create.creating", "Creating…")
									: t("apiKeys.create.submit", "Create key")}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
