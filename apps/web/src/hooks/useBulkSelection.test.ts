import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBulkSelection } from "./useBulkSelection";

interface Row {
	id: string;
	name: string;
	locked?: boolean;
	warn?: boolean;
}

const rows: Row[] = [
	{ id: "a", name: "Alpha" },
	{ id: "b", name: "Bravo", warn: true },
	{ id: "c", name: "Charlie", locked: true },
];

function setup(overrides?: {
	items?: Row[];
	canDeleteItem?: (item: Row) => boolean;
	getItemWarning?: (item: Row) => string | null;
}) {
	return renderHook(
		(props: { items: Row[] }) =>
			useBulkSelection<Row>({
				items: props.items,
				getItemId: (item) => item.id,
				canDeleteItem: overrides?.canDeleteItem,
				getItemWarning: overrides?.getItemWarning,
			}),
		{ initialProps: { items: overrides?.items ?? rows } },
	);
}

describe("useBulkSelection", () => {
	it("starts empty", () => {
		const { result } = renderHook(() =>
			useBulkSelection<Row>({ items: rows, getItemId: (i) => i.id }),
		);
		expect(result.current.selectedIds.size).toBe(0);
		expect(result.current.hasSelection).toBe(false);
		expect(result.current.selectionCount).toBe(0);
		expect(result.current.isAllSelected).toBe(false);
		expect(result.current.isPartiallySelected).toBe(false);
		expect(result.current.selectableItems).toHaveLength(3);
	});

	it("toggles a single id on and off", () => {
		const { result } = renderHook(() =>
			useBulkSelection<Row>({ items: rows, getItemId: (i) => i.id }),
		);
		act(() => result.current.toggle("a"));
		expect(result.current.selectedIds.has("a")).toBe(true);
		expect(result.current.isPartiallySelected).toBe(true);
		expect(result.current.selectedItems).toEqual([rows[0]]);
		act(() => result.current.toggle("a"));
		expect(result.current.selectedIds.has("a")).toBe(false);
	});

	it("select / deselect add and remove ids", () => {
		const { result } = renderHook(() =>
			useBulkSelection<Row>({ items: rows, getItemId: (i) => i.id }),
		);
		act(() => result.current.select("a"));
		act(() => result.current.select("b"));
		expect(result.current.selectionCount).toBe(2);
		act(() => result.current.deselect("a"));
		expect(result.current.selectedIds.has("a")).toBe(false);
		expect(result.current.selectionCount).toBe(1);
	});

	it("selectAll / deselectAll / clearSelection", () => {
		const { result } = renderHook(() =>
			useBulkSelection<Row>({ items: rows, getItemId: (i) => i.id }),
		);
		act(() => result.current.selectAll());
		expect(result.current.isAllSelected).toBe(true);
		expect(result.current.selectionCount).toBe(3);
		act(() => result.current.deselectAll());
		expect(result.current.selectionCount).toBe(0);
		act(() => result.current.selectAll());
		act(() => result.current.clearSelection());
		expect(result.current.selectionCount).toBe(0);
	});

	it("toggleAll selects when none selected, clears when all selected", () => {
		const { result } = renderHook(() =>
			useBulkSelection<Row>({ items: rows, getItemId: (i) => i.id }),
		);
		act(() => result.current.toggleAll());
		expect(result.current.isAllSelected).toBe(true);
		act(() => result.current.toggleAll());
		expect(result.current.selectionCount).toBe(0);
	});

	it("respects canDeleteItem: locked items are not selectable", () => {
		const { result } = setup({ canDeleteItem: (item) => !item.locked });
		expect(result.current.selectableItems).toHaveLength(2);
		// toggling a locked item is a no-op
		act(() => result.current.toggle("c"));
		expect(result.current.selectionCount).toBe(0);
		// select on a locked item is a no-op
		act(() => result.current.select("c"));
		expect(result.current.selectionCount).toBe(0);
		// selectAll only picks deletable
		act(() => result.current.selectAll());
		expect(result.current.isAllSelected).toBe(true);
		expect(result.current.selectionCount).toBe(2);
	});

	it("isAllSelected is false when there are no selectable items", () => {
		const { result } = setup({ canDeleteItem: () => false });
		expect(result.current.selectableItems).toHaveLength(0);
		expect(result.current.isAllSelected).toBe(false);
		expect(result.current.isPartiallySelected).toBe(false);
	});

	it("collects warnings for selected items only", () => {
		const { result } = setup({
			getItemWarning: (item) => (item.warn ? "has warning" : null),
		});
		act(() => result.current.selectAll());
		expect(result.current.itemsWithWarnings).toEqual([
			{ item: rows[1], warning: "has warning" },
		]);
	});

	it("deletableSelectedItems filters by canDeleteItem", () => {
		// Make item become non-deletable after selection by toggling predicate
		let allowLocked = true;
		const { result, rerender } = renderHook(
			(p: { canDelete: (i: Row) => boolean }) =>
				useBulkSelection<Row>({
					items: rows,
					getItemId: (i) => i.id,
					canDeleteItem: p.canDelete,
				}),
				{ initialProps: { canDelete: (_item: Row) => allowLocked } },
		);
		act(() => result.current.selectAll());
		expect(result.current.deletableSelectedItems).toHaveLength(3);
		allowLocked = false;
		rerender({ canDelete: (i: Row) => !i.locked });
		expect(result.current.deletableSelectedItems).toHaveLength(2);
	});

	it("recomputes when the item set changes", () => {
		const { result, rerender } = setup({ items: rows });
		act(() => result.current.selectAll());
		expect(result.current.selectionCount).toBe(3);
		// remove item "a" — selectedItems drops it (id no longer maps)
		rerender({ items: rows.slice(1) });
		expect(result.current.selectedItems.map((i) => i.id)).toEqual(["b", "c"]);
	});
});
