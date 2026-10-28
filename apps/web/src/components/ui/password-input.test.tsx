import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { PasswordInput } from "./password-input";
vi.mock("react-i18next", () => reactI18nextMock());
describe("password visibility control", () => {
	it("toggles the field type with an accurate pressed state, never submits the form, and keeps the typed value", async () => {
		const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
		render(<form onSubmit={submit}><label htmlFor="pw">Password</label><PasswordInput id="pw" defaultValue="" /></form>);
		const field = screen.getByLabelText("Password") as HTMLInputElement;
		await userEvent.type(field, "s3cret-value");
		const toggle = screen.getByRole("button", { name: "ux.showPassword" });
		expect(toggle).toHaveAttribute("type", "button"); expect(toggle).toHaveAttribute("aria-pressed", "false");
		await userEvent.click(toggle);
		expect(field.type).toBe("text"); expect(field.value).toBe("s3cret-value");
		expect(screen.getByRole("button", { name: "ux.hidePassword" })).toHaveAttribute("aria-pressed", "true");
		await userEvent.click(screen.getByRole("button", { name: "ux.hidePassword" }));
		expect(field.type).toBe("password");
		expect(submit).not.toHaveBeenCalled();
	});
	it("is disabled together with its field while a submission is in flight", () => {
		render(<PasswordInput disabled aria-label="Password" />);
		expect(screen.getByRole("button", { name: "ux.showPassword" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "ux.showPassword" }));
		expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
	});
});
