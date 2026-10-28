import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { CopyableUrl } from "./copyable-url";
vi.mock("react-i18next", () => reactI18nextMock());
afterEach(() => { vi.restoreAllMocks(); });
const url = "https://status.example.com/status/owner-id/some-very-long-slug-with-ünïcode-and-more";
describe("copyable canonical URL", () => {
  it("shows the whole URL as wrappable text and copies exactly that string", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyableUrl url={url} label="API" />);
    expect(screen.getByText(url)).toHaveClass("break-all");
    await userEvent.click(screen.getByRole("button", { name: /statusUX\.copyUrl.*API/ }));
    expect(writeText).toHaveBeenCalledWith(url);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("statusUX.urlCopied"));
  });
  it("says so when copying is refused instead of claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    render(<CopyableUrl url={url} label="API" />);
    await userEvent.click(screen.getByRole("button", { name: /statusUX\.copyUrl/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("statusUX.urlCopyFailed"));
    expect(screen.getByRole("status")).not.toHaveTextContent("statusUX.urlCopied");
  });
});

it("can truncate the URL middle while exposing and copying the full canonical URL", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<CopyableUrl url={url} label="API" truncateMiddle />);
  const value = screen.getByLabelText(url);
  expect(value).toHaveAttribute("title", url);
  expect(value).toHaveAttribute("tabindex", "0");
  expect(value).toHaveAttribute("dir", "ltr");
  expect(value.querySelector(".truncate")).toBeInTheDocument();
  fireEvent.focus(value);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(url);
  await userEvent.click(screen.getByRole("button", { name: /statusUX\.copyUrl.*API/ }));
  expect(writeText).toHaveBeenCalledWith(url);
});


it("does not copy a credential resolved after its owning UI unmounts", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  let release!: (value: string) => void;
  const { unmount } = render(<CopyableUrl url="masked" label="Heartbeat" resolveCopy={() => new Promise<string>(resolve => { release = resolve; })} />);
  fireEvent.click(screen.getByRole("button", { name: /statusUX.copyUrl/ }));
  unmount();
  await act(async () => release("owner-only-credential"));
  expect(writeText).not.toHaveBeenCalled();
});
