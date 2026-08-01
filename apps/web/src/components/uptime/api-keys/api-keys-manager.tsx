/**
 * API keys manager.
 *
 * Lists the user's keys in a table with inline create/revoke.
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
import { useApiKeys } from "@/hooks/apiKeys/useApiKeys";
import type { ApiKey } from "@/types/apiKey";

import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { RevokeApiKeyDialog } from "./revoke-api-key-dialog";

function formatDate(value: string): string {
	return new Date(value).toLocaleDateString();
}

export function ApiKeysManager() {
	const { t } = useTranslation("uptimeMonitor");
	const [createOpen, setCreateOpen] = useState(false);
	const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
	const keysQuery = useApiKeys();

	const header = (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap items-center gap-2">
				<h1 className="text-2xl font-semibold">
					{t("apiKeys.title", "API Keys")}
				</h1>
			</div>
			<p className="text-sm text-muted-foreground">
				{t(
					"apiKeys.description",
					"Create and manage API keys for the Pulsy REST API.",
				)}
			</p>
			<Link
				to="/dashboard/api-docs"
				className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
			>
				<BookOpen className="h-4 w-4" />
				{t("apiKeys.docsLink", "View API documentation")}
			</Link>
		</div>
	);

	const keys = keysQuery.data ?? [];

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				{header}
				<Button onClick={() => setCreateOpen(true)} className="h-[44px]">
					<Plus className="h-4 w-4 me-2" />
					{t("apiKeys.create.button", "Create API key")}
				</Button>
			</div>

			{keysQuery.isLoading ? (
				<div className="flex items-center justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : keys.length === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
					<KeyRound
						className="h-8 w-8 text-muted-foreground"
						aria-hidden="true"
					/>
					<p className="text-sm text-muted-foreground">
						{t("apiKeys.list.empty", "No API keys yet.")}
					</p>
				</div>
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="text-start">
									{t("apiKeys.list.name", "Name")}
								</TableHead>
								<TableHead className="text-start">
									{t("apiKeys.list.prefix", "Key")}
								</TableHead>
								<TableHead className="text-start hidden sm:table-cell">
									{t("apiKeys.list.created", "Created")}
								</TableHead>
								<TableHead className="text-start hidden md:table-cell">
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
									<TableCell className="font-medium">{key.name}</TableCell>
									<TableCell>
										<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
											{key.keyPrefix}…
										</code>
									</TableCell>
									<TableCell className="hidden sm:table-cell text-muted-foreground">
										{formatDate(key.createdAt)}
									</TableCell>
									<TableCell className="hidden md:table-cell text-muted-foreground">
										{key.lastUsedAt
											? formatDate(key.lastUsedAt)
											: t("apiKeys.list.never", "Never")}
									</TableCell>
									<TableCell className="text-end">
										<Button
											variant="ghost"
											size="sm"
											className="h-[44px] text-destructive hover:text-destructive"
											onClick={() => setKeyToRevoke(key)}
										>
											{t("apiKeys.revoke.button", "Revoke")}
										</Button>
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
