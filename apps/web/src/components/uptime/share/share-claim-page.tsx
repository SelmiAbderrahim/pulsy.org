import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { SectionCard } from "@/components/ui/section-card";
/**
 * Share claim page content.
 *
 * Resolves a share token and lets the (authenticated) recipient pick which of
 * the shared monitors to clone into their own account. Rendered by the public
 * /share/$token route once a session exists.
 *
 * @module components/uptime/share/share-claim-page
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Link2Off } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "@dr.pogodin/react-helmet";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

import { SelectableCheckbox } from "@/components/dashboard/settings/common/SelectableCheckbox";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	useCloneSharedMonitors,
	useResolveShareLink,
	useUptimeMonitors,
} from "@/hooks/uptime";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { isMissingResource } from "@/lib/api/is-missing-resource";
import { duplicateMonitor } from "@pulsy/db/monitor-url";

const UNAVAILABLE_DESCRIPTION = "This link doesn't exist, was revoked or has expired. Ask the person who shared it for a new link.";

interface ShareClaimPageProps {
	token: string;
}

export function ShareClaimPage({ token }: ShareClaimPageProps) {
  const client = useQueryClient();
	const { t } = useTranslation("uptimeMonitor");
	const navigate = useNavigate();
	const { data, isLoading, error } = useResolveShareLink(token);
	const ownMonitors = useUptimeMonitors();
	const cloneMutation = useCloneSharedMonitors();
	const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cloneError, setCloneError] = useState("");
  const initialized = useRef(false);
  const cloning = useRef(false);

	const monitors = useMemo(() => data?.monitors ?? [], [data]);
	// Imports follow the server rule: a URL the recipient already monitors
	// (canonical match against their HTTP monitors) is never cloned again, so
	// those rows are shown up front with a link to the existing monitor.
	const existingById = useMemo(() => {
		const own = (ownMonitors.data ?? []).filter(monitor => (monitor.monitorType ?? "http") === "http");
		return new Map(monitors.flatMap(monitor => {
			const existing = duplicateMonitor(monitor.url, own);
			return existing ? [[monitor.uptimeMonitorId, existing] as const] : [];
		}));
	}, [monitors, ownMonitors.data]);
	const importable = useMemo(() => monitors.filter(monitor => !existingById.has(monitor.uptimeMonitorId)), [monitors, existingById]);
	const unavailable = Boolean(error) || (!isLoading && !data);
	useDocumentTitle(unavailable ? t("share.claim.unavailableTitle", "Link unavailable") : t("share.claim.pageTitle", "Shared monitors"));

	// Pre-select every importable shared monitor once the link resolves.
	useEffect(() => {
		if (data && !ownMonitors.isPending) {
			const available = new Set(importable.map(m => m.uptimeMonitorId));
      const wasInitialized = initialized.current;
      setSelected(previous => wasInitialized ? new Set([...previous].filter(id => available.has(id))) : available);
      initialized.current = true;
		}
	}, [data, importable, ownMonitors.isPending]);

	const goToDashboard = () => {
		navigate({ to: "/dashboard" });
	};

	const toggle = (id: string) => {
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

	const allSelected = importable.length > 0 && selected.size === importable.length;

	const toggleAll = () => {
		setSelected(
			allSelected
				? new Set()
				: new Set(importable.map((m) => m.uptimeMonitorId)),
		);
	};

	const handleClone = async () => {
    if (cloning.current || !selected.size) return;
    cloning.current = true;
    setCloneError("");
		try {
			const cloned = await cloneMutation.mutateAsync({
				token,
				uptimeMonitorIds: Array.from(selected),
			});
			if (!isSessionClientActive(client)) return; toast.success(
				t("share.claim.success", "Added {{count}} monitors", {
					count: cloned.length,
				}),
			);
			goToDashboard();
		} catch (err) { if (!isSessionClientActive(client)) return;
			// Inline (not a toast) so the message never covers the Add button;
			// a conflict also refreshes the recipient's monitors so the
			// duplicate row gains its "Open existing monitor" link.
			setCloneError(
				extractErrorMessage(
					err,
					t("share.claim.error", "Failed to add monitors"),
				),
			);
			void ownMonitors.refetch();
		}
    finally { cloning.current = false; }
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<Card>
				<Helmet><meta name="robots" content="noindex, nofollow" /></Helmet>
				<CardHeader className="text-center">
					<div className="flex justify-center">
						<Link2Off className="h-8 w-8 text-muted-foreground" />
					</div>
					<CardTitle className="text-base font-semibold">
						{t("share.claim.unavailableTitle", "Link unavailable")}
					</CardTitle>
					<CardDescription>
						{!error || isMissingResource(error)
							? t("share.claim.unavailableDescription", UNAVAILABLE_DESCRIPTION)
							: extractErrorMessage(error, t("share.claim.unavailableDescription", UNAVAILABLE_DESCRIPTION))}
					</CardDescription>
				</CardHeader>
				<CardFooter className="justify-center">
					<Button
						variant="outline"
						onClick={goToDashboard}
						className="h-[44px]"
					>
						{t("share.claim.goToDashboard", "Go to dashboard")}
					</Button>
				</CardFooter>
			</Card>
		);
	}

	if (monitors.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<Link2Off className="h-8 w-8 text-muted-foreground" />
					<p className="text-sm text-muted-foreground">
						{t(
							"share.claim.empty",
							"The shared monitors are no longer available.",
						)}
					</p>
					<Button
						variant="outline"
						onClick={goToDashboard}
						className="h-[44px]"
					>
						{t("share.claim.goToDashboard", "Go to dashboard")}
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
		<Helmet><meta name="robots" content="noindex, nofollow" /><meta name="description" content={t("share.claim.metaDescription", "Review shared monitor settings and copy them into your Pulsy account.")} /></Helmet>
		<SectionCard title={<>
					{data.sharedBy
						? t("share.claim.title", "{{name}} shared monitors with you", {
								name: data.sharedBy,
							})
						: t(
								"share.claim.titleAnonymous",
								"A Pulsy user shared monitors with you",
							)}
				</>} description={<>
					{t(
						"share.claim.description",
						"Choose which monitors to add to your account. They start fresh with no history.",
					)}
				</>}><div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("shareUX.repeatHint")}</p>
				<div className="flex min-h-[44px] items-center gap-2">
					<SelectableCheckbox
						checked={allSelected}
						onChange={toggleAll}
						disabled={importable.length === 0}
						label={t("share.claim.selectAll", "Select all")}
					/>
					<span className="text-sm font-medium">
						{t("share.claim.selectAll", "Select all")}
					</span>
				</div>
				{monitors.map((monitor) => {
					const existing = existingById.get(monitor.uptimeMonitorId);
					return (
					<div
						key={monitor.uptimeMonitorId}
						className="flex min-h-[44px] items-center gap-2 rounded-md border py-1 pe-3"
					>
						<SelectableCheckbox
							checked={!existing && selected.has(monitor.uptimeMonitorId)}
							onChange={() => toggle(monitor.uptimeMonitorId)}
							disabled={Boolean(existing)}
							label={monitor.name}
						/>
						<span className="min-w-0 flex-1">
							<span className="block break-words text-sm font-medium" dir="auto">
								{monitor.name}
							</span>
							<span className="block break-all text-xs text-muted-foreground" dir="ltr">
								{monitor.url}
							</span>
							{existing && (
								<span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
									<span className="text-muted-foreground">{t("shareUX.alreadyMonitored", "Already monitored as “{{name}}”.", { name: existing.name })}</span>
									<Link
										to="/dashboard/uptime/$monitorId"
										params={{ monitorId: existing.uptimeMonitorId }}
										search={{ tab: "overview" }}
										className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
										aria-label={t("shareUX.openExistingNamed", "Open existing monitor “{{name}}”", { name: existing.name })}
									>
										{t("shareUX.openExisting", "Open existing monitor")}
									</Link>
								</span>
							)}
						</span>
					</div>
					);
				})}
			</div>
			{cloneError && <p role="alert" className="mt-4 text-sm text-destructive">{cloneError}</p>}
			<div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button
					variant="ghost"
					onClick={goToDashboard}
					className="h-[44px]"
				>
					{t("share.claim.later", "Maybe later")}
				</Button>
				<Button
					onClick={handleClone}
					disabled={selected.size === 0 || cloneMutation.isPending}
					className="h-[44px]"
				>
					{cloneMutation.isPending && (
						<Loader2 className="h-4 w-4 me-2 animate-spin" />
					)}
					{cloneMutation.isPending
						? t("share.claim.adding", "Adding...")
						: t("share.claim.add", "Add {{count}} monitors", {
								count: selected.size,
							})}
				</Button>
			</div>
		</SectionCard>
		</>
	);
}
