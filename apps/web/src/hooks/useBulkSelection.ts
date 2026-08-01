/**
 * useBulkSelection Hook
 *
 * Core hook for managing bulk selection state across lists.
 * Supports filtering by deletability and tracking warnings.
 *
 * @module hooks/useBulkSelection
 */

import { useCallback, useMemo, useState } from "react";
import type {
	UseBulkSelectionOptions,
	UseBulkSelectionReturn,
} from "@/types/bulk-selection";

/**
 * Hook for managing bulk selection state.
 */
export function useBulkSelection<T>(
	options: UseBulkSelectionOptions<T>,
): UseBulkSelectionReturn<T> {
	const {
		items,
		getItemId,
		canDeleteItem = () => true,
		getItemWarning = () => null,
	} = options;

	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	const selectableItems = useMemo(
		() => items.filter((item) => canDeleteItem(item)),
		[items, canDeleteItem],
	);

	const itemsById = useMemo(() => {
		const map = new Map<string, T>();
		for (const item of items) {
			map.set(getItemId(item), item);
		}
		return map;
	}, [items, getItemId]);

	const selectedItems = useMemo(
		() =>
			Array.from(selectedIds)
				.map((id) => itemsById.get(id))
				.filter((item): item is T => item !== undefined),
		[selectedIds, itemsById],
	);

	const selectableIds = useMemo(
		() => new Set(selectableItems.map(getItemId)),
		[selectableItems, getItemId],
	);

	const selectionCount = selectedIds.size;
	const hasSelection = selectionCount > 0;

	const isAllSelected = useMemo(() => {
		if (selectableItems.length === 0) return false;
		return selectableItems.every((item) => selectedIds.has(getItemId(item)));
	}, [selectableItems, selectedIds, getItemId]);

	const isPartiallySelected = useMemo(() => {
		if (selectableItems.length === 0) return false;
		const selectedCount = selectableItems.filter((item) =>
			selectedIds.has(getItemId(item)),
		).length;
		return selectedCount > 0 && selectedCount < selectableItems.length;
	}, [selectableItems, selectedIds, getItemId]);

	const itemsWithWarnings = useMemo(
		() =>
			selectedItems
				.map((item) => {
					const warning = getItemWarning(item);
					return warning ? { item, warning } : null;
				})
				.filter(
					(result): result is { item: T; warning: string } => result !== null,
				),
		[selectedItems, getItemWarning],
	);

	const deletableSelectedItems = useMemo(
		() => selectedItems.filter((item) => canDeleteItem(item)),
		[selectedItems, canDeleteItem],
	);

	const select = useCallback(
		(id: string) => {
			if (!selectableIds.has(id)) return;
			setSelectedIds((prev) => {
				const next = new Set(prev);
				next.add(id);
				return next;
			});
		},
		[selectableIds],
	);

	const deselect = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
	}, []);

	const toggle = useCallback(
		(id: string) => {
			if (!selectableIds.has(id)) return;
			setSelectedIds((prev) => {
				const next = new Set(prev);
				if (next.has(id)) {
					next.delete(id);
				} else {
					next.add(id);
				}
				return next;
			});
		},
		[selectableIds],
	);

	const selectAll = useCallback(() => {
		setSelectedIds(new Set(selectableItems.map(getItemId)));
	}, [selectableItems, getItemId]);

	const deselectAll = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const toggleAll = useCallback(() => {
		if (isAllSelected) {
			deselectAll();
		} else {
			selectAll();
		}
	}, [isAllSelected, selectAll, deselectAll]);

	const clearSelection = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	return {
		selectedIds,
		selectedItems,
		selectableItems,
		isAllSelected,
		isPartiallySelected,
		hasSelection,
		selectionCount,
		select,
		deselect,
		toggle,
		selectAll,
		deselectAll,
		toggleAll,
		clearSelection,
		deletableSelectedItems,
		itemsWithWarnings,
	};
}

export default useBulkSelection;
