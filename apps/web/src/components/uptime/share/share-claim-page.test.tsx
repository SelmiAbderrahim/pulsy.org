vi.mock("@dr.pogodin/react-helmet", () => ({ Helmet: () => null }));
import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { ResolvedShareLink } from "@/types/uptime";
import { ShareClaimPage } from "./share-claim-page";

vi.mock("react-i18next", () => reactI18nextMock());

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const resolveState: {
	data: ResolvedShareLink | undefined;
	isLoading: boolean;
	error: unknown;
} = { data: undefined, isLoading: false, error: null };
const cloneMutateAsync = vi.fn();
const cloneState = { isPending: false };
const ownMonitors = { data: [], isPending: false, refetch: vi.fn() };

vi.mock("@/hooks/uptime", () => ({
	useUptimeMonitors: () => ownMonitors,
  useResolveShareLink: () => ({
		data: resolveState.data,
		isLoading: resolveState.isLoading,
		error: resolveState.error,
	}),
	useCloneSharedMonitors: () => ({
		mutateAsync: cloneMutateAsync,
		isPending: cloneState.isPending,
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

function resolved(overrides: Partial<ResolvedShareLink> = {}): ResolvedShareLink {
	return {
		sharedBy: "Owner",
		expiresAt: "2026-07-01T00:00:00.000Z",
		monitors: [
			{
				uptimeMonitorId: "m1",
				name: "Alpha",
				url: "https://a.com",
				method: "GET",
				expectedStatus: 200,
				timeout: 10_000,
				interval: 300,
				failureThreshold: 3,
				tags: [],
			},
			{
				uptimeMonitorId: "m2",
				name: "Beta",
				url: "https://b.com",
				method: "GET",
				expectedStatus: 200,
				timeout: 10_000,
				interval: 300,
				failureThreshold: 3,
				tags: [],
			},
		],
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	resolveState.data = undefined;
	resolveState.isLoading = false;
	resolveState.error = null;
	cloneState.isPending = false;
});

describe("ShareClaimPage states", () => {
	it("shows a loader while resolving", () => {
		resolveState.isLoading = true;
		const { container } = render(<ShareClaimPage token="tok1" />);
		expect(container.querySelector(".animate-spin")).toBeInTheDocument();
	});

	it("shows the unavailable card with the server message on error", async () => {
		resolveState.error = new Error("This share link has expired");
		render(<ShareClaimPage token="tok1" />);
		expect(screen.getByText("Link unavailable")).toBeInTheDocument();
		expect(
			screen.getByText("This share link has expired"),
		).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "Go to dashboard" }),
		);
		expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard" });
	});

	it("shows the unavailable card when no data arrives", () => {
		render(<ShareClaimPage token="tok1" />);
		expect(screen.getByText("Link unavailable")).toBeInTheDocument();
	});

	it("shows the empty card when every shared monitor is gone", async () => {
		resolveState.data = resolved({ monitors: [] });
		render(<ShareClaimPage token="tok1" />);
		expect(
			screen.getByText("The shared monitors are no longer available."),
		).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "Go to dashboard" }),
		);
		expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard" });
	});

	it("titles the card with the sharer's name", () => {
		resolveState.data = resolved();
		render(<ShareClaimPage token="tok1" />);
		expect(
			screen.getByText("Owner shared monitors with you"),
		).toBeInTheDocument();
	});

	it("falls back to an anonymous title without a sharer name", () => {
		resolveState.data = resolved({ sharedBy: null });
		render(<ShareClaimPage token="tok1" />);
		expect(
			screen.getByText("A Pulsy user shared monitors with you"),
		).toBeInTheDocument();
	});
});

describe("ShareClaimPage selection", () => {
	it("pre-selects all monitors", () => {
		resolveState.data = resolved();
		render(<ShareClaimPage token="tok1" />);
		expect(
			screen.getByRole("button", { name: "Add 2 monitors" }),
		).toBeEnabled();
	});

	it("toggles a monitor off and back on", async () => {
		resolveState.data = resolved();
		render(<ShareClaimPage token="tok1" />);
		const alphaCheckbox = screen.getByRole("checkbox", { name: "Alpha" });
		await userEvent.click(alphaCheckbox);
		expect(
			screen.getByRole("button", { name: "Add 1 monitors" }),
		).toBeEnabled();
		await userEvent.click(alphaCheckbox);
		expect(
			screen.getByRole("button", { name: "Add 2 monitors" }),
		).toBeEnabled();
	});

	it("select-all clears and re-selects everything", async () => {
		resolveState.data = resolved();
		render(<ShareClaimPage token="tok1" />);
		const selectAll = screen.getByRole("checkbox", { name: "Select all" });
		await userEvent.click(selectAll);
		expect(
			screen.getByRole("button", { name: "Add 0 monitors" }),
		).toBeDisabled();
		await userEvent.click(selectAll);
		expect(
			screen.getByRole("button", { name: "Add 2 monitors" }),
		).toBeEnabled();
	});
});

describe("ShareClaimPage cloning", () => {
	it("clones the selected monitors and navigates to the dashboard", async () => {
		resolveState.data = resolved();
		cloneMutateAsync.mockResolvedValue([{ uptimeMonitorId: "n1" }]);
		render(<ShareClaimPage token="tok1" />);
		await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Add 1 monitors" }),
		);
		expect(cloneMutateAsync).toHaveBeenCalledWith({
			token: "tok1",
			uptimeMonitorIds: ["m2"],
		});
		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith("Added 1 monitors"),
		);
		expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard" });
	});

	it("shows an inline error when cloning fails", async () => {
		resolveState.data = resolved();
		cloneMutateAsync.mockRejectedValue(new Error("expired"));
		render(<ShareClaimPage token="tok1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "Add 2 monitors" }),
		);
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("expired"));
    expect(toastError).not.toHaveBeenCalled();
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("shows the in-progress label while cloning", () => {
		resolveState.data = resolved();
		cloneState.isPending = true;
		render(<ShareClaimPage token="tok1" />);
		expect(screen.getByRole("button", { name: /Adding/ })).toBeDisabled();
	});

	it("navigates away via maybe later", async () => {
		resolveState.data = resolved();
		render(<ShareClaimPage token="tok1" />);
		await userEvent.click(screen.getByRole("button", { name: "Maybe later" }));
		expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard" });
	});
});
