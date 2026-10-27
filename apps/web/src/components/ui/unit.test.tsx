import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Unit } from "./unit";

describe("Unit", () => {
	it.each(["350 ms", "5 s", "99.50%"])("renders %s as one non-wrapping, left-to-right token", (text) => {
		const { container } = render(<div dir="rtl"><Unit>{text}</Unit></div>);
		const el = container.querySelector("bdi")!;
		expect(el).toHaveTextContent(text);
		expect(el).toHaveAttribute("dir", "ltr");
		expect(el.className).toContain("whitespace-nowrap");
	});

	it("keeps its own direction when the unit is written in Arabic script", () => {
		const { container } = render(<Unit>{"5 ثوانٍ"}</Unit>);
		const el = container.querySelector("bdi")!;
		expect(el).not.toHaveAttribute("dir");
		expect(el.className).toContain("whitespace-nowrap");
	});

	it("renders the dash for missing values", () => {
		const { container } = render(<Unit>{null}</Unit>);
		expect(container).toHaveTextContent("—");
		expect(container.querySelector("bdi")).toBeNull();
	});
});
