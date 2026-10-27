import { renderWithQueryClient as render } from "@/test/query-wrapper";
import * as confirmations from "@/lib/confirmation";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeEmailProvider } from "@/types/uptime";
import { EmailProvidersSection } from "./email-providers-section";

vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });

const providersData = { value: undefined as UptimeEmailProvider[] | undefined };
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();
const testMutateAsync = vi.fn();
const pending = {
	create: false,
	update: false,
	delete: false,
	test: false,
};

vi.mock("@/hooks/uptime", () => ({
	useUptimeEmailProviders: () => ({ data: providersData.value }),
	useCreateUptimeEmailProvider: () => ({
		mutateAsync: createMutateAsync,
		isPending: pending.create,
	}),
	useUpdateUptimeEmailProvider: () => ({
		mutateAsync: updateMutateAsync,
		isPending: pending.update,
	}),
	useDeleteUptimeEmailProvider: () => ({
		mutateAsync: deleteMutateAsync,
		isPending: pending.delete,
	}),
	useTestUptimeEmailProvider: () => ({
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

function provider(
	overrides: Partial<UptimeEmailProvider> = {},
): UptimeEmailProvider {
	return {
		emailProviderId: "e1",
		name: "Primary",
		providerType: "resend",
		fromAddress: "alerts@x.com",
		smtpHost: null,
		smtpPort: null,
		smtpUsername: null,
		smtpSecure: true,
		...overrides,
	} as UptimeEmailProvider;
}

beforeEach(() => {
	vi.clearAllMocks();
 vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
	providersData.value = undefined;
	pending.create = pending.update = pending.delete = pending.test = false;
});

describe("EmailProvidersSection empty state", () => {
	it("shows the empty card and opens the create dialog", async () => {
		providersData.value = [];
		render(<EmailProvidersSection />);
		expect(screen.getByText("emailProviders.empty")).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		expect(
			screen.getByText("emailProviders.create.title"),
		).toBeInTheDocument();
	});

	it("treats undefined providers like an empty list", () => {
		providersData.value = undefined;
		render(<EmailProvidersSection />);
		expect(screen.getByText("emailProviders.empty")).toBeInTheDocument();
	});
});

describe("EmailProvidersSection list", () => {
	it("renders a row per provider", () => {
		providersData.value = [
			provider({ emailProviderId: "e1", name: "Primary" }),
			provider({
				emailProviderId: "e2",
				name: "Backup",
				providerType: "smtp",
			}),
		];
		render(<EmailProvidersSection />);
		expect(screen.getByText("Primary")).toBeInTheDocument();
		expect(screen.getByText("Backup")).toBeInTheDocument();
	});

	it("tests a provider with success and error toasts", async () => {
		providersData.value = [provider()];
		testMutateAsync.mockResolvedValueOnce(undefined);
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", {
				name: "emailProviders.testCredentials.label",
			}),
		);
		await waitFor(() =>
			expect(testMutateAsync).toHaveBeenCalledWith("e1"),
		);
		expect(toastSuccess).toHaveBeenCalledWith(
			"emailProviders.test.success",
		);

		testMutateAsync.mockRejectedValueOnce(new Error("test boom"));
		await userEvent.click(
			screen.getByRole("button", {
				name: "emailProviders.testCredentials.label",
			}),
		);
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("test boom"),
		);
	});

	it("deletes a provider with success and error toasts", async () => {
		providersData.value = [provider()];
		deleteMutateAsync.mockResolvedValueOnce(undefined);
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.delete Primary" }),
		);
		await waitFor(() =>
			expect(deleteMutateAsync).toHaveBeenCalledWith("e1"),
		);
		expect(toastSuccess).toHaveBeenCalledWith(
			"emailProviders.delete.success",
		);

		deleteMutateAsync.mockRejectedValueOnce(new Error("del boom"));
		await userEvent.click(
			screen.getByRole("button", { name: "actions.delete Primary" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("del boom"));
	});

	it("creates a provider from the populated-list header dialog", async () => {
		providersData.value = [provider()];
		createMutateAsync.mockResolvedValue(undefined);
		render(<EmailProvidersSection />);
		// "Add provider" button shown in the header of the populated list.
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		await userEvent.type(
			screen.getByPlaceholderText("emailProviders.fields.namePlaceholder"),
			"New",
		);
		await userEvent.type(
			screen.getByPlaceholderText(
				"emailProviders.fields.fromAddressPlaceholder",
			),
			"new@x.com",
		);
		await userEvent.type(
			screen.getByPlaceholderText("emailProviders.fields.apiKeyPlaceholder"),
			"k",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ name: "New" }),
			),
		);
		expect(toastSuccess).toHaveBeenCalledWith(
			"emailProviders.create.success",
		);
	});
});

describe("EmailProviderDialog create", () => {
  it("shows linked and inline server field feedback without duplicate generic errors", async () => {
    providersData.value = [];
    createMutateAsync.mockRejectedValue({ message: "Generic rejected input", data: { validationErrors: { fieldErrors: { fromAddress: ["Verify this sender address"] } } } });
    render(<EmailProvidersSection />);
    await userEvent.click(screen.getByRole("button", { name: "actions.addProvider" }));
    fireEvent.change(screen.getByPlaceholderText("emailProviders.fields.namePlaceholder"), { target: { value: "Sender" } });
    const address = screen.getByPlaceholderText("emailProviders.fields.fromAddressPlaceholder");
    fireEvent.change(address, { target: { value: "from@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("emailProviders.fields.apiKeyPlaceholder"), { target: { value: "test-placeholder-key" } });
    await userEvent.click(screen.getByRole("button", { name: "actions.addProvider" }));
    await waitFor(() => expect(address).toHaveAttribute("aria-invalid", "true"));
    expect(address).toHaveFocus();
    expect(screen.getByRole("link", { name: /Verify this sender address/ })).toHaveAttribute("href", `#${address.id}`);
    expect(within(address.closest(".form-field")!).getByText("Verify this sender address")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("Generic rejected input")).not.toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
    fireEvent.change(address, { target: { value: "corrected@example.com" } });
    expect(screen.queryByText("Verify this sender address")).not.toBeInTheDocument();
  });

	it("submits an API-key provider (resend) and shows success", async () => {
		providersData.value = [];
		createMutateAsync.mockResolvedValue(undefined);
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		await userEvent.type(
			screen.getByPlaceholderText("emailProviders.fields.namePlaceholder"),
			"Sender",
		);
		await userEvent.type(
			screen.getByPlaceholderText(
				"emailProviders.fields.fromAddressPlaceholder",
			),
			"from@x.com",
		);
		await userEvent.type(
			screen.getByPlaceholderText("emailProviders.fields.apiKeyPlaceholder"),
			"key123",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Sender",
					providerType: "resend",
					apiKey: "key123",
					fromAddress: "from@x.com",
					smtpHost: undefined,
				}),
			),
		);
		expect(toastSuccess).toHaveBeenCalledWith(
			"emailProviders.create.success",
		);
	});

	it("submits an SMTP provider with host/port/password fields", async () => {
		providersData.value = [];
		createMutateAsync.mockResolvedValue(undefined);
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		// Switch provider type to smtp
		await userEvent.click(screen.getByRole("combobox"));
		await userEvent.click(screen.getByRole("option", { name: "smtp" }));
		await userEvent.type(
			screen.getByPlaceholderText("emailProviders.fields.namePlaceholder"),
			"SMTP",
		);
		await userEvent.type(
			screen.getByPlaceholderText(
				"emailProviders.fields.fromAddressPlaceholder",
			),
			"from@x.com",
		);
		await userEvent.type(
			screen.getByPlaceholderText("emailProviders.fields.smtpHostPlaceholder"),
			"smtp.x.com",
		);
		// smtpPort is the only numeric (spinbutton) field; exercise its onChange.
		const portInput = screen.getByRole("spinbutton");
		await userEvent.clear(portInput);
		await userEvent.type(portInput, "2525");
		// smtpUsername is the lone text input without a placeholder.
		const textInputs = Array.from(
			document.querySelectorAll('input[type="text"], input:not([type])'),
		) as HTMLInputElement[];
		const usernameInput = textInputs.find((i) => !i.placeholder);
		await userEvent.type(usernameInput as HTMLInputElement, "user1");
		// smtpPassword has no placeholder; it's the only password input present.
		const passwordInput = document.querySelector(
			'input[type="password"]',
		) as HTMLInputElement;
		await userEvent.type(passwordInput, "pw");
		// toggle secure off
		await userEvent.click(screen.getByRole("switch"));
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		await waitFor(() =>
			expect(createMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					providerType: "smtp",
					smtpHost: "smtp.x.com",
					smtpPort: 2525,
					smtpUsername: "user1",
					smtpPassword: "pw",
					smtpSecure: false,
					apiKey: undefined,
				}),
			),
		);
	});

	it("shows an error toast when create submission fails", async () => {
		providersData.value = [];
		createMutateAsync.mockRejectedValue(new Error("create boom"));
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		await userEvent.type(
			screen.getByPlaceholderText("emailProviders.fields.namePlaceholder"),
			"X",
		);
		await userEvent.type(
			screen.getByPlaceholderText(
				"emailProviders.fields.fromAddressPlaceholder",
			),
			"from@x.com",
		);
		await userEvent.type(
			screen.getByPlaceholderText("emailProviders.fields.apiKeyPlaceholder"),
			"k",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("create boom"),
		);
	});

	it("closes the create dialog via Cancel", async () => {
		providersData.value = [];
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.cancel" }),
		);
		await waitFor(() =>
			expect(
				screen.queryByText("emailProviders.create.title"),
			).not.toBeInTheDocument(),
		);
	});
});

describe("EmailProviderDialog edit", () => {
	it("opens prefilled, omits unchanged secrets, and saves", async () => {
		providersData.value = [provider({ name: "Primary" })];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.edit Primary" }),
		);
		expect(screen.getByText("emailProviders.edit.title")).toBeInTheDocument();
		// Save without re-entering the API key → apiKey omitted (undefined)
		await userEvent.click(
			screen.getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					emailProviderId: "e1",
					name: "Primary",
					apiKey: undefined,
				}),
			),
		);
		expect(toastSuccess).toHaveBeenCalledWith("emailProviders.edit.success");
	});

	it("edits an SMTP provider, omitting an unchanged password", async () => {
		providersData.value = [
			provider({
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "a@x.com",
				smtpHost: "smtp.x.com",
				smtpPort: 2525,
				smtpUsername: "user1",
				smtpSecure: true,
			}),
		];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.edit SMTP" }),
		);
		// Save without re-entering the SMTP password → `(!isEdit || smtpPassword)`
		// evaluates the empty smtpPassword side, so smtpPassword is omitted.
		await userEvent.click(
			screen.getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					emailProviderId: "e1",
					providerType: "smtp",
					smtpHost: "smtp.x.com",
					smtpPort: 2525,
					smtpUsername: "user1",
					smtpPassword: undefined,
				}),
			),
		);
	});

	it("includes a newly typed API key on edit", async () => {
		providersData.value = [provider({ name: "Primary" })];
		updateMutateAsync.mockResolvedValue(undefined);
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.edit Primary" }),
		);
		await userEvent.type(
			screen.getByLabelText("emailProviders.fields.apiKey"),
			"newkey",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() =>
			expect(updateMutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: "newkey" }),
			),
		);
	});

	it("shows an error toast when edit submission fails", async () => {
		providersData.value = [provider({ name: "Primary" })];
		updateMutateAsync.mockRejectedValue(new Error("edit boom"));
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.edit Primary" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.save" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("edit boom"));
	});

	it("closes the edit dialog when dismissed", async () => {
		providersData.value = [provider({ name: "Primary" })];
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.edit Primary" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.cancel" }),
		);
		await waitFor(() =>
			expect(
				screen.queryByText("emailProviders.edit.title"),
			).not.toBeInTheDocument(),
		);
	});
});

describe("EmailProvidersSection pending states", () => {
	it("disables the test button and shows a spinner while testing", () => {
		providersData.value = [provider()];
		pending.test = true;
		render(<EmailProvidersSection />);
		expect(
			screen.getByText("emailProviders.testCredentials.testing"),
		).toBeInTheDocument();
	});

	it("shows a spinner in the create dialog while the provider is being created", async () => {
		providersData.value = [];
		pending.create = true;
		render(<EmailProvidersSection />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.addProvider" }),
		);
		const dialog = screen.getByRole("dialog");
		expect(dialog.querySelector(".animate-spin")).toBeInTheDocument();
	});
});

it("tells an editor that stored secrets are kept, that changes mark the provider untested, and never prefills a secret", async () => {
	providersData.value = [provider({ name: "Primary" })];
	render(<EmailProvidersSection />);
	await userEvent.click(screen.getByRole("button", { name: "actions.edit Primary" }));
	expect(screen.getByText("notificationUX.reverifyHint")).toBeInTheDocument();
	const key = screen.getByLabelText("emailProviders.fields.apiKey") as HTMLInputElement;
	expect(key.value).toBe("");
	expect(key.placeholder).toBe("notificationUX.storedSecretPlaceholder");
	await userEvent.click(screen.getByRole("button", { name: "actions.save" }));
	await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ apiKey: undefined })));
});

it("collects all invalid provider fields and focuses linked controls, then trims the saved name", async () => {
  providersData.value = [];
  createMutateAsync.mockResolvedValue({});
  render(<EmailProvidersSection />);
  await userEvent.click(screen.getByRole("button", { name: "actions.addProvider" }));
  const name = screen.getByLabelText("emailProviders.fields.name");
  await userEvent.type(name, "   ");
  await userEvent.type(screen.getByLabelText("emailProviders.fields.fromAddress"), "invalid");
  await userEvent.click(screen.getAllByRole("button", { name: "actions.addProvider" }).at(-1)!);
  expect(name).toHaveFocus(); expect(name).toHaveAttribute("aria-invalid", "true");
  expect(screen.getAllByRole("link")).toHaveLength(3);
  await userEvent.click(screen.getByRole("link", { name: /formValidation.email/ }));
  expect(screen.getByLabelText("emailProviders.fields.fromAddress")).toHaveFocus();
  expect(createMutateAsync).not.toHaveBeenCalled();
  await userEvent.clear(name); await userEvent.type(name, "  Primary  ");
  await userEvent.clear(screen.getByLabelText("emailProviders.fields.fromAddress"));
  await userEvent.type(screen.getByLabelText("emailProviders.fields.fromAddress"), "qa@example.test");
  await userEvent.type(screen.getByLabelText("emailProviders.fields.apiKey"), "local-fixture");
  await userEvent.click(screen.getAllByRole("button", { name: "actions.addProvider" }).at(-1)!);
  expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: "Primary" }));
});

it("clears an accepted discarded provider draft and its validation errors before reopening", async () => {
  providersData.value = [];
  render(<EmailProvidersSection />);
  await userEvent.click(screen.getByRole("button", {name:"actions.addProvider"}));
  await userEvent.type(screen.getByLabelText("emailProviders.fields.name"), "Discard me");
  await userEvent.click(screen.getAllByRole("button", {name:"actions.addProvider"}).at(-1)!);
  expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole("button", {name:"actions.cancel"}));
  await userEvent.click(screen.getByRole("button", { name: "actions.discard" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", {name:"actions.addProvider"}));
  expect(screen.getByLabelText("emailProviders.fields.name")).toHaveValue("");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each([false, true])("keeps the provider section named with providers present=%s", populated => {
  providersData.value = populated ? [provider()] : [];
  render(<EmailProvidersSection />);
  const heading = screen.getByRole("heading", { name: "emailProviders.title", level: 2 });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  expect(section).toHaveAttribute("aria-labelledby", heading.id);
  expect(section).toContainElement(screen.getByRole("button", { name: "actions.addProvider" }));
});
