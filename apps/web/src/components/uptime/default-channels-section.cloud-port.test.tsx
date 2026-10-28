import { renderWithQueryClient as render } from "@/test/query-wrapper";
import * as confirmations from "@/lib/confirmation";
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
import { DefaultChannelsSection } from "./default-channels-section";

vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });

const defaultsData = {
	value: undefined as UptimeNotificationChannel[] | undefined,
};
const defaultsState = { isPending: false, error: null as Error | null, refetch: vi.fn() };
const providersData = { value: [] as UptimeEmailProvider[] };
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();
const testMutateAsync = vi.fn();
const pending = { create: false, update: false, delete: false, test: false };

const channelHealthData: { value: unknown[] } = { value: [] };

vi.mock("@/hooks/uptime", () => ({
	useUptimeDefaultChannels: () => ({ data: defaultsData.value, ...defaultsState }),
	useUptimeChannelHealth: () => ({ data: channelHealthData.value }),
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
		channelType: "webhook",
		hasWebhookUrl: true, webhookUrlMasked: "hooks.x.com", hasWebhookHeaders: false, webhookHeaderNames: [],
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
	vi.clearAllMocks();
 vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
	defaultsData.value = undefined;
	providersData.value = [];
	pending.create = pending.update = pending.delete = pending.test = false;
});

describe("DefaultChannelsSection empty state", () => {
	it("renders the empty state when no defaults exist", () => {
		defaultsData.value = [];
		render(<DefaultChannelsSection />);
		expect(screen.getByText("Default channels")).toBeInTheDocument();
    expect(document.querySelector("svg.lucide-bell")).toHaveAttribute("aria-hidden", "true");
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

	it("says what is loading, and on failure offers a retry instead of a stuck spinner or an incident message", async () => {
		defaultsData.value = undefined;
		defaultsState.isPending = true;
		const { unmount } = render(<DefaultChannelsSection />);
		expect(screen.getByRole("status")).toHaveTextContent("notificationUX.loadingChannels");
		unmount();
		defaultsState.isPending = false;
		defaultsState.error = new Error("network");
		render(<DefaultChannelsSection />);
		expect(screen.getByRole("alert")).toHaveTextContent("notificationUX.errorChannels");
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "workspace.retry" }));
		expect(defaultsState.refetch).toHaveBeenCalledOnce();
		defaultsState.error = null;
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
		expect(screen.getByText("hooks.x.com")).toBeInTheDocument();
		expect(screen.getAllByText("All monitors")).toHaveLength(2);
	});

	it("tests a channel with success and error", async () => {
		defaultsData.value = [defaultChannel()];
		testMutateAsync.mockResolvedValueOnce(undefined);
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.test/ }));
		expect(confirmations.requestConfirmation).toHaveBeenCalledWith("notificationUX.confirmTest", expect.objectContaining({ title: "notificationUX.testTitle", destructive: false }));
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
	it("explains why an email default cannot be added without a provider and creates nothing", async () => {
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
		const submit = within(dialog).getByRole("button", { name: "actions.addChannel" });
		expect(within(dialog).getByText("notificationUX.noProviderTitle")).toBeInTheDocument();
		expect(submit).toBeDisabled();
		await userEvent.click(submit);
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
		expect(within(dialog).getByRole("link", { name: /notifications.fields.webhookHeadersInvalid/ })).toBeVisible();
    const headers = within(dialog).getByLabelText("Headers / options (JSON)");
    expect(headers).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(`${headers.id}-error`)).toHaveTextContent("notifications.fields.webhookHeadersInvalid");
    expect(headers).toHaveFocus();
    expect(toastError).not.toHaveBeenCalled();
		expect(createMutateAsync).not.toHaveBeenCalled();
	});

	it("keeps submission feedback in the dialog when create fails", async () => {
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

	it("retains stored webhook credentials without revealing or resubmitting them", async () => {
		defaultsData.value = [
			defaultChannel({
				channelId: "d3",
				channelType: "webhook",
				  hasWebhookUrl: true, hasWebhookHeaders: true, webhookUrlMasked: "hooks.x.com",
			}),
		];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByLabelText("Headers / options (JSON)")).toHaveValue(
			"",
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: "d3",
					uptimeMonitorId: null,
					channelType: "webhook",
					emailProviderId: null,
				}),
			),
		);
 expect(updateMutateAsync.mock.calls[0]?.[0]).not.toHaveProperty("webhookUrl");
 expect(updateMutateAsync.mock.calls[0]?.[0]).not.toHaveProperty("webhookHeaders");
	});

	it("blocks saving an email default that lost its provider", async () => {
		providersData.value = [provider()];
		defaultsData.value = [
			defaultChannel({
				channelId: "d4",
				channelType: "email",
				
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
		expect(within(dialog).getByRole("alert")).toHaveTextContent("notificationUX.chooseProvider");
    expect(within(dialog).getByRole("combobox", { name: "notifications.fields.emailProvider" })).toHaveFocus();
		expect(updateMutateAsync).not.toHaveBeenCalled();
	});

	it("rejects invalid header JSON on save", async () => {
		defaultsData.value = [defaultChannel()];
		render(<DefaultChannelsSection />);
		await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
		const dialog = screen.getByRole("dialog");
		await userEvent.click(within(dialog).getByRole("combobox", { name: "notificationUX.headersAction" }));
		await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
    fireEvent.change(
			within(dialog).getByLabelText("Headers / options (JSON)"),
			{ target: { value: "not json" } },
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "actions.save" }),
		);
		expect(within(dialog).getByRole("link", { name: /notifications.fields.webhookHeadersInvalid/ })).toBeVisible();
    const headers = within(dialog).getByLabelText("Headers / options (JSON)");
    expect(headers).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(`${headers.id}-error`)).toHaveTextContent("notifications.fields.webhookHeadersInvalid");
    expect(headers).toHaveFocus();
    expect(toastError).not.toHaveBeenCalled();
		expect(updateMutateAsync).not.toHaveBeenCalled();
	});

	it("keeps submission feedback in the dialog when the edit update fails", async () => {
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

describe("explicit credential edits and deletion consent", () => {
 it("requires replacement mode and supports clearing private options", async () => {
  defaultsData.value = [defaultChannel({   hasWebhookUrl: true, hasWebhookHeaders: true, webhookUrlMasked: "hooks.x.com" })];
  updateMutateAsync.mockResolvedValue(undefined);
  render(<DefaultChannelsSection />);
  await userEvent.click(screen.getByRole("button", { name: /actions.edit/ }));
  const dialog = screen.getByRole("dialog");
  const target = within(dialog).getByLabelText("notifications.fields.webhookUrl");
  expect(target).toBeDisabled(); expect(target).toHaveValue("");
  await userEvent.click(within(dialog).getByRole("combobox", { name: "notificationUX.targetAction" }));
  await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
  await userEvent.type(target, "https://replacement.invalid/new-target");
  await userEvent.click(within(dialog).getByRole("combobox", { name: "notificationUX.headersAction" }));
  await userEvent.click(screen.getByRole("option", { name: "notificationUX.clear" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "actions.save" }));
  await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ webhookUrl: "https://replacement.invalid/new-target", webhookHeaders: {} })));
 });
 it("keeps the channel when deletion is cancelled", async () => {
  defaultsData.value = [defaultChannel()]; vi.mocked(confirmations.requestConfirmation).mockResolvedValue(false);
  render(<DefaultChannelsSection />);
  await userEvent.click(screen.getByRole("button", { name: /actions.delete/ }));
  expect(confirmations.requestConfirmation).toHaveBeenCalled(); expect(deleteMutateAsync).not.toHaveBeenCalled();
 });
});


it.each([false, true])("keeps a newer channel editor when a dismissed create finishes (failure=%s)", async failure => {
 let release!: (value: unknown) => void, reject!: (error: Error) => void;
 createMutateAsync.mockImplementation(() => new Promise((resolve, fail) => { release = resolve; reject = fail; }));
 defaultsData.value = [defaultChannel()]; render(<DefaultChannelsSection />);
 await userEvent.click(screen.getByRole("button", { name: "Add default channel" }));
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
