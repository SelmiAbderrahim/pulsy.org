vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorPortability } from "./monitor-portability";
const mocks = vi.hoisted(() => ({ export: vi.fn(), preview: vi.fn(), apply: vi.fn(), invalidate: vi.fn() }));
const monitorRows = vi.hoisted(() => ({ data: [] as Array<{ uptimeMonitorId: string; name: string }> }));
vi.mock("@/hooks/uptime/useUptimeMonitors", () => ({ useUptimeMonitors: () => ({ data: monitorRows.data, isPending: false, error: null }) }));
vi.mock("@/services/uptime/monitorPortabilityService", () => ({ MonitorPortabilityService: mocks }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
const manifest = { format: "pulsy-monitor-configuration", version: 1, monitors: [] };
const preview = { manifest, warnings: [], revision: "a".repeat(64), counts: { create: 1, update: 0, unchanged: 0, rejected: 0 }, entries: [{ key: "api", action: "create", changes: [{ field: "name", before: null, after: "API" }], reasons: [] }] };
beforeEach(() => { monitorRows.data = [{ uptimeMonitorId: "first", name: "First" }, { uptimeMonitorId: "second", name: "Second" }]; vi.resetAllMocks(); mocks.export.mockResolvedValue({ manifest, warnings: [] }); mocks.preview.mockResolvedValue(preview); mocks.apply.mockResolvedValue({ counts: preview.counts }); });
afterEach(cleanup);
describe("explicit native configuration controls", () => {
  it("exports only matching IDs selected by select all without applying anything", async () => {
    render(<MonitorPortability />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "First" } });
    fireEvent.click(screen.getByLabelText("portability.selectMatching"));
    fireEvent.click(screen.getByRole("button", { name: "portability.export" }));
    await waitFor(() => expect(mocks.export).toHaveBeenCalledWith(["first"]));
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "portability.manifest" })).toHaveValue(JSON.stringify(manifest, null, 2));
  });
  it("requires a fresh preview after any edit and sends its exact revision on explicit apply", async () => {
    render(<MonitorPortability />);
    const editor = screen.getByRole("textbox", { name: "portability.manifest" });
    fireEvent.change(editor, { target: { value: '{"draft": "original"}' } });
    fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
    await screen.findByText(/API/);
    expect(mocks.apply).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: '{"draft": "changed"}' } });
    expect(screen.queryByRole("button", { name: "portability.apply" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "portability.apply" }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(JSON.stringify(manifest, null, 2), "a".repeat(64)));
    expect(mocks.preview).toHaveBeenLastCalledWith('{"draft": "changed"}');
    expect(mocks.invalidate).toHaveBeenCalled();
  });
  it("shows rejected entries and never enables apply for an invalid manifest", async () => {
    mocks.preview.mockResolvedValue({ ...preview, counts: { ...preview.counts, rejected: 1 }, entries: [{ key: "api", action: "rejected", changes: [], reasons: ["targetBlocked"] }] });
    render(<MonitorPortability />);
    fireEvent.change(screen.getByRole("textbox", { name: "portability.manifest" }), { target: { value: '{"draft": "targetBlocked"}' } });
    fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
    await screen.findByText("portability.reason.targetBlocked");
    expect(screen.getByRole("button", { name: "portability.apply" })).toBeDisabled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("cannot download imported text before redaction and invalidates download after an edit", async () => {
    render(<MonitorPortability />);
    const editor = screen.getByRole("textbox", { name: "portability.manifest" });
    fireEvent.change(editor, { target: { value: '{"token":"private-value"}' } });
    expect(screen.getByRole("button", { name: "portability.download" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
    await screen.findByRole("button", { name: "portability.apply" });
    expect((editor as HTMLTextAreaElement).value).not.toContain("private-value");
    expect(screen.getByRole("button", { name: "portability.download" })).not.toBeDisabled();
    fireEvent.change(editor, { target: { value: "edited" } });
    expect(screen.getByRole("button", { name: "portability.download" })).toBeDisabled();
  });
});

it("keeps exact selection while searching and invalidates export download when selection changes", async () => {
  render(<MonitorPortability />);
  fireEvent.click(screen.getByLabelText("First"));
  fireEvent.click(screen.getByRole("button", { name: "portability.export" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "portability.download" })).toBeEnabled());
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Second" } });
  expect(screen.queryByLabelText("First")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Second"));
  expect(screen.getByRole("button", { name: "portability.download" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "portability.export" }));
  await waitFor(() => expect(mocks.export).toHaveBeenLastCalledWith(["first", "second"]));
});

describe("portability layout and failure recovery", () => {
  it("separates export from review-and-import, labels the monitor filter and links the format sample", () => {
    render(<MonitorPortability />);
    expect(screen.getByRole("heading", { name: "portability.selection" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "portability.importHeading" })).toBeInTheDocument();
    expect(screen.getByLabelText("portability.searchLabel")).toHaveAttribute("placeholder", "portability.searchPlaceholder");
    expect(screen.getByRole("link", { name: "portability.formatLink" })).toHaveAttribute("href", "/dashboard/help/configuration-portability");
  });
  it("summarises rejected entries once at the top and keeps apply unavailable", async () => {
    mocks.preview.mockResolvedValue({ ...preview, counts: { ...preview.counts, rejected: 2 }, entries: [{ key: "a", action: "rejected", changes: [], reasons: ["targetBlocked"] }, { key: "b", action: "rejected", changes: [], reasons: ["targetBlocked"] }] });
    render(<MonitorPortability />);
    fireEvent.change(screen.getByRole("textbox", { name: "portability.manifest" }), { target: { value: '{"draft": "x"}' } });
    fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("portability.rejectedSummary");
    expect(screen.getByRole("button", { name: "portability.apply" })).toBeDisabled();
  });
  it("keeps the edited draft and shows an error when preview fails, and never applies", async () => {
    mocks.preview.mockRejectedValue(new Error("server said no"));
    render(<MonitorPortability />);
    const editor = screen.getByRole("textbox", { name: "portability.manifest" });
    fireEvent.change(editor, { target: { value: '{"draft": "my careful draft"}' } });
    fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("server said no");
    expect(editor).toHaveValue('{"draft": "my careful draft"}');
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("keeps the reviewed text when apply fails as stale and requires another preview", async () => {
    mocks.apply.mockRejectedValue(new Error("stale"));
    render(<MonitorPortability />);
    const editor = screen.getByRole("textbox", { name: "portability.manifest" });
    fireEvent.change(editor, { target: { value: '{"draft": "original"}' } });
    fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "portability.apply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("stale");
    expect(editor).toHaveValue(JSON.stringify(manifest, null, 2));
    expect(screen.queryByRole("button", { name: "portability.apply" })).toBeNull();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

it("downloads exactly the redacted manifest bytes, never the pasted private text", async () => {
  const blobs: Blob[] = [];
  const create = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:test"; });
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  render(<MonitorPortability />);
  fireEvent.change(screen.getByRole("textbox", { name: "portability.manifest" }), { target: { value: '{"token":"private-value"}' } });
  fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
  await screen.findByRole("button", { name: "portability.apply" });
  fireEvent.click(screen.getByRole("button", { name: "portability.download" }));
  expect(click).toHaveBeenCalledTimes(1);
  const bytes = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]!); });
  expect(bytes).toBe(JSON.stringify(manifest, null, 2));
  expect(bytes).not.toContain("private-value");
  click.mockRestore();
});

it("summarizes safe parse diagnostics and focuses the associated JSON field", async () => {
  render(<MonitorPortability />);
  const editor = screen.getByRole("textbox", { name: "portability.manifest" });
  fireEvent.change(editor, { target: { value: '{"bad":' } });
  fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
  const error = await screen.findByRole("alert");
  await waitFor(() => expect(editor).toHaveFocus());
  expect(error).toHaveTextContent("formValidation.summary");
  expect(editor).toHaveAttribute("aria-invalid", "true");
  expect(editor).toHaveAccessibleDescription(/portability.jsonError/);
  expect(editor.nextElementSibling).toHaveTextContent("portability.jsonError");
  fireEvent.click(screen.getByRole("link", { name: /portability.manifest: portability.jsonError/ }));
  expect(editor).toHaveFocus();
  expect(mocks.preview).not.toHaveBeenCalled();
});

it("imports a dropped JSON file, preserves inline parsing errors, and clears it on removal", async () => {
  render(<MonitorPortability />);
  const file = new File(['{"broken":}'], "monitors.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => '{"broken":}' });
  const chooser = screen.getByLabelText("portability.file");
  fireEvent.drop(chooser, { dataTransfer: { files: [file] } });
  const editor = screen.getByRole("textbox", { name: "portability.manifest" });
  await waitFor(() => expect(editor).toHaveValue('{"broken":}'));
  expect(screen.getByText("monitors.json")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
  await waitFor(() => expect(editor).toHaveAttribute("aria-invalid", "true"));
  expect(editor).toHaveAccessibleDescription(/portability.jsonError/);
  expect(chooser).not.toHaveAttribute("aria-invalid", "true");
  expect(mocks.preview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "controls.removeFile" }));
  expect(editor).toHaveValue("");
  expect(screen.queryByText("monitors.json")).not.toBeInTheDocument();
  expect(chooser).toHaveFocus();
});

function warnsBeforeUnload() { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }
it("guards typed import drafts for route navigation and reload, then clears only after apply or restoration", async () => {
  const { hasRegisteredDraft } = await import("@/lib/draft-guards");
  render(<MonitorPortability />);
  const editor = screen.getByRole("textbox", { name: "portability.manifest" });
  expect(hasRegisteredDraft()).toBe(false);
  fireEvent.change(editor, { target: { value: '{"draft":true}' } });
  expect(hasRegisteredDraft()).toBe(true); expect(warnsBeforeUnload()).toBe(true);
  fireEvent.change(editor, { target: { value: "" } });
  expect(warnsBeforeUnload()).toBe(false);
  fireEvent.change(editor, { target: { value: '{"draft":true}' } });
  fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
  await screen.findByRole("button", { name: "portability.apply" });
  expect(warnsBeforeUnload()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "portability.apply" }));
  await screen.findByText("portability.applied");
  expect(warnsBeforeUnload()).toBe(false); expect(hasRegisteredDraft()).toBe(false);
});
it("keeps uploaded manifests guarded through failed apply while exported configuration starts clean", async () => {
  render(<MonitorPortability />);
  fireEvent.click(screen.getByLabelText("First"));
  expect(warnsBeforeUnload()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "portability.export" }));
  await screen.findByText("portability.exported");
  expect(warnsBeforeUnload()).toBe(false);
  const file = new File(['{"draft":true}'], "import.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => '{"draft":true}' });
  fireEvent.drop(screen.getByLabelText("portability.file"), { dataTransfer: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "portability.manifest" })).toHaveValue('{"draft":true}'));
  expect(warnsBeforeUnload()).toBe(true);
  mocks.preview.mockResolvedValueOnce({ ...preview, manifest: { ...manifest, monitors: [{ key: "new-import" }] } });
  fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
  mocks.apply.mockRejectedValueOnce(new Error("retry needed"));
  fireEvent.click(await screen.findByRole("button", { name: "portability.apply" }));
  await screen.findByText("retry needed");
  expect(warnsBeforeUnload()).toBe(true);
});

it("focuses the file chooser for upload read errors and the export action for export errors", async () => {
  mocks.export.mockRejectedValue(new Error("Export unavailable"));
  render(<MonitorPortability />);
  const file = new File(["{}"], "monitors.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => { throw new Error("Cannot read file"); } });
  const chooser = screen.getByLabelText("portability.file");
  fireEvent.drop(chooser, { dataTransfer: { files: [file] } });
  await waitFor(() => expect(chooser).toHaveFocus());
  expect(chooser).toHaveAttribute("aria-invalid", "true");
  expect(chooser).toHaveAccessibleDescription(/Cannot read file/);
  expect(screen.getByRole("alert")).toHaveTextContent("portability.file: Cannot read file");
  fireEvent.click(screen.getByRole("checkbox", { name: "First" }));
  const exportButton = screen.getByRole("button", { name: "portability.export" });
  fireEvent.click(exportButton);
  await waitFor(() => expect(exportButton).toHaveFocus());
  expect(exportButton).toHaveAccessibleDescription(/Export unavailable/);
  expect(screen.getByRole("alert")).toHaveTextContent("portability.export: Export unavailable");
});

it("downloads a sample that can be imported by the real manifest parser", async () => {
  const { parseMonitorManifest } = await import("@pulsy/db/monitor-manifest");
  const blobs: Blob[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:sample"; }), revokeObjectURL: vi.fn() });
  render(<MonitorPortability />);
  fireEvent.click(screen.getByRole("button", { name: "portability.downloadSample" }));
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blobs[0]!);
  });
  const parsed = parseMonitorManifest(text);
  expect(parsed.manifest.monitors).toEqual([expect.objectContaining({ type: "http", redirectPolicy: "follow", active: false, url: "https://example.com/" })]);
  click.mockRestore();
});

it.each(["preview", "export"])("keeps a valid near-limit %s manifest importable after safe serialization", async mode => {
  const { parseMonitorManifest } = await import("@pulsy/db/monitor-manifest");
  const large = { format: "pulsy-monitor-configuration", version: 1, monitors: Array.from({ length: 200 }, (_, index) => ({
    key: `http-${index}`, type: "http", name: `Monitor ${index}`, url: `https://example.com/${index}`, method: "GET", expectedStatus: 200,
    redirectPolicy: "follow", timeout: 10000, failureThreshold: 3, interval: 300, active: false, tags: [], httpAssertions: [{ type: "body_contains", value: "x".repeat(950) }],
  })) };
  const input = JSON.stringify(large);
  expect(new TextEncoder().encode(input).byteLength).toBeLessThanOrEqual(262144);
  expect(new TextEncoder().encode(JSON.stringify(large, null, 2)).byteLength).toBeGreaterThan(262144);
  const safe = parseMonitorManifest(input).manifest;
  mocks.preview.mockResolvedValue({ ...preview, manifest: safe, counts: { create: 200, update: 0, unchanged: 0, rejected: 0 }, entries: [] });
  mocks.apply.mockImplementation(async (text: string) => { parseMonitorManifest(text); return { counts: { create: 200 } }; });
  if (mode === "export") {
    monitorRows.data = large.monitors.map(row => ({ uptimeMonitorId: row.key, name: row.name }));
    mocks.export.mockResolvedValue({ manifest: safe, warnings: [] });
  }
  const blobs: Blob[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:large"; }), revokeObjectURL: vi.fn() });
  render(<MonitorPortability />);
  if (mode === "preview") {
    fireEvent.change(screen.getByRole("textbox", { name: "portability.manifest" }), { target: { value: input } });
    fireEvent.click(screen.getByRole("button", { name: "portability.preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "portability.apply" }));
    await screen.findByText("portability.applied");
  } else {
    fireEvent.click(screen.getByLabelText("portability.selectMatching"));
    fireEvent.click(screen.getByRole("button", { name: "portability.export" }));
    await screen.findByText("portability.exported");
  }
  fireEvent.click(screen.getByRole("button", { name: "portability.download" }));
  const bytes = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blobs[0]!); });
  expect(parseMonitorManifest(bytes).manifest.monitors).toHaveLength(200);
  click.mockRestore();
});
