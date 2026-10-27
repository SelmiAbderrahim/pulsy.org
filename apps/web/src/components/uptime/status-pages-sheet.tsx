import { registerDraftGuard } from "@/lib/draft-guards";
import { useDirtyBeforeUnload } from "@/hooks/use-dirty-before-unload";
import { isSessionClientActive } from "@/lib/session-query-client";
import { FormErrorSummary, useFormValidation } from "@/components/ui/form-validation";
import { FormField } from "@/components/ui/form-field";
import { FormFooter } from "@/components/ui/form-footer";
import { SectionCard } from "@/components/ui/section-card";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { requestConfirmation, requestDiscardConfirmation } from "@/lib/confirmation";
/**
 * Status pages management sheet.
 *
 * Lists the user's named status pages and lets them create/edit/delete pages,
 * pick which monitors each shows, publish, and attach a DNS-verified custom
 * domain. Opened from the dashboard header, mirroring the share-links sheet.
 *
 *
 * @module components/uptime/status-pages-sheet
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

import { useSession } from "@/lib/auth-client";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
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
  useStatusPage,
  useStatusPageDomainStatus,
  useStatusPages,
  useUpdateStatusPage,
  useVerifyStatusPageDomain,
} from "@/hooks/uptime";
import { useUptimeMonitors } from "@/hooks/uptime";
import { UptimeService } from "@/services/uptime/uptimeService";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { statusPageSlugSchema } from "@pulsy/db/status-page-slug";
import { extractFieldErrors, extractErrorMessage } from "@/lib/api/extractErrorMessage";
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
  const { data: pages, isLoading, error, refetch } = useStatusPages({ enabled: open });
  const deleteMutation = useDeleteStatusPage();
  const updatePage = useUpdateStatusPage(); const client = useQueryClient();
  const duplicate = useMutation({ mutationFn: (page: StatusPage) => UptimeService.duplicateStatusPage(page.statusPageId, t("statusUX.copyTitle", { title: page.title }).slice(0, 255)), onSuccess: async () => { await client.invalidateQueries({ queryKey: uptimeKeys.statusPages.all() }); if (!isSessionClientActive(client)) return; toast.success(t("statusUX.duplicated")); }, onError: error => { if (!isSessionClientActive(client)) return; toast.error(extractErrorMessage(error, t("statusPages.saveError"))); } });
  const unpublish = async (page: StatusPage) => { if (!await requestConfirmation(t("statusUX.unpublishConfirm", { name: page.title }), { title: t("statusUX.unpublishTitle"), action: t("statusUX.unpublish") })) return; try { await updatePage.mutateAsync({ statusPageId: page.statusPageId, isPublished: false }); } catch (error) { if (!isSessionClientActive(client)) return; toast.error(extractErrorMessage(error, t("statusPages.saveError"))); } };

  const [creating, setCreating] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);

  const list = pages ?? [];
  const handleDelete = async (page: StatusPage) => {
    if (
      !await requestConfirmation(
        t("statusUX.deleteNamed", { name: page.title }), { title: t("statusUX.deleteTitle"), action: t("statusPages.delete") },
      )
    )
      return;
    try {
      await deleteMutation.mutateAsync({ statusPageId: page.statusPageId });
      if (!isSessionClientActive(client)) return; toast.success(t("statusPages.deleted", "Status page deleted"));
    } catch (error) { if (!isSessionClientActive(client)) return;
      toast.error(
        extractErrorMessage(
          error,
          t("statusPages.deleteError", "Failed to delete status page"),
        ),
      );
    }
  };

  return (
    <Sheet open={open} onOpenChange={async value => { if (value || !createDirty || await requestDiscardConfirmation()) onOpenChange(value); }}>
      <SheetContent side="right" className={`flex flex-col overflow-hidden ${layoutTokens.listDrawer}`}>
        <SheetHeader>
          <SheetTitle>{t("statusPages.title", "Status pages")}</SheetTitle>
          <SheetDescription>
            {t(
              "statusPages.description",
              "Publish a selection of monitors as a public status page.",
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex min-h-0 flex-col gap-3 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {creating ? (
            // Creation is its own view: the list of existing pages is not shown beneath the form.
            <>
              <h3 className="text-base font-semibold">{t("statusPages.create", "New status page")}</h3>
              <StatusPageForm onDirtyChange={setCreateDirty} onClose={() => { setCreateDirty(false); setCreating(false); }} />
            </>
          ) : <>
<Button
              onClick={() => {
                setCreating(true);
              }}
              className="h-[44px] justify-start w-full sm:w-auto sm:justify-self-start sm:self-start"
            >
              <Plus className="h-4 w-4 me-2" />
              {t("statusPages.create", "New status page")}
            </Button>

          {error && <div role="alert" className="grid gap-2"><p className="text-sm text-destructive">{extractErrorMessage(error, t("communication.error"))}</p><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" variant="outline" onClick={() => void refetch()}>{t("communication.retry")}</Button></div>}
          {isLoading ? <div role="status" className="flex items-center gap-2 py-6"><Loader2 className="h-5 w-5 animate-spin" />{t("common:states.loading")}</div> : !error && list.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t("statusPages.empty", "No status pages yet.")}</p> : list.map(page => <div key={page.statusPageId} className="grid min-w-0 gap-3 rounded-lg border p-4">
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h3 className="break-words font-medium" dir="auto">{page.title}</h3><div className="mt-2 flex flex-wrap gap-2">{page.slug === DEFAULT_STATUS_PAGE_SLUG && <Badge variant="outline">{t("statusPages.defaultBadge", "Default")}</Badge>}<Badge variant="outline">{t(page.isPublished ? "statusPages.published" : "statusPages.draft", page.isPublished ? "Published" : "Draft")}</Badge><span className="text-sm text-muted-foreground">{t("statusUX.componentCount", { count: page.componentCount ?? 0 })}</span></div></div>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t("statusUX.moreNamed", { name: page.title })}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><a href={`/dashboard/status-pages/${encodeURIComponent(page.statusPageId)}?tab=general`}><Pencil className="me-2 h-4 w-4" />{t("statusPages.edit", "Edit")}</a></DropdownMenuItem><DropdownMenuItem disabled={duplicate.isPending} onSelect={() => duplicate.mutate(page)}><Copy className="me-2 h-4 w-4" />{t("statusUX.duplicate")}</DropdownMenuItem>{page.isPublished && <DropdownMenuItem disabled={updatePage.isPending} onSelect={() => void unpublish(page)}>{t("statusUX.unpublish")}</DropdownMenuItem>} {page.slug !== DEFAULT_STATUS_PAGE_SLUG && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" disabled={deleteMutation.isPending} onSelect={() => void handleDelete(page)}><Trash2 className="me-2 h-4 w-4" />{t("statusPages.delete", "Delete")}</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu>
            </div>
            {page.isPublished && (page.componentCount ?? 0) === 0 && <p className="flex items-start gap-2 text-sm text-warning"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t("statusUX.emptyPublishedWarning")}</p>}
            <p className="break-all text-xs text-muted-foreground" dir="ltr"><span className="sr-only">{t("statusPages.fieldSlug", "Slug")}: </span>{page.slug}{page.customDomain ? ` · ${page.customDomain}` : ""}</p>
            <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><a href={`/dashboard/status-pages/${encodeURIComponent(page.statusPageId)}`}>{t("statusUX.manage")}</a></Button>{page.isPublished && <Button variant="ghost" asChild><a href={statusPageUrl(page)} target="_blank" rel="noopener noreferrer">{t("statusPages.open", "Open page")}<ExternalLink className="h-4 w-4 rtl:scale-x-[-1]" /></a></Button>}</div>
          </div>)}
          </>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface StatusPageFormProps { page?: StatusPage; onClose: () => void; embedded?: boolean; onDirtyChange?: (dirty: boolean) => void; }
const pageFields = (page?: StatusPage) => ({ title: page?.title ?? "", slug: page?.slug ?? "", description: page?.description ?? null, isPublished: page?.isPublished ?? false });

export function StatusPageForm({ page, onClose, embedded = false, onDirtyChange }: StatusPageFormProps) {
  const client = useQueryClient();
  const { t } = useTranslation("uptimeMonitor"); const { t: common } = useTranslation("common"); const { data: session } = useSession();
  const { data: monitors } = useUptimeMonitors();
  const createMutation = useCreateStatusPage(), updateMutation = useUpdateStatusPage();
  const [fields, setFields] = useState(() => pageFields(page)), [baseline, setBaseline] = useState(() => pageFields(page));
  const [selected, setSelected] = useState<Set<string>>(new Set()), [search, setSearch] = useState(""), [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"title" | "slug" | "description", string>>>({});
  const validation = useFormValidation();
  const formRef = validation.formRef;
  const slugResult = statusPageSlugSchema.safeParse(fields.slug);
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>("#sp-slug")?.setCustomValidity(
      statusPageSlugSchema.safeParse(fields.slug).success ? "" : t("statusUX.slugHint"),
    );
  }, [fields.slug, t]);
  const [domainDirty, setDomainDirty] = useState(false);
  const submitting = useRef(false), snapshot = JSON.stringify({ ...fields, description: fields.description || null }), serverSnapshot = JSON.stringify(pageFields(page));
  const dirty = snapshot !== JSON.stringify({ ...baseline, description: baseline.description || null }) || !page && selected.size > 0 || domainDirty;
  const routeDraft = useRef({ dirty, onClose }); routeDraft.current = { dirty, onClose };
  useDirtyBeforeUnload(() => !embedded && routeDraft.current.dirty);
  useEffect(() => registerDraftGuard({
    dirty: () => !embedded && routeDraft.current.dirty,
    discard: () => { routeDraft.current.dirty = false; routeDraft.current.onClose(); },
  }), [embedded]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const stale = Boolean(page && serverSnapshot !== JSON.stringify(baseline));
  useEffect(() => { if (!dirty) { setFields(pageFields(page)); setBaseline(pageFields(page)); } }, [serverSnapshot]);
  const saving = createMutation.isPending || updateMutation.isPending;
  const update = <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) => {
    validation.clear(`sp-${key === "description" ? "desc" : key}`);
    setFields(previous => ({ ...previous, [key]: value }));
    setFieldErrors(previous => ({ ...previous, [key]: key === "title" && !String(value).trim() ? t("statusUX.titleRequired") : key === "slug" && !statusPageSlugSchema.safeParse(value).success ? t("statusUX.slugHint") : undefined })); setError("");
  };
  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault(); if (submitting.current) return;
    const localErrors: typeof fieldErrors = {};
    if (!slugResult.success) localErrors.slug = t("statusUX.slugHint");
    if (!fields.title.trim()) localErrors.title = t("statusUX.titleRequired");
    else if (fields.title.trim().length > 255) localErrors.title = common("nav.invalidField");
    if ((fields.description?.length ?? 0) > 1000) localErrors.description = common("nav.invalidField");
    setFieldErrors(localErrors); setError("");
    if (Object.keys(localErrors).length) {
      validation.show(Object.entries(localErrors).map(([key, message]) => ({ id: `sp-${key === "description" ? "desc" : key}`, message }))); return;
    }
    validation.clear();
    submitting.current = true;
    try {
      let confirmEmptyPublication = false;
      if (fields.isPublished && !baseline.isPublished && (page ? (page.componentCount ?? 0) === 0 : selected.size === 0)) {
        confirmEmptyPublication = await requestConfirmation(t("statusUX.confirmEmptyPublication"), { title: t("statusUX.publishEmptyTitle"), action: t("statusUX.publishEmptyAction"), destructive: false });
        if (!confirmEmptyPublication || !isSessionClientActive(client)) return;
      }
      const confirmation = confirmEmptyPublication ? { confirmEmptyPublication: true } : {};
      const values = { ...fields, title: fields.title.trim(), slug: statusPageSlugSchema.parse(fields.slug), description: fields.description || null };
      if (page) await updateMutation.mutateAsync({ statusPageId: page.statusPageId, ...values, ...confirmation, expected: baseline });
      else await createMutation.mutateAsync({ ...values, ...confirmation, uptimeMonitorIds: [...selected] });
      if (!isSessionClientActive(client)) return; setFields(values); setBaseline(values); setSelected(new Set()); if (!isSessionClientActive(client)) return; toast.success(t("statusPages.saved", "Status page saved")); onClose();
    } catch (caught) { if (!isSessionClientActive(client)) return;
      const errors = extractFieldErrors(caught, ["title", "slug", "description"] as const);
      setFieldErrors(errors);
      if (Object.keys(errors).length) { validation.show(Object.entries(errors).map(([key, message]) => ({ id: `sp-${key === "description" ? "desc" : key}`, message: message! }))); return; }
      const message = extractErrorMessage(caught, Object.keys(errors).length ? t("statusUX.validationError") : t("statusPages.saveError", "Failed to save status page"));
      setError(message); toast.error(message);
    }
    finally { submitting.current = false; }
  };
  const publicPath = statusPageUrl({ userId: page?.userId ?? session?.user.id ?? "…", slug: slugResult.success ? slugResult.data : "", customDomain: null, domainVerified: false });
  return <div className="grid min-w-0 gap-6">
    {page && <a className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-muted/30 px-4 text-sm font-medium underline" href="#status-custom-domain">{t("statusUX.customDomainLink")}</a>}
    <SectionCard title={t("statusUX.tabs.general")}><form ref={formRef} noValidate className="grid min-w-0 gap-4" onSubmit={event => void handleSave(event)}>
      <FormErrorSummary issues={validation.issues} />
      <p className="text-sm text-muted-foreground">{t("statusUX.requiredHint")}{dirty && <> · {t("statusUX.unsaved")}</>}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {stale && <div role="alert" className="grid gap-2 text-sm"><p>{t("statusUX.stale")}</p><Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" type="button" variant="outline" onClick={async () => { if (!dirty || await requestDiscardConfirmation()) { setFields(pageFields(page)); setBaseline(pageFields(page)); setFieldErrors({}); setError(""); } }}>{t("statusUX.reload")}</Button></div>}
      <div className="grid min-w-0 gap-4">
        <FormField label={t("statusPages.fieldTitle", "Title")} control={<Input id="sp-title" aria-invalid={Boolean(fieldErrors.title)} dir="auto" required maxLength={255} disabled={saving} value={fields.title} onChange={event => update("title", event.target.value)} placeholder={t("statusPages.titlePlaceholder", "Example: Acme Status")} />} error={fieldErrors.title} />
        <FormField label={t("statusPages.fieldSlug", "Slug")} control={<Input id="sp-slug" dir="ltr" required aria-invalid={Boolean(fieldErrors.slug)} disabled={saving} readOnly={page?.slug === DEFAULT_STATUS_PAGE_SLUG} className={page?.slug === DEFAULT_STATUS_PAGE_SLUG ? "bg-muted text-muted-foreground" : undefined} value={fields.slug} onChange={event => {
          const value = event.target.value;
          event.currentTarget.setCustomValidity(statusPageSlugSchema.safeParse(value).success ? "" : t("statusUX.slugHint"));
          update("slug", value);
        }} onBlur={event => {
          const valid = statusPageSlugSchema.safeParse(event.currentTarget.value).success;
          event.currentTarget.setCustomValidity(valid ? "" : t("statusUX.slugHint"));
          setFieldErrors(previous => valid ? previous : { ...previous, slug: t("statusUX.slugHint") });
        }} placeholder={t("formUX.example", { value: "status" })} />} helper={t(page?.slug === DEFAULT_STATUS_PAGE_SLUG ? "statusUX.defaultSlugHelp" : "statusUX.slugHint")} error={fieldErrors.slug} />
        <FormField label={t("statusPages.fieldDescription", "Description")} control={<Textarea id="sp-desc" aria-invalid={Boolean(fieldErrors.description)} dir="auto" maxLength={1000} rows={3} disabled={saving} value={fields.description ?? ""} onChange={event => update("description", event.target.value)} />} helper={t("statusUX.optionalDescription", { max: 1000 })} error={fieldErrors.description} />
      </div>
      {slugResult.success && (!page || slugResult.data !== page.slug) && <p className="break-all text-sm"><span className="text-muted-foreground">{t("statusUX.addressAfterSaving")}: </span><bdi dir="ltr">{publicPath}</bdi></p>}
      <div className="grid gap-2"><div className="flex min-h-11 items-center justify-between gap-3"><Label htmlFor="sp-pub">{t("statusPages.publish", "Published")}</Label><Switch id="sp-pub" disabled={saving} checked={fields.isPublished} onCheckedChange={value => update("isPublished", value)} aria-describedby="sp-publication-help" /></div><p id="sp-publication-help" className="text-sm text-muted-foreground">{t(fields.isPublished ? "statusUX.publishHint" : "statusUX.draftLimit")}{fields.isPublished && (page ? page.componentCount === 0 : selected.size === 0) && <> {t("statusUX.publishEmpty")}</>}</p></div>
      {!page && <fieldset className="grid min-w-0 gap-2"><legend className="mb-2 text-sm font-medium">{t("statusPages.monitors", "Monitors")}</legend><Input type="search" aria-label={t("notificationUX.searchMonitors")} placeholder={t("search.shortPlaceholder")} value={search} onChange={event => setSearch(event.target.value)} /><p className="text-sm">{t("statusUX.selectedCount", { count: selected.size })}</p><div className="">{(monitors ?? []).filter(monitor => monitor.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(monitor => <label key={monitor.uptimeMonitorId} className="flex min-h-11 cursor-pointer items-center gap-3 p-2"><Checkbox disabled={saving} checked={selected.has(monitor.uptimeMonitorId)} onCheckedChange={checked => setSelected(previous => { const next = new Set(previous); if (checked) next.add(monitor.uptimeMonitorId); else next.delete(monitor.uptimeMonitorId); return next; })} /><bdi className="min-w-0 break-words text-sm">{monitor.name}</bdi></label>)}</div>{!monitors?.length && <p className="text-sm text-muted-foreground">{t("statusPages.noMonitorsToPick", "No monitors to add yet.")}</p>}<p className="text-xs text-muted-foreground">{t("pageSelection.disclosure")}</p></fieldset>}
      <FormFooter sticky className="bg-card">{!embedded && <Button type="button" variant="ghost" disabled={saving} onClick={async () => { if (!dirty || await requestDiscardConfirmation()) onClose(); }}>{t("common:actions.cancel", "Cancel")}</Button>}<Button type="submit" disabled={saving || !dirty}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{t("statusPages.save", "Save")}</Button></FormFooter>
    </form></SectionCard>
    {page && <section id="status-custom-domain" className="scroll-mt-20"><DomainSection page={page} onDirtyChange={setDomainDirty} /></section>}
  </div>;
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

export function DomainSection({ page, onDirtyChange }: { page: StatusPage; onDirtyChange?: (dirty: boolean) => void }) {
  const client = useQueryClient();
  const { t } = useTranslation("uptimeMonitor");
  const queryClient = client;
  const attachMutation = useAttachStatusPageDomain();
  const verifyMutation = useVerifyStatusPageDomain();
  const detachMutation = useDetachStatusPageDomain();
  const hasDomain = Boolean(page.customDomain);
  const domainStatusQuery = useStatusPageDomainStatus(page.statusPageId, {
    enabled: hasDomain,
  });

  const [domain, setDomain] = useState("");
  useEffect(() => { onDirtyChange?.(Boolean(domain.trim())); }, [domain, onDirtyChange]);
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

  // A later owner action in another tab can replace the ownership proof.
  useEffect(() => {
    setRecord(page.customDomain && page.domainVerifyToken ? {
      domain: page.customDomain, name: `_pulsy-verify.${page.customDomain}`, value: page.domainVerifyToken,
    } : null);
  }, [page.customDomain, page.domainVerifyToken]);
  const copyRecord = async (value: string) => {
    try { await navigator.clipboard.writeText(value); if (!isSessionClientActive(client)) return; toast.success(t("statusPages.copied", "Copied")); }
    catch { if (!isSessionClientActive(client)) return; toast.error(t("statusUX.urlCopyFailed", "Could not copy. Select and copy the value manually.")); }
  };

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
      if (!isSessionClientActive(client)) return;
      setDomain("");
      setRecord({
        domain: res.customDomain ?? domain,
        name: res.recordName,
        value: res.recordValue,
      });
      if (!isSessionClientActive(client)) return; toast.success(t("statusPages.domainAttached", "Domain attached"));
    } catch (error) { if (!isSessionClientActive(client)) return;
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
        if (!isSessionClientActive(client)) return; toast.success(t("statusPages.domainVerified", "Domain verified"));
      }
    } catch (error) { if (!isSessionClientActive(client)) return;
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
      if (!isSessionClientActive(client)) return; toast.success(t("statusPages.domainDetached", "Domain removed"));
    } catch (error) { if (!isSessionClientActive(client)) return;
      toast.error(
        extractErrorMessage(
          error,
          t("statusPages.domainError", "Failed to remove domain"),
        ),
      );
    }
  };

  return (
    <SectionCard title={t("statusPages.customDomain", "Custom domain")} headerEnd={activeDomain ? (
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
        ) : null}>
      <div className="grid gap-3">

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
                  "{{step}}. Point your domain here ({{type}} record):",
                  { type: routingRecord.recordType, step: 1 },
                )}
              </p>
              <p className="break-all font-mono">{routingRecord.recordName}</p>
              <div className="flex items-center gap-1">
                <p className="break-all font-mono">{routingRecord.recordValue}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label={t("statusPages.copyRecord", "Copy record value")}
                  onClick={() => void copyRecord(routingRecord.recordValue)}
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
                      "{{step}}. Add this TXT record to prove ownership:",
                      { step: 2 },
                    )
                  : t("statusPages.dnsRecord", "Add this TXT record:")}
              </p>
              <p className="break-all font-mono">{record.name}</p>
              <div className="flex items-center gap-1">
                <p className="break-all font-mono">{record.value}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label={t("statusPages.copyRecord", "Copy record value")}
                  onClick={() => void copyRecord(record.value)}
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
            disabled={attachMutation.isPending}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={t("formUX.example", { value: "status.example.com" })}
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
    </SectionCard>
  );
}
