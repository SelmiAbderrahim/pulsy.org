import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorCreateDialog } from "./monitor-create-dialog";

// Private destination rejections model operator-configured deny mode; metadata stays blocked in every mode.
// The server is the authority on the egress policy. When it rejects a destination, the create
// form must surface the localized server message on the URL field (linked, focused, invalid),
// keep the dialog open with the draft intact, and never report success.
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/hooks/uptime/useUptimeMonitors", () => ({ useUptimeMonitors: () => ({ data: [] }) }));
vi.mock("@/services/uptime/monitorTemplatesService", () => ({ MonitorTemplatesService: { save: vi.fn() } }));
const mutateAsync = vi.fn();
vi.mock("@/hooks/uptime", () => ({ useCreateUptimeMonitor: () => ({ mutateAsync, isPending: false }) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: (...args: unknown[]) => toastError(...args) } }));

const BLOCKED = "Blocked target: private, link-local, metadata, or otherwise unsafe destination.";
const serverRejection = (field: string) => Object.assign(new Error(BLOCKED), { data: { code: "BAD_REQUEST", validationErrors: { fieldErrors: { [field]: [BLOCKED] }, formErrors: [] } } });

beforeEach(() => vi.clearAllMocks());

it.each(["http://169.254.169.254/latest/meta-data/", "http://localhost:4000", "http://10.0.0.1", "http://pulsy-postgres:5432", "http://127.0.0.1.nip.io"])("shows the server's blocked-target error on the URL field for %s", async url => {
	mutateAsync.mockRejectedValue(serverRejection("url"));
	const onOpenChange = vi.fn();
	render(<MonitorCreateDialog open onOpenChange={onOpenChange} />);
	await userEvent.type(screen.getByLabelText("Name"), "Metadata probe");
	await userEvent.type(screen.getByLabelText("URL"), url);
	await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));

	await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
	const field = screen.getByLabelText("URL");
	await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
	expect(screen.getByRole("link", { name: `URL: ${BLOCKED}` })).toHaveAttribute("href", "#url");
	// The draft survives (the form may normalise a bare origin to a trailing slash).
	expect((field as HTMLInputElement).value).toContain(new URL(url).hostname);
	expect(screen.getByLabelText("Name")).toHaveValue("Metadata probe");
	expect(toastSuccess).not.toHaveBeenCalled();
	expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

it("editing the rejected URL clears the server error so the user can retry", async () => {
	mutateAsync.mockRejectedValueOnce(serverRejection("url")).mockResolvedValueOnce({ uptimeMonitorId: "m1" });
	const onOpenChange = vi.fn();
	render(<MonitorCreateDialog open onOpenChange={onOpenChange} />);
	await userEvent.type(screen.getByLabelText("Name"), "Retry");
	await userEvent.type(screen.getByLabelText("URL"), "http://10.0.0.1");
	await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
	await waitFor(() => expect(screen.getByLabelText("URL")).toHaveAttribute("aria-invalid", "true"));

	await userEvent.clear(screen.getByLabelText("URL"));
	await userEvent.type(screen.getByLabelText("URL"), "https://api.example.com");
	await waitFor(() => expect(screen.getByLabelText("URL")).not.toHaveAttribute("aria-invalid", "true"));
	await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
	await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	expect(toastSuccess).toHaveBeenCalled();
});
