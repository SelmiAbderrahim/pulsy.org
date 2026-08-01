import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateUptimeMonitor } from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import { extractNameFromUrl } from "@/lib/uptime/extract-name";

interface MonitorQuickAddProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function MonitorQuickAdd({ open, onOpenChange }: MonitorQuickAddProps) {
	const { t } = useTranslation("uptimeMonitor");
	const createMutation = useCreateUptimeMonitor();
	const navigate = useNavigate();

	const [url, setUrl] = useState("");
	const [name, setName] = useState("");

	const defaultInterval = 300;

	const autoName = extractNameFromUrl(url);
	const effectiveName = name.trim() || autoName;

	const resetForm = () => {
		setUrl("");
		setName("");
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!effectiveName) return;

		try {
			const created = await createMutation.mutateAsync({
				name: effectiveName,
				url,
				method: "GET",
				expectedStatus: 200,
				timeout: 10000,
				interval: defaultInterval,
				failureThreshold: 3,
			});
			toast.success(t("create.success", "Monitor created successfully"), {
				action: {
					label: t("quickAdd.setupNotifications", "Set up notifications"),
					onClick: () => {
						navigate({
							to: "/dashboard/uptime/$monitorId",
							params: { monitorId: created.uptimeMonitorId },
							search: { tab: "notifications" },
						});
					},
				},
			});
			resetForm();
			onOpenChange(false);
		} catch (error) {
			toast.error(extractErrorMessage(error, t("create.error", "Failed to create monitor")));
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[440px]">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>
							{t("quickAdd.title", "Quick Add Monitor")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"quickAdd.description",
								"Add a monitor with sensible defaults. Customize settings later.",
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="quick-url">
								{t("create.fields.url", "URL")}
							</Label>
							<Input
								id="quick-url"
								type="url"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder={t(
									"quickAdd.urlPlaceholder",
									"https://example.com/health",
								)}
								required
								autoFocus
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="quick-name">
								{t("create.fields.name", "Name")}
							</Label>
							<Input
								id="quick-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={
									autoName ||
									t("quickAdd.namePlaceholder", "Auto-generated from URL")
								}
							/>
						</div>

						<p className="text-xs text-muted-foreground">
							{t("quickAdd.defaultsWithInterval", {
								defaultValue: "Checks every {{interval}} | Method: GET | Expect: 200",
								interval: t(`intervals.${defaultInterval}`, `${defaultInterval}s`),
							})}
							<br />
							{t(
								"quickAdd.changeDefaults",
								"Change defaults in Settings tab after adding",
							)}
						</p>
					</div>

					<DialogFooter className="border-t pt-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							className="h-[44px] w-full sm:w-auto"
						>
							{t("actions.cancel", "Cancel")}
						</Button>
						<Button
							type="submit"
							disabled={createMutation.isPending || !effectiveName}
							className="h-[44px] w-full sm:w-auto"
						>
							{createMutation.isPending && (
								<Loader2 className="h-4 w-4 me-2 animate-spin" />
							)}
							{t("quickAdd.submit", "Add Monitor")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
