import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { BulkDeleteConfirmDialog } from "./BulkDeleteConfirmDialog";

vi.mock("react-i18next", () => reactI18nextMock());

interface Row {
	id: string;
	name: string;
	warn?: string | null;
}

function renderDialog(props?: {
	items?: Row[];
	itemType?: "server" | "monitor" | "channel" | "account" | "user";
	getItemWarning?: (item: Row) => string | null;
	isDeleting?: boolean;
	onConfirm?: () => void | Promise<void>;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
}) {
	const items = props?.items ?? [
		{ id: "a", name: "Alpha" },
		{ id: "b", name: "Bravo" },
	];
	return render(
		<BulkDeleteConfirmDialog<Row>
			open={props?.open ?? true}
			onOpenChange={props?.onOpenChange ?? vi.fn()}
			items={items}
			itemType={props?.itemType ?? "monitor"}
			getItemName={(item) => item.name}
			getItemWarning={props?.getItemWarning}
			onConfirm={props?.onConfirm ?? vi.fn()}
			isDeleting={props?.isDeleting}
		/>,
	);
}

describe("BulkDeleteConfirmDialog", () => {
	it("lists item names and a pluralized title", () => {
		renderDialog();
		expect(screen.getByText("Alpha")).toBeInTheDocument();
		expect(screen.getByText("Bravo")).toBeInTheDocument();
		expect(screen.getByText("Delete 2 monitors?")).toBeInTheDocument();
	});

	it("uses the singular type label for a single item", () => {
		renderDialog({ items: [{ id: "a", name: "Alpha" }] });
		expect(screen.getByText("Delete 1 monitor?")).toBeInTheDocument();
	});

	it("uses the user labels for the user item type", () => {
		renderDialog({
			itemType: "user",
			items: [
				{ id: "a", name: "A" },
				{ id: "b", name: "B" },
			],
		});
		expect(screen.getByText("Delete 2 users?")).toBeInTheDocument();
	});

	it("derives a generic plural for an unmapped item type", () => {
		render(
			<BulkDeleteConfirmDialog<Row>
				open
				onOpenChange={vi.fn()}
				items={[{ id: "a", name: "A" }]}
				// Cast: exercises the runtime `labels[itemType] || {...}` fallback for
				// a type that is not in the label map.
				itemType={"widget" as never}
				getItemName={(item) => item.name}
				onConfirm={vi.fn()}
			/>,
		);
		expect(screen.getByText("Delete 1 widget?")).toBeInTheDocument();
	});

	it("keeps the confirm button disabled until the exact phrase is typed", async () => {
		const onConfirm = vi.fn();
		renderDialog({ onConfirm });
		const confirmBtn = screen.getByRole("button", {
			name: "Delete 2 monitors",
		});
		expect(confirmBtn).toBeDisabled();

		const input = screen.getByPlaceholderText("DELETE 2");
		await userEvent.type(input, "delete 2"); // case-insensitive match
		expect(confirmBtn).toBeEnabled();
		await userEvent.click(confirmBtn);
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it("does not call onConfirm via the guard when input is invalid", async () => {
		const onConfirm = vi.fn();
		renderDialog({ onConfirm });
		const input = screen.getByPlaceholderText("DELETE 2");
		await userEvent.type(input, "wrong");
		// handleConfirm guards even if somehow invoked
		const confirmBtn = screen.getByRole("button", {
			name: "Delete 2 monitors",
		});
		expect(confirmBtn).toBeDisabled();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("keeps every affected name accessible in the scrollable list", () => {
		const items = Array.from({ length: 7 }, (_v, i) => ({
			id: String(i),
			name: `Item ${i}`,
		}));
		renderDialog({ items });
		expect(screen.getByRole("region", { name: "Items to delete (7)" })).toBeInTheDocument();
		expect(screen.getByText("Item 6")).toBeInTheDocument();
	});

	it("renders per-item warnings and an aggregate constraint banner", () => {
		renderDialog({
			getItemWarning: (item) => (item.id === "a" ? "has incidents" : null),
		});
		expect(screen.getByText("has incidents")).toBeInTheDocument();
		expect(
			screen.getByText(/have constraints that may require manual cleanup/),
		).toBeInTheDocument();
	});

	it("shows the deleting state and disables inputs", () => {
		renderDialog({ isDeleting: true });
		expect(screen.getByText("Deleting...")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("DELETE 2")).toBeDisabled();
	});

	it("blocks open-change while deleting", async () => {
		const onOpenChange = vi.fn();
		renderDialog({ isDeleting: true, onOpenChange });
		// Escape would normally request close; while deleting it is ignored.
		await userEvent.keyboard("{Escape}");
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("requests close via onOpenChange when not deleting", async () => {
		const onOpenChange = vi.fn();
		renderDialog({ onOpenChange });
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});
});
