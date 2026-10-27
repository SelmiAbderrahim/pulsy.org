import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { BulkEditSettingsDialog } from "./bulk-edit-settings-dialog";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/hooks/uptime", () => ({ useBulkUpdateUptimeSettings: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const monitors = ["Checkout API", "Customer site", "Docs"].map(name => ({ uptimeMonitorId: name, name, monitorType: "http" }) as UptimeMonitor);

describe("bulk edit shows what it will do (QA-049/050)", () => {
	it("lists every affected monitor name and, before any field is enabled, no changed fields", () => {
		render(<BulkEditSettingsDialog open onOpenChange={vi.fn()} monitors={monitors} />);
		const list = document.querySelector<HTMLElement>("[data-bulk-name-list]")!;
		for (const monitor of monitors) expect(within(list).getByText(monitor.name)).toBeInTheDocument();
		expect(within(list).getAllByRole("listitem")).toHaveLength(monitors.length);
		expect(screen.getByText("bulk.edit.noChanges")).toBeInTheDocument();
		expect(screen.queryByRole("term")).toBeNull();
	});

	it("shows only the fields that will change, with human-readable values and the applicable count", async () => {
		render(<BulkEditSettingsDialog open onOpenChange={vi.fn()} monitors={monitors} />);
		const checkboxes = screen.getAllByRole("checkbox");
		// FieldRow order: method, interval, expectedStatus, timeout, failureThreshold, tags.
		await userEvent.click(checkboxes[0]!);
		await userEvent.click(checkboxes[4]!);
		const preview = screen.getByRole("region", { name: "bulk.edit.preview" });
		const labels = within(preview).getAllByRole("term").map(node => node.textContent);
		expect(labels).toEqual(["create.fields.method", "create.fields.failureThreshold"]);
		const values = within(preview).getAllByRole("definition").map(node => node.textContent);
		expect(values[0]).toBe("GET");
		expect(values[1]).toMatch(/^\d+$/);
		expect(within(preview).getAllByText("Applies to 3 of 3 selected")).toHaveLength(2);
		expect(screen.queryByText("bulk.edit.noChanges")).toBeNull();
	});
});
