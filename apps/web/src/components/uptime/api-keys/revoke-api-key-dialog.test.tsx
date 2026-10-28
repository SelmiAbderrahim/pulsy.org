import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reactI18nextMock } from "@/test/i18n-mock";
import type { ApiKey } from "@/types/apiKey";

import { RevokeApiKeyDialog } from "./revoke-api-key-dialog";

vi.mock("react-i18next", () => reactI18nextMock());

const revokeMutateAsync = vi.fn();
const revokeState = { isPending: false };

vi.mock("@/hooks/apiKeys/useApiKeys", () => ({
	useRevokeApiKey: () => ({
		mutateAsync: revokeMutateAsync,
		isPending: revokeState.isPending,
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

const apiKey: ApiKey = {
	apiKeyId: "k1",
	scope: "full",
	name: "CI pipeline",
	keyPrefix: "pul_abcd",
	lastUsedAt: null,
	expiresAt: null,
	revokedAt: null,
	createdAt: "2026-06-01T00:00:00.000Z",
};

beforeEach(() => {
	vi.clearAllMocks();
	revokeState.isPending = false;
});

describe("RevokeApiKeyDialog", () => {
	it("keeps the revoke button disabled until the confirm word is typed", async () => {
		const user = userEvent.setup();
		render(
			<RevokeApiKeyDialog open onOpenChange={vi.fn()} apiKey={apiKey} />,
		);
		const revoke = screen.getByRole("button", { name: "Revoke key" });
		expect(revoke).toBeDisabled();

		await user.type(screen.getByLabelText("Type REVOKE to confirm"), "nope");
		expect(revoke).toBeDisabled();

		await user.clear(screen.getByLabelText("Type REVOKE to confirm"));
		// Case-insensitive match.
		await user.type(screen.getByLabelText("Type REVOKE to confirm"), "revoke");
		expect(revoke).toBeEnabled();
	});

	it("revokes the key and closes on success", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		revokeMutateAsync.mockResolvedValue({ success: true });
		render(
			<RevokeApiKeyDialog open onOpenChange={onOpenChange} apiKey={apiKey} />,
		);
		await user.type(screen.getByLabelText("Type REVOKE to confirm"), "REVOKE");
		await user.click(screen.getByRole("button", { name: "Revoke key" }));

		await waitFor(() =>
			expect(revokeMutateAsync).toHaveBeenCalledWith({ apiKeyId: "k1" }),
		);
		expect(toastSuccess).toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("surfaces an error toast when revoke fails", async () => {
		const user = userEvent.setup();
		revokeMutateAsync.mockRejectedValue(new Error("boom"));
		render(
			<RevokeApiKeyDialog open onOpenChange={vi.fn()} apiKey={apiKey} />,
		);
		await user.type(screen.getByLabelText("Type REVOKE to confirm"), "REVOKE");
		await user.click(screen.getByRole("button", { name: "Revoke key" }));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
	});

	it("no-ops when confirmed with no key selected", async () => {
		const user = userEvent.setup();
		render(<RevokeApiKeyDialog open onOpenChange={vi.fn()} apiKey={null} />);
		await user.type(screen.getByLabelText("Type REVOKE to confirm"), "REVOKE");
		await user.click(screen.getByRole("button", { name: "Revoke key" }));
		expect(revokeMutateAsync).not.toHaveBeenCalled();
	});

	it("cancels and clears the confirm text", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		render(
			<RevokeApiKeyDialog open onOpenChange={onOpenChange} apiKey={apiKey} />,
		);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("shows the revoking label while pending", () => {
		revokeState.isPending = true;
		render(
			<RevokeApiKeyDialog open onOpenChange={vi.fn()} apiKey={apiKey} />,
		);
		expect(screen.getByRole("button", { name: "Revoking…" })).toBeDisabled();
	});
});
