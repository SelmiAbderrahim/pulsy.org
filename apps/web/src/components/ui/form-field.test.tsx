import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormField } from "./form-field";
import { Input } from "./input";
import { fireEvent } from "@testing-library/react";

describe("FormField message stack", () => {
  it("places control-owned validation after help, in the same message stack", () => {
    render(<FormField label="URL" helper="An HTTP endpoint" control={<Input id="endpoint" type="url" validateOnBlur />} />);
    const input = screen.getByLabelText("URL");
    fireEvent.change(input, { target: { value: "invalid" } });
    fireEvent.blur(input);
    const help = screen.getByText("An HTTP endpoint"), error = screen.getByRole("alert");
    expect(help.parentElement).toBe(error.parentElement);
    expect(help.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
  it("keeps help before errors in one container and connects both descriptions", () => {
    const { rerender } = render(<FormField label="Timeout" control={<input id="timeout" />} helper="Milliseconds" error="Too small" />);
    const help = screen.getByText("Milliseconds"), error = screen.getByRole("alert");
    expect(help.parentElement).toBe(error.parentElement);
    expect(help.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText("Timeout")).toHaveAccessibleDescription("Milliseconds Too small");
    expect(screen.getByLabelText("Timeout")).toHaveAttribute("aria-invalid", "true");
    rerender(<FormField label="Timeout" control={<input id="timeout" />} helper="Milliseconds" />);
    expect(screen.getByLabelText("Timeout")).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Timeout")).toHaveAccessibleDescription("Milliseconds");
  });

  it("groups composed field messages help-first while preserving existing ids", () => {
    render(<FormField><label htmlFor="failures">Failures</label><input id="failures" aria-invalid="true" aria-describedby="failures-help failures-error" /><p id="failures-error" role="alert">Positive number required</p><p id="failures-help">Consecutive failures</p></FormField>);
    const help = screen.getByText("Consecutive failures"), error = screen.getByRole("alert");
    expect(help.parentElement).toBe(error.parentElement);
    expect(help.parentElement?.children).toHaveLength(2);
    expect(help.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText("Failures")).toHaveAccessibleDescription("Consecutive failures Positive number required");
  });
});
