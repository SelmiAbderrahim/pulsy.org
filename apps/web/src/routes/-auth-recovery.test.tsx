import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { reactI18nextMock } from "@/test/i18n-mock";
import { Route } from "./forgot-password";
const ForgotPasswordPage = () => { const Page = Route.options.component!; return <Page />; };
const request = vi.hoisted(() => vi.fn());
const success = vi.hoisted(() => vi.fn());
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/lib/auth-client", () => ({ authClient: { requestPasswordReset: request } }));
vi.mock("@/lib/toast", () => ({ toast: { success } }));
vi.mock("@dr.pogodin/react-helmet", () => ({ Helmet: () => null }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: object) => ({ options }), Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
describe("privacy-aware recovery", () => {
  it("keeps the email and exposes a returned transport error without a false success", async () => {
    request.mockResolvedValueOnce({ error: { status: 503, message: "private provider details" } });
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("auth:fields.email"), { target: { value: "fixture@example.invalid" } });
    fireEvent.submit(document.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("auth:forgot.error");
    expect(screen.getByLabelText("auth:fields.email")).toHaveValue("fixture@example.invalid");
    expect(document.body).not.toHaveTextContent("private provider details");
    expect(success).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ data: { status: true }, error: null });
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(success).toHaveBeenCalledWith("auth:forgot.success"));
  });
  it("names a rate limit instead of a generic failure", async () => {
    request.mockResolvedValueOnce({ error: { status: 429 } });
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("auth:fields.email"), { target: { value: "fixture@example.invalid" } });
    fireEvent.submit(document.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("auth:ux.rateLimited");
  });
});
