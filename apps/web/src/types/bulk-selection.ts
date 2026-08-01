/**
 * Bulk Selection Types
 *
 * TypeScript interfaces for bulk selection functionality.
 *
 * @module types/bulk-selection
 */

/**
 * Options for the useBulkSelection hook.
 *
 * Note: `T` is unconstrained (the item's id is provided via `getItemId`), so
 * domain entities like `UptimeMonitor` that use a custom id field work without
 * an `id` property.
 */
export interface UseBulkSelectionOptions<T> {
	/** Array of items available for selection */
	items: T[];
	/** Function to get unique ID from item */
	getItemId: (item: T) => string;
	/** Optional function to determine if item can be deleted */
	canDeleteItem?: (item: T) => boolean;
	/** Optional function to get warning message for item */
	getItemWarning?: (item: T) => string | null;
	/** Optional function to get display name for item */
	getItemDisplayName?: (item: T) => string;
}

/**
 * Return type for the useBulkSelection hook
 */
export interface UseBulkSelectionReturn<T> {
	// State
	selectedIds: Set<string>;
	selectedItems: T[];
	selectableItems: T[];
	isAllSelected: boolean;
	isPartiallySelected: boolean;
	hasSelection: boolean;
	selectionCount: number;

	// Actions
	select: (id: string) => void;
	deselect: (id: string) => void;
	toggle: (id: string) => void;
	selectAll: () => void;
	deselectAll: () => void;
	toggleAll: () => void;
	clearSelection: () => void;

	// Computed
	deletableSelectedItems: T[];
	itemsWithWarnings: Array<{ item: T; warning: string }>;
}

/**
 * Props for BulkDeleteConfirmDialog
 */
export interface BulkDeleteConfirmDialogProps<T> {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	items: T[];
	itemType: "server" | "monitor" | "channel" | "account" | "user";
	getItemName: (item: T) => string;
	getItemWarning?: (item: T) => string | null;
	onConfirm: () => void | Promise<void>;
	isDeleting?: boolean;
}

/**
 * Props for SelectableCheckbox
 */
export interface SelectableCheckboxProps {
	checked: boolean;
	indeterminate?: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	label?: string;
	className?: string;
}
