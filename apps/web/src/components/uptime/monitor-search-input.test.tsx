import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorSearchInput } from "./monitor-search-input";

vi.mock("react-i18next", () => reactI18nextMock());

describe("MonitorSearchInput", () => {
	it("renders the current value and forwards typed input", async () => {
		const onChange = vi.fn();
		render(<MonitorSearchInput value="" onChange={onChange} />);
		const input = screen.getByRole("searchbox", { name: "Search monitors" });
		await userEvent.type(input, "a");
		expect(onChange).toHaveBeenCalledWith("a");
	});

	it("hides the clear button when empty", () => {
		render(<MonitorSearchInput value="" onChange={vi.fn()} />);
		expect(
			screen.queryByRole("button", { name: "Clear search" }),
		).not.toBeInTheDocument();
	});

	it("clears the value via the clear button", async () => {
		const onChange = vi.fn();
		render(<MonitorSearchInput value="api" onChange={onChange} />);
		await userEvent.click(
			screen.getByRole("button", { name: "Clear search" }),
		);
		expect(onChange).toHaveBeenCalledWith("");
	});
});
