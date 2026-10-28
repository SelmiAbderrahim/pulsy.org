import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { VerifyEmailBanner } from "./verify-email-banner";

vi.mock("react-i18next", () => reactI18nextMock());

const useSession = vi.fn();
const sendVerificationEmail = vi.fn();
vi.mock("@/lib/auth-client", () => ({
	useSession: () => useSession(),
	authClient: {
		sendVerificationEmail: (args: unknown) => sendVerificationEmail(args),
	},
}));

const useConfig = vi.fn();
vi.mock("@/hooks/useConfig", () => ({
	useConfig: () => useConfig(),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
const deliveredToastOptions = vi.fn();
vi.mock("sonner", () => ({
	toast: {
		error: (m: unknown, options?: unknown) => { deliveredToastOptions("error", options); toastError(m); },
		success: (m: unknown, options?: unknown) => { deliveredToastOptions("success", options); toastSuccess(m); },
	},
}));

function setSession(user: Record<string, unknown> | null) {
	useSession.mockReturnValue({ data: user ? { user } : null });
}

beforeEach(() => {
	vi.clearAllMocks();
	useConfig.mockReturnValue({ data: { requireEmailVerification: true } });
});

describe("VerifyEmailBanner visibility", () => {
	it("renders when verification is required and the user is unverified", () => {
		setSession({ email: "a@b.com", emailVerified: false });
		render(<VerifyEmailBanner />);
		expect(
			screen.getByText("auth:verifyBanner.title"),
		).toBeInTheDocument();
	});

	it("renders nothing when verification is not required", () => {
		useConfig.mockReturnValue({ data: { requireEmailVerification: false } });
		setSession({ email: "a@b.com", emailVerified: false });
		const { container } = render(<VerifyEmailBanner />);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing when the email is already verified", () => {
		setSession({ email: "a@b.com", emailVerified: true });
		const { container } = render(<VerifyEmailBanner />);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing when there is no email", () => {
		setSession({ email: undefined, emailVerified: false });
		const { container } = render(<VerifyEmailBanner />);
		expect(container).toBeEmptyDOMElement();
	});

	it("defaults emailVerified to true and requireVerification to false when config/session absent", () => {
		useConfig.mockReturnValue({ data: undefined });
		setSession(null);
		const { container } = render(<VerifyEmailBanner />);
		expect(container).toBeEmptyDOMElement();
	});
});

describe("VerifyEmailBanner resend", () => {
	beforeEach(() => {
		setSession({ email: "a@b.com", emailVerified: false });
	});

	it.each(["success", "error"] as const)("uses the shared dismissible %s toast duration after resend", async (kind) => {
		sendVerificationEmail.mockResolvedValue({ error: kind === "error" ? { message: "rate limited" } : null });
		render(<VerifyEmailBanner />);
		await userEvent.click(screen.getByRole("button", { name: "auth:verifyBanner.resend" }));
		await waitFor(() => expect(deliveredToastOptions).toHaveBeenCalledWith(kind, expect.objectContaining({
			duration: kind === "error" ? 10_000 : 5_000, closeButton: true,
		})));
	});

	it("sends the verification email and shows success", async () => {
		sendVerificationEmail.mockResolvedValue({ error: null });
		render(<VerifyEmailBanner />);
		await userEvent.click(
			screen.getByRole("button", { name: "auth:verifyBanner.resend" }),
		);
		await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
		expect(sendVerificationEmail).toHaveBeenCalledWith({
			email: "a@b.com",
			callbackURL: "/dashboard",
		});
	});

	it("shows the error message returned by the auth client", async () => {
		sendVerificationEmail.mockResolvedValue({
			error: { message: "rate limited" },
		});
		render(<VerifyEmailBanner />);
		await userEvent.click(
			screen.getByRole("button", { name: "auth:verifyBanner.resend" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("rate limited"));
		expect(toastSuccess).not.toHaveBeenCalled();
	});

	it("falls back to a generic error when the returned error has no message", async () => {
		sendVerificationEmail.mockResolvedValue({ error: {} });
		render(<VerifyEmailBanner />);
		await userEvent.click(
			screen.getByRole("button", { name: "auth:verifyBanner.resend" }),
		);
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("auth:verifyBanner.resendError"),
		);
	});

	it("handles a thrown error during resend", async () => {
		sendVerificationEmail.mockRejectedValue(new Error("network down"));
		render(<VerifyEmailBanner />);
		await userEvent.click(
			screen.getByRole("button", { name: "auth:verifyBanner.resend" }),
		);
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("network down"),
		);
	});
});
