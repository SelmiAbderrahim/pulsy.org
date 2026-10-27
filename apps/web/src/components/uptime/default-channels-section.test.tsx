import * as confirmations from "@/lib/confirmation";
import { renderWithQueryClient as render } from "@/test/query-wrapper";
import {
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type {
	UptimeEmailProvider,
	UptimeNotificationChannel,
} from "@/types/uptime";
import { DefaultChannelsSection } from "./default-channels-section";

vi.mock("react-i18next", () => reactI18nextMock());

const defaultsData = {
	value: undefined as UptimeNotificationChannel[] | undefined,
};
const providersData = { value: [] as UptimeEmailProvider[] };
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();
const testMutateAsync = vi.fn();
const pending = { create: false, update: false, delete: false, test: false };

vi.mock("@/hooks/uptime", () => ({
 useUptimeChannelHealth: () => ({ data: [] }),
	useUptimeDefaultChannels: () => ({ data: defaultsData.value }),
	useUptimeEmailProviders: () => ({ data: providersData.value }),
	useCreateUptimeDefaultChannel: () => ({
		mutateAsync: createMutateAsync,
		isPending: pending.create,
	}),
	useUpdateUptimeNotificationChannel: () => ({
		mutateAsync: updateMutateAsync,
		isPending: pending.update,
	}),
	useDeleteUptimeNotificationChannel: () => ({
		mutateAsync: deleteMutateAsync,
		isPending: pending.delete,
	}),
	useTestUptimeNotificationChannel: () => ({
		mutateAsync: testMutateAsync,
		isPending: pending.test,
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

function requireElement(
	element: Element | undefined,
	message: string,
): Element {
	if (!element) throw new Error(message);
	return element;
}

function defaultChannel(
	overrides: Partial<UptimeNotificationChannel> = {},
): UptimeNotificationChannel {
	return {
		channelId: "d1",
		uptimeMonitorId: null,
		userId: "u1",
		channelType: "webhook",
		hasWebhookUrl: true,
		webhookUrlMasked: "https://hooks.x.com/••••••••",
		hasWebhookHeaders: false,
		webhookHeaderNames: [],
		emailProviderId: null,
		recipientAddresses: null,
		notifyOnDown: true,
		notifyOnRecovery: true,
		notifyOnTlsExpiry: false,
		tlsExpiryThresholdDays: 14,
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	} as UptimeNotificationChannel;
}

function provider(): UptimeEmailProvider {
	return {
		emailProviderId: "e1",
		name: "Primary",
		providerType: "resend",
		fromAddress: "a@x.com",
	} as UptimeEmailProvider;
}

const addButtonName = "Add default channel";

beforeEach(() => {
 vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
	vi.clearAllMocks();
	defaultsData.value = undefined;
	providersData.value = [];
	pending.create = pending.update = pending.delete = pending.test = false;
});

describe("DefaultChannelsSection empty state", () => {
	it("renders the empty state when no defaults exist", () => {
		defaultsData.value = [];
		render(<DefaultChannelsSection />);
		expect(screen.getByRole("heading", { name: "Default channels" })).toBeInTheDocument();
		expect(
			screen.getByText(
				"No default channels yet. Add one to alert every monitor without per-monitor setup.",
			),
		).toBeInTheDocument();
	});

	it("renders the empty state while channels are loading (undefined)", () => {
		defaultsData.value = undefined;
		render(<DefaultChannelsSection />);
		expect(
			screen.getByText(
				"No default channels yet. Add one to alert every monitor without per-monitor setup.",
			),
		).toBeInTheDocument();
	});

	it("opens the create dialog from the add button", async () => {
		defaultsData.value = [];
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: addButtonName }));
		expect(screen.getByText("notifications.create.title")).toBeInTheDocument();
	});
});

describe("DefaultChannelsSection list", () => {
	it("renders email and webhook rows with their targets", () => {
		defaultsData.value = [
			defaultChannel({
				channelId: "d1",
				channelType: "email",
				hasWebhookUrl: false,
				webhookUrlMasked: null,
				emailProviderId: "e1",
				recipientAddresses: ["ops@x.com", "oncall@x.com"],
			}),
			defaultChannel({
				channelId: "d2",
				channelType: "webhook",
			}),
		];
		render(<DefaultChannelsSection />);
		expect(screen.getByText("ops@x.com, oncall@x.com")).toBeInTheDocument();
		expect(
			screen.getByText("https://hooks.x.com/••••••••"),
		).toBeInTheDocument();
		expect(screen.getAllByText("All monitors")).toHaveLength(2);
	});

	it("tests a channel with success and error", async () => {
		defaultsData.value = [defaultChannel()];
		testMutateAsync.mockResolvedValueOnce(undefined);
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.test/ }));
		await waitFor(() => expect(testMutateAsync).toHaveBeenCalledWith("d1"));
		expect(toastSuccess).toHaveBeenCalledWith("notificationUX.testAccepted");

		testMutateAsync.mockRejectedValueOnce(new Error("boom"));
		await userEvent.click(screen.getByRole("button", { name: /actions.test/ }));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
	});

	it("shows a spinner on the test button while testing", () => {
		defaultsData.value = [defaultChannel()];
		pending.test = true;
		render(<DefaultChannelsSection />);
		expect(
			screen.getByRole("button", { name: /actions.test/ }),
		).toBeDisabled();
	});

	it("deletes a channel with success and error", async () => {
		defaultsData.value = [defaultChannel()];
		deleteMutateAsync.mockResolvedValueOnce(undefined);
		render(<DefaultChannelsSection />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.delete/ }),
		);
		await waitFor(() =>
			expect(deleteMutateAsync).toHaveBeenCalledWith({
				channelId: "d1",
				uptimeMonitorId: null,
			}),
		);
		expect(toastSuccess).toHaveBeenCalledWith("notifications.delete.success");

		deleteMutateAsync.mockRejectedValueOnce(new Error("boom"));
		await userEvent.click(
			screen.getByRole("button", { name: /actions.delete/ }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalled());
	});
});

describe("DefaultChannelsSection create", () => {
	it("blocks an email default without a provider", async () => {
		defaultsData.value = [];
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: addButtonName }));
		const dialog = screen.getByRole("dialog");
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.recipientsPlaceholder",
			),
			"a@x.com",
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		expect(within(dialog).getAllByText(/notificationUX.noProviderTitle|notificationUX.chooseProvider/).length).toBeGreaterThan(0);
 expect(toastError).not.toHaveBeenCalled();
		expect(createMutateAsync).not.toHaveBeenCalled();
	});

	it("creates an email default with provider + recipients", async () => {
		defaultsData.value = [];
		providersData.value = [provider()];
		createMutateAsync.mockResolvedValue(undefined);
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: addButtonName }));
		const dialog = screen.getByRole("dialog");
		// The section defaults to the email channel type — the provider select is
		// the second combobox.
		const providerSelect = requireElement(
			within(dialog).getAllByRole("combobox")[1],
			"Email provider select not found",
		);
		await userEvent.click(providerSelect);
		await userEvent.click(screen.getByRole("option", { name: "Primary" }));
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.recipientsPlaceholder",
			),
			"a@x.com, b@x.com",
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					channelType: "email",
					emailProviderId: "e1",
					recipientAddresses: ["a@x.com", "b@x.com"],
					webhookUrl: undefined,
					webhookHeaders: undefined,
				}),
			),
		);
		expect(toastSuccess).toHaveBeenCalledWith("notifications.create.success");
	});

	it("creates a webhook default with custom headers", async () => {
		defaultsData.value = [];
		createMutateAsync.mockResolvedValue(undefined);
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: addButtonName }));
		const dialog = screen.getByRole("dialog");
		const channelTypeSelect = requireElement(
			within(dialog).getAllByRole("combobox")[0],
			"Channel type select not found",
		);
		await userEvent.click(channelTypeSelect);
		await userEvent.click(screen.getByRole("option", { name: "webhook" }));
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.webhookUrlPlaceholder",
			),
			"https://hooks.x.com/new",
		);
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{ target: { value: '{ "X-Pulsy": "1" }' } },
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					channelType: "webhook",
					webhookUrl: "https://hooks.x.com/new",
					webhookHeaders: { "X-Pulsy": "1" },
					emailProviderId: undefined,
					recipientAddresses: undefined,
				}),
			),
		);
	});

	it("rejects invalid custom header JSON", async () => {
		defaultsData.value = [];
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: addButtonName }));
		const dialog = screen.getByRole("dialog");
		const channelTypeSelect = requireElement(
			within(dialog).getAllByRole("combobox")[0],
			"Channel type select not found",
		);
		await userEvent.click(channelTypeSelect);
		await userEvent.click(screen.getByRole("option", { name: "webhook" }));
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.webhookUrlPlaceholder",
			),
			"https://hooks.x.com/new",
		);
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{ target: { value: '{ "X-Pulsy": 1 }' } },
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		expect(within(dialog).getByLabelText("Headers / options (JSON)")).toHaveAttribute("aria-invalid", "true");
 expect(toastError).not.toHaveBeenCalled();
		expect(createMutateAsync).not.toHaveBeenCalled();
	});

	it("shows an error toast when create fails", async () => {
		defaultsData.value = [];
		providersData.value = [provider()];
		createMutateAsync.mockRejectedValue(new Error("nope"));
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: addButtonName }));
		const dialog = screen.getByRole("dialog");
		const providerSelect = requireElement(
			within(dialog).getAllByRole("combobox")[1],
			"Email provider select not found",
		);
		await userEvent.click(providerSelect);
		await userEvent.click(screen.getByRole("option", { name: "Primary" }));
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.recipientsPlaceholder",
			),
			"a@x.com",
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("nope"));
	});

	it("closes the create dialog via Cancel", async () => {
		defaultsData.value = [];
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: addButtonName }));
		const dialog = screen.getByRole("dialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.cancel" }),
		);
		await waitFor(() =>
			expect(
				screen.queryByText("notifications.create.title"),
			).not.toBeInTheDocument(),
		);
	});

	it("falls back to an empty provider list when none are loaded", async () => {
		defaultsData.value = [];
		providersData.value = undefined as never;
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: addButtonName }));
		const dialog = screen.getByRole("dialog");
		// Email is the default type, so the provider select renders with no options.
		expect(within(dialog).getAllByRole("combobox")).toHaveLength(2);
	});
});

describe("DefaultChannelsSection edit", () => {
	it("opens an email default prefilled and saves the update", async () => {
		defaultsData.value = [
			defaultChannel({
				channelId: "d2",
				channelType: "email",
				hasWebhookUrl: false,
				webhookUrlMasked: null,
				emailProviderId: "e1",
				recipientAddresses: ["a@x.com"],
			}),
		];
		providersData.value = [provider()];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		const dialog = screen.getByRole("dialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: "d2",
					uptimeMonitorId: null,
					channelType: "email",
					emailProviderId: "e1",
					recipientAddresses: ["a@x.com"],
				}),
			),
		);
		expect(toastSuccess).toHaveBeenCalledWith("Channel updated successfully");
	});

	it("keeps stored secrets masked and omits them on an unchanged save", async () => {
		defaultsData.value = [
			defaultChannel({
				channelId: "d3",
				channelType: "webhook",
				hasWebhookHeaders: true,
				webhookHeaderNames: ["X-Pulsy"],
			}),
		];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByPlaceholderText("https://hooks.x.com/••••••••"),
		).toHaveValue("");
		const headersField = within(dialog).getByLabelText(
			"Headers / options (JSON)",
		);
		expect(headersField).toHaveValue("");
		expect(headersField).toHaveAttribute(
			"placeholder",
			JSON.stringify({ "X-Pulsy": "••••••••" }, null, 2),
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledOnce());
		const update = updateMutateAsync.mock.calls[0]?.[0];
		expect(update).toEqual(
			expect.objectContaining({
				channelId: "d3",
				uptimeMonitorId: null,
				channelType: "webhook",
				emailProviderId: null,
			}),
		);
		expect(update).not.toHaveProperty("webhookUrl");
		expect(update).not.toHaveProperty("webhookHeaders");
	});

	it("sends an explicit empty header object to clear stored headers", async () => {
		defaultsData.value = [
			defaultChannel({
				hasWebhookHeaders: true,
				webhookHeaderNames: ["Authorization"],
			}),
		];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		const dialog = screen.getByRole("dialog");

 await replaceHeaders(dialog);
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{ target: { value: "{}" } },
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ webhookHeaders: {} }),
			),
		);
	});

	it("blocks saving an email default that lost its provider", async () => {
		defaultsData.value = [
			defaultChannel({
				channelId: "d4",
				channelType: "email",
				hasWebhookUrl: false,
				webhookUrlMasked: null,
				emailProviderId: null,
				recipientAddresses: ["a@x.com"],
			}),
		];
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		const dialog = screen.getByRole("dialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		expect(within(dialog).getByText("notificationUX.noProviderTitle")).toBeInTheDocument();
 expect(toastError).not.toHaveBeenCalled();
		expect(updateMutateAsync).not.toHaveBeenCalled();
	});

	it("rejects invalid header JSON on save", async () => {
		defaultsData.value = [defaultChannel()];
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		const dialog = screen.getByRole("dialog");

 await replaceHeaders(dialog);
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{ target: { value: "not json" } },
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		expect(within(dialog).getByLabelText("Headers / options (JSON)")).toHaveAttribute("aria-invalid", "true");
 expect(toastError).not.toHaveBeenCalled();
		expect(updateMutateAsync).not.toHaveBeenCalled();
	});

	it("shows an error toast when the edit update fails", async () => {
		defaultsData.value = [defaultChannel()];
		updateMutateAsync.mockRejectedValue(new Error("nope"));
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		const dialog = screen.getByRole("dialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("nope"));
	});

	it("closes the edit dialog when dismissed", async () => {
		defaultsData.value = [defaultChannel()];
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		const dialog = screen.getByRole("dialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.cancel" }),
		);
		await waitFor(() =>
			expect(
				screen.queryByText("Edit Notification Channel"),
			).not.toBeInTheDocument(),
		);
	});
});

async function replaceHeaders(dialog: HTMLElement) {
 const action = within(dialog).queryByRole("combobox", { name: "notificationUX.headersAction" });
 if (action) { await userEvent.click(action); await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" })); }
}
async function replaceTarget(dialog: HTMLElement) {
 await userEvent.click(within(dialog).getByRole("combobox", { name: "notificationUX.targetAction" }));
 await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
}
