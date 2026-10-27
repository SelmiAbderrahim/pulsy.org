import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { BulkEditSettingsDialog } from "./bulk-edit-settings-dialog";

vi.mock("react-i18next", () => reactI18nextMock());

const mutateAsync = vi.fn();
const mutationState = { isPending: false };

vi.mock("@/hooks/uptime", () => ({
	useBulkUpdateUptimeSettings: () => ({
		mutateAsync,
		isPending: mutationState.isPending,
	}),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
	toast: {
		success: (m: unknown) => toastSuccess(m),
		error: (m: unknown) => toastError(m),
	},
}));

function monitor(id: string): UptimeMonitor {
	return { uptimeMonitorId: id, name: id } as UptimeMonitor;
}

// Checkbox order matches FieldRow render order.
const FIELD = {
	method: 0,
	interval: 1,
	expectedStatus: 2,
	timeout: 3,
	failureThreshold: 4,
	tags: 5,
} as const;

beforeEach(() => {
	vi.clearAllMocks();
	mutationState.isPending = false;
	mutateAsync.mockResolvedValue({ updated: [{}, {}], results: [] });
});

function renderDialog(props?: Partial<React.ComponentProps<typeof BulkEditSettingsDialog>>) {
	const onOpenChange = props?.onOpenChange ?? vi.fn();
	const monitors = props?.monitors ?? [monitor("m1"), monitor("m2")];
	render(
		<BulkEditSettingsDialog
			open
			onOpenChange={onOpenChange}
			monitors={monitors}
			{...props}
		/>,
	);
	return { onOpenChange };
}

function enableField(field: keyof typeof FIELD) {
	const checkboxes = screen.getAllByRole("checkbox");
	return userEvent.click(checkboxes[FIELD[field]]!);
}

describe("BulkEditSettingsDialog rendering", () => {
	it("shows the title, monitor count, and a disabled submit by default", () => {
		renderDialog();
		expect(screen.getByText("Edit settings")).toBeInTheDocument();
		expect(
			screen.getByText(/Apply these settings to 2 selected monitors/),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Apply to 2 monitors" }),
		).toBeDisabled();
	});

	it("does not render content when closed (reset effect false branch)", () => {
		renderDialog({ open: false });
		expect(screen.queryByText("Edit settings")).not.toBeInTheDocument();
	});

	it("disables submit while the mutation is pending", async () => {
		mutationState.isPending = true;
		renderDialog();
		await enableField("timeout");
		expect(
			screen.getByRole("button", { name: "Apply to 2 monitors" }),
		).toBeDisabled();
	});
});

describe("BulkEditSettingsDialog submission", () => {
	it("sends only the enabled field", async () => {
		const { onOpenChange } = renderDialog({ onUpdated: vi.fn() });
		await enableField("timeout");
		const submit = screen.getByRole("button", { name: "Apply to 2 monitors" });
		expect(submit).toBeEnabled();
		await userEvent.click(submit);

		expect(mutateAsync).toHaveBeenCalledWith({
			monitorIds: ["m1", "m2"],
			patch: { timeout: 10000 },
		});
		expect(toastSuccess).toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("calls onUpdated after a successful update", async () => {
		const onUpdated = vi.fn();
		renderDialog({ onUpdated });
		await enableField("failureThreshold");
		await userEvent.click(
			screen.getByRole("button", { name: "Apply to 2 monitors" }),
		);
		expect(onUpdated).toHaveBeenCalledTimes(1);
	});

	it("succeeds without an onUpdated callback", async () => {
		const { onOpenChange } = renderDialog();
		await enableField("expectedStatus");
		await userEvent.click(
			screen.getByRole("button", { name: "Apply to 2 monitors" }),
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("builds a patch from every enabled field", async () => {
		renderDialog();
		await enableField("method");
		await enableField("interval");
		await enableField("expectedStatus");
		await enableField("timeout");
		await enableField("failureThreshold");
		await enableField("tags");

		// Method select (first combobox).
		const combos = screen.getAllByRole("combobox");
		await userEvent.click(combos[0]!);
		await userEvent.click(screen.getByRole("option", { name: "HEAD" }));
		// Interval select (second combobox).
		await userEvent.click(screen.getAllByRole("combobox")[1]!);
		await userEvent.click(screen.getByRole("option", { name: "1 minute" }));

		// Numeric inputs (exercise their onChange handlers).
		const expected = screen.getByLabelText("Expected status");
		await userEvent.clear(expected);
		await userEvent.type(expected, "301");
		const timeout = screen.getByLabelText("Timeout (ms)");
		await userEvent.clear(timeout);
		await userEvent.type(timeout, "20000");
		const threshold = screen.getByLabelText("Failure threshold");
		await userEvent.clear(threshold);
		await userEvent.type(threshold, "5");

		// Tag.
		const tagInput = screen.getByPlaceholderText("Example: production");
		await userEvent.type(tagInput, "prod{Enter}");

		await userEvent.click(
			screen.getByRole("button", { name: "Apply to 2 monitors" }),
		);

		expect(mutateAsync).toHaveBeenCalledWith({
			monitorIds: ["m1", "m2"],
			patch: {
				method: "HEAD",
				interval: 60,
				expectedStatus: 301, expectedStatuses: null,
				timeout: 20000,
				failureThreshold: 5,
				tags: ["prod"],
			},
		});
	});

	it("shows an error toast and keeps the dialog open on failure", async () => {
		mutateAsync.mockRejectedValue(new Error("nope"));
		const { onOpenChange } = renderDialog();
		await enableField("timeout");
		await userEvent.click(
			screen.getByRole("button", { name: "Apply to 2 monitors" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalled());
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("ignores a submit when no field is enabled", () => {
		renderDialog({ monitors: [monitor("m1")] });
		// Radix renders the dialog in a portal, so the form lives in document.
		const form = document.querySelector("form")!;
		fireEvent.submit(form);
		expect(mutateAsync).not.toHaveBeenCalled();
	});
});

describe("BulkEditSettingsDialog tags", () => {
	it("adds, deduplicates, and removes tags and shows the replace hint", async () => {
		renderDialog();
		await enableField("tags");
		expect(
			screen.getByText(/Replaces existing tags on every selected monitor/),
		).toBeInTheDocument();

		const tagInput = screen.getByPlaceholderText("Example: production");
		await userEvent.type(tagInput, "api{Enter}");
		expect(screen.getByLabelText("Remove api").parentElement).toHaveTextContent("api");

		// Duplicate is ignored (no second badge); a blank blur is a no-op.
		await userEvent.type(tagInput, "api{Enter}");
		await userEvent.clear(tagInput);
		fireEvent.blur(tagInput);
		expect(screen.getAllByLabelText("Remove api")).toHaveLength(1);

		await userEvent.click(screen.getByLabelText("Remove api"));
		expect(screen.queryByText("api")).not.toBeInTheDocument();
	});

	it("sends an empty tags array when tags is enabled but none added", async () => {
		renderDialog();
		await enableField("tags");
		await userEvent.click(
			screen.getByRole("button", { name: "Apply to 2 monitors" }),
		);
		expect(mutateAsync).toHaveBeenCalledWith({
			monitorIds: ["m1", "m2"],
			patch: { tags: [] },
		});
	});
});

describe("BulkEditSettingsDialog cancel", () => {
	it("closes via the cancel button", async () => {
		const { onOpenChange } = renderDialog();
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
