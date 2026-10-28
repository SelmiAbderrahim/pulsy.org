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
import { NotificationsTab } from "./notifications-tab";

vi.mock("react-i18next", () => reactI18nextMock());

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
 vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
	vi.clearAllMocks();
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
		expect(within(dialog).getByLabelText("Headers / options (JSON)")).toHaveAttribute("aria-invalid", "true");
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
		expect(within(dialog).getAllByText(/notificationUX.noProviderTitle|notificationUX.chooseProvider/).length).toBeGreaterThan(0);
 expect(toastError).not.toHaveBeenCalled();
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
			const switches = within(dialog).getAllByRole("switch");
			const tlsExpirySwitch = requireElement(
				switches[3],
				"TLS expiry switch not found",
			);
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
					webhookUrl: undefined,
				}),
			),
		);
	});

	it("shows an error toast when create fails", async () => {
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
				hasWebhookUrl: false,
				webhookUrlMasked: null,
				recipientAddresses: ["a@x.com"],
				notifyOnDown: false,
				notifyOnRecovery: false,
				notifyOnTlsExpiry: true,
			}),
		];
		render(<NotificationsTab monitorId="m1" />);
		expect(screen.getByText("notifications.title")).toBeInTheDocument();
		expect(
			screen.getByText("https://hooks.x.com/••••••••"),
		).toBeInTheDocument();
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
 await confirmTestSend();
		await waitFor(() => expect(testMutateAsync).toHaveBeenCalledWith("c1"));
		expect(toastSuccess).toHaveBeenCalledWith("notificationUX.testAccepted");

		testMutateAsync.mockRejectedValueOnce(new Error("test boom"));
		await userEvent.click(
			screen.getByRole("button", { name: /actions.test/ }),
		);
 await confirmTestSend();
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("test boom"),
		);
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
				hasWebhookUrl: false,
				webhookUrlMasked: null,
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
		channelsData.value = [
			channel({
				channelId: "c2",
				channelType: "email",
				hasWebhookUrl: false,
				webhookUrlMasked: null,
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
		expect(within(dialog).getByText("notificationUX.noProviderTitle")).toBeInTheDocument();
 expect(toastError).not.toHaveBeenCalled();
		expect(updateMutateAsync).not.toHaveBeenCalled();
	});

	it("shows an error toast when the edit update fails", async () => {
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

	it("shows masked stored-secret placeholders and omits unchanged secrets", async () => {
		channelsData.value = [
			channel({
				channelType: "webhook",
				hasWebhookHeaders: true,
				webhookHeaderNames: ["Authorization", "X-Pulsy-Test"],
			}),
		];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
		const targetField = within(dialog).getByPlaceholderText(
			"https://hooks.x.com/••••••••",
		);
		const headersField = within(dialog).getByLabelText(
			"Headers / options (JSON)",
		);
		expect(targetField).toHaveValue("");
		expect(headersField).toHaveValue("");
		expect(headersField).toHaveAttribute(
			"placeholder",
			JSON.stringify(
				{ Authorization: "••••••••", "X-Pulsy-Test": "••••••••" },
				null,
				2,
			),
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledOnce());
		const update = updateMutateAsync.mock.calls[0]?.[0];
		expect(update).toEqual(
			expect.objectContaining({ channelId: "c1", channelType: "webhook" }),
		);
		expect(update).not.toHaveProperty("webhookUrl");
		expect(update).not.toHaveProperty("webhookHeaders");
	});

	it("replaces stored target and header values when new values are entered", async () => {
		channelsData.value = [
			channel({
				hasWebhookHeaders: true,
				webhookHeaderNames: ["Authorization"],
			}),
		];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
 await replaceTarget(dialog); await replaceHeaders(dialog);
		await userEvent.type(
			within(dialog).getByLabelText("notifications.fields.webhookUrl"),
			"https://hooks.example.com/replacement",
		);
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{ target: { value: '{ "Authorization": "Bearer replacement" }' } },
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					webhookUrl: "https://hooks.example.com/replacement",
					webhookHeaders: {
						Authorization: "Bearer replacement",
					},
				}),
			),
		);
	});

	it("clears stored webhook secrets when switching the channel to email", async () => {
		channelsData.value = [
			channel({
				hasWebhookHeaders: true,
				webhookHeaderNames: ["Authorization"],
			}),
		];
		providersData.value = [provider()];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");

 await replaceHeaders(dialog);
		fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{ target: { value: "{ stale invalid JSON" } },
		);
		const channelTypeSelect = requireElement(
			within(dialog).getAllByRole("combobox")[0],
			"Channel type select not found",
		);
		await userEvent.click(channelTypeSelect);
		await userEvent.click(screen.getByRole("option", { name: "email" }));
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
			"ops@example.com",
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					channelType: "email",
					webhookUrl: null,
					webhookHeaders: null,
				}),
			),
		);
	});

	it("rejects invalid header JSON when saving an edit", async () => {
		channelsData.value = [channel({ channelType: "webhook" })];
		render(<NotificationsTab monitorId="m1" />);
		await userEvent.click(
			screen.getByRole("button", { name: /actions.edit/ }),
		);
		const dialog = screen.getByRole("dialog");
 await replaceHeaders(dialog);
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
		expect(within(dialog).getByLabelText("Headers / options (JSON)")).toHaveAttribute("aria-invalid", "true");
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
 await replaceHeaders(dialog);
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
		expect(within(dialog).getByLabelText("Headers / options (JSON)")).toHaveAttribute("aria-invalid", "true");
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

async function confirmTestSend() {
 const dialog = await screen.findByRole("alertdialog");
 await userEvent.click(within(dialog).getByRole("button", { name: "actions.test" }));
}

async function replaceHeaders(dialog: HTMLElement) {
 const action = within(dialog).queryByRole("combobox", { name: "notificationUX.headersAction" });
 if (action) { await userEvent.click(action); await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" })); }
}
async function replaceTarget(dialog: HTMLElement) {
 await userEvent.click(within(dialog).getByRole("combobox", { name: "notificationUX.targetAction" }));
 await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
}
