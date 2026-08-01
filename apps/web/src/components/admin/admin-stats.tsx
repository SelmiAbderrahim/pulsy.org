/**
 * Admin overview — aggregate platform stats.
 *
 * @module components/admin/admin-stats
 */

import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminStats } from "@/hooks/admin/useAdmin";

function StatCard({ label, value }: { label: string; value: string | number }) {
	return (
		<Card className="shadow-xs">
			<CardHeader className="pb-2">
				<CardTitle className="text-sm font-medium text-muted-foreground">
					{label}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-2xl font-semibold">{value}</p>
			</CardContent>
		</Card>
	);
}

export function AdminStats() {
	const { t } = useTranslation("admin");
	const { data, isLoading, isError } = useAdminStats();

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (isError || !data) {
		return (
			<p className="py-8 text-center text-sm text-muted-foreground">
				{t("common.loadError")}
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
				<StatCard label={t("stats.totalUsers")} value={data.users.total} />
				<StatCard label={t("stats.newUsers")} value={data.users.new30d} />
				<StatCard label={t("stats.bannedUsers")} value={data.users.banned} />
				<StatCard
					label={t("stats.superadmins")}
					value={data.users.superadmins}
				/>
				<StatCard
					label={t("stats.totalMonitors")}
					value={data.monitors.total}
				/>
				<StatCard
					label={t("stats.activeMonitors")}
					value={data.monitors.active}
				/>
			</div>

			<Card className="shadow-xs">
				<CardHeader>
					<CardTitle className="text-base">{t("stats.byStatus")}</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					{data.monitors.byStatus.map((row) => (
						<div
							key={row.status}
							className="flex items-center justify-between text-sm"
						>
							<span className="text-muted-foreground">
								{t(`monitorStatus.${row.status}`, row.status)}
							</span>
							<span className="font-medium">{row.count}</span>
						</div>
					))}
				</CardContent>
			</Card>
		</div>
	);
}
