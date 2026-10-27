import { renderWithQueryClient as render } from "@/test/query-wrapper";
import * as confirmations from "@/lib/confirmation";
const detachReference = vi.fn();
vi.mock("@/services/uptime/monitorTemplatesService", () => ({ MonitorTemplatesService: { detachChannel: (...args: unknown[]) => detachReference(...args) } }));
import {
	act,
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
import { NotificationsTab } from "./notifications-tab";

vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });

vi.mock("./email-providers-section", () => ({
	EmailProvidersSection: () => <div data-testid="email-providers" />,
}));

vi.mock("@/components/uptime/notification-log-table", () => ({
	NotificationLogTable: ({ monitorId }: { monitorId?: string }) => (
		<div data-testid="delivery-history" data-monitor={monitorId} />
	),
}));

const channelsData = {
	value: undefined as UptimeNotificationChannel[] | undefined,
};
const defaultChannelsData = {
	value: undefined as UptimeNotificationChannel[] | undefined,
};
const providersData = { value: [] as UptimeEmailProvider[] };
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();
const testMutateAsync = vi.fn();
const pending = { create: false, update: false, delete: false, test: false };

vi.mock("@/hooks/uptime", () => ({
	useUptimeNotificationChannels: () => ({ data: channelsData.value }),
	useUptimeDefaultChannels: () => ({ data: defaultChannelsData.value }),
	useUptimeEmailProviders: () => ({ data: providersData.value }),
	useCreateUptimeNotificationChannel: () => ({
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

function channel(
	overrides: Partial<UptimeNotificationChannel> = {},
): UptimeNotificationChannel {
	return {
		channelId: "c1",
		channelType: "webhook",
		hasWebhookUrl: true, webhookUrlMasked: "hooks.x.com", hasWebhookHeaders: false, webhookHeaderNames: [],
		emailProviderId: null,
		recipientAddresses: null,
		notifyOnDown: true,
		notifyOnRecovery: true,
		notifyOnTlsExpiry: false,
		tlsExpiryThresholdDays: 14,
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

beforeEach(() => {
	vi.clearAllMocks();
 vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
	channelsData.value = undefined;
	defaultChannelsData.value = undefined;
	providersData.value = [];
	pending.create = pending.update = pending.delete = pending.test = false;
});

describe("NotificationsTab default-channels notice", () => {
	it("shows a notice when account-level default channels exist", () => {
		channelsData.value = [];
		defaultChannelsData.value = [channel({ uptimeMonitorId: null })];
		render(<NotificationsTab monitorId="m1" />);
		expect(
			screen.getByText("notifications.defaultsNotice"),
		).toBeInTheDocument();
	});

	it("shows the notice alongside the channels table too", () => {
		channelsData.value = [channel()];
		defaultChannelsData.value = [channel({ uptimeMonitorId: null })];
		render(<NotificationsTab monitorId="m1" />);
		expect(
			screen.getByText("notifications.defaultsNotice"),
		).toBeInTheDocument();
	});

	it("renders no notice when there are no default channels", () => {
		channelsData.value = [];
		defaultChannelsData.value = [];
		render(<NotificationsTab monitorId="m1" />);
		expect(
			screen.queryByText("notifications.defaultsNotice"),
		).not.toBeInTheDocument();
	});
});

describe("NotificationsTab empty state", () => {
	it("renders the empty state and the email-providers section", () => {
		channelsData.value = [];
		render(<NotificationsTab monitorId="m1" />);
		expect(screen.getByText("notifications.empty")).toBeInTheDocument();
		expect(screen.getByTestId("email-providers")).toBeInTheDocument();
	});

	it("opens the create dialog from the empty state", async () => {
		channelsData.value = undefined;
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
		expect(
			screen.getByText("notifications.create.title"),
		).toBeInTheDocument();
	});

	it("falls back to an empty provider list when none are loaded", async () => {
		channelsData.value = [];
		// `emailProviders` undefined exercises the `emailProviders ?? []` fallback.
		providersData.value = undefined as never;
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
		const dialog = screen.getByRole("dialog");
		const channelTypeSelect = requireElement(
			within(dialog).getAllByRole("combobox")[0],
			"Channel type select not found",
		);
		await userEvent.click(channelTypeSelect);
		await userEvent.click(screen.getByRole("option", { name: "email" }));
		// Provider select renders with no options (empty fallback list).
		expect(within(dialog).getAllByRole("combobox").length).toBe(2);
	});
});

describe("NotificationsTab create channel", () => {
	it("creates a webhook channel", async () => {
		channelsData.value = [];
		createMutateAsync.mockResolvedValue(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.webhookUrlPlaceholder",
			),
			"https://hooks.x.com/zzz",
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					uptimeMonitorId: "m1",
					channelType: "webhook",
					webhookUrl: "https://hooks.x.com/zzz",
					emailProviderId: undefined,
					recipientAddresses: undefined,
				}),
			),
		);
		expect(toastSuccess).toHaveBeenCalledWith("notifications.create.success");
	});

	it("creates a webhook channel with custom headers", async () => {
		channelsData.value = [];
		createMutateAsync.mockResolvedValue(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.webhookUrlPlaceholder",
			),
			"https://hooks.x.com/zzz",
		);
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{
				target: { value: '{ "X-Pulsy-Test": "true" }' },
			},
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					channelType: "webhook",
					webhookHeaders: { "X-Pulsy-Test": "true" },
				}),
			),
		);
	});

	it("rejects invalid custom header JSON", async () => {
		channelsData.value = [];
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.webhookUrlPlaceholder",
			),
			"https://hooks.x.com/zzz",
		);
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{
				target: { value: '{ "X-Pulsy-Test": true }' },
			},
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		expect(within(dialog).getAllByRole("alert").some(alert => alert.textContent?.includes("notifications.fields.webhookHeadersInvalid"))).toBe(true);
    const headers = within(dialog).getByLabelText("Headers / options (JSON)");
    expect(headers).toHaveAttribute("aria-invalid", "true");
    expect(headers).toHaveFocus();
    expect(toastError).not.toHaveBeenCalled();
		expect(createMutateAsync).not.toHaveBeenCalled();
	});

	it("creates a Telegram channel with shorthand token and chat target", async () => {
		channelsData.value = [];
		createMutateAsync.mockResolvedValue(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
		const dialog = screen.getByRole("dialog");
		const channelTypeSelect = requireElement(
			within(dialog).getAllByRole("combobox")[0],
			"Channel type select not found",
		);
		await userEvent.click(channelTypeSelect);
		await userEvent.click(screen.getByRole("option", { name: "telegram" }));
		await userEvent.type(
			within(dialog).getByLabelText("notificationUX.telegramBotToken"),
			"123456:abcdef",
		);
    await userEvent.type(within(dialog).getByLabelText("notificationUX.telegramChatId"), "-100999");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					channelType: "telegram",
					webhookUrl: "123456:abcdef:-100999",
				}),
			),
		);
	});

	it("blocks email channel creation without a provider", async () => {
		channelsData.value = [];
		providersData.value = [provider()];
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
			);
			const dialog = screen.getByRole("dialog");
			// switch channel type to email
			const channelTypeSelect = requireElement(
				within(dialog).getAllByRole("combobox")[0],
				"Channel type select not found",
			);
			await userEvent.click(channelTypeSelect);
			await userEvent.click(screen.getByRole("option", { name: "email" }));
		// fill recipients (a required field) but leave the provider unset so the
		// submit handler runs and hits the provider-required guard.
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.recipientsPlaceholder",
			),
			"a@x.com",
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		expect(within(dialog).getByRole("alert")).toHaveTextContent("notificationUX.chooseProvider");
		expect(createMutateAsync).not.toHaveBeenCalled();
	});

	it("creates an email channel with provider + recipients and TLS threshold", async () => {
		channelsData.value = [];
		providersData.value = [provider()];
		createMutateAsync.mockResolvedValue(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
			);
			const dialog = screen.getByRole("dialog");
			const channelTypeSelect = requireElement(
				within(dialog).getAllByRole("combobox")[0],
				"Channel type select not found",
			);
			await userEvent.click(channelTypeSelect);
			await userEvent.click(screen.getByRole("option", { name: "email" }));
			// choose the email provider (second combobox now present)
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
			// enable TLS expiry → reveals the threshold input
			await userEvent.click(within(dialog).getByRole("switch", { name: "notifications.fields.notifyOnDegraded" }));
			const tlsExpirySwitch = within(dialog).getByRole("switch", { name: "notifications.fields.notifyOnTlsExpiry" });
			await userEvent.click(tlsExpirySwitch);
		// The threshold number input appears once TLS expiry is enabled.
		const thresholdInput = within(dialog).getByRole("spinbutton");
		await userEvent.clear(thresholdInput);
		await userEvent.type(thresholdInput, "21");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					tlsExpiryThresholdDays: 21,
					channelType: "email",
					emailProviderId: "e1",
					recipientAddresses: ["a@x.com", "b@x.com"],
					notifyOnTlsExpiry: true,
					notifyOnDegraded: true,
					webhookUrl: undefined,
				}),
			),
		);
	});

	it("keeps submission feedback in the dialog when create fails", async () => {
		channelsData.value = [];
		createMutateAsync.mockRejectedValue(new Error("create boom"));
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.type(
			within(dialog).getByPlaceholderText(
				"notifications.fields.webhookUrlPlaceholder",
			),
			"https://hooks.x.com/zzz",
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.addChannel" }),
		);
		await waitFor(() =>
			expect(within(dialog).getByRole("alert")).toHaveTextContent("create boom"),
		);
	});

	it("closes the create dialog via Cancel", async () => {
		channelsData.value = [];
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
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
});

describe("NotificationsTab list & row actions", () => {
	it("renders channels with yes/no flags", () => {
		channelsData.value = [
			channel({ channelId: "c1", channelType: "webhook" }),
			channel({
				channelId: "c2",
				channelType: "email",
				
				recipientAddresses: ["a@x.com"],
				notifyOnDown: false,
				notifyOnRecovery: false,
				notifyOnTlsExpiry: true,
			}),
		];
		render(<NotificationsTab monitorId="m1" />);
		expect(screen.getByText("notifications.title")).toBeInTheDocument();
		expect(screen.getByText("hooks.x.com")).toBeInTheDocument();
		expect(screen.getByText("a@x.com")).toBeInTheDocument();
		expect(
			screen.getAllByText("notifications.fields.yes").length,
		).toBeGreaterThan(0);
		expect(
			screen.getAllByText("notifications.fields.no").length,
		).toBeGreaterThan(0);
	});

	it("tests a channel with success and error", async () => {
		channelsData.value = [channel()];
		testMutateAsync.mockResolvedValueOnce(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.test/ }),
		);
		expect(screen.getByRole("alertdialog")).toHaveTextContent("notificationUX.confirmTest");
		expect(testMutateAsync).not.toHaveBeenCalled();
		await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "actions.test" }));
		await waitFor(() => expect(testMutateAsync).toHaveBeenCalledWith("c1"));
		expect(toastSuccess).toHaveBeenCalledWith("notificationUX.testAccepted");

		testMutateAsync.mockRejectedValueOnce(new Error("test boom"));
		await userEvent.click(
			screen.getByRole("button", { name: /actions.test/ }),
		);
		await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "actions.test" }));
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("test boom"),
		);
	});

	it("sends nothing when the test confirmation is declined, and opening or cancelling an edit sends and saves nothing", async () => {
		channelsData.value = [channel()];
		const native = vi.spyOn(confirmations, "requestConfirmation");
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(screen.getByRole("button", { name: /actions.test/ }));
		await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "actions.cancel" }));
		expect(testMutateAsync).not.toHaveBeenCalled();
		expect(native).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "actions.cancel" }));
		expect(testMutateAsync).not.toHaveBeenCalled();
		expect(updateMutateAsync).not.toHaveBeenCalled();
	});

	it("explains a disabled email completion when no provider exists and warns about an untested one", async () => {
		channelsData.value = [];
		providersData.value = [];
		const { unmount } = render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(screen.getByRole("button", { name: "actions.addChannel" }));
		await userEvent.click(within(screen.getByRole("dialog")).getAllByRole("combobox")[0]!);
		await userEvent.click(screen.getByRole("option", { name: "email" }));
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByText("notificationUX.noProviderTitle")).toBeInTheDocument();
		const submit = within(dialog).getByRole("button", { name: "actions.addChannel" });
		expect(submit).toBeDisabled();
		expect(submit.getAttribute("aria-describedby")).toBeTruthy();
		unmount();
		providersData.value = [{ ...provider(), verified: false }];
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(screen.getByRole("button", { name: "actions.addChannel" }));
		await userEvent.click(within(screen.getByRole("dialog")).getAllByRole("combobox")[0]!);
		await userEvent.click(screen.getByRole("option", { name: "email" }));
		expect(within(screen.getByRole("dialog")).queryByText("notificationUX.noProviderTitle")).not.toBeInTheDocument();
		await userEvent.click(within(screen.getByRole("dialog")).getAllByRole("combobox")[1]!);
		await userEvent.click(screen.getByRole("option", { name: "Primary" }));
		expect(within(screen.getByRole("dialog")).getByText("notificationUX.providerUntestedHint")).toBeInTheDocument();
	});

	it("deletes a channel with success and error", async () => {
		channelsData.value = [channel()];
		deleteMutateAsync.mockResolvedValueOnce(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.delete/ }),
		);
		await waitFor(() =>
			expect(deleteMutateAsync).toHaveBeenCalledWith({
				channelId: "c1",
				uptimeMonitorId: "m1",
			}),
		);
		expect(toastSuccess).toHaveBeenCalledWith("notifications.delete.success");

		deleteMutateAsync.mockRejectedValueOnce(new Error("del boom"));
		await userEvent.click(
			screen.getByRole("button", { name: /actions.delete/ }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("del boom"));
	});

	it("shows a spinner on the test button while testing", () => {
		channelsData.value = [channel()];
		pending.test = true;
		const { container } = render(<NotificationsTab monitorId="m1" />);
		expect(container.querySelector(".animate-spin")).toBeInTheDocument();
	});
});

describe("NotificationsTab edit channel", () => {
	it("opens an email channel prefilled and saves the update", async () => {
		channelsData.value = [
			channel({
				channelId: "c2",
				channelType: "email",
				
				emailProviderId: "e1",
				recipientAddresses: ["a@x.com"],
			}),
		];
		providersData.value = [provider()];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: "c2",
					channelType: "email",
					emailProviderId: "e1",
					recipientAddresses: ["a@x.com"],
				}),
			),
		);
		expect(toastSuccess).toHaveBeenCalledWith(
			"Channel updated successfully",
		);
	});

	it("blocks saving an email channel that lost its provider", async () => {
		providersData.value = [provider()];
		channelsData.value = [
			channel({
				channelId: "c2",
				channelType: "email",
				
				emailProviderId: null,
				recipientAddresses: ["a@x.com"],
			}),
		];
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		expect(within(dialog).getByRole("alert")).toHaveTextContent("notificationUX.chooseProvider");
		expect(updateMutateAsync).not.toHaveBeenCalled();
	});

	it("keeps submission feedback in the dialog when the edit update fails", async () => {
		channelsData.value = [channel()];
		updateMutateAsync.mockRejectedValue(new Error("edit boom"));
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(within(dialog).getByRole("alert")).toHaveTextContent("edit boom"),
		);
	});

	it("closes the edit dialog when dismissed", async () => {
		channelsData.value = [channel()];
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.cancel" }),
		);
		await waitFor(() =>
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
		);
	});

	it("retains masked headers without returning their value to the draft", async () => {
		channelsData.value = [
			channel({
				channelType: "webhook",
				 hasWebhookHeaders: true,
			}),
		];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
		// The retained secret is never rendered in an editable field.
		const headersField = within(dialog).getByLabelText(
			"Headers / options (JSON)",
		);
		expect(headersField).toHaveValue(
			"",
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: "c1",
					channelType: "webhook",
				}),
			),
		);
 expect(updateMutateAsync.mock.calls[0]?.[0]).not.toHaveProperty("webhookUrl");
 expect(updateMutateAsync.mock.calls[0]?.[0]).not.toHaveProperty("webhookHeaders");
	});

	it("rejects invalid header JSON when saving an edit", async () => {
		channelsData.value = [channel({ channelType: "webhook" })];
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.click(within(dialog).getByRole("combobox", { name: "notificationUX.headersAction" }));
		await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
		// Unparseable JSON drives `parseWebhookHeaders` into its `catch` branch.
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{
				target: { value: "{ not valid json" },
			},
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		expect(within(dialog).getAllByRole("alert").some(alert => alert.textContent?.includes("notifications.fields.webhookHeadersInvalid"))).toBe(true);
    const headers = within(dialog).getByLabelText("Headers / options (JSON)");
    expect(headers).toHaveAttribute("aria-invalid", "true");
    expect(headers).toHaveFocus();
    expect(toastError).not.toHaveBeenCalled();
		expect(updateMutateAsync).not.toHaveBeenCalled();
	});

	it("rejects non-object header JSON when saving an edit", async () => {
		channelsData.value = [channel({ channelType: "webhook" })];
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
		await userEvent.click(within(dialog).getByRole("combobox", { name: "notificationUX.headersAction" }));
		await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
		// A JSON array parses but is not a plain object → the non-object guard.
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{
				target: { value: '["a", "b"]' },
			},
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		expect(within(dialog).getAllByRole("alert").some(alert => alert.textContent?.includes("notifications.fields.webhookHeadersInvalid"))).toBe(true);
    const headers = within(dialog).getByLabelText("Headers / options (JSON)");
    expect(headers).toHaveAttribute("aria-invalid", "true");
    expect(headers).toHaveFocus();
    expect(toastError).not.toHaveBeenCalled();
		expect(updateMutateAsync).not.toHaveBeenCalled();
	});
});

describe("NotificationsTab dialog pending", () => {
	it("shows a spinner in the create dialog while creating", async () => {
		channelsData.value = [];
		pending.create = true;
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
		const dialog = screen.getByRole("dialog");
		expect(dialog.querySelector(".animate-spin")).toBeInTheDocument();
	});

	it("falls back to an empty provider list in the list-path and edit dialogs", async () => {
		// Channels present (list path) + providers undefined exercises the
		// `emailProviders ?? []` fallback for both the list-path create dialog and
		// the edit dialog.
		channelsData.value = [channel()];
		providersData.value = undefined as never;
		render(<NotificationsTab monitorId="m1" />);

		// List-path create dialog
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addChannel" }),
		);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
		);

		// Edit dialog
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});
});

it("shows reused channel references and detaches only the chosen monitor binding", async () => {
  const confirm = vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true); detachReference.mockResolvedValue({ success: true });
  render(<NotificationsTab monitorId="m1" referencedChannels={[{ id: "owned-reference", type: "webhook" }]} />);
  expect(screen.getByText("templates.linkedChannels")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "templates.detach" }));
  await waitFor(() => expect(detachReference).toHaveBeenCalledWith("m1", "owned-reference"));
  await waitFor(() => expect(screen.queryByText("templates.linkedChannels")).not.toBeInTheDocument()); confirm.mockRestore();
});

it("cancels test sends with Escape, returns focus, and confirms only one request while pending", async () => {
  channelsData.value = [channel()];
  testMutateAsync.mockImplementation(() => new Promise(() => {}));
  render(<NotificationsTab monitorId="m1" />);
  const opener = screen.getByRole("button", { name: /actions.test/ });
  await userEvent.click(opener); await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(opener).toHaveFocus(); expect(testMutateAsync).not.toHaveBeenCalled();
  await userEvent.click(opener);
  await userEvent.dblClick(within(screen.getByRole("alertdialog")).getByRole("button", { name: "actions.test" }));
  await waitFor(() => expect(testMutateAsync).toHaveBeenCalledTimes(1));
  expect(testMutateAsync).toHaveBeenCalledWith("c1"); expect(opener).toBeDisabled();
  await userEvent.click(opener); expect(testMutateAsync).toHaveBeenCalledTimes(1);
});

it("names the empty channel and delivery history sections", () => {
  channelsData.value = [];
  render(<NotificationsTab monitorId="m1" />);
  expect(screen.getByRole("region", { name: "notifications.title" })).toContainElement(screen.getByRole("button", { name: "actions.addChannel" }));
  expect(screen.getByRole("region", { name: "notifications.history.title" })).toContainElement(screen.getByTestId("delivery-history"));
});


it.each([false, true])("keeps a newer channel editor when a dismissed create finishes (failure=%s)", async failure => {
 let release!: (value: unknown) => void, reject!: (error: Error) => void;
 createMutateAsync.mockImplementation(() => new Promise((resolve, fail) => { release = resolve; reject = fail; }));
 channelsData.value = [channel()]; render(<NotificationsTab monitorId="m1" />);
 await userEvent.click(screen.getByRole("button", { name: "actions.addChannel" }));
 const create = screen.getByRole("dialog");
 await userEvent.click(within(create).getByRole("combobox", { name: "notifications.fields.channelType" }));
 await userEvent.click(screen.getByRole("option", { name: "webhook" }));
 await userEvent.type(within(create).getByLabelText("notifications.fields.webhookUrl"), "https://first.invalid/hook");
 await userEvent.click(within(create).getByRole("button", { name: "actions.addChannel" }));
 await waitFor(() => expect(createMutateAsync).toHaveBeenCalledOnce());
 await userEvent.click(within(create).getByRole("button", { name: "actions.cancel" }));
 await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "actions.discard" }));
 await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
 await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
 const edit = screen.getByRole("dialog");
 await userEvent.click(within(edit).getByRole("combobox", { name: "notificationUX.targetAction" }));
 await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
 const target = within(edit).getByLabelText("notifications.fields.webhookUrl");
 await userEvent.type(target, "https://second.invalid/new-draft");
 await act(async () => { if (failure) reject(new Error("First request failed")); else release(undefined); });
 expect(target).toHaveValue("https://second.invalid/new-draft");
 expect(within(edit).getByRole("combobox", { name: "notifications.fields.channelType" })).toHaveTextContent("webhook");
 expect(edit).not.toHaveTextContent("First request failed");
});


it("invalidates monitor details and lists after an accepted detach even when the tab closes", async () => {
 const { uptimeKeys } = await import("@/hooks/uptime/queryKeys");
 let release!: (value: unknown) => void;
 detachReference.mockImplementation(() => new Promise(resolve => { release = resolve; }));
 const view = render(<NotificationsTab monitorId="m1" referencedChannels={[{ id: "owned-reference", type: "webhook" }]} />);
 const detailKey = uptimeKeys.monitors.detail("m1"), listKey = uptimeKeys.monitors.lists();
 view.client.setQueryData(detailKey, { referencedChannels: [{ id: "owned-reference", type: "webhook" }] }); view.client.setQueryData(listKey, [{ uptimeMonitorId: "m1", overrideChannelCount: 1 }]);
 await userEvent.click(screen.getByRole("button", { name: "templates.detach" }));
 await waitFor(() => expect(detachReference).toHaveBeenCalledWith("m1", "owned-reference")); view.unmount();
 await act(async () => release({ success: true }));
 expect(view.client.getQueryState(detailKey)?.isInvalidated).toBe(true); expect(view.client.getQueryState(listKey)?.isInvalidated).toBe(true);
});
