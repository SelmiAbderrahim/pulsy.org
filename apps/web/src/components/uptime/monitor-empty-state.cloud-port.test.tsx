import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorEmptyState } from "./monitor-empty-state";

vi.mock("react-i18next", () => reactI18nextMock());

describe("MonitorEmptyState", () => {
	it("renders a three-step setup guide and CTA", () => {
		render(<MonitorEmptyState onCreateMonitor={vi.fn()} />);
		expect(
			screen.getByText("Start monitoring your services"),
		).toBeInTheDocument();
		expect(
			screen.getByText("emptyState.steps.monitor"),
		).toBeInTheDocument();
		expect(screen.getAllByRole("listitem")).toHaveLength(3);
		expect(
			screen.getByRole("button", { name: "Add your first monitor" }),
		).toBeInTheDocument();
	});

	it("invokes onCreateMonitor when the CTA is clicked", async () => {
		const onCreate = vi.fn();
		render(<MonitorEmptyState onCreateMonitor={onCreate} />);
		await userEvent.click(
			screen.getByRole("button", { name: "Add your first monitor" }),
		);
		expect(onCreate).toHaveBeenCalledOnce();
	});
});
