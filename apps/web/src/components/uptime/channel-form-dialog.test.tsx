import { renderWithQueryClient as render } from "@/test/query-wrapper";
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { ChannelFormDialog } from "./channel-form-dialog";
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });

function Fixture({ submit = vi.fn(), isEdit = false, url = "https://fixture.invalid/webhook", kind = "webhook" }: { submit?: (target: string) => void; isEdit?: boolean; url?: string; kind?: "webhook" | "telegram" }) {
  const [headers, setHeaders] = useState("");
  const [target, setTarget] = useState(url);
  return <ChannelFormDialog open onOpenChange={vi.fn()} isEdit={isEdit} hasStoredTarget={isEdit} storedChannelType={kind} channelType={kind} setChannelType={vi.fn()}
    emailProviders={[]} emailProviderId="" setEmailProviderId={vi.fn()} webhookUrl={target} setWebhookUrl={setTarget}
    webhookHeaders={headers} setWebhookHeaders={setHeaders} recipients="" setRecipients={vi.fn()} notifyOnDown setNotifyOnDown={vi.fn()}
    notifyOnDegraded={false} setNotifyOnDegraded={vi.fn()} notifyOnRecovery setNotifyOnRecovery={vi.fn()}
    notifyOnTlsExpiry={false} setNotifyOnTlsExpiry={vi.fn()} tlsExpiryThresholdDays="14" setTlsExpiryThresholdDays={vi.fn()}
    onSubmit={event => { event.preventDefault(); submit(target); }} isPending={false}  />;
}

describe("webhook headers field validation", () => {
  it.each(["not JSON", "[]", "null", '{"X-Test": 1}'])("associates %s feedback with the field and blocks submission", async value => {
    const submit = vi.fn(); render(<Fixture submit={submit} />);
    const headers = screen.getByLabelText("Headers / options (JSON)");
    fireEvent.change(headers, { target: { value } });
    await userEvent.click(screen.getByRole("button", { name: "actions.addChannel" }));
    const error = screen.getAllByRole("alert").find(element => element.tagName === "P")!;
    expect(error).toHaveTextContent("notifications.fields.webhookHeadersInvalid");
    expect(headers.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
    expect(headers).toHaveAttribute("aria-invalid", "true");
    expect(headers).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
    // Editing clears feedback until blur, then even another invalid value
    // restores aria-invalid after the dialog's native input error cleanup.
    await userEvent.type(headers, "x");
    await userEvent.tab();
    expect(headers).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(headers, { target: { value: '{"X-Test": "valid"}' } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "actions.addChannel" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("validates deliberate replacement but permits retaining and clearing stored headers", async () => {
    const submit = vi.fn(); render(<Fixture submit={submit} isEdit />);
    const headers = screen.getByLabelText("Headers / options (JSON)");
    expect(headers).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "actions.save" }));
    expect(submit).toHaveBeenCalledTimes(1);
    const mode = screen.getByRole("combobox", { name: "notificationUX.headersAction" });
    expect(mode.tagName).toBe("BUTTON");
    expect(document.querySelectorAll('select:not([aria-hidden="true"])')).toHaveLength(0);
    await userEvent.click(mode);
    await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
    fireEvent.change(headers, { target: { value: "invalid" } });
    await userEvent.click(screen.getByRole("button", { name: "actions.save" }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    await userEvent.click(mode);
    await userEvent.click(screen.getByRole("option", { name: "notificationUX.clear" }));
    expect(headers).toHaveValue("{}");
    expect(headers).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "actions.save" }));
    expect(submit).toHaveBeenCalledTimes(2);
  });
});

it("links both invalid Webhook URL and nested JSON errors in the summary", async () => {
  const submit = vi.fn(); render(<Fixture submit={submit} url="invalid URL" />);
  fireEvent.change(screen.getByLabelText("Headers / options (JSON)"), { target: { value: "{" } });
  await userEvent.click(screen.getByRole("button", { name: "actions.addChannel" }));
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(2);
  expect(document.getElementById("channel-target")).toHaveFocus();
  await userEvent.click(links[1]!);
  expect(screen.getByLabelText("Headers / options (JSON)")).toHaveFocus();
  expect(submit).not.toHaveBeenCalled();
});

it("shows empty Webhook URL feedback beside the field and retains summary navigation", async () => {
  const submit = vi.fn(); render(<Fixture submit={submit} url="" />);
  await userEvent.click(screen.getByRole("button", { name: "actions.addChannel" }));
  const target = screen.getByLabelText("notifications.fields.webhookUrl");
  expect(target).toHaveAttribute("aria-invalid", "true");
  expect(target).toHaveClass("aria-invalid:border-destructive");
  const inline = target.parentElement!.querySelector('p.text-destructive');
  expect(inline).toHaveTextContent("formValidation.required");
  expect(target.getAttribute("aria-describedby")?.split(" ")).toContain(inline!.id);
  expect(target).toHaveFocus();
  await userEvent.click(screen.getByRole("link", { name: /notifications.fields.webhookUrl/ }));
  expect(target).toHaveFocus();
  expect(submit).not.toHaveBeenCalled();
});


it("clears Telegram replacement fields together when retaining and replacing again", async () => {
  const submit = vi.fn(); render(<Fixture kind="telegram" isEdit url="" submit={submit} />);
  const action = screen.getByRole("combobox", { name: "notificationUX.targetAction" });
  await userEvent.click(action); await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
  const bot = screen.getByLabelText("notificationUX.telegramBotToken"), chat = screen.getByLabelText("notificationUX.telegramChatId");
  await userEvent.type(bot, "123456:ABC"); await userEvent.type(chat, "-100123456789");
  await userEvent.click(action); await userEvent.click(screen.getByRole("option", { name: "notificationUX.retain" }));
  await userEvent.click(action); await userEvent.click(screen.getByRole("option", { name: "notificationUX.replace" }));
  expect(bot).toHaveValue(""); expect(chat).toHaveValue("");
  await userEvent.click(screen.getByRole("button", { name: "actions.save" })); expect(submit).not.toHaveBeenCalled();
  await userEvent.type(bot, "654321:DEF"); await userEvent.type(chat, "@new_channel");
  await userEvent.click(screen.getByRole("button", { name: "actions.save" })); expect(submit).toHaveBeenCalledWith("654321:DEF:@new_channel");
});
