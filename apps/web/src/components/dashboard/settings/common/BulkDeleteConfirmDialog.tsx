import { FormField } from "@/components/ui/form-field";
import { formatCount } from "@/lib/count-format";
/**
 * BulkDeleteConfirmDialog Component
 *
 * Dangerous action confirmation modal with input validation.
 * Requires user to type "DELETE {count}" to confirm.
 *
 * @module components/dashboard/settings/common/BulkDeleteConfirmDialog
 */

import { AlertTriangle, Loader2 } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { BulkDeleteConfirmDialogProps } from "@/types/bulk-selection";
import { BulkNameList } from "./BulkNameList";

/**
 * Confirmation dialog for bulk delete operations.
 */
export function BulkDeleteConfirmDialog<T>({
	open,
	onOpenChange,
	items,
	itemType,
	getItemName,
	getItemWarning,
	getItemId,
	constraints,
	description,
	onConfirm,
	isDeleting = false,
}: BulkDeleteConfirmDialogProps<T>) {
	const { t, i18n } = useTranslation("common");
	const [confirmInput, setConfirmInput] = useState("");

	useEffect(() => {
		if (!open) {
			setConfirmInput("");
		}
	}, [open]);

	const itemCount = items.length;
	const expectedInput = `DELETE ${itemCount}`;

	const isInputValid =
		confirmInput.toUpperCase() === expectedInput.toUpperCase();

	const itemsWithWarnings = getItemWarning
		? items.filter((item) => getItemWarning(item) !== null)
		: [];
	const warningCount = itemsWithWarnings.length;

	// Every affected name stays reachable: the list scrolls (and windows beyond 100 rows).
	const listItems = items.map((item, index) => ({
		id: getItemId?.(item) ?? String(index),
		name: getItemName(item),
		detail: getItemWarning?.(item) ?? null,
	}));

	const getItemTypeLabel = (count: number) => {
		const labels: Record<string, { singular: string; plural: string }> = {
			server: {
				singular: t("bulkSelection.itemTypes.server", "server"),
				plural: t("bulkSelection.itemTypes.servers", "servers"),
			},
			user: {
				singular: t("bulkSelection.itemTypes.user", "user"),
				plural: t("bulkSelection.itemTypes.users", "users"),
			},
			monitor: {
				singular: t("bulkSelection.itemTypes.monitor", "monitor"),
				plural: t("bulkSelection.itemTypes.monitors", "monitors"),
			},
			channel: {
				singular: t("bulkSelection.itemTypes.channel", "channel"),
				plural: t("bulkSelection.itemTypes.channels", "channels"),
			},
			account: {
				singular: t("bulkSelection.itemTypes.account", "account"),
				plural: t("bulkSelection.itemTypes.accounts", "accounts"),
			},
		};
		const label = labels[itemType] || {
			singular: itemType,
			plural: `${itemType}s`,
		};
		return formatCount((key, options) => t(key, { ...options, defaultValue: count === 1 ? label.singular : label.plural }), `bulkSelection.itemTypes.${itemType}`, count, i18n.language);
	};

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setConfirmInput(e.target.value);
		},
		[],
	);

	const handleConfirm = useCallback(async () => {
		// defensive: the confirm button is disabled until the typed phrase is
		// valid, so this guard's early-return is unreachable from the UI.
		/* v8 ignore next */
		if (!isInputValid) return;
		await onConfirm();
	}, [isInputValid, onConfirm]);

	const handleOpenChange = useCallback(
		(newOpen: boolean) => {
			if (isDeleting) return;
			onOpenChange(newOpen);
		},
		[isDeleting, onOpenChange],
	);

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent className="max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<AlertTriangle className="h-5 w-5 text-destructive" />
						{t(
							"bulkSelection.confirmDelete.title",
							"Delete {{count}} {{type}}?",
							{
								count: itemCount,
								type: getItemTypeLabel(itemCount),
							},
						)}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{description ? `${description} ` : ""}
						{t(
							"bulkSelection.confirmDelete.warning",
							"This action cannot be undone.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="space-y-3">
					<p className="text-sm font-medium">
						{t(
							"bulkSelection.confirmDelete.itemsLabel",
							"You are about to delete:",
						)}
					</p>
					<BulkNameList
						items={listItems}
						label={t("bulkSelection.confirmDelete.listLabel", "Items to delete ({{count}})", { count: itemCount })}
					/>

					{constraints && constraints.length > 0 ? (
						<div role="note" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
								{constraints.map(constraint => (
									<li key={constraint.key} className="flex gap-1">
										<AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
										<span>{constraint.message}</span>
									</li>
								))}
							</ul>
						</div>
					) : warningCount > 0 && (
						<div role="note" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
							<p className="text-sm text-amber-700 dark:text-amber-400">
								<AlertTriangle aria-hidden className="inline h-4 w-4 me-1 align-text-bottom" />
								{t(
									"bulkSelection.warnings.someItemsHaveConstraints",
									"{{count}} {{type}} have constraints that may require manual cleanup.",
									{
										count: warningCount,
										type: getItemTypeLabel(warningCount),
									},
								)}
							</p>
						</div>
					)}

					<FormField className="space-y-2 pt-2">
						<Label htmlFor="bulk-delete-confirm">
							{t(
								"bulkSelection.confirmDelete.inputLabel",
								'Type "{{confirmation}}" to confirm:',
								{ confirmation: expectedInput },
							)}
						</Label>
						<Input
							id="bulk-delete-confirm"
							type="text"
							placeholder={expectedInput}
							value={confirmInput}
							onChange={handleInputChange}
							disabled={isDeleting}
							className="min-h-[44px] font-mono"
							autoComplete="off"
							autoFocus
						/>
					</FormField>
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel className="min-h-[44px]" disabled={isDeleting}>
						{t("bulkSelection.confirmDelete.cancel", "Cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={handleConfirm}
						disabled={!isInputValid || isDeleting}
						className={cn(
							"min-h-[44px]",
							"bg-destructive text-destructive-foreground hover:bg-destructive/90",
						)}
					>
						{isDeleting ? (
							<>
								<Loader2 className="me-2 h-4 w-4 animate-spin" />
								{t("bulkSelection.deleting", "Deleting...")}
							</>
						) : (
							t(
								"bulkSelection.confirmDelete.confirm",
								"Delete {{count}} {{type}}",
								{
									count: itemCount,
									type: getItemTypeLabel(itemCount),
								},
							)
						)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export default BulkDeleteConfirmDialog;
