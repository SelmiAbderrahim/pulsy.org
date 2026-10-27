import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Input } from "./input";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe("deliberate field validation", () => {
  it("allows partial typing, reports an associated error on blur, and clears it when editing resumes", () => {
    render(<><label htmlFor="endpoint">Endpoint</label><Input id="endpoint" validateOnBlur type="url" required aria-describedby="hint" /><p id="hint">HTTPS endpoint</p></>);
    const input = screen.getByLabelText("Endpoint");
    fireEvent.change(input, { target: { value: "https:" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.blur(input);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("HTTPS endpoint nav.invalidField");
    fireEvent.change(input, { target: { value: "https://fixture.invalid" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveValue("https://fixture.invalid");
    fireEvent.blur(input);
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  it("validates an untouched required field on blur", () => {
    render(<><label htmlFor="url">URL</label><Input id="url" validateOnBlur type="url" required /></>);
    const input = screen.getByLabelText("URL");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("nav.requiredField");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("reports a field that was edited and then emptied once it is left", () => {
    render(<><label htmlFor="url">URL</label><Input id="url" validateOnBlur type="url" required /></>);
    const input = screen.getByLabelText("URL");
    fireEvent.change(input, { target: { value: "https://a.test" } });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("nav.requiredField");
  });

  it("validates an untouched field when a submit is attempted", () => {
    render(<form><label htmlFor="url">URL</label><Input id="url" validateOnBlur type="url" required /><button type="submit">Go</button></form>);
    const input = screen.getByLabelText("URL");
    fireEvent.invalid(input);
    expect(screen.getByRole("alert")).toHaveTextContent("nav.requiredField");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});


it("defers blur feedback until submit validation when focusing an external submit button", () => {
  render(<><form id="editor"><label htmlFor="name">Name</label><Input id="name" required validateOnBlur /></form><button type="submit" form="editor">Save</button></>);
  const field = screen.getByLabelText("Name");
  fireEvent.blur(field, { relatedTarget: screen.getByRole("button", { name: "Save" }) });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.invalid(field);
  expect(screen.getByRole("alert")).toHaveTextContent("nav.requiredField");
  expect(field).toHaveAttribute("aria-invalid", "true");
});
