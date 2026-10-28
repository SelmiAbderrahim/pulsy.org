import { useState } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { ExpectedStatusInput } from "./expected-status-input";
vi.mock("react-i18next", () => reactI18nextMock());
function Example() { const [value,setValue]=useState("200"); return <><label htmlFor="status">HTTP status</label><ExpectedStatusInput id="status" value={value} onChange={event=>setValue(event.target.value)} /></>; }
it("accepts list/range text and associates localized invalid feedback with the field", () => {
  render(<Example />); const input=screen.getByLabelText("HTTP status") as HTMLInputElement;
  for (const value of ["200,204","2xx","200–299"]) { fireEvent.change(input,{target:{value}}); expect(input.checkValidity()).toBe(true); }
  fireEvent.change(input,{target:{value:"299–200"}}); fireEvent.blur(input);
  act(() => { expect(input.checkValidity()).toBe(false); }); expect(input).toHaveAttribute("aria-invalid","true");
  expect(screen.getByRole("alert")).toHaveTextContent("httpStatuses.invalid");
  fireEvent.change(input,{target:{value:"204"}}); expect(input.checkValidity()).toBe(true); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps each status example together while the helper can wrap between examples", () => {
  render(<Example />);
  const input = screen.getByLabelText("HTTP status");
  expect(input.getAttribute("aria-describedby")?.split(" ")).toContain("status-status-hint");
  for (const example of ["200,204", "2xx", "200–299"]) {
    const token = screen.getByText(example);
    expect(token).toHaveAttribute("dir", "ltr");
    expect(token).toHaveClass("whitespace-nowrap");
  }
});
