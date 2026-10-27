import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import { act, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { ShareMonitorsDialog } from "./share-monitors-dialog";

vi.mock("react-i18next", () => reactI18nextMock());

const preview = vi.hoisted(() => vi.fn());
vi.mock("@/services/uptime/uptimeService", () => ({ UptimeService: { previewShareLink: preview } }));
const createMutateAsync = vi.fn();
const createState = { isPending: false };

vi.mock("@/hooks/uptime", () => ({
	useCreateUptimeShareLink: () => ({
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

function monitor(id: string, name: string): UptimeMonitor {
	return { uptimeMonitorId: id, name, url: `https://${id}.com` } as UptimeMonitor;
}

const createdLink = {
	shareLinkId: "s1",
	token: "tok_abc",
	monitorIds: ["m1"],
	createdAt: "2026-06-01T00:00:00.000Z",
	expiresAt: "2026-07-01T00:00:00.000Z",
};

const clipboardWriteText = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
  preview.mockImplementation(async (ids: string[]) => ids.map(id => ({ uptimeMonitorId: id, name: id, url: `https://${id}.com`, method: "GET", interval: 300, timeout: 10000, expectedStatus: 200, failureThreshold: 3, tags: [] })));
	createState.isPending = false;
	clipboardWriteText.mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText: clipboardWriteText },
		configurable: true,
	});
});

describe("ShareMonitorsDialog before creation", () => {
	it("lists the selected monitor names", async () => {
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={vi.fn()}
				monitors={[monitor("m1", "Alpha"), monitor("m2", "Beta")]}
			/>,
		);
		expect(screen.getByText("Alpha")).toBeInTheDocument();
		expect(screen.getByText("Beta")).toBeInTheDocument();
		expect(screen.getByText("Share 2 monitors")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("common:states.loading")).not.toBeInTheDocument());
	});

	it("keeps all selected monitor names available for review", async () => {
		const monitors = Array.from({ length: 7 }, (_, i) =>
			monitor(`m${i}`, `Monitor ${i}`),
		);
		render(
			<ShareMonitorsDialog open onOpenChange={vi.fn()} monitors={monitors} />,
		);
		expect(screen.getByText("Monitor 4")).toBeInTheDocument();
		expect(screen.getByText("Monitor 5")).toBeInTheDocument();
    expect(screen.getByText("Monitor 6")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("common:states.loading")).not.toBeInTheDocument());
	});

	it("disables the create button with no monitors", () => {
		render(<ShareMonitorsDialog open onOpenChange={vi.fn()} monitors={[]} />);
		expect(
			screen.getByRole("button", { name: "Create link" }),
		).toBeDisabled();
	});

	it("shows the in-progress label while creating", async () => {
		createState.isPending = true;
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={vi.fn()}
				monitors={[monitor("m1", "Alpha")]}
			/>,
		);
		expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();
    await waitFor(() => expect(screen.queryByText("common:states.loading")).not.toBeInTheDocument());
	});

	it("closes without onCreated when nothing was created", async () => {
		const onOpenChange = vi.fn();
		const onCreated = vi.fn();
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={onOpenChange}
				monitors={[monitor("m1", "Alpha")]}
				onCreated={onCreated}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onCreated).not.toHaveBeenCalled();
	});
});

describe("ShareMonitorsDialog creation flow", () => {
	it("creates a link with the default 30-day expiry and shows the URL", async () => {
		createMutateAsync.mockResolvedValue(createdLink);
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={vi.fn()}
				monitors={[monitor("m1", "Alpha")]}
			/>,
		);
		await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));

		expect(createMutateAsync).toHaveBeenCalledWith({
			uptimeMonitorIds: ["m1"],
			expiresInDays: 30,
			showSharerName: false,
		});
		const input = await screen.findByLabelText("Share link");
		expect((input as HTMLInputElement).value).toBe(
			`${window.location.origin}/share/tok_abc`,
		);
		expect(screen.getByText(/Expires/)).toBeInTheDocument();
	});

	it("honors a different expiry chosen in the select", async () => {
		createMutateAsync.mockResolvedValue(createdLink);
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={vi.fn()}
				monitors={[monitor("m1", "Alpha")]}
			/>,
		);
		await userEvent.click(screen.getByRole("combobox"));
		await userEvent.click(screen.getByRole("option", { name: "7 days" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));

		expect(createMutateAsync).toHaveBeenCalledWith({
			uptimeMonitorIds: ["m1"],
			expiresInDays: 7,
			showSharerName: false,
		});
	});

	it("copies the link to the clipboard", async () => {
		createMutateAsync.mockResolvedValue(createdLink);
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={vi.fn()}
				monitors={[monitor("m1", "Alpha")]}
			/>,
		);
		await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
		await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

		expect(clipboardWriteText).toHaveBeenCalledWith(
			`${window.location.origin}/share/tok_abc`,
		);
		expect(toastSuccess).toHaveBeenCalledWith("Link copied");
	});

	it("notifies onCreated and resets when closed after creating", async () => {
		createMutateAsync.mockResolvedValue(createdLink);
		const onOpenChange = vi.fn();
		const onCreated = vi.fn();
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={onOpenChange}
				monitors={[monitor("m1", "Alpha")]}
				onCreated={onCreated}
			/>,
		);
		await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
		await userEvent.click(screen.getByRole("button", { name: "Done" }));

		expect(onCreated).toHaveBeenCalledTimes(1);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("closes after creating even without an onCreated callback", async () => {
		createMutateAsync.mockResolvedValue(createdLink);
		const onOpenChange = vi.fn();
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={onOpenChange}
				monitors={[monitor("m1", "Alpha")]}
			/>,
		);
		await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
		await userEvent.click(screen.getByRole("button", { name: "Done" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("shows an error toast when creation fails", async () => {
		createMutateAsync.mockRejectedValue(new Error("nope"));
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={vi.fn()}
				monitors={[monitor("m1", "Alpha")]}
			/>,
		);
		await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
		expect(screen.queryByLabelText("Share link")).not.toBeInTheDocument();
	});
});


describe("reviewed sharing boundaries", () => {
  it("does not create when a private configuration fails preview", async () => {
    preview.mockRejectedValue(new Error("Private endpoint cannot be shared"));
    render(<ShareMonitorsDialog open onOpenChange={vi.fn()} monitors={[monitor("m1", "Alpha")]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Private endpoint cannot be shared");
    expect(screen.getByRole("button", { name: "Create link" })).toBeDisabled();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });
  it("prevents duplicate creates before the mutation state catches up", async () => {
    createMutateAsync.mockImplementation(() => new Promise(() => {}));
    render(<ShareMonitorsDialog open onOpenChange={vi.fn()} monitors={[monitor("m1", "Alpha")]} />);
    const button = screen.getByRole("button", { name: "Create link" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button); fireEvent.click(button);
    expect(createMutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe("ShareMonitorsDialog expiry choices", () => {
	it("offers exactly 7, 30 and 90 days and never a 'Never' option", async () => {
		render(<ShareMonitorsDialog open onOpenChange={vi.fn()} monitors={[monitor("m1", "Alpha")]} />);
		await userEvent.click(screen.getByRole("combobox"));
		const options = screen.getAllByRole("option").map(option => option.textContent);
		expect(options).toEqual(["7 days", "30 days", "90 days"]);
		expect(screen.queryByRole("option", { name: /never/i })).not.toBeInTheDocument();
	});

	it("submits a 90-day expiry when selected", async () => {
		createMutateAsync.mockResolvedValue(createdLink);
		render(<ShareMonitorsDialog open onOpenChange={vi.fn()} monitors={[monitor("m1", "Alpha")]} />);
		await userEvent.click(screen.getByRole("combobox"));
		await userEvent.click(screen.getByRole("option", { name: "90 days" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
		await userEvent.click(screen.getByRole("button", { name: "Create link" }));
		expect(createMutateAsync).toHaveBeenCalledWith({ uptimeMonitorIds: ["m1"], expiresInDays: 90, showSharerName: false });
	});
});

it.each([false, true])("ignores link creation completion from a retired session (failure=%s)", async failure => {
  const { retireSessionClient } = await import("@/lib/session-query-client");
  let resolve!: (value: typeof createdLink) => void, reject!: (value: Error) => void;
  createMutateAsync.mockImplementation(() => new Promise((ok, no) => { resolve = ok; reject = no; }));
  const view = render(<ShareMonitorsDialog open monitors={[monitor("m1", "Alpha")]} onOpenChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Create link" }));
  retireSessionClient(view.client);
  await act(async () => { if (failure) reject(new Error("Old account")); else resolve(createdLink); });
  expect(screen.queryByLabelText("Share link")).not.toBeInTheDocument();
  expect(toastSuccess).not.toHaveBeenCalled(); expect(toastError).not.toHaveBeenCalled();
});
