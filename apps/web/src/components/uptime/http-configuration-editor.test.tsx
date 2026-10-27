import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { HttpConfigurationPatch } from "@/types/uptime";
import { HttpConfigurationEditor } from "./http-configuration-editor";
vi.mock("react-i18next", () => reactI18nextMock());

function Fixture({ method = "GET", initial = {}, changed = vi.fn(), test = vi.fn(), isEdit = true }: { isEdit?: boolean; method?: "GET" | "POST"; initial?: HttpConfigurationPatch; changed?: (value: HttpConfigurationPatch) => void; test?: () => Promise<{ status: "up"; httpStatus: number; responseTime: number }> }) {
  const [value, setValue] = useState(initial);
  return <form><HttpConfigurationEditor isEdit={isEdit} value={value} onChange={next => { changed(next); setValue(next); }} configured method={method} expectedStatus={200} onTest={test} /></form>;
}

describe("advanced configuration UX", () => {
  it("exposes private headers and POST body directly on create without edit actions", async () => {
    const changed = vi.fn(); render(<Fixture isEdit={false} method="POST" changed={changed} />);
    await userEvent.click(screen.getByText("http.title"));
    expect(screen.queryByLabelText("http.requestValues")).not.toBeInTheDocument();
    expect(screen.queryByText("http.replaceWarning")).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled(); // Optional values stay omitted until entered.
    await userEvent.click(screen.getByRole("button", { name: "http.addHeader" }));
    await userEvent.type(screen.getByLabelText("http.headerName"), "X-Private");
    await userEvent.type(screen.getByLabelText("http.headerValue"), "fixture-secret");
    await userEvent.type(screen.getByLabelText("http.body"), "fixture-body");
    expect(changed).toHaveBeenLastCalledWith({ requestConfig: { headers: [{ name: "X-Private", value: "fixture-secret" }], body: "fixture-body" } });
    expect(screen.getByLabelText("http.headerValue")).toHaveAttribute("type", "password");
    await userEvent.clear(screen.getByLabelText("http.body"));
    await userEvent.click(screen.getByRole("button", { name: "http.remove" }));
    expect(changed).toHaveBeenLastCalledWith({ requestConfig: { headers: [], body: undefined } });
  });
  it("does not test on render or edit; requires explicit POST confirmation", async () => {
    const test = vi.fn().mockResolvedValue({ status: "up", httpStatus: 200, responseTime: 0 });
    render(<Fixture method="POST" test={test} />);
    await userEvent.click(screen.getByText("http.title"));
    expect(test).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "http.test" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "http.test" }));
    await waitFor(() => expect(test).toHaveBeenCalledTimes(1));
    expect(test).toHaveBeenCalledWith(true);
    expect(screen.getByRole("status")).toHaveTextContent("0 ms");
  });
  it("retains private values by omission, replaces by deliberate re-entry and clears explicitly", async () => {
    const changed = vi.fn(); render(<Fixture changed={changed} />);
    await userEvent.click(screen.getByText("http.title"));
    expect(changed).not.toHaveBeenCalled();
    const mode = screen.getByRole("combobox", { name: "http.requestValues" });
    expect(mode).toHaveClass("ps-3.5", "pe-10");
    await userEvent.click(mode);
    await userEvent.click(screen.getByRole("option", { name: "http.replace" }));
    expect(changed).toHaveBeenLastCalledWith({ requestConfig: { headers: [] } });
    await userEvent.click(screen.getByRole("button", { name: "http.addHeader" }));
    await userEvent.type(screen.getByLabelText("http.headerValue"), "fixture-secret");
    expect(screen.getByLabelText("http.headerValue")).toHaveAttribute("type", "password");
    await userEvent.click(mode);
    await userEvent.click(screen.getByRole("option", { name: "http.retain" }));
    expect(changed).toHaveBeenLastCalledWith({ requestConfig: undefined });
    expect(screen.queryByLabelText("http.headerValue")).not.toBeInTheDocument();
    await userEvent.click(mode);
    await userEvent.click(screen.getByRole("option", { name: "http.clear" }));
    expect(changed).toHaveBeenLastCalledWith({ requestConfig: null });
  });
  it("keeps the displayed expected value aligned when the preceding rule is removed", async () => {
    const changed = vi.fn();
    render(<Fixture changed={changed} initial={{ httpAssertions: [{ type: "json", path: "$.first", op: "equals", value: 1 }, { type: "json", path: "$.second", op: "equals", value: 2 }] }} />);
    await userEvent.click(screen.getByText("http.title"));
    await userEvent.click(screen.getAllByRole("button", { name: "http.remove" })[0]!);
    expect(screen.getByLabelText("http.jsonValue")).toHaveValue("2");
    expect(changed.mock.lastCall?.[0].httpAssertions).toEqual([{ type: "json", path: "$.second", op: "equals", value: 2 }]);
  });
  it("preserves numeric zero and null and blocks malformed JSON from testing a previous value", async () => {
    const changed = vi.fn(); const test = vi.fn();
    render(<Fixture changed={changed} test={test} initial={{ httpAssertions: [{ type: "json", path: "$.count", op: "equals", value: 0 }] }} />);
    await userEvent.click(screen.getByText("http.title"));
    const input = screen.getByLabelText("http.jsonValue");
    expect(input).toHaveValue("0");
    fireEvent.change(input, { target: { value: "null" } });
    expect(changed.mock.lastCall?.[0].httpAssertions[0].value).toBeNull();
    fireEvent.change(input, { target: { value: "not JSON" } });
    expect(input).toBeInvalid();
    await userEvent.click(screen.getByRole("button", { name: "http.test" }));
    expect(test).not.toHaveBeenCalled();
  });
});

it.each(["0", "false", "null", '\"\"'])("preserves the distinct JSON scalar %s", async text => {
  const changed = vi.fn(); render(<Fixture changed={changed} initial={{ httpAssertions: [{ type: "json", path: "$.value", op: "equals", value: "initial" }] }} />);
  await userEvent.click(screen.getByText("http.title"));
  fireEvent.change(screen.getByLabelText("http.jsonValue"), { target: { value: text } });
  expect(changed.mock.lastCall?.[0].httpAssertions[0].value).toEqual(JSON.parse(text));
});

it("can remove a collapsed rule from its header without opening its fields", async () => {
  const changed = vi.fn();
  render(<Fixture changed={changed} initial={{ httpAssertions: [{ type: "json", path: "$.status", op: "equals", value: "ok" }] }} />);
  await userEvent.click(screen.getByRole("button", { name: "http.title" }));
  await userEvent.click(screen.getByRole("button", { name: /http.rule/ }));
  expect(screen.queryByRole("combobox", { name: "http.ruleType" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "http.remove" }));
  expect(changed).toHaveBeenLastCalledWith({ httpAssertions: [] });
});
