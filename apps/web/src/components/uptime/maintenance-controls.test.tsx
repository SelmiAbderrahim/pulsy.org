import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MaintenanceControls, MaintenanceDialog } from "./maintenance-controls";

vi.mock("react-i18next", () => reactI18nextMock());
const state = vi.hoisted(() => {
  const config = { name: "Upcoming maintenance", reason: "Private change", startsAt: "2099-01-01T10:00:00.000Z", endsAt: "2099-01-01T11:00:00.000Z", timezone: "UTC", recurrence: "once" };
  const action = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue({}) });
  return { confirm: vi.fn().mockResolvedValue(false), config, window: { ...config, id: "owned-schedule", kind: "maintenance", monitorIds: ["m1", "m2"], enabled: true, suppression: null, occurrences: [{ startsAt: config.startsAt, endsAt: config.endsAt }] }, actions: { create: action(), update: action(), snooze: action(), cancel: action(), resume: action(), preview: { ...action(), data: [{ startsAt: config.startsAt, endsAt: config.endsAt }] } } };
});
vi.mock("@/lib/confirmation", () => ({ requestConfirmation: state.confirm }));
vi.mock("@/hooks/uptime/useMaintenance", () => ({ useMaintenance: () => ({ data: [state.window] }), useMaintenanceActions: () => state.actions }));

describe("maintenance editing", () => {
  it("requires a fresh preview after edits and retains the draft when a concurrent update is rejected", async () => {
    state.actions.update.mutateAsync.mockRejectedValue(new Error("Saved schedule changed"));
    render(<MaintenanceControls monitorIds={["m1"]} />);
    expect(screen.getByRole("heading", { name: "maintenance.title", level: 2 })).toBeVisible();
    expect(screen.getByRole("region", { name: "maintenance.title" })).toContainElement(screen.getByRole("link", { name: "help.title" }));
    await userEvent.click(screen.getByRole("button", { name: "maintenanceUX.edit" }));
    const name = screen.getByLabelText("maintenance.name");
    expect(screen.getByRole("region", { name: "maintenanceUX.edit" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "maintenance.recurrence" })).toHaveClass("ps-3.5", "pe-10");
    fireEvent.change(name, { target: { value: "Reviewed change" } });
    const save = screen.getByRole("button", { name: "maintenance.saveSchedule" });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "maintenance.preview" }));
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.change(name, { target: { value: "Reviewed change revision" } }); expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "maintenance.preview" }));
    await waitFor(() => expect(save).toBeEnabled()); await userEvent.click(save);
    await screen.findByRole("alert");
    expect(name).toHaveValue("Reviewed change revision");
    expect(state.actions.update.mutateAsync).toHaveBeenCalledWith({ id: "owned-schedule", config: { ...state.config, name: "Reviewed change revision" }, expected: state.config });
    expect(state.actions.create.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("maintenanceUX.editScope")).toBeVisible();
  });
});

it("changes recurrence through the keyboard select and closes the controlled editor after saving", async () => {
  state.actions.update.mutateAsync.mockResolvedValue({});
  render(<MaintenanceControls monitorIds={["m1"]} />);
  await userEvent.click(screen.getByRole("button", { name: "maintenanceUX.edit" }));
  const recurrence = screen.getByRole("combobox", { name: "maintenance.recurrence" });
  await userEvent.click(recurrence);
  await userEvent.keyboard("{End}{Enter}");
  expect(recurrence).toHaveTextContent("maintenance.weekly");
  await userEvent.click(screen.getByRole("button", { name: "maintenance.preview" }));
  const save = screen.getByRole("button", { name: "maintenance.saveSchedule" });
  await waitFor(() => expect(save).toBeEnabled());
  await userEvent.click(save);
  await waitFor(() => expect(screen.getByRole("button", { name: "maintenance.schedule" })).toHaveAttribute("aria-expanded", "false"));
  expect(state.actions.update.mutateAsync).toHaveBeenLastCalledWith({ id: "owned-schedule", config: { ...state.config, recurrence: "weekly" }, expected: state.config });
});

it("compares maintenance edits with the saved defaults, including reversion and preview", async () => {
  const { hasRegisteredDraft } = await import("@/lib/draft-guards");
  state.actions.preview.mutateAsync.mockResolvedValue(state.actions.preview.data);
  render(<MaintenanceControls monitorIds={["m1"]} />);
  await userEvent.click(screen.getByRole("button", { name: "maintenanceUX.edit" }));
  const name = screen.getByLabelText("maintenance.name");
  expect(hasRegisteredDraft()).toBe(false);
  fireEvent.change(name, { target: { value: `${state.config.name} changed` } }); expect(hasRegisteredDraft()).toBe(true);
  fireEvent.change(name, { target: { value: state.config.name } });
  expect(hasRegisteredDraft()).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "maintenance.preview" }));
  expect(hasRegisteredDraft()).toBe(false);
  expect(screen.getByRole("button", { name: "maintenance.saveSchedule" })).toBeDisabled();
});
it("maps preview duration errors to the end field with a summary and inline message", async () => {
  state.actions.preview.mutateAsync.mockRejectedValueOnce(Object.assign(new Error("End must follow start"), { data: { validationErrors: { fieldErrors: {}, formErrors: ["errors.maintenanceDuration"] } } }));
  render(<MaintenanceControls monitorIds={["m1"]} />);
  await userEvent.click(screen.getByRole("button", { name: "maintenanceUX.edit" }));
  await userEvent.click(screen.getByRole("button", { name: "maintenance.preview" }));
  const end = screen.getByLabelText("maintenance.end");
  await waitFor(() => expect(end).toHaveFocus());
  expect(end).toHaveAttribute("aria-invalid", "true");
  expect(end).toHaveAccessibleDescription(/End must follow start/);
  expect(screen.getByRole("link", { name: /maintenance.end.*End must follow start/ })).toBeVisible();
  expect(end.closest(".form-field")).toHaveTextContent("End must follow start");
  expect(screen.getByLabelText("maintenance.name")).toHaveValue(state.config.name);
});


it("keeps a collapsed schedule draft protected when the maintenance dialog closes", async () => {
  render(<MaintenanceDialog monitorIds={["m1"]} />);
  await userEvent.click(screen.getByRole("button", { name: "maintenance.title" }));
  await userEvent.click(screen.getByRole("button", { name: "maintenance.schedule" }));
  await userEvent.type(screen.getByLabelText("maintenance.name"), "Unfinished change");
  await userEvent.click(screen.getByRole("button", { name: "maintenance.schedule" }));
  await userEvent.keyboard("{Escape}");
  const confirmation = await screen.findByRole("alertdialog");
  await userEvent.click(within(confirmation).getByRole("button", { name: "actions.cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});
