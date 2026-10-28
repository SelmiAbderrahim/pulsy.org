import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reactI18nextMock } from "@/test/i18n-mock";

import { CreateApiKeyDialog } from "./create-api-key-dialog";

vi.mock("react-i18next", () => reactI18nextMock());

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: { children?: unknown }) => {
		const { to, ...rest } = props as Record<string, unknown>;
		void to;
		return <a {...(rest as object)}>{children as never}</a>;
	},
}));

const createMutateAsync = vi.fn();
const createState = { isPending: false };

vi.mock("@/hooks/apiKeys/useApiKeys", () => ({
	useCreateApiKey: () => ({
		mutateAsync: createMutateAsync,
		isPending: createState.isPending,
	}),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
	toast: {
		success: (m: unknown) => toastSuccess(m),
		error: (m: unknown) => toastError(m),
	},
}));

const clipboardWriteText = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	createState.isPending = false;
	clipboardWriteText.mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText: clipboardWriteText },
		configurable: true,
	});
});

const createdKey = {
	apiKeyId: "k1",
	scope: "full",
	name: "CI",
	keyPrefix: "pul_abcd",
	lastUsedAt: null,
	expiresAt: null,
	revokedAt: null,
	createdAt: "2026-06-01T00:00:00.000Z",
	plaintext: "pul_abcdefghijklmnop",
};

describe("CreateApiKeyDialog — name form", () => {
	it("validates the required name, then creates and reveals the key", async () => {
		const user = userEvent.setup();
		createMutateAsync.mockResolvedValue(createdKey);
		render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);

		const createButton = screen.getByRole("button", { name: "Create key" });
		expect(createButton).toBeEnabled();
    await user.click(createButton);
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveFocus();

		await user.type(screen.getByLabelText("Name"), "CI");
		expect(createButton).toBeEnabled();

		await user.click(createButton);

		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith({ name: "CI", scope: "read", expiresAt: null }),
		);
		// The plaintext is now revealed once.
		expect(screen.getByLabelText("Your API key")).toHaveValue(
			"pul_abcdefghijklmnop",
		);
		expect(
			screen.getByText("Copy this now. You won't be able to see it again."),
		).toBeInTheDocument();
	});

	it("copies the plaintext to the clipboard", async () => {
		const user = userEvent.setup();
		createMutateAsync.mockResolvedValue(createdKey);
		render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);

		await user.type(screen.getByLabelText("Name"), "CI");
		await user.click(screen.getByRole("button", { name: "Create key" }));
		await screen.findByLabelText("Your API key");

		// `userEvent.setup()` may install its own clipboard stub — spy on whatever
		// is active when the component reads it.
		const writeSpy = vi.spyOn(navigator.clipboard, "writeText");
		await user.click(screen.getByRole("button", { name: "Copy" }));
		expect(writeSpy).toHaveBeenCalledWith("pul_abcdefghijklmnop");
		expect(toastSuccess).toHaveBeenCalled();
	});

	it("surfaces an error toast when creation fails", async () => {
		const user = userEvent.setup();
		createMutateAsync.mockRejectedValue(new Error("boom"));
		render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);

		await user.type(screen.getByLabelText("Name"), "CI");
		await user.click(screen.getByRole("button", { name: "Create key" }));

		await waitFor(() => expect(toastError).toHaveBeenCalled());
		// Stays on the form (no reveal).
		expect(screen.queryByLabelText("Your API key")).not.toBeInTheDocument();
	});

	it("shows a spinner label while pending", () => {
		createState.isPending = true;
		render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);
		expect(
			screen.getByRole("button", { name: "Creating…" }),
		).toBeDisabled();
	});

	it("closes and resets via Cancel", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		render(<CreateApiKeyDialog open onOpenChange={onOpenChange} />);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("closes via Done after a key is created", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		createMutateAsync.mockResolvedValue(createdKey);
		render(<CreateApiKeyDialog open onOpenChange={onOpenChange} />);
		await user.type(screen.getByLabelText("Name"), "CI");
		await user.click(screen.getByRole("button", { name: "Create key" }));
		await screen.findByLabelText("Your API key");
		await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
