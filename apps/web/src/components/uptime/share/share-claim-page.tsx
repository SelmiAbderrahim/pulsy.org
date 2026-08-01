/**
 * Share claim page content.
 *
 * Resolves a share token and lets the (authenticated) recipient pick which of
 * the shared monitors to clone into their own account. Rendered by the public
 * /share/$token route once a session exists.
 *
 * @module components/uptime/share/share-claim-page
 */

import { useNavigate } from "@tanstack/react-router";
import { Loader2, Link2Off } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
} from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";

interface ShareClaimPageProps {
	token: string;
}

export function ShareClaimPage({ token }: ShareClaimPageProps) {
	const { t } = useTranslation("uptimeMonitor");
	const navigate = useNavigate();
	const { data, isLoading, error } = useResolveShareLink(token);
	const cloneMutation = useCloneSharedMonitors();
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const monitors = data?.monitors ?? [];

	// Pre-select every shared monitor once the link resolves.
	useEffect(() => {
		if (data) {
			setSelected(new Set(data.monitors.map((m) => m.uptimeMonitorId)));
		}
	}, [data]);

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

	const allSelected = monitors.length > 0 && selected.size === monitors.length;

	const toggleAll = () => {
		setSelected(
			allSelected
				? new Set()
				: new Set(monitors.map((m) => m.uptimeMonitorId)),
		);
	};

	const handleClone = async () => {
		try {
			const cloned = await cloneMutation.mutateAsync({
				token,
				uptimeMonitorIds: Array.from(selected),
			});
			toast.success(
				t("share.claim.success", "Added {{count}} monitors", {
					count: cloned.length,
				}),
			);
			goToDashboard();
		} catch (err) {
			toast.error(
				extractErrorMessage(
					err,
					t("share.claim.error", "Failed to add monitors"),
				),
			);
		}
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
				<CardHeader className="text-center">
					<div className="flex justify-center">
						<Link2Off className="h-8 w-8 text-muted-foreground" />
					</div>
					<CardTitle className="text-lg">
						{t("share.claim.unavailableTitle", "Link unavailable")}
					</CardTitle>
					<CardDescription>
						{extractErrorMessage(
							error,
							t("share.claim.error", "Failed to add monitors"),
						)}
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
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">
					{data.sharedBy
						? t("share.claim.title", "{{name}} shared monitors with you", {
								name: data.sharedBy,
							})
						: t(
								"share.claim.titleAnonymous",
								"Someone shared monitors with you",
							)}
				</CardTitle>
				<CardDescription>
					{t(
						"share.claim.description",
						"Choose which monitors to add to your account. They start fresh with no history.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<div className="flex min-h-[44px] items-center gap-2">
					<SelectableCheckbox
						checked={allSelected}
						onChange={toggleAll}
						label={t("share.claim.selectAll", "Select all")}
					/>
					<span className="text-sm font-medium">
						{t("share.claim.selectAll", "Select all")}
					</span>
				</div>
				{monitors.map((monitor) => (
					<div
						key={monitor.uptimeMonitorId}
						className="flex min-h-[44px] items-center gap-2 rounded-md border py-1 pe-3"
					>
						<SelectableCheckbox
							checked={selected.has(monitor.uptimeMonitorId)}
							onChange={() => toggle(monitor.uptimeMonitorId)}
							label={monitor.name}
						/>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm font-medium">
								{monitor.name}
							</span>
							<span className="block truncate text-xs text-muted-foreground">
								{monitor.url}
							</span>
						</span>
					</div>
				))}
			</CardContent>
			<CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
			</CardFooter>
		</Card>
	);
}
