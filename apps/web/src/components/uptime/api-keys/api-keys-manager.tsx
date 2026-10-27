import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatDate } from "@/lib/date-format";
/**
 * API keys manager.
 *
 * Lists keys with their permissions, expiry and owner actions.
 *
 * @module components/uptime/api-keys/api-keys-manager
 */

import { Link } from "@tanstack/react-router";
import { BookOpen, KeyRound, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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
import { useApiKeys, useRemoveApiKey } from "@/hooks/apiKeys/useApiKeys";
import type { ApiKey } from "@/types/apiKey";

import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { RevokeApiKeyDialog } from "./revoke-api-key-dialog";



export function ApiKeysManager() {
	const { t, i18n } = useTranslation("uptimeMonitor");
  useDocumentTitle(t("apiKeys.title", "API keys"));
  const accountTimezone = useAccountTimezone();
  const remove = useRemoveApiKey();
	const [createOpen, setCreateOpen] = useState(false);
	const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);

	const keysQuery = useApiKeys();

	const inactive = (key: ApiKey) => Boolean(key.revokedAt || key.expiresAt && (!Number.isFinite(Date.parse(key.expiresAt)) || Date.parse(key.expiresAt) <= Date.now()));
  const keys = [...(keysQuery.data ?? [])].sort((a, b) => Number(inactive(a)) - Number(inactive(b)));
	const header = (
		<header className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				<h1 className="app-title">
					{t("apiKeys.title", "API keys")}
				</h1>

			</div>
        {(keys.length > 0 || keysQuery.isLoading || keysQuery.error) && <Button onClick={() => setCreateOpen(true)} className="w-full shrink-0 sm:w-auto"><Plus className="h-4 w-4" aria-hidden="true" />{t("apiKeys.create.button", "Create API key")}</Button>}
      </div>
			<p className="text-sm text-muted-foreground">
				{t(
					"apiKeys.description",
					"Create and manage API keys for the Pulsy REST API.",
				)}
			</p>
			<Link
				to="/dashboard/api-docs"
				className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
			>
				<BookOpen className="h-4 w-4" />
				{t("apiKeys.docsLink", "View API documentation")}
			</Link>
		</header>
	);

  const error = keysQuery.error;

	return (
		<div className="flex app-page flex-col gap-6">
			{header}

			{remove.error && <p role="alert" className="text-sm text-destructive">{t("apiKeys.removeError")}</p>}
      {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><p className="min-w-0 flex-1 text-sm">{t("apiKeys.loadError")}</p><Button variant="outline" onClick={() => { void keysQuery.refetch(); }}>{t("communication.retry")}</Button></div>}
      {keysQuery.isLoading ? (
				<div className="flex items-center justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : !error && keys.length === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-12 text-center">
					<KeyRound
						className="h-8 w-8 text-muted-foreground"
						aria-hidden="true"
					/>
					<p className="text-sm text-muted-foreground">
						{t("apiKeys.list.empty", "No API keys yet.")}
					</p>
          <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto"><Plus className="h-4 w-4" aria-hidden="true" />{t("apiKeys.create.button", "Create API key")}</Button>
				</div>
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<Table aria-label={t("apiKeys.title")} className="min-w-[520px]">
						<TableHeader>
							<TableRow>
								<TableHead className="text-start">
									{t("apiKeys.list.name", "Name")}
								</TableHead>
								<TableHead className="text-start">
									{t("apiKeys.list.prefix", "Key")}
								</TableHead>
								<TableHead className="text-start ">
									{t("apiKeys.list.created", "Created")}
								</TableHead>
								<TableHead className="text-start ">
									{t("apiKeys.list.lastUsed", "Last used")}
								</TableHead>
								<TableHead className="text-end">
									{t("apiKeys.list.actions", "Actions")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{keys.map((key) => (
								<TableRow key={key.apiKeyId}>
									<TableCell className="min-w-40 break-words font-medium">{key.name}{key.revokedAt ? <div><Badge variant="outline">{t("apiKeys.revoked")}</Badge><p className="text-sm text-muted-foreground">{t("apiKeys.revokedOn", { date: formatDate(key.revokedAt, i18n.language, accountTimezone) })}</p></div> : inactive(key) ? <Badge variant="outline">{t("apiKeys.expired")}</Badge> : null}<p className="text-sm font-normal text-muted-foreground">{t(key.scope === "read" ? "apiKeys.permissions.read" : "apiKeys.permissions.full")}</p><p className="text-sm font-normal text-muted-foreground">{key.expiresAt ? t("apiKeys.permissions.expires", { date: formatDate(key.expiresAt, i18n.language, accountTimezone) }) : t("apiKeys.permissions.noExpiry")}</p></TableCell>
									<TableCell>
										<code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
											{key.keyPrefix}…
										</code>
									</TableCell>
									<TableCell className=" text-muted-foreground">
										{formatDate(key.createdAt, i18n.language, accountTimezone)}
									</TableCell>
									<TableCell className=" text-muted-foreground">
										{key.lastUsedAt
											? formatDate(key.lastUsedAt, i18n.language, accountTimezone)
											: t("apiKeys.list.never", "Never")}
									</TableCell>
									<TableCell className="text-end">
										{key.revokedAt ? <Button variant="ghost" className="min-h-11" disabled={remove.isPending} aria-label={`${t("apiKeys.remove")} ${key.name}`} onClick={() => remove.mutate(key.apiKeyId)}>{t("apiKeys.remove")}</Button> : !inactive(key) && <Button
											variant="ghost"
											size="sm"
											className="h-[44px] text-destructive hover:text-destructive"
											aria-label={`${t("apiKeys.revoke.button", "Revoke")} ${key.name}`}
                      onClick={() => setKeyToRevoke(key)}
										>
											{t("apiKeys.revoke.button", "Revoke")}
										</Button>}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<CreateApiKeyDialog open={createOpen} onOpenChange={setCreateOpen} />
			<RevokeApiKeyDialog
				open={keyToRevoke !== null}
				onOpenChange={(open) => {
					if (!open) {
						setKeyToRevoke(null);
					}
				}}
				apiKey={keyToRevoke}
			/>
		</div>
	);
}
