import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { reactI18nextMock } from "@/test/i18n-mock";
import { Route } from "./reset-password";
const mocks = vi.hoisted(() => ({ reset: vi.fn(), navigate: vi.fn(), success: vi.fn(), search: { token: "tok", error: undefined as string | undefined } }));
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/lib/auth-client", () => ({ authClient: { resetPassword: mocks.reset } }));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success } }));
vi.mock("@dr.pogodin/react-helmet", () => ({ Helmet: () => null }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: { component: () => ReactNode }) => ({ options: config, useSearch: () => mocks.search }), Link: ({ children }: { children: ReactNode }) => <a>{children}</a>, useNavigate: () => mocks.navigate }));
const Page = () => { const Component = Route.options.component!; return <Component />; };
const fill = (password: string, confirm = password) => { fireEvent.change(screen.getByLabelText("auth:reset.newPassword"), { target: { value: password } }); fireEvent.change(screen.getByLabelText("auth:reset.confirmPassword"), { target: { value: confirm } }); };
beforeEach(() => { vi.clearAllMocks(); mocks.search = { token: "tok", error: undefined }; });
describe("reset-link lifecycle in the UI", () => {
  it("shows the dead-link explanation and a new-request action when there is no token or the server flagged one", () => {
    mocks.search = { token: undefined as never, error: undefined };
    const { unmount } = render(<Page />);
    expect(screen.getByText("auth:reset.invalidLink")).toBeInTheDocument(); expect(screen.getByText("auth:reset.requestNewLink")).toBeInTheDocument(); expect(document.querySelector("form")).toBeNull();
    unmount(); mocks.search = { token: "tok", error: "INVALID_TOKEN" };
    render(<Page />); expect(screen.getByText("auth:reset.invalidLink")).toBeInTheDocument();
  });
  it("refuses mismatched passwords locally without calling the server", () => {
    render(<Page />); fill("Password-one-1!", "Password-two-2!");
    fireEvent.submit(document.querySelector("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("auth:reset.mismatch"); expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("keeps what was typed and offers a new link when the server rejects an expired or used token", async () => {
    mocks.reset.mockResolvedValue({ error: { status: 400 } });
    render(<Page />); fill("Password-one-1!");
    fireEvent.submit(document.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("auth:reset.error");
    expect(screen.getAllByText("auth:reset.requestNewLink").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("auth:reset.newPassword")).toHaveValue("Password-one-1!");
    expect(mocks.success).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("submits once for a double submit and returns to sign-in on success", async () => {
    let done: (value: unknown) => void = () => undefined;
    mocks.reset.mockImplementation(() => new Promise(resolve => { done = resolve; }));
    render(<Page />); fill("Password-one-1!");
    fireEvent.submit(document.querySelector("form")!); fireEvent.submit(document.querySelector("form")!);
    expect(mocks.reset).toHaveBeenCalledTimes(1); expect(mocks.reset).toHaveBeenCalledWith({ newPassword: "Password-one-1!", token: "tok" });
    done({ error: null });
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("auth:reset.success"));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login" });
  });
  it("says rate limited, not expired, on a 429 and does not tell the person to request a new link", async () => {
    mocks.reset.mockResolvedValue({ error: { status: 429 } });
    render(<Page />); fill("Password-one-1!");
    fireEvent.submit(document.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("auth:ux.rateLimited");
    expect(screen.queryByText("auth:reset.requestNewLink")).not.toBeInTheDocument();
  });
});
