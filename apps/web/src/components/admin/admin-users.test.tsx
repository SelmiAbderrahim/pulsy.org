import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast as sonner } from "sonner";
import { formattingLocale } from "@/lib/formatting-locale";
import { AdminService } from "@/services/admin/adminService";
import { translate } from "@/test/i18n-mock";
import { renderWithQueryClient } from "@/test/query-wrapper";
import type { AdminUserList } from "@/types/admin";
import { AdminUsers } from "./admin-users";

const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: translate, i18n: locale }),
}));
vi.mock("@/services/admin/adminService", () => ({
	AdminService: {
		listUsers: vi.fn(), setRole: vi.fn(), banUser: vi.fn(),
		unbanUser: vi.fn(), deleteUser: vi.fn(),
	},
}));

const joined = new Date("2026-10-14T12:00:00Z");
const users: AdminUserList = {
	items: [{
		id: "user-1", email: "operator@example.com", name: "Operator",
		emailVerified: true, role: "user", banned: false, bannedReason: null,
		createdAt: joined, monitorCount: 7,
	}],
	total: 1, limit: 25, offset: 0,
};

beforeEach(() => {
	vi.clearAllMocks();
	locale.language = "en";
	vi.mocked(AdminService.listUsers).mockResolvedValue(users);
});
afterEach(cleanup);

describe("admin users controls", () => {
	it("names the role filter and each user's role selector", async () => {
		renderWithQueryClient(<AdminUsers />);
		await screen.findByText("operator@example.com");
		expect(screen.getByRole("combobox", { name: "users.filters.role" })).toBeInTheDocument();
		expect(screen.getByRole("combobox", { name: "users.columns.role: operator@example.com" })).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "users.columns.monitors" })).toBeInTheDocument();
		expect(screen.getByRole("cell", { name: "7" })).toBeInTheDocument();
	});

	it.each(["ban", "delete"])("groups the %s dialog label and control with the shared field message host", async (action) => {
		const user = userEvent.setup();
		renderWithQueryClient(<AdminUsers />);
		await user.click(await screen.findByRole("button", { name: `users.actions.${action}` }));
		const dialog = screen.getByRole("dialog");
		const control = within(dialog).getByLabelText(action === "ban" ? "users.ban.reason" : "users.delete.confirmLabel");
		const field = control.closest(".form-field");
		expect(field).not.toBeNull();
		expect(field?.querySelector("label")).toHaveAttribute("for", control.id);
		expect(field?.querySelector("[data-form-messages]")).toBeInTheDocument();
	});

	it.each(["en", "ar", "fr", "de", "es"])("renders joined dates in the selected %s language", async (language) => {
		locale.language = language;
		renderWithQueryClient(<AdminUsers />);
		await screen.findByText("operator@example.com");
		const expected = new Intl.DateTimeFormat(formattingLocale(language), { dateStyle: "medium" }).format(joined);
		expect(screen.getByRole("cell", { name: expected })).toBeInTheDocument();
	});

	it("gives a rejected ban a dismissible error notification with the shared reading duration", async () => {
		vi.mocked(AdminService.banUser).mockRejectedValueOnce(new Error("Unavailable"));
		const user = userEvent.setup();
		renderWithQueryClient(<AdminUsers />);
		await user.click(await screen.findByRole("button", { name: "users.actions.ban" }));
		await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "users.ban.confirm" }));
		await waitFor(() => expect(sonner.error).toHaveBeenCalledWith("users.toast.error", expect.objectContaining({ duration: 10_000, closeButton: true })));
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});
});
