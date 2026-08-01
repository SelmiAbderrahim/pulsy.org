import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectableCheckbox } from "./SelectableCheckbox";

describe("SelectableCheckbox", () => {
	it("renders with an accessible label", () => {
		render(
			<SelectableCheckbox
				checked={false}
				onChange={vi.fn()}
				label="Select row"
			/>,
		);
		expect(
			screen.getByRole("checkbox", { name: "Select row" }),
		).toBeInTheDocument();
	});

	it("calls onChange(true) when an unchecked box is toggled", async () => {
		const onChange = vi.fn();
		render(<SelectableCheckbox checked={false} onChange={onChange} label="x" />);
		await userEvent.click(screen.getByRole("checkbox", { name: "x" }));
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it("calls onChange(false) when a checked box is toggled", async () => {
		const onChange = vi.fn();
		render(<SelectableCheckbox checked={true} onChange={onChange} label="x" />);
		await userEvent.click(screen.getByRole("checkbox", { name: "x" }));
		expect(onChange).toHaveBeenCalledWith(false);
	});

	it("reports indeterminate state and maps its toggle to onChange(true)", async () => {
		const onChange = vi.fn();
		render(
			<SelectableCheckbox
				checked={false}
				indeterminate
				onChange={onChange}
				label="all"
			/>,
		);
		const box = screen.getByRole("checkbox", { name: "all" });
		expect(box).toHaveAttribute("data-state", "indeterminate");
		await userEvent.click(box);
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it("mirrors the indeterminate flag onto the hidden form input", async () => {
		// Inside a form, Radix renders a bubble <input> under the wrapper, so the
		// effect's querySelector finds it and sets `.indeterminate`.
		const { container } = render(
			<form>
				<SelectableCheckbox
					checked={false}
					indeterminate
					onChange={vi.fn()}
					label="all"
				/>
			</form>,
		);
		const input = container.querySelector("input");
		expect(input).not.toBeNull();
		await waitFor(() =>
			expect((input as HTMLInputElement).indeterminate).toBe(true),
		);
	});

	it("does not fire onChange when disabled", async () => {
		const onChange = vi.fn();
		render(
			<SelectableCheckbox
				checked={false}
				onChange={onChange}
				disabled
				label="x"
			/>,
		);
		await userEvent.click(screen.getByRole("checkbox", { name: "x" }));
		expect(onChange).not.toHaveBeenCalled();
	});
});
