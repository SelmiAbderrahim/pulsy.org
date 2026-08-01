import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
}));

import { toast } from "sonner";
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
    expect(screen.getByText(/\/status\/u1\/status · s\.acme\.com/)).toBeInTheDocument();
  });

  it("opens the create form", async () => {
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "New status page" }),
    );
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("opens the edit form for a page", async () => {
    h.pages = { data: [makePage()], isLoading: false };
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Edit"));
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
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

  it("closes the edit form on cancel", async () => {
    h.pages = { data: [makePage()], isLoading: false };
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Edit"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Edit")).toBeInTheDocument();
  });

  it("deletes a page after confirmation", async () => {
    h.pages = { data: [makePage()], isLoading: false };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Delete"));
    await waitFor(() =>
      expect(h.del).toHaveBeenCalledWith({ statusPageId: "p1" }),
    );
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("does nothing when delete is not confirmed", async () => {
    h.pages = { data: [makePage()], isLoading: false };
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Delete"));
    expect(h.del).not.toHaveBeenCalled();
  });

  it("shows an error toast when delete fails", async () => {
    h.pages = { data: [makePage()], isLoading: false };
    h.del.mockRejectedValue(new Error("nope"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StatusPagesSheet open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Delete"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
});

describe("StatusPageForm", () => {
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
    });
    expect(h.setMon).toHaveBeenCalledWith({
      statusPageId: "new",
      uptimeMonitorIds: ["m1"],
    });
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
    });
  });

  it("edits an existing page and hydrates its monitors", async () => {
    h.monitors = { data: [{ uptimeMonitorId: "m1", name: "Mon 1" }] };
    h.detail = { data: { monitorIds: ["m1"] } };
    const onClose = vi.fn();
    render(<StatusPageForm page={makePage()} onClose={onClose} />);
    // Pre-selected from detail; un-check then save with empty set.
    await waitFor(() =>
      expect(screen.getByRole("checkbox")).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ statusPageId: "p1" }),
    );
    expect(h.setMon).toHaveBeenCalledWith({
      statusPageId: "p1",
      uptimeMonitorIds: [],
    });
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
    const input = screen.getByLabelText("Custom domain");
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
      screen.getByLabelText("Custom domain"),
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
          expectedIp: "203.0.113.7",
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
      screen.getByText(/resolved 1\.2\.3\.4, expected 203\.0\.113\.7/),
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
          resolvedIps: ["203.0.113.7"],
          expectedIp: "203.0.113.7",
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
