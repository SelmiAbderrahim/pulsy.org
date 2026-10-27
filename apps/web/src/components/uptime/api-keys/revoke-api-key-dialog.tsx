import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { FormField } from "@/components/ui/form-field";
/**
 * Revoke API key dialog — type-to-confirm danger action.
 *
 * The user must type the confirmation word (REVOKE) to enable the destructive
 * button, per the bulk-selection danger pattern.
 *
 * @module components/uptime/api-keys/revoke-api-key-dialog
 */

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

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
import { useRevokeApiKey } from "@/hooks/apiKeys/useApiKeys";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { ApiKey } from "@/types/apiKey";

interface RevokeApiKeyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	apiKey: ApiKey | null;
}

export function RevokeApiKeyDialog({
	open,
	onOpenChange,
	apiKey,
}: RevokeApiKeyDialogProps) {
  const client = useQueryClient();
	const { t } = useTranslation("uptimeMonitor");
	const revokeMutation = useRevokeApiKey();
	const [confirmText, setConfirmText] = useState("");

	const confirmWord = t("apiKeys.revoke.confirmWord", "REVOKE");
	const canConfirm =
		confirmText.trim().toUpperCase() === confirmWord.toUpperCase();

	const handleClose = () => {
		setConfirmText("");
		onOpenChange(false);
	};

	const handleRevoke = async () => {
		if (!apiKey || !canConfirm) {
			return;
		}
		try {
			await revokeMutation.mutateAsync({ apiKeyId: apiKey.apiKeyId });
			if (!isSessionClientActive(client)) return; toast.success(t("apiKeys.revoke.success", "API key revoked"));
			handleClose();
		} catch (error) { if (!isSessionClientActive(client)) return;
			toast.error(
				extractErrorMessage(
					error,
					t("apiKeys.revoke.error", "Failed to revoke API key"),
				),
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-[var(--dialog-simple)]">
				<DialogHeader>
					<DialogTitle>
						{t("apiKeys.revoke.title", "Revoke API key")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"apiKeys.revoke.description",
							'Revoking "{{name}}" immediately breaks any integration using it. This cannot be undone.',
							{ name: apiKey?.name ?? "" },
						)}
					</DialogDescription>
				</DialogHeader>

				<FormField className="form-field">
					<Label htmlFor="api-key-revoke-confirm">
						{t("apiKeys.revoke.confirmLabel", "Type REVOKE to confirm")}
					</Label>
					<Input
						id="api-key-revoke-confirm"
						value={confirmText}
						onChange={(event) => setConfirmText(event.target.value)}
						placeholder={confirmWord}
						autoComplete="off"
					/>
				</FormField>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={handleClose}
						className="h-[44px]"
					>
						{t("apiKeys.revoke.cancel", "Cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={handleRevoke}
						disabled={!canConfirm || revokeMutation.isPending}
						className="h-[44px]"
					>
						{revokeMutation.isPending && (
							<Loader2 className="h-4 w-4 me-2 animate-spin" />
						)}
						{revokeMutation.isPending
							? t("apiKeys.revoke.revoking", "Revoking…")
							: t("apiKeys.revoke.submit", "Revoke key")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
