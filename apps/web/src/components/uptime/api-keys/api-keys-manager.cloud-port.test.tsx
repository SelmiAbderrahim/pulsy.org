import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reactI18nextMock } from "@/test/i18n-mock";
import type { ApiKey } from "@/types/apiKey";

import { ApiKeysManager } from "./api-keys-manager";

vi.mock("react-i18next", () => reactI18nextMock());

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: { children?: unknown }) => {
		const { to, ...rest } = props as Record<string, unknown>;
		void to;
		return <a {...(rest as object)}>{children as never}</a>;
	},
}));

const keysResult = {
	data: undefined as ApiKey[] | undefined,
	isLoading: false,
};

vi.mock("@/hooks/apiKeys/useApiKeys", () => ({
	useApiKeys: () => keysResult,
  useRemoveApiKey: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));


vi.mock("./create-api-key-dialog", () => ({
	CreateApiKeyDialog: ({ open }: { open: boolean }) =>
		open ? <div data-testid="create-dialog">create-open</div> : null,
}));

vi.mock("./revoke-api-key-dialog", () => ({
	RevokeApiKeyDialog: ({
		open,
		apiKey,
		onOpenChange,
	}: {
		open: boolean;
		apiKey: ApiKey | null;
		onOpenChange: (open: boolean) => void;
	}) =>
		open ? (
			<div data-testid="revoke-dialog">
				{apiKey?.name}
				<button type="button" onClick={() => onOpenChange(false)}>
					close-revoke
				</button>
			</div>
		) : null,
}));

const key = (id: string, overrides: Partial<ApiKey> = {}): ApiKey => ({
	apiKeyId: id,
	name: `Key ${id}`,
	scope: "full", keyPrefix: "pul_abcd",
	lastUsedAt: null,
	expiresAt: null,
	revokedAt: null,
	createdAt: "2026-06-01T00:00:00.000Z",
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	keysResult.data = undefined;
	keysResult.isLoading = false;
});


describe("ApiKeysManager — manager", () => {
  it("shows revoked keys with removal instead of revocation", () => {
    keysResult.data = [key("revoked", { revokedAt: "2026-10-16T12:00:00Z" }), key("expired", { expiresAt: "2020-01-01T00:00:00Z" }), key("active")];
    render(<ApiKeysManager />);
    expect(screen.getByText("Key revoked")).toBeInTheDocument();
    expect(screen.getByText("apiKeys.revoked")).toBeInTheDocument();
    expect(screen.getByText("apiKeys.expired")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Revoke / })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Revoke Key active" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Key active");
    expect(screen.getByRole("button", { name: /apiKeys.remove/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Create API key/ })).toHaveLength(1);
  });

	it("shows full key permissions and the keys table", () => {
		keysResult.data = [key("k1", { name: "CI", lastUsedAt: null })];
		render(<ApiKeysManager />);
		expect(screen.getByText("apiKeys.permissions.full")).toBeInTheDocument();
		expect(screen.getByText("CI")).toBeInTheDocument();
		// Null lastUsedAt renders as "Never".
		expect(screen.getByText("Never")).toBeInTheDocument();
	});

	it("shows read key permissions and a formatted last-used date", () => {
		keysResult.data = [
			key("k1", { scope: "read", lastUsedAt: "2026-06-02T00:00:00.000Z" }),
		];
		render(<ApiKeysManager />);
		expect(screen.getByText("apiKeys.permissions.read")).toBeInTheDocument();
		expect(screen.queryByText("Never")).not.toBeInTheDocument();
	});

	it("renders the empty state when there are no keys", () => {
		keysResult.data = [];
		render(<ApiKeysManager />);
		expect(screen.getByText("No API keys yet.")).toBeInTheDocument();
	});

	it("shows a spinner while the keys list loads", () => {
		keysResult.isLoading = true;
		render(<ApiKeysManager />);
		expect(screen.queryByText("No API keys yet.")).not.toBeInTheDocument();
	});

	it("opens the create dialog", async () => {
		const user = userEvent.setup();
		keysResult.data = [];
		render(<ApiKeysManager />);
		await user.click(screen.getAllByRole("button", { name: /Create API key/ })[0]!);
		expect(screen.getByTestId("create-dialog")).toBeInTheDocument();
	});

	it("opens the revoke dialog for a row", async () => {
		const user = userEvent.setup();
		keysResult.data = [key("k1", { name: "Prod" })];
		render(<ApiKeysManager />);
		await user.click(screen.getByRole("button", { name: /^Revoke / }));
		expect(screen.getByTestId("revoke-dialog")).toHaveTextContent("Prod");
	});

	it("clears the selected key when the revoke dialog closes", async () => {
		const user = userEvent.setup();
		keysResult.data = [key("k1", { name: "Prod" })];
		render(<ApiKeysManager />);
		await user.click(screen.getByRole("button", { name: /^Revoke / }));
		await user.click(screen.getByRole("button", { name: "close-revoke" }));
		expect(screen.queryByTestId("revoke-dialog")).not.toBeInTheDocument();
	});
});

it("offers only the empty-state Create action when no keys exist", async () => {
  keysResult.data = [];
  render(<ApiKeysManager />);
  const header = screen.getByRole("heading", { name: "API keys" }).closest("header")!;
  expect(within(header).queryByRole("button", { name: "Create API key" })).not.toBeInTheDocument();
  const empty = screen.getByText("No API keys yet.").parentElement!;
  await userEvent.click(within(empty).getByRole("button", { name: "Create API key" }));
  expect(screen.getByTestId("create-dialog")).toBeInTheDocument();
});
