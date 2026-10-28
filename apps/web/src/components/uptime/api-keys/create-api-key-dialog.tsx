import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { isFutureUtcExpiry } from "@pulsy/db/api-key-expiry";
import { useDraftComparison } from "@/hooks/use-draft-comparison";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { FormField } from "@/components/ui/form-field";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { requestConfirmation } from "@/lib/confirmation";
/**
 * Create API key dialog.
 *
 * Two states: a name form, then a one-time reveal of the plaintext key with a
 * copy button. The secret is never shown again, so the reveal is explicit.
 *
 * @module components/uptime/api-keys/create-api-key-dialog
 */

import { Link } from "@tanstack/react-router";
import { BookOpen, Check, Copy, Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
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
  const client = useQueryClient();
	const { t } = useTranslation("uptimeMonitor");
	const createMutation = useCreateApiKey();
  const creating = useRef(false);
	const [name, setName] = useState("");
	const [scope, setScope] = useState<"read" | "full">("read"); const [expiry, setExpiry] = useState("");
  const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const firstValidUtc = tomorrow.toISOString().slice(0, 10);
  const expiresAt = expiry ? `${expiry}T23:59:59.999Z` : null;
  const expiryValid = !expiresAt || isFutureUtcExpiry(expiresAt);
	const [created, setCreated] = useState<CreatedApiKey | null>(null);
	const [copied, setCopied] = useState(false);
	const [revealed, setRevealed] = useState(false);
  const values = { name, scope, expiry };
  const draft = useDraftComparison(values, values, open && !created);
  const validation = useFormValidation();

	const handleClose = async () => {
    if (creating.current) return;
		// The secret exists only in this dialog's memory: closing before copying loses it for good.
		if (created && !copied && !await requestConfirmation(t("apiKeys.create.closeConfirm", "You have not copied this key. Closing forgets it permanently. Close anyway?"), { title: t("apiKeys.create.closeTitle"), action: t("common:actions.close") })) return;
		setRevealed(false);
		setName(""); setScope("read"); setExpiry("");
		setCreated(null);
		setCopied(false);
    validation.clear();
		onOpenChange(false);
	};

	const handleCreate = async () => {
    if (creating.current || !validation.validate(expiryValid ? [] : [{ id: "api-key-expiry", message: t("apiKeys.permissions.expiryInvalid") }])) return;
    creating.current = true;
		try {
			const key = await createMutation.mutateAsync({ name: name.trim(), scope, expiresAt });
			if (!isSessionClientActive(client)) return; draft.accept(); setCreated(key);
		} catch (error) { if (!isSessionClientActive(client)) return;
      if (!validation.server(error, { name: "api-key-name", scope: "api-key-scope", expiresAt: "api-key-expiry" })) toast.error(
				extractErrorMessage(
					error,
					t("apiKeys.create.error", "Failed to create API key"),
				),
			);
		}
    finally { creating.current = false; }
	};

	const handleCopy = async (value: string) => {
		try {
      await navigator.clipboard.writeText(value); setCopied(true);
      if (!isSessionClientActive(client)) return; toast.success(t("apiKeys.create.copied", "Copied"));
    } catch { if (!isSessionClientActive(client)) return; toast.error(t("detailUX.copyFailed")); }
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent hasUnsavedChanges={draft.dirty} className="sm:max-w-[var(--dialog-simple)]">
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
								id="api-key-secret" dir="ltr" autoComplete="off" type={revealed ? "text" : "password"}
								value={created.plaintext}
								readOnly
								className="font-mono"
							/>
							<Button
								variant="outline"
								size="icon"
								onClick={() => setRevealed(value => !value)}
								aria-pressed={revealed}
								className="h-[44px] w-[44px] shrink-0"
								aria-label={revealed ? t("apiKeys.create.hide", "Hide key") : t("apiKeys.create.reveal", "Show key")}
							>
								{revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
							</Button>
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
								className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
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
					<form id="api-key-create" {...draft.formProps} ref={validation.formRef} noValidate onSubmit={event => { event.preventDefault(); void handleCreate(); }} className="grid gap-4">
          <FormErrorSummary issues={validation.issues} />
					<FormField className="form-field">
						<Label htmlFor="api-key-name">
							{t("apiKeys.create.nameLabel", "Name")}
						</Label>
						<Input
							disabled={createMutation.isPending} id="api-key-name" validateOnBlur required {...validation.field("api-key-name")}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder={t(
								"apiKeys.create.namePlaceholder",
								"Example: CI pipeline",
							)}
							maxLength={100}
						/>
					</FormField>
					<FormField className="form-field"><Label htmlFor="api-key-scope">{t("apiKeys.permissions.scope")}</Label><Select disabled={createMutation.isPending} value={scope} onValueChange={value => setScope(value as "read" | "full")}><SelectTrigger id="api-key-scope" aria-label={t("apiKeys.permissions.scope")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="read">{t("apiKeys.permissions.read")}</SelectItem><SelectItem value="full">{t("apiKeys.permissions.full")}</SelectItem></SelectContent></Select></FormField>
          <FormField className="form-field"><Label htmlFor="api-key-expiry">{t("apiKeys.permissions.expiry")}</Label><DatePicker disabled={createMutation.isPending} id="api-key-expiry" min={firstValidUtc} value={expiry} {...validation.field("api-key-expiry", "api-key-expiry-help")} aria-invalid={!expiryValid || validation.issues.some(issue => issue.id === "api-key-expiry") || undefined} onValueChange={value => setExpiry(value ?? "")} /><p id="api-key-expiry-help" className={expiryValid ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{t(expiryValid ? "apiKeys.permissions.expiryHint" : "apiKeys.permissions.expiryInvalid")}</p></FormField>
          {<p id="api-key-privilege" className="rounded-md border bg-muted/50 p-3 text-sm">{scope === "full" ? t("apiKeys.create.privilegeFull", "This key will have full access (read and write) to your account through the API: it can create, change, pause and delete monitors and other settings. Treat it like a password.") : t("apiKeys.create.privilegeLimited", "This key will be read-only: it can read monitors, incidents and reports through the API but cannot change anything.")}</p>}
					</form>
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
                data-dialog-discard
								onClick={handleClose}
								className="h-[44px]"
							>
								{t("apiKeys.create.cancel", "Cancel")}
							</Button>
							<Button
								type="submit" form="api-key-create"
								aria-describedby="api-key-privilege"
								disabled={createMutation.isPending}
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
