/**
 * Status pages management sheet.
 *
 * Lists the user's named status pages and lets them create/edit/delete pages,
 * pick which monitors each shows, publish, and attach a DNS-verified custom
 * domain. Opened from the dashboard header, mirroring the share-links sheet.
 *
 * @module components/uptime/status-pages-sheet
 */

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useAttachStatusPageDomain,
  useCreateStatusPage,
  useDeleteStatusPage,
  useDetachStatusPageDomain,
  useSetStatusPageMonitors,
  useStatusPage,
  useStatusPageDomainStatus,
  useStatusPages,
  useUpdateStatusPage,
  useVerifyStatusPageDomain,
} from "@/hooks/uptime";
import { useUptimeMonitors } from "@/hooks/uptime";
import { useQueryClient } from "@tanstack/react-query";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { statusPageUrl } from "@/lib/status-domain";
import { cn } from "@/lib/utils";
import type { DomainRoutingRecord, StatusPage } from "@/types/uptime";

const DEFAULT_STATUS_PAGE_SLUG = "default";

interface StatusPagesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StatusPagesSheet({ open, onOpenChange }: StatusPagesSheetProps) {
  const { t } = useTranslation("uptimeMonitor");
  const { data: pages, isLoading } = useStatusPages({ enabled: open });
  const deleteMutation = useDeleteStatusPage();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = pages ?? [];

  const handleDelete = async (page: StatusPage) => {
    if (
      !confirm(
        t("statusPages.deleteConfirm", "Delete this status page?"),
      )
    )
      return;
    try {
      await deleteMutation.mutateAsync({ statusPageId: page.statusPageId });
      toast.success(t("statusPages.deleted", "Status page deleted"));
    } catch (error) {
      toast.error(
        extractErrorMessage(
          error,
          t("statusPages.deleteError", "Failed to delete status page"),
        ),
      );
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("statusPages.title", "Status pages")}</SheetTitle>
          <SheetDescription>
            {t(
              "statusPages.description",
              "Publish a selection of monitors as a public status page.",
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-3">
          {creating ? (
            <StatusPageForm onClose={() => setCreating(false)} />
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setEditingId(null);
                setCreating(true);
              }}
              className="h-[44px] justify-start"
            >
              <Plus className="h-4 w-4 me-2" />
              {t("statusPages.create", "New status page")}
            </Button>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <Globe className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {t("statusPages.empty", "No status pages yet.")}
              </p>
            </div>
          ) : (
            list.map((page) =>
              editingId === page.statusPageId ? (
                <StatusPageForm
                  key={page.statusPageId}
                  page={page}
                  onClose={() => setEditingId(null)}
                />
              ) : (
                <div
                  key={page.statusPageId}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {page.title}
                      </p>
                      {page.slug === DEFAULT_STATUS_PAGE_SLUG ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("statusPages.defaultBadge", "Default")}
                        </Badge>
                      ) : null}
                      {page.isPublished ? (
                        <Badge
                          variant="outline"
                          className="border-success/30 bg-success/10 text-success"
                        >
                          {t("statusPages.published", "Published")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("statusPages.draft", "Draft")}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      /status/{page.userId}/{page.slug}
                      {page.customDomain ? ` · ${page.customDomain}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        window.open(
                          statusPageUrl(page),
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                      disabled={!page.isPublished}
                      className="h-[44px] w-[44px]"
                      aria-label={t("statusPages.open", "Open page")}
                    >
                      <ExternalLink className="h-4 w-4 rtl:scale-x-[-1]" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setCreating(false);
                        setEditingId(page.statusPageId);
                      }}
                      className="h-[44px] w-[44px]"
                      aria-label={t("statusPages.edit", "Edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {page.slug === DEFAULT_STATUS_PAGE_SLUG ? null : (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(page)}
                        disabled={deleteMutation.isPending}
                        className="h-[44px] w-[44px] text-destructive hover:text-destructive"
                        aria-label={t("statusPages.delete", "Delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ),
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface StatusPageFormProps {
  page?: StatusPage;
  onClose: () => void;
}

export function StatusPageForm({ page, onClose }: StatusPageFormProps) {
  const { t } = useTranslation("uptimeMonitor");
  const isEdit = Boolean(page);
  const { data: detail } = useStatusPage(page?.statusPageId ?? "", {
    enabled: isEdit,
  });
  const { data: monitors } = useUptimeMonitors();

  const createMutation = useCreateStatusPage();
  const updateMutation = useUpdateStatusPage();
  const setMonitorsMutation = useSetStatusPageMonitors();

  const [title, setTitle] = useState(page?.title ?? "");
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [description, setDescription] = useState(page?.description ?? "");
  const [isPublished, setIsPublished] = useState(page?.isPublished ?? false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Hydrate the monitor selection once the page detail loads.
  useEffect(() => {
    if (detail) {
      setSelected(new Set(detail.monitorIds));
    }
  }, [detail]);

  const toggleMonitor = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSave = async () => {
    try {
      const ids = [...selected];
      if (isEdit && page) {
        await updateMutation.mutateAsync({
          statusPageId: page.statusPageId,
          title,
          slug,
          description: description || null,
          isPublished,
        });
        await setMonitorsMutation.mutateAsync({
          statusPageId: page.statusPageId,
          uptimeMonitorIds: ids,
        });
      } else {
        const created = await createMutation.mutateAsync({
          slug,
          title,
          description: description || null,
          isPublished,
        });
        await setMonitorsMutation.mutateAsync({
          statusPageId: created.statusPageId,
          uptimeMonitorIds: ids,
        });
      }
      toast.success(t("statusPages.saved", "Status page saved"));
      onClose();
    } catch (error) {
      toast.error(
        extractErrorMessage(
          error,
          t("statusPages.saveError", "Failed to save status page"),
        ),
      );
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sp-title">{t("statusPages.fieldTitle", "Title")}</Label>
        <Input
          id="sp-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("statusPages.titlePlaceholder", "Acme Status")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sp-slug">{t("statusPages.fieldSlug", "Slug")}</Label>
        <Input
          id="sp-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="status"
          disabled={page?.slug === DEFAULT_STATUS_PAGE_SLUG}
        />
        {page?.slug === DEFAULT_STATUS_PAGE_SLUG ? (
          <p className="text-xs text-muted-foreground">
            {t(
              "statusPages.slugLockedHint",
              "The default page slug can't be changed.",
            )}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sp-desc">
          {t("statusPages.fieldDescription", "Description")}
        </Label>
        <Textarea
          id="sp-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 p-3">
        <Label htmlFor="sp-pub" className="cursor-pointer">
          {t("statusPages.publish", "Published")}
        </Label>
        <Switch
          id="sp-pub"
          checked={isPublished}
          onCheckedChange={setIsPublished}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          {t("statusPages.monitors", "Monitors")}
        </p>
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {(monitors ?? []).map((m) => (
            <label
              key={m.uptimeMonitorId}
              className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-muted/50"
            >
              <Checkbox
                checked={selected.has(m.uptimeMonitorId)}
                onCheckedChange={() => toggleMonitor(m.uptimeMonitorId)}
              />
              <span className="truncate text-sm">{m.name}</span>
            </label>
          ))}
          {(monitors ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("statusPages.noMonitorsToPick", "No monitors to add yet.")}
            </p>
          ) : null}
        </div>
      </div>

      {isEdit && page ? <DomainSection page={page} /> : null}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose} className="h-[44px]">
          {t("common:cancel", "Cancel")}
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !title || !slug}
          className="h-[44px]"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 me-2 animate-spin" />
          ) : null}
          {t("statusPages.save", "Save")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The routing record (CNAME/A) a user must create so their custom domain
 * actually reaches this server. The target is operator config, exposed to the
 * web build via VITE_CUSTOM_DOMAIN_* (mirrors the server's CUSTOM_DOMAIN_*).
 * Returns null when no target is configured (self-hoster wiring nginx by hand).
 */
function routingRecordFromEnv(domain: string): DomainRoutingRecord | null {
  const cname = (
    import.meta.env.VITE_CUSTOM_DOMAIN_CNAME_TARGET as string | undefined
  )?.trim();
  if (cname) {
    return { recordType: "CNAME", recordName: domain, recordValue: cname };
  }
  const ip = (
    import.meta.env.VITE_CUSTOM_DOMAIN_IP as string | undefined
  )?.trim();
  if (ip) {
    return { recordType: "A", recordName: domain, recordValue: ip };
  }
  return null;
}

/** One row of the custom-domain "DNS records & status" checklist. */
function DomainCheckRow({
  state,
  label,
  detail,
}: {
  state: "ok" | "fail" | "progress" | "idle";
  label: string;
  detail?: string | null;
}) {
  const icon =
    state === "ok" ? (
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
    ) : state === "fail" ? (
      <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
    ) : state === "progress" ? (
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
    ) : (
      <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    );
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5">{icon}</span>
      <span className="font-medium">{label}</span>
      {detail ? (
        <span className="text-muted-foreground break-all">{detail}</span>
      ) : null}
    </div>
  );
}

export function DomainSection({ page }: { page: StatusPage }) {
  const { t } = useTranslation("uptimeMonitor");
  const queryClient = useQueryClient();
  const attachMutation = useAttachStatusPageDomain();
  const verifyMutation = useVerifyStatusPageDomain();
  const detachMutation = useDetachStatusPageDomain();
  const hasDomain = Boolean(page.customDomain);
  const domainStatusQuery = useStatusPageDomainStatus(page.statusPageId, {
    enabled: hasDomain,
  });

  const [domain, setDomain] = useState("");
  const [record, setRecord] = useState<{
    domain: string;
    name: string;
    value: string;
  } | null>(
    page.customDomain && page.domainVerifyToken
      ? {
          domain: page.customDomain,
          name: `_pulsy-verify.${page.customDomain}`,
          value: page.domainVerifyToken,
        }
      : null,
  );

  // The domain to display comes from the persisted page or a just-attached
  // record (the page prop refreshes on the next query invalidation).
  const activeDomain = page.customDomain ?? record?.domain ?? null;
  const routingRecord = activeDomain ? routingRecordFromEnv(activeDomain) : null;
  const provisionStatus = page.domainProvisionStatus;

  const handleAttach = async () => {
    try {
      const res = await attachMutation.mutateAsync({
        statusPageId: page.statusPageId,
        customDomain: domain,
      });
      setRecord({
        domain: res.customDomain ?? domain,
        name: res.recordName,
        value: res.recordValue,
      });
      toast.success(t("statusPages.domainAttached", "Domain attached"));
    } catch (error) {
      toast.error(
        extractErrorMessage(
          error,
          t("statusPages.domainError", "Failed to attach domain"),
        ),
      );
    }
  };

  const handleVerify = async () => {
    try {
      const res = await verifyMutation.mutateAsync({
        statusPageId: page.statusPageId,
      });
      if (res.domainVerified) {
        toast.success(t("statusPages.domainVerified", "Domain verified"));
      }
    } catch (error) {
      toast.error(
        extractErrorMessage(
          error,
          t("statusPages.domainNotVerified", "Domain not verified yet"),
        ),
      );
    }
  };

  const handleRecheck = () => {
    void domainStatusQuery.refetch();
    // Pull the latest daemon-written provisioning fields onto the page row.
    void queryClient.invalidateQueries({
      queryKey: uptimeKeys.statusPages.lists(),
    });
  };

  const handleDetach = async () => {
    try {
      await detachMutation.mutateAsync({ statusPageId: page.statusPageId });
      setRecord(null);
      setDomain("");
      toast.success(t("statusPages.domainDetached", "Domain removed"));
    } catch (error) {
      toast.error(
        extractErrorMessage(
          error,
          t("statusPages.domainError", "Failed to remove domain"),
        ),
      );
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {t("statusPages.customDomain", "Custom domain")}
        </p>
        {activeDomain ? (
          page.domainVerified ? (
            provisionStatus === "active" ? (
              <Badge
                variant="outline"
                className="gap-1 border-success/30 bg-success/10 text-success"
              >
                <CheckCircle2 className="h-3 w-3" />
                {t("statusPages.domainLive", "Live")}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 border-success/30 bg-success/10 text-success"
              >
                <CheckCircle2 className="h-3 w-3" />
                {t("statusPages.verified", "Verified")}
              </Badge>
            )
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t("statusPages.notVerified", "Not verified")}
            </Badge>
          )
        ) : null}
      </div>

      {activeDomain ? (
        <>
          <p className="text-sm text-muted-foreground">{activeDomain}</p>

          {/* Routing record (CNAME/A): points the hostname at this server so it
              actually resolves. Shown until the domain is live; the TXT record
              below only proves ownership — both are required. */}
          {routingRecord && provisionStatus !== "active" ? (
            <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2 text-xs">
              <p className="font-medium">
                {t(
                  "statusPages.routingRecord",
                  "1. Point your domain here ({{type}} record):",
                  { type: routingRecord.recordType },
                )}
              </p>
              <p className="break-all font-mono">{routingRecord.recordName}</p>
              <div className="flex items-center gap-1">
                <p className="break-all font-mono">{routingRecord.recordValue}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={t("statusPages.copyRecord", "Copy record value")}
                  onClick={() => {
                    void navigator.clipboard.writeText(routingRecord.recordValue);
                    toast.success(t("statusPages.copied", "Copied"));
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-muted-foreground">
                {t(
                  "statusPages.routingDnsOnly",
                  "Use a DNS-only record (no proxy) so the certificate can be issued.",
                )}
              </p>
            </div>
          ) : null}

          {record && !page.domainVerified ? (
            <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2 text-xs">
              <p className="font-medium">
                {routingRecord
                  ? t(
                      "statusPages.dnsRecordOwnership",
                      "2. Add this TXT record to prove ownership:",
                    )
                  : t("statusPages.dnsRecord", "Add this TXT record:")}
              </p>
              <p className="break-all font-mono">{record.name}</p>
              <div className="flex items-center gap-1">
                <p className="break-all font-mono">{record.value}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={t("statusPages.copyRecord", "Copy record value")}
                  onClick={() => {
                    void navigator.clipboard.writeText(record.value);
                    toast.success(t("statusPages.copied", "Copied"));
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : null}

          {/* DNS records & status — live integration checklist. Ownership (TXT)
              + routing (A/CNAME resolved vs expected) + the host daemon's cert
              provisioning state. Driven by the polling domainStatus query. */}
          {(() => {
            const ds = domainStatusQuery.data;
            const prov = ds?.provisionStatus ?? provisionStatus;
            const ownershipOk = ds?.ownershipVerified ?? page.domainVerified;

            const routingState: "ok" | "fail" | "idle" = ds?.routing.ok
              ? "ok"
              : ds && ds.routing.expectedIp == null
                ? "idle"
                : "fail";
            const routingDetail = !ds
              ? null
              : ds.routing.ok
                ? null
                : ds.routing.expectedIp == null
                  ? t(
                      "statusPages.routingNoTarget",
                      "no routing target configured",
                    )
                  : t("statusPages.routingMismatch", "resolved {{resolved}}, expected {{expected}}", {
                      resolved: ds.routing.resolvedIps.join(", ") ||
                        t("statusPages.routingNothing", "nothing"),
                      expected: ds.routing.expectedIp,
                    });

            const certState: "ok" | "fail" | "progress" | "idle" =
              prov === "active"
                ? "ok"
                : prov === "failed"
                  ? "fail"
                  : prov === "pending"
                    ? "progress"
                    : "idle";
            const certDetail =
              prov === "active"
                ? t("statusPages.domainLive", "Live")
                : prov === "failed"
                  ? (ds?.provisionError ?? page.domainProvisionError ??
                      t("statusPages.domainProvisionFailed", "issuance failed"))
                  : prov === "pending"
                    ? t("statusPages.certIssuing", "issuing…")
                    : t("statusPages.certWaiting", "waiting for verification");

            return (
              <div className="flex flex-col gap-1.5 rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">
                    {t("statusPages.dnsStatusTitle", "DNS records & status")}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={handleRecheck}
                    disabled={domainStatusQuery.isFetching}
                  >
                    <RefreshCw
                      className={cn(
                        "h-3 w-3",
                        domainStatusQuery.isFetching && "animate-spin",
                      )}
                    />
                    {t("statusPages.recheck", "Re-check")}
                  </Button>
                </div>
                <DomainCheckRow
                  state={ownershipOk ? "ok" : "idle"}
                  label={t("statusPages.checkOwnership", "Ownership (TXT)")}
                  detail={
                    ownershipOk
                      ? t("statusPages.checkVerified", "verified")
                      : t("statusPages.checkPending", "pending")
                  }
                />
                <DomainCheckRow
                  state={routingState}
                  label={t("statusPages.checkRouting", "Routing (A/CNAME)")}
                  detail={routingDetail}
                />
                <DomainCheckRow
                  state={certState}
                  label={t("statusPages.checkCertificate", "Certificate")}
                  detail={certDetail}
                />
              </div>
            );
          })()}
          <div className="flex items-center gap-2">
            {!page.domainVerified ? (
              <Button
                variant="outline"
                onClick={handleVerify}
                disabled={verifyMutation.isPending}
                className="h-[44px]"
              >
                {verifyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                ) : null}
                {t("statusPages.verify", "Verify")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={handleDetach}
              disabled={detachMutation.isPending}
              className="h-[44px] text-destructive hover:text-destructive"
            >
              {t("statusPages.removeDomain", "Remove")}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="status.example.com"
            aria-label={t("statusPages.customDomain", "Custom domain")}
          />
          <Button
            variant="outline"
            onClick={handleAttach}
            disabled={attachMutation.isPending || !domain}
            className="h-[44px]"
          >
            {attachMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : null}
            {t("statusPages.attach", "Attach")}
          </Button>
        </div>
      )}
    </div>
  );
}
