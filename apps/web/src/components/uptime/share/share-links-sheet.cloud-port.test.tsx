import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import * as confirmations from "@/lib/confirmation";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeShareLink } from "@/types/uptime";
import { ShareLinksSheet } from "./share-links-sheet";

vi.mock("react-i18next", () => reactI18nextMock());

const listState: {
	data: UptimeShareLink[] | undefined;
	isLoading: boolean;
} = { data: undefined, isLoading: false };
const revokeMutateAsync = vi.fn();

vi.mock("@/hooks/uptime", () => ({
	useUptimeShareLinks: () => ({
		data: listState.data,
		isLoading: listState.isLoading,
	}),
	useRevokeUptimeShareLink: () => ({
		mutateAsync: revokeMutateAsync,
		isPending: false,
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

function shareLink(overrides: Partial<UptimeShareLink> = {}): UptimeShareLink {
	return {
		shareLinkId: "s1",
		token: "tok_abc",
		createdAt: "2026-06-01T00:00:00.000Z",
		expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
		monitorCount: 2,
		monitorNames: ["Alpha", "Beta"],
		...overrides,
	};
}

const clipboardWriteText = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	listState.data = undefined;
	listState.isLoading = false;
	clipboardWriteText.mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText: clipboardWriteText },
		configurable: true,
	});
	vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
});

describe("ShareLinksSheet states", () => {
	it("shows a loader while fetching", () => {
		listState.isLoading = true;
		render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
		expect(screen.getByText("Share links")).toBeInTheDocument();
		expect(screen.queryByText("No share links yet.")).not.toBeInTheDocument();
	});

	it("shows the empty state when there are no links", () => {
		listState.data = [];
		render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
		expect(screen.getByText("No share links yet.")).toBeInTheDocument();
	});

	it("renders active links with their expiry date", () => {
		listState.data = [shareLink()];
		render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
		expect(screen.getByText("Alpha, Beta")).toBeInTheDocument();
		expect(screen.getByText("2 monitors")).toBeInTheDocument();
		expect(screen.getByText(/Expires/)).toBeInTheDocument();
		expect(screen.queryByText("Expired")).not.toBeInTheDocument();
	});

	it("badges expired links", () => {
		listState.data = [
			shareLink({ expiresAt: "2020-01-01T00:00:00.000Z" }),
		];
		render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
		expect(screen.getByText("Expired")).toBeInTheDocument();
	});
});

describe("ShareLinksSheet actions", () => {
	it("copies the share URL", async () => {
		listState.data = [shareLink()];
		render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /^Copy link / }));
		expect(clipboardWriteText).toHaveBeenCalledWith(
			`${window.location.origin}/share/tok_abc`,
		);
		expect(toastSuccess).toHaveBeenCalledWith("Link copied");
	});

	it("revokes a link after confirmation", async () => {
		listState.data = [shareLink()];
		revokeMutateAsync.mockResolvedValue(undefined);
		render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /^Revoke / }));
		expect(revokeMutateAsync).toHaveBeenCalledWith({ shareLinkId: "s1" });
		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith("Share link revoked"),
		);
	});

	it("does nothing when the confirmation is declined", async () => {
		listState.data = [shareLink()];
		vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(false);
		render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /^Revoke / }));
		expect(revokeMutateAsync).not.toHaveBeenCalled();
	});

	it("shows an error toast when revoking fails", async () => {
		listState.data = [shareLink()];
		revokeMutateAsync.mockRejectedValue(new Error("nope"));
		render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /^Revoke / }));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
	});
});


it("opens the sharing disclosure with an accessible toggle", async () => {
  listState.data = [];
  render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
  const toggle = screen.getByRole("button", { name: "shareUX.whatsShared" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("shareUX.disclosure")).toBeVisible();
});

describe("ShareLinksSheet expiry date", () => {
	it("shows 'Expires on <date>' with a resolved date for an active link and no placeholder", () => {
		listState.data = [shareLink()];
		render(<ShareLinksSheet open onOpenChange={vi.fn()} />);
		const row = screen.getByText(/Expires on/);
		expect(row.textContent).not.toContain("{{date}}");
		expect(row.textContent).toMatch(/\d/);
	});
});
