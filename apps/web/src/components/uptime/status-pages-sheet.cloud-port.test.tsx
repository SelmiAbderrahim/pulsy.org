import * as confirmations from "@/lib/confirmation";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { StatusPage } from "@/types/uptime";
import {
  DomainSection,
  StatusPageForm,
  StatusPagesSheet,
} from "./status-pages-sheet";

const h = vi.hoisted(() => ({
  pages: { data: [] as unknown, isLoading: false },
  detail: { data: undefined as unknown },
  monitors: { data: [] as unknown },
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  setMon: vi.fn(),
  attach: vi.fn(),
  verify: vi.fn(),
  detach: vi.fn(),
  domainStatus: {
    data: undefined as unknown,
    isFetching: false,
    refetch: vi.fn(),
  },
  pending: {
    create: false,
    update: false,
    attach: false,
    verify: false,
    detach: false,
  },
}));

vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u1" } } }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/uptime", () => ({
  useStatusPages: () => h.pages,
  useStatusPage: () => h.detail,
  useUptimeMonitors: () => h.monitors,
  useCreateStatusPage: () => ({ mutateAsync: h.create, isPending: h.pending.create }),
  useUpdateStatusPage: () => ({ mutateAsync: h.update, isPending: h.pending.update }),
  useDeleteStatusPage: () => ({ mutateAsync: h.del, isPending: false }),
  useSetStatusPageMonitors: () => ({ mutateAsync: h.setMon, isPending: false }),
  useAttachStatusPageDomain: () => ({ mutateAsync: h.attach, isPending: h.pending.attach }),
  useVerifyStatusPageDomain: () => ({ mutateAsync: h.verify, isPending: h.pending.verify }),
  useDetachStatusPageDomain: () => ({ mutateAsync: h.detach, isPending: h.pending.detach }),
  useStatusPageDomainStatus: () => h.domainStatus,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { toast } from "@/lib/toast";
const toastMock = vi.mocked(toast);

function makePage(overrides: Partial<StatusPage> = {}): StatusPage {
  return {
    statusPageId: "p1",
    userId: "u1",
    slug: "status",
    title: "Acme Status",
    description: null,
    logoUrl: null,
    isPublished: true,
    customDomain: null,
    domainVerified: false,
    domainVerifyToken: null,
    domainVerifiedAt: null,
    domainProvisionStatus: null,
    domainProvisionError: null,
    domainProvisionedAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.pages = { data: [], isLoading: false };
  h.detail = { data: undefined };
  h.monitors = { data: [] };
  h.pending = {
    create: false,
    update: false,
    attach: false,
    verify: false,
    detach: false,
  };
  h.create.mockResolvedValue({ statusPageId: "new" });
  h.update.mockResolvedValue({ statusPageId: "p1" });
  h.del.mockResolvedValue({ success: true });
  h.setMon.mockResolvedValue({ success: true, count: 0 });
  h.attach.mockResolvedValue({
    recordName: "_pulsy-verify.status.example.com",
    recordValue: "tok-value",
  });
  h.verify.mockResolvedValue({ domainVerified: true });
  h.detach.mockResolvedValue({ success: true });
  h.domainStatus = { data: undefined, isFetching: false, refetch: vi.fn() };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("StatusPagesSheet", () => {
  it("shows the loading spinner", () => {
    h.pages = { data: undefined, isLoading: true };
    // Sheet content renders into a portal on document.body, not `container`.
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows the empty state and create button", () => {
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    expect(screen.getByText("No status pages yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New status page" }),
    ).toBeInTheDocument();
  });



  it("renders published and draft rows with slug + custom domain", () => {
    h.pages = {
      data: [
        makePage({ statusPageId: "p1", isPublished: true, customDomain: "s.acme.com" }),
        makePage({ statusPageId: "p2", slug: "ops", isPublished: false, title: "Ops" }),
      ],
      isLoading: false,
    };
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText(/status · s\.acme\.com/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("/status/u1/");
  });

  it("opens the create form", async () => {
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "New status page" }),
    );
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("links to the General editor from the named overflow menu", async () => {
    h.pages = { data: [makePage()], isLoading: false };
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("statusUX.moreNamed"));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("href", "/dashboard/status-pages/p1?tab=general");
  });

  it("closes the create form on cancel", async () => {
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "New status page" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "New status page" }),
    ).toBeInTheDocument();
  });

  it("deletes a page after confirmation", async () => {
    h.pages = { data: [makePage()], isLoading: false };
    vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("statusUX.moreNamed"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() =>
      expect(h.del).toHaveBeenCalledWith({ statusPageId: "p1" }),
    );
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("does nothing when delete is not confirmed", async () => {
    h.pages = { data: [makePage()], isLoading: false };
    vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(false);
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("statusUX.moreNamed"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(h.del).not.toHaveBeenCalled();
  });

  it("shows an error toast when delete fails", async () => {
    h.pages = { data: [makePage()], isLoading: false };
    h.del.mockRejectedValue(new Error("nope"));
    vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("statusUX.moreNamed"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
});

describe("StatusPageForm", () => {
  it("warns before publishing a page with no components and shows the new address only while the slug differs", async () => {
    const page = makePage({ statusPageId: "p-empty", slug: "ops", isPublished: false, componentCount: 0 } as never);
    render(<StatusPageForm page={page} onClose={vi.fn()} />);
    expect(screen.queryByText(/statusUX\.addressAfterSaving/)).not.toBeInTheDocument();
    expect(screen.queryByText(/statusUX\.publishEmpty/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch"));
    expect(screen.getByText(/statusUX\.publishEmpty/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Slug")); await userEvent.type(screen.getByLabelText("Slug"), "ops-two");
    expect(screen.getByText(/statusUX\.addressAfterSaving/)).toBeInTheDocument();
  });

  it("creates a page with selected monitors", async () => {
    h.monitors = { data: [{ uptimeMonitorId: "m1", name: "Mon 1" }] };
    const onClose = vi.fn();
    render(<StatusPageForm onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Title"), "My Page");
    await userEvent.type(screen.getByLabelText("Slug"), "mypage");
    await userEvent.type(screen.getByLabelText("Description"), "desc");
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create).toHaveBeenCalledWith({
      slug: "mypage",
      title: "My Page",
      description: "desc",
      isPublished: true,
      uptimeMonitorIds: ["m1"],
    });
    expect(h.setMon).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("creates a page with no description as null", async () => {
    const onClose = vi.fn();
    render(<StatusPageForm onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.type(screen.getByLabelText("Slug"), "t");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create).toHaveBeenCalledWith({
      slug: "t",
      title: "T",
      description: null,
      isPublished: false,
      uptimeMonitorIds: [],
    });
  });

  it("retains a stale General draft and sends its captured baseline without replacing membership", async () => {
    const saved = makePage();
    const view = render(<StatusPageForm page={saved} onClose={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText("Title")); await userEvent.type(screen.getByLabelText("Title"), "My draft");
    view.rerender(<StatusPageForm page={{ ...saved, title: "Concurrent title" }} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Title")).toHaveValue("My draft"); expect(screen.getByText("statusUX.stale")).toBeInTheDocument();
    h.update.mockRejectedValue(new Error("Conflict"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Conflict");
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ statusPageId: "p1", title: "My draft", expected: { title: "Acme Status", slug: "status", description: null, isPublished: true } }));
    expect(h.setMon).not.toHaveBeenCalled(); expect(screen.getByLabelText("Title")).toHaveValue("My draft");
  });

  it("shows an error toast when save fails", async () => {
    h.create.mockRejectedValue(new Error("save fail"));
    render(<StatusPageForm onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.type(screen.getByLabelText("Slug"), "t");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });

  it("disables Save until title and slug are present", () => {
    render(<StatusPageForm onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the empty-monitors hint and cancels", async () => {
    const onClose = vi.fn();
    render(<StatusPageForm onClose={onClose} />);
    expect(screen.getByText("No monitors to add yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a spinner while saving", () => {
    h.pending.create = true;
    render(<StatusPageForm onClose={vi.fn()} />);
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("tolerates an undefined monitors list", () => {
    h.monitors = { data: undefined };
    render(<StatusPageForm onClose={vi.fn()} />);
    expect(screen.getByText("No monitors to add yet.")).toBeInTheDocument();
  });
});

describe("DomainSection", () => {
  // Routing-record visibility depends on VITE_CUSTOM_DOMAIN_* (operator config
  // baked into the build). Pin it OFF by default so these assertions don't shift
  // with the build env; the dedicated test below opts in.
  beforeEach(() => {
    vi.stubEnv("VITE_CUSTOM_DOMAIN_IP", "");
    vi.stubEnv("VITE_CUSTOM_DOMAIN_CNAME_TARGET", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });



  it("attaches a domain and shows the TXT record", async () => {
    render(<DomainSection page={makePage()} />);
    const input = screen.getByRole("textbox", { name: "Custom domain" });
    await userEvent.type(input, "status.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Attach" }));
    await waitFor(() =>
      expect(h.attach).toHaveBeenCalledWith({
        statusPageId: "p1",
        customDomain: "status.example.com",
      }),
    );
    expect(screen.getByText("_pulsy-verify.status.example.com")).toBeInTheDocument();
    expect(screen.getByText("tok-value")).toBeInTheDocument();
  });

  it("shows an error toast when attach fails", async () => {
    h.attach.mockRejectedValue(new Error("bad"));
    render(<DomainSection page={makePage()} />);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Custom domain" }),
      "status.example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Attach" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });

  it("verifies an attached-but-unverified domain and copies the record", async () => {
    render(
      <DomainSection
        page={makePage({
          customDomain: "status.acme.com",
          domainVerified: false,
          domainVerifyToken: "tok",
        })}
      />,
    );
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.getByText("status.acme.com")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Copy record value" }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("tok");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(h.verify).toHaveBeenCalledWith({ statusPageId: "p1" }),
    );
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("shows the routing record when a routing target is configured", () => {
    vi.stubEnv("VITE_CUSTOM_DOMAIN_IP", "203.0.113.7");
    render(
      <DomainSection
        page={makePage({
          customDomain: "status.acme.com",
          domainVerified: false,
          domainVerifyToken: "tok",
        })}
      />,
    );
    // Routing target (A record value) shown alongside the TXT ownership token.
    expect(screen.getByText("203.0.113.7")).toBeInTheDocument();
    expect(screen.getByText("tok")).toBeInTheDocument();
    // Two copyable records now: routing (CNAME/A) + ownership (TXT).
    expect(
      screen.getAllByRole("button", { name: "Copy record value" }),
    ).toHaveLength(2);
  });

  it("shows the DNS status checklist with a routing mismatch and re-checks", async () => {
    h.domainStatus = {
      data: {
        customDomain: "status.acme.com",
        ownershipVerified: true,
        routing: {
          ok: false,
          resolvedIps: ["1.2.3.4"],
          expectedIp: "187.124.177.50",
          record: null,
        },
        provisionStatus: "pending",
        provisionError: null,
        provisionedAt: null,
      },
      isFetching: false,
      refetch: vi.fn(),
    };
    render(
      <DomainSection
        page={makePage({
          customDomain: "status.acme.com",
          domainVerified: true,
          domainProvisionStatus: "pending",
        })}
      />,
    );
    expect(screen.getByText("DNS records & status")).toBeInTheDocument();
    expect(screen.getByText("Ownership (TXT)")).toBeInTheDocument();
    // Routing mismatch detail shows resolved vs expected.
    expect(
      screen.getByText(/resolved 1\.2\.3\.4, expected 187\.124\.177\.50/),
    ).toBeInTheDocument();
    // Certificate row reflects the pending provisioning state.
    expect(screen.getByText("issuing…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Re-check" }));
    expect(h.domainStatus.refetch).toHaveBeenCalled();
  });

  it("shows a Live certificate state when provisioning is active", () => {
    h.domainStatus = {
      data: {
        customDomain: "status.acme.com",
        ownershipVerified: true,
        routing: {
          ok: true,
          resolvedIps: ["187.124.177.50"],
          expectedIp: "187.124.177.50",
          record: null,
        },
        provisionStatus: "active",
        provisionError: null,
        provisionedAt: "2026-06-21T12:00:00.000Z",
      },
      isFetching: false,
      refetch: vi.fn(),
    };
    render(
      <DomainSection
        page={makePage({
          customDomain: "status.acme.com",
          domainVerified: true,
          domainProvisionStatus: "active",
        })}
      />,
    );
    // "Live" appears both in the header badge and the certificate row.
    expect(screen.getAllByText("Live").length).toBeGreaterThanOrEqual(1);
  });

  it("does not toast success when verification reports not verified", async () => {
    h.verify.mockResolvedValue({ domainVerified: false });
    render(
      <DomainSection
        page={makePage({
          customDomain: "status.acme.com",
          domainVerified: false,
          domainVerifyToken: "tok",
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(h.verify).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("shows an error toast when verify fails", async () => {
    h.verify.mockRejectedValue(new Error("dns"));
    render(
      <DomainSection
        page={makePage({
          customDomain: "status.acme.com",
          domainVerifyToken: "tok",
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });

  it("renders the verified badge and detaches", async () => {
    render(
      <DomainSection
        page={makePage({ customDomain: "status.acme.com", domainVerified: true })}
      />,
    );
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Verify" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(h.detach).toHaveBeenCalledWith({ statusPageId: "p1" }),
    );
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("shows an error toast when detach fails", async () => {
    h.detach.mockRejectedValue(new Error("x"));
    render(
      <DomainSection
        page={makePage({ customDomain: "status.acme.com", domainVerified: true })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });

  it("shows a spinner while attaching", () => {
    h.pending.attach = true;
    render(<DomainSection page={makePage()} />);
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows a spinner while verifying", () => {
    h.pending.verify = true;
    render(
      <DomainSection
        page={makePage({ customDomain: "status.acme.com", domainVerifyToken: "tok" })}
      />,
    );
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });
});


describe("StatusPageForm validation regression", () => {
  it("keeps uppercase and surrounding spaces while typing, previews normalization and saves it", async () => {
    render(<StatusPageForm page={makePage()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Slug") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  New-Address  " } });
    expect(input).toHaveValue("  New-Address  ");
    expect(input.checkValidity()).toBe(true);
    expect(screen.getByText(/new-address$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ slug: "new-address" })));
  });
  it.each(["Bad Slug--!!", "has space", "", "   ", "a".repeat(64)])("rejects %j even when native validation is bypassed", async value => {
    const view = render(<StatusPageForm page={makePage()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Slug") as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    expect(screen.queryByText("statusUX.addressAfterSaving", { exact: false })).not.toBeInTheDocument();
    fireEvent.submit(view.container.querySelector("form")!);
    expect(h.update).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "sp-slug-helper sp-slug-error");
    expect(document.getElementById("sp-slug-error")).toHaveAttribute("role", "alert");
    expect(input).toHaveFocus();
    expect(screen.getByRole("link", { name: /^Slug:/ })).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent('"code":');
  });
  it("maps duplicate and server field errors, keeps the draft, then clears feedback on edit", async () => {
    h.update.mockRejectedValue({ message: '[{"code":"custom","message":"private"}]', data: { validationErrors: { fieldErrors: { slug: ["Choose another slug"] }, formErrors: [] } } });
    render(<StatusPageForm page={makePage()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited title" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const input = screen.getByLabelText("Slug");
    await screen.findByText("Choose another slug");
    expect(input).toHaveAttribute("aria-invalid", "true"); expect(input).toHaveFocus();
    expect(input).toHaveValue("status"); expect(screen.getByRole("link", { name: /^Slug:/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "another" } });
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText("Choose another slug")).not.toBeInTheDocument();
  });
  it("maps title/description problems and summarizes unknown fields safely", async () => {
    h.update.mockRejectedValue({ message: "Review fields", data: { validationErrors: { fieldErrors: { title: ["Title required"], description: ["Description too long"], expected: ["Reload"] }, formErrors: [] } } });
    render(<StatusPageForm page={makePage()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited title" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Title required");
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-describedby", "sp-title-error");
    expect(screen.getByLabelText("Description")).toHaveAttribute("aria-describedby", "sp-desc-helper sp-desc-error");
    expect(screen.getByLabelText("Title")).toHaveFocus();
    expect(screen.queryByText("Reload")).not.toBeInTheDocument();
  });
  it("shows native invalid feedback and supports resubmission after correction", async () => {
    render(<StatusPageForm page={makePage()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Slug");
    fireEvent.change(input, { target: { value: "Bad Slug--!!" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.update).not.toHaveBeenCalled(); expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "Fixed-Link" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ slug: "fixed-link" })));
  });
});

it("retains an empty draft until publication is explicitly confirmed", async () => {
  const confirmation = vi.spyOn(confirmations, "requestConfirmation").mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<StatusPageForm page={makePage({ isPublished: false, componentCount: 0 })} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole("switch", { name: "Published" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(confirmation).toHaveBeenCalledWith("statusUX.confirmEmptyPublication", expect.objectContaining({ destructive: false }));
  expect(h.update).not.toHaveBeenCalled();
  expect(screen.getByRole("switch", { name: "Published" })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ isPublished: true, confirmEmptyPublication: true }));
});

it("requires a title on submit and only enables Save for changed values, preserving the saved baseline", async () => {
  const onDirty = vi.fn();
  render(<StatusPageForm page={makePage()} embedded onDirtyChange={onDirty} onClose={vi.fn()} />);
  const save = screen.getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  await userEvent.clear(screen.getByLabelText("Title"));
  expect(screen.getByText("statusUX.titleRequired")).toBeInTheDocument(); expect(save).toBeEnabled();
  fireEvent.click(save);
  expect(screen.getByRole("link", { name: /^Title:/ })).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveFocus();
  await userEvent.type(screen.getByLabelText("Title"), "Updated title");
  await userEvent.click(save);
  await waitFor(() => expect(save).toBeDisabled());
  expect(screen.getByLabelText("Title")).toHaveValue("Updated title");
  expect(onDirty).toHaveBeenLastCalledWith(false);
});


it("warns only for published empty pages and offers a primary create action", () => {
  h.pages = { data: [makePage({componentCount: 0}), makePage({statusPageId:"draft",isPublished:false,componentCount:0}), makePage({statusPageId:"populated",componentCount:2})], isLoading: false };
  render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
  expect(screen.getAllByText("statusUX.emptyPublishedWarning")).toHaveLength(1);
  expect(screen.getByRole("button", {name:"New status page"})).toHaveClass("bg-primary");
});


it.each(["title", "selection"])("registers a new-page %s draft for navigation/reload until reverted", async kind => {
 const { hasRegisteredDraft } = await import("@/lib/draft-guards");
 const unload = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
 h.monitors = { data: [{ uptimeMonitorId: "monitor", name: "API" }] };
 const view = render(<StatusPageForm onClose={vi.fn()} />);
 expect(hasRegisteredDraft()).toBe(false); expect(unload()).toBe(false);
 if (kind === "title") await userEvent.type(screen.getByLabelText("Title"), "Draft page"); else await userEvent.click(screen.getByRole("checkbox", { name: "API" }));
 expect(hasRegisteredDraft()).toBe(true); expect(unload()).toBe(true);
 if (kind === "title") await userEvent.clear(screen.getByLabelText("Title")); else await userEvent.click(screen.getByRole("checkbox", { name: "API" }));
 expect(hasRegisteredDraft()).toBe(false); expect(unload()).toBe(false);
 view.unmount(); expect(hasRegisteredDraft()).toBe(false);
});
it("includes a custom-domain draft in the General editor's dirty state and clears it on revert", async () => {
 const changed = vi.fn(); render(<StatusPageForm page={makePage()} embedded onDirtyChange={changed} onClose={vi.fn()} />);
 const domain = screen.getByRole("textbox", { name: "Custom domain" });
 await userEvent.type(domain, "status.example.com"); expect(changed).toHaveBeenLastCalledWith(true);
 await userEvent.clear(domain); expect(changed).toHaveBeenLastCalledWith(false);
});
it("freezes the submitted custom-domain value while attachment is pending", async () => {
 let release!: (value: unknown) => void;
 h.attach.mockImplementation(() => new Promise(resolve => { release = resolve; h.pending.attach = true; }));
 const page = makePage(), view = render(<DomainSection page={page} />), user = userEvent.setup();
 const domain = screen.getByRole("textbox", { name: "Custom domain" });
 await user.type(domain, "first.example.com"); await user.click(screen.getByRole("button", { name: "Attach" }));
 view.rerender(<DomainSection page={page} />); expect(domain).toBeDisabled();
 await user.type(domain, "second.example.com"); expect(domain).toHaveValue("first.example.com");
 await act(async () => release({ customDomain: "first.example.com", recordName: "_pulsy-verify.first.example.com", recordValue: "proof" }));
 expect(screen.getByText("first.example.com")).toBeVisible();
});
it("reports a rejected DNS-record clipboard write without claiming it was copied", async () => {
 vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("Permission denied"));
 render(<DomainSection page={makePage({ customDomain: "status.example.com", domainVerifyToken: "public-proof" })} />);
 await userEvent.click(screen.getByRole("button", { name: "Copy record value" }));
 await waitFor(() => expect(toastMock.error).toHaveBeenCalled()); expect(toastMock.success).not.toHaveBeenCalled();
});
it("refreshes the displayed ownership record when the persisted domain token changes", () => {
 const view = render(<DomainSection page={makePage({ customDomain: "status.example.com", domainVerifyToken: "old-proof" })} />);
 expect(screen.getByText("old-proof")).toBeVisible();
 view.rerender(<DomainSection page={makePage({ customDomain: "status.example.com", domainVerifyToken: "new-proof" })} />);
 expect(screen.getByText("new-proof")).toBeVisible(); expect(screen.queryByText("old-proof")).not.toBeInTheDocument();
});
