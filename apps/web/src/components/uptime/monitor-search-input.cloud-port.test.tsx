import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorSearchInput } from "./monitor-search-input";
import { useState } from "react";

vi.mock("react-i18next", () => reactI18nextMock());

describe("MonitorSearchInput", () => {
	it("renders the current value and forwards typed input", async () => {
		const onChange = vi.fn();
		render(<MonitorSearchInput value="" onChange={onChange} />);
		const input = screen.getByPlaceholderText("Search…");
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

	it("keeps search semantics, exposes one clear button and restores input focus", async () => {
		function Search() {
			const [value, setValue] = useState("");
			return <MonitorSearchInput value={value} onChange={setValue} />;
		}
		render(<Search />);
		const input = screen.getByRole("searchbox", { name: "Search monitors" });
		await userEvent.type(input, "api");
		expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(1);
		await userEvent.tab();
		expect(screen.getByRole("button", { name: "Clear search" })).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		expect(input).toHaveValue("");
		expect(input).toHaveFocus();
		expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
		await userEvent.type(input, "worker");
		await userEvent.keyboard("{Escape}");
		expect(input).toHaveValue("");
		expect(input).toHaveFocus();
	});
});
