import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { ShareMonitorsDialog } from "./share-monitors-dialog";

vi.mock("react-i18next", () => reactI18nextMock());

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
vi.mock("sonner", () => ({
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
	createState.isPending = false;
	clipboardWriteText.mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText: clipboardWriteText },
		configurable: true,
	});
});

describe("ShareMonitorsDialog before creation", () => {
	it("lists the selected monitor names", () => {
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
	});

	it("collapses more than five monitors into an overflow row", () => {
		const monitors = Array.from({ length: 7 }, (_, i) =>
			monitor(`m${i}`, `Monitor ${i}`),
		);
		render(
			<ShareMonitorsDialog open onOpenChange={vi.fn()} monitors={monitors} />,
		);
		expect(screen.getByText("Monitor 4")).toBeInTheDocument();
		expect(screen.queryByText("Monitor 5")).not.toBeInTheDocument();
		expect(screen.getByText("+2 more")).toBeInTheDocument();
	});

	it("disables the create button with no monitors", () => {
		render(<ShareMonitorsDialog open onOpenChange={vi.fn()} monitors={[]} />);
		expect(
			screen.getByRole("button", { name: "Create link" }),
		).toBeDisabled();
	});

	it("shows the in-progress label while creating", () => {
		createState.isPending = true;
		render(
			<ShareMonitorsDialog
				open
				onOpenChange={vi.fn()}
				monitors={[monitor("m1", "Alpha")]}
			/>,
		);
		expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();
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
		await userEvent.click(screen.getByRole("button", { name: "Create link" }));

		expect(createMutateAsync).toHaveBeenCalledWith({
			uptimeMonitorIds: ["m1"],
			expiresInDays: 30,
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
		await userEvent.click(screen.getByRole("button", { name: "Create link" }));

		expect(createMutateAsync).toHaveBeenCalledWith({
			uptimeMonitorIds: ["m1"],
			expiresInDays: 7,
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
		await userEvent.click(screen.getByRole("button", { name: "Create link" }));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
		expect(screen.queryByLabelText("Share link")).not.toBeInTheDocument();
	});
});
