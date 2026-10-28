import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { Route as LoginRoute } from "./login";
import { Route as SignupRoute } from "./signup";

const mocks = vi.hoisted(() => ({
  login: vi.fn(), signup: vi.fn(), navigate: vi.fn(), getSession: vi.fn(), search: {} as Record<string, unknown>,
  session: null as { user: { id: string } } | null, error: null as { status: number } | null,
}));
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@dr.pogodin/react-helmet", () => ({ Helmet: () => null }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options, useSearch: () => mocks.search }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>, useNavigate: () => mocks.navigate,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: mocks.login }, signUp: { email: mocks.signup }, getSession: mocks.getSession },
  useSession: () => ({ data: mocks.session, error: mocks.error }),
}));
vi.mock("@/hooks/uptime/useUptimeShareLinks", () => ({ useResolveShareLink: () => ({ data: { monitors: [] } }) }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.search = {}; mocks.session = null; mocks.error = null;
  mocks.login.mockResolvedValue({ error: null }); mocks.signup.mockResolvedValue({ error: null });
  mocks.getSession.mockResolvedValue({ data: { user: { id: "owner", role: "user" } } });
});
function Page({ signup = false }: { signup?: boolean }) {
  const Component = (signup ? SignupRoute : LoginRoute).options.component!;
  return <Component />;
}
function fill(signup: boolean) {
  if (signup) fireEvent.change(screen.getByLabelText("auth:fields.name"), { target: { value: "Owner" } });
  fireEvent.change(screen.getByLabelText("auth:fields.email"), { target: { value: "owner@example.com" } });
  fireEvent.change(screen.getByLabelText("auth:fields.password"), { target: { value: "A-strong-password-1" } });
}

describe.each([false, true])("auth session behavior (signup=%s)", signup => {
  it("redirects a confirmed existing session to the dashboard", async () => {
    mocks.session = { user: { id: "owner" } };
    render(<Page signup={signup} />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard", replace: true }));
  });
  it.each([401, 403])("does not redirect stale session data after a terminal %s", status => {
    mocks.session = { user: { id: "owner" } }; mocks.error = { status };
    render(<Page signup={signup} />);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("keeps entered values, masks returned provider details, and names a rate limit", async () => {
    const send = signup ? mocks.signup : mocks.login;
    send.mockResolvedValueOnce({ error: { status: 503, message: "private provider credentials" } }).mockResolvedValueOnce({ error: { status: 429 } });
    render(<Page signup={signup} />); fill(signup);
    fireEvent.submit(document.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(signup ? "auth:signup.error" : "auth:login.error");
    expect(screen.getByLabelText("auth:fields.email")).toHaveValue("owner@example.com");
    expect(document.body).not.toHaveTextContent("private provider credentials");
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("auth:ux.rateLimited"));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("returns to a validated private destination using SPA navigation", async () => {
    mocks.search = { returnTo: "/dashboard?q=API&group=tag#metrics" };
    render(<Page signup={signup} />); fill(signup);
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ href: mocks.search.returnTo }));
    if (signup) expect(mocks.signup).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: mocks.search.returnTo }));
  });
  it("preserves the fixed share-token destination", async () => {
    mocks.search = { share: "shared-token" };
    render(<Page signup={signup} />); fill(signup);
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/share/$token", params: { token: "shared-token" } }));
  });
  it("submits once when two submit events arrive before rendering", async () => {
    let resolve!: (value: unknown) => void;
    const send = signup ? mocks.signup : mocks.login;
    send.mockImplementation(() => new Promise(done => { resolve = done; }));
    render(<Page signup={signup} />); fill(signup);
    fireEvent.submit(document.querySelector("form")!); fireEvent.submit(document.querySelector("form")!);
    expect(send).toHaveBeenCalledOnce();
    await act(async () => { resolve({ error: null }); });
  });
});

it("validates return paths, fixed tokens and verification errors without carrying unrelated intent", () => {
  const validate = LoginRoute.options.validateSearch as (search: Record<string, unknown>) => Record<string, unknown>;
  expect(validate({ share: " token ", returnTo: "https://untrusted.invalid", reason: "session", error: "TOKEN_EXPIRED", unknown: "discard" })).toEqual({ share: "token", reason: "session", verificationError: true });
  expect(validate({ returnTo: "/dashboard?group=tag", error: "anything" })).toEqual({ returnTo: "/dashboard?group=tag" });
});
