import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import * as confirmations from "@/lib/confirmation";
import { act, screen, waitFor } from "@testing-library/react";
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
	name: "CI",
	keyPrefix: "pul_abcd",
	lastUsedAt: null,
	expiresAt: null,
	revokedAt: null,
	createdAt: "2026-06-01T00:00:00.000Z",
	plaintext: "pul_abcdefghijklmnop",
};

describe("CreateApiKeyDialog — name form", () => {
	it("summarizes an empty name, focuses it, then creates and reveals the key", async () => {
		const user = userEvent.setup();
		createMutateAsync.mockResolvedValue(createdKey);
		render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);

		const createButton = screen.getByRole("button", { name: "Create key" });
		expect(createButton).toBeEnabled();
    await user.click(createButton);
    expect(screen.getAllByRole("alert").filter(alert => alert.querySelector("a"))).toHaveLength(1);
    expect(screen.queryByText("nav.formErrors")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(createMutateAsync).not.toHaveBeenCalled();

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

describe("CreateApiKeyDialog — privilege and one-time secret", () => {
	const create = async (user: ReturnType<typeof userEvent.setup>, onOpenChange = vi.fn()) => {
		createMutateAsync.mockResolvedValue(createdKey);
		render(<CreateApiKeyDialog open onOpenChange={onOpenChange} />);
		await user.type(screen.getByLabelText("Name"), "CI");
		await user.click(screen.getByRole("button", { name: "Create key" }));
		await screen.findByLabelText("Your API key");
		return onOpenChange;
	};
	it("repeats the chosen privilege right where the key is created, and ties it to the button", async () => {
		const { unmount } = render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);
		await userEvent.click(screen.getByLabelText("apiKeys.permissions.scope"));
  await userEvent.click(screen.getByRole("option", { name: "apiKeys.permissions.full" }));
    expect(screen.getByText(/full access \(read and write\)/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Create key" })).toHaveAttribute("aria-describedby", "api-key-privilege");
		unmount();
		render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);
		expect(screen.getByText(/read-only/i)).toBeInTheDocument();
		expect(screen.queryByText(/full access/i)).not.toBeInTheDocument();
	});
	it("keeps the secret masked until deliberately shown, and sends nothing but the name", async () => {
		const user = userEvent.setup(); await create(user);
		const field = screen.getByLabelText("Your API key");
		expect(field).toHaveAttribute("type", "password");
		await user.click(screen.getByRole("button", { name: "Show key" }));
		expect(field).toHaveAttribute("type", "text");
		expect(createMutateAsync).toHaveBeenCalledWith({ name: "CI", scope: "read", expiresAt: null });
	});
	it("asks before closing an uncopied key, keeps it on decline, and forgets it once confirmed", async () => {
		const user = userEvent.setup(); const confirm = vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(false);
		const onOpenChange = await create(user);
		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(confirm).toHaveBeenCalledTimes(1); expect(onOpenChange).not.toHaveBeenCalled(); expect(screen.getByLabelText("Your API key")).toBeInTheDocument();
		confirm.mockResolvedValue(true);
		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		confirm.mockRestore();
	});
	it("does not nag once the key was copied", async () => {
		const user = userEvent.setup(); const confirm = vi.spyOn(confirmations, "requestConfirmation");
		const onOpenChange = await create(user);
		await user.click(screen.getByRole("button", { name: "Copy" }));
		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(confirm).not.toHaveBeenCalled(); expect(onOpenChange).toHaveBeenCalledWith(false);
		confirm.mockRestore();
	});
});

it("creates a full-scope key with end-of-day UTC expiry and excludes today", async () => {
  createMutateAsync.mockResolvedValue(createdKey);
  render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);
  await userEvent.type(screen.getByLabelText("Name"), "Release");
  await userEvent.click(screen.getByLabelText("apiKeys.permissions.scope"));
  await userEvent.click(screen.getByRole("option", { name: "apiKeys.permissions.full" }));
  const expiry = screen.getByLabelText("apiKeys.permissions.expiry");
  await userEvent.click(expiry);
  const today = new Date();
  const todayLabel = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(today);
  expect(screen.getByRole("button", { name: todayLabel })).toBeDisabled();
  await userEvent.keyboard("{ArrowRight}{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Create key" }));
  await waitFor(() => expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: "Release", scope: "full", expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/) })));
  const sentExpiry = createMutateAsync.mock.calls[0]?.[0]?.expiresAt as string;
  expect(Date.parse(sentExpiry)).toBeGreaterThan(Date.now());
});


it("maps server expiry errors to the picker and summary without a generic toast", async () => {
  const user = userEvent.setup();
  createMutateAsync.mockRejectedValue({ data: { validationErrors: { fieldErrors: { expiresAt: ["Choose a future UTC date"] } } } });
  render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);
  await user.type(screen.getByLabelText("Name"), "CI");
  await user.click(screen.getByRole("button", { name: "Create key" }));
  const error = await screen.findByRole("link", { name: "apiKeys.permissions.expiry: Choose a future UTC date" });
  const picker = screen.getByLabelText("apiKeys.permissions.expiry");
  expect(picker).toHaveAttribute("aria-invalid", "true");
  expect(picker.getAttribute("aria-describedby")).toContain(error.id);
  await waitFor(() => expect(picker).toHaveFocus());
  expect(toastError).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Your API key")).not.toBeInTheDocument();
});

it.each([false, true])("disposes an outstanding key creation when its session retires (failure=%s)", async failure => {
  const { retireSessionClient } = await import("@/lib/session-query-client");
  let resolve!: (value: typeof createdKey) => void, reject!: (value: Error) => void;
  createMutateAsync.mockImplementation(() => new Promise((ok, no) => { resolve = ok; reject = no; }));
  const view = render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);
  await userEvent.type(screen.getByLabelText("Name"), "CI");
  await userEvent.click(screen.getByRole("button", { name: "Create key" }));
  retireSessionClient(view.client);
  await act(async () => { if (failure) reject(new Error("Old account")); else resolve(createdKey); });
  expect(screen.queryByLabelText("Your API key")).not.toBeInTheDocument();
  expect(toastSuccess).not.toHaveBeenCalled(); expect(toastError).not.toHaveBeenCalled();
});

it("freezes name, scope and expiry during key creation", async () => {
  let resolve!: (value: typeof createdKey) => void;
  createMutateAsync.mockImplementation(() => new Promise(ok => { resolve = ok; createState.isPending = true; }));
  const view = render(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);
  await userEvent.type(screen.getByLabelText("Name"), "CI");
  await userEvent.click(screen.getByRole("button", { name: "Create key" }));
  view.rerender(<CreateApiKeyDialog open onOpenChange={vi.fn()} />);
  expect(screen.getByLabelText("Name")).toBeDisabled();
  expect(screen.getByLabelText("apiKeys.permissions.scope")).toBeDisabled();
  expect(screen.getByLabelText("apiKeys.permissions.expiry")).toBeDisabled();
  await act(async () => resolve(createdKey));
});
