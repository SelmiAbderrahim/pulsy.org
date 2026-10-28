/**
 * Admin users panel — table with role management, ban/unban, and delete.
 *
 * @module components/admin/admin-users
 */

import { Ban, Loader2, ShieldOff, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
	useAdminUsers,
	useBanUser,
	useDeleteUser,
	useSetUserRole,
	useUnbanUser,
} from "@/hooks/admin/useAdmin";
import type { AdminUserListItem, PlatformRole } from "@/types/admin";

import { AdminPagination } from "./admin-pagination";
import { formatDate } from "./format";

const LIMIT = 25;

export function AdminUsers() {
	const { t, i18n } = useTranslation("admin");
	const [search, setSearch] = useState("");
	const [roleFilter, setRoleFilter] = useState<"all" | PlatformRole>("all");
	const [bannedOnly, setBannedOnly] = useState(false);
	const [offset, setOffset] = useState(0);
	const [banTarget, setBanTarget] = useState<AdminUserListItem | null>(null);
	const [banReason, setBanReason] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<AdminUserListItem | null>(
		null,
	);
	const [deleteConfirm, setDeleteConfirm] = useState("");

	const trimmed = search.trim();
	const { data, isLoading, isError } = useAdminUsers({
		limit: LIMIT,
		offset,
		search: trimmed.length > 0 ? trimmed : undefined,
		role: roleFilter === "all" ? undefined : roleFilter,
		banned: bannedOnly ? true : undefined,
	});

	const setRole = useSetUserRole();
	const ban = useBanUser();
	const unban = useUnbanUser();
	const remove = useDeleteUser();

	const resetPage = () => setOffset(0);

	const handleRoleChange = (userId: string, role: PlatformRole) => {
		setRole.mutate(
			{ userId, role },
			{
				onSuccess: () => toast.success(t("users.toast.roleUpdated")),
				onError: () => toast.error(t("users.toast.error")),
			},
		);
	};

	const confirmBan = () => {
		if (!banTarget) return;
		ban.mutate(
			{ userId: banTarget.id, reason: banReason.trim() || undefined },
			{
				onSuccess: () => {
					toast.success(t("users.toast.banned"));
					setBanTarget(null);
					setBanReason("");
				},
				onError: () => toast.error(t("users.toast.error")),
			},
		);
	};

	const handleUnban = (user: AdminUserListItem) => {
		unban.mutate(user.id, {
			onSuccess: () => toast.success(t("users.toast.unbanned")),
			onError: () => toast.error(t("users.toast.error")),
		});
	};

	const confirmDelete = () => {
		if (!deleteTarget) return;
		remove.mutate(deleteTarget.id, {
			onSuccess: () => {
				toast.success(t("users.toast.deleted"));
				setDeleteTarget(null);
				setDeleteConfirm("");
			},
			onError: () => toast.error(t("users.toast.error")),
		});
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<Input
					value={search}
					onChange={(e) => {
						setSearch(e.target.value);
						resetPage();
					}}
					placeholder={t("common.searchUsers")}
					className="sm:max-w-xs"
				/>
				<Select
					value={roleFilter}
					onValueChange={(v) => {
						setRoleFilter(v as "all" | PlatformRole);
						resetPage();
					}}
				>
					<SelectTrigger className="sm:w-44" aria-label={t("users.filters.role")}>
						<SelectValue placeholder={t("users.filters.role")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">{t("common.all")}</SelectItem>
						<SelectItem value="user">{t("users.roles.user")}</SelectItem>
						<SelectItem value="superadmin">
							{t("users.roles.superadmin")}
						</SelectItem>
					</SelectContent>
				</Select>
				<Button
					variant={bannedOnly ? "default" : "outline"}
					size="sm"
					className="h-[44px]"
					onClick={() => {
						setBannedOnly((v) => !v);
						resetPage();
					}}
				>
					{t("users.filters.banned")}
				</Button>
			</div>

			<div className="overflow-x-auto rounded-lg border">
				<Table className="min-w-[720px]">
					<TableHeader>
						<TableRow>
							<TableHead className="text-start">
								{t("users.columns.email")}
							</TableHead>
							<TableHead className="text-start">
								{t("users.columns.role")}
							</TableHead>
							<TableHead className="text-start hidden md:table-cell">
								{t("users.columns.monitors")}
							</TableHead>
							<TableHead className="text-start hidden lg:table-cell">
								{t("users.columns.joined")}
							</TableHead>
							<TableHead className="text-end">
								{t("common.actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading && (
							<TableRow>
								<TableCell colSpan={5} className="py-10 text-center">
									<Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
								</TableCell>
							</TableRow>
						)}
						{isError && !isLoading && (
							<TableRow>
								<TableCell
									colSpan={5}
									className="py-10 text-center text-sm text-muted-foreground"
								>
									{t("common.loadError")}
								</TableCell>
							</TableRow>
						)}
						{!isLoading &&
							!isError &&
							data?.items.length === 0 && (
								<TableRow>
									<TableCell
										colSpan={5}
										className="py-10 text-center text-sm text-muted-foreground"
									>
										{t("common.empty")}
									</TableCell>
								</TableRow>
							)}
						{data?.items.map((user) => (
							<TableRow key={user.id}>
								<TableCell className="text-start">
									<div className="flex flex-col">
										<span className="font-medium">{user.email}</span>
										<span className="text-xs text-muted-foreground">
											{user.name}
										</span>
									</div>
									<div className="mt-1 flex flex-wrap gap-1">
										{user.banned && (
											<Badge variant="destructive" className="gap-1">
												{t("users.badges.banned")}
											</Badge>
										)}
										<Badge variant="outline">
											{user.emailVerified
												? t("users.badges.verified")
												: t("users.badges.unverified")}
										</Badge>
									</div>
								</TableCell>
								<TableCell className="text-start">
									<Select
										value={user.role}
										onValueChange={(v) =>
											handleRoleChange(user.id, v as PlatformRole)
										}
									>
										<SelectTrigger className="w-36" aria-label={`${t("users.columns.role")}: ${user.email}`}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="user">
												{t("users.roles.user")}
											</SelectItem>
											<SelectItem value="superadmin">
												{t("users.roles.superadmin")}
											</SelectItem>
										</SelectContent>
									</Select>
								</TableCell>
								<TableCell className="text-start hidden md:table-cell">
									{user.monitorCount}
								</TableCell>
								<TableCell className="text-start hidden lg:table-cell text-sm text-muted-foreground">
									{formatDate(user.createdAt, i18n.language)}
								</TableCell>
								<TableCell className="text-end">
									<div className="flex items-center justify-end gap-1">
										{user.banned ? (
											<Button
												variant="ghost"
												size="sm"
												className="h-[44px]"
												onClick={() => handleUnban(user)}
											>
												<Undo2 className="h-4 w-4 me-1 rtl:scale-x-[-1]" />
												<span className="hidden sm:inline">
													{t("users.actions.unban")}
												</span>
											</Button>
										) : (
											<Button
												variant="ghost"
												size="sm"
												className="h-[44px]"
												onClick={() => setBanTarget(user)}
											>
												<Ban className="h-4 w-4 me-1" />
												<span className="hidden sm:inline">
													{t("users.actions.ban")}
												</span>
											</Button>
										)}
										<Button
											variant="ghost"
											size="sm"
											className="h-[44px] text-destructive"
											onClick={() => setDeleteTarget(user)}
										>
											<Trash2 className="h-4 w-4 me-1" />
											<span className="hidden sm:inline">
												{t("users.actions.delete")}
											</span>
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{data && (
				<AdminPagination
					offset={offset}
					limit={LIMIT}
					total={data.total}
					onChange={setOffset}
				/>
			)}

			{/* Ban dialog */}
			<AlertDialog
				open={banTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setBanTarget(null);
						setBanReason("");
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("users.ban.title", { email: banTarget?.email ?? "" })}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t("users.ban.description")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<FormField className="flex flex-col gap-2">
						<Label htmlFor="ban-reason">{t("users.ban.reason")}</Label>
						<Textarea
							id="ban-reason"
							value={banReason}
							onChange={(e) => setBanReason(e.target.value)}
							placeholder={t("users.ban.reasonPlaceholder")}
						/>
					</FormField>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={(e) => {
								e.preventDefault();
								confirmBan();
							}}
							disabled={ban.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							<ShieldOff className="h-4 w-4 me-1" />
							{t("users.ban.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Delete dialog (type-to-confirm) */}
			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteTarget(null);
						setDeleteConfirm("");
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("users.delete.title", { email: deleteTarget?.email ?? "" })}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t("users.delete.description")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<FormField className="flex flex-col gap-2">
						<Label htmlFor="delete-confirm">
							{t("users.delete.confirmLabel")}
						</Label>
						<Input
							id="delete-confirm"
							value={deleteConfirm}
							onChange={(e) => setDeleteConfirm(e.target.value)}
							placeholder={t("users.delete.confirmWord")}
						/>
					</FormField>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={(e) => {
								e.preventDefault();
								confirmDelete();
							}}
							disabled={
								remove.isPending ||
								deleteConfirm.trim().toUpperCase() !==
									t("users.delete.confirmWord")
							}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							<Trash2 className="h-4 w-4 me-1" />
							{t("users.delete.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
