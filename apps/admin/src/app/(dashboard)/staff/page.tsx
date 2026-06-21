"use client";

import * as React from "react";
import { Loader2, Pencil, Plus, Trash2, Undo2, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  STAFF_PERMISSION_KEYS,
  useCreateStaffAccount,
  useDeleteStaffAccount,
  useStaffAccounts,
  useUpdateStaffAccount,
  type CreateStaffPayload,
  type StaffAccount,
  type StaffPermissionKey,
  type StaffPermissions,
  type StaffRole,
  type UpdateStaffPayload,
} from "@/lib/admin-staff";

const selectCls =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none";

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("az-AZ", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

export default function StaffPage(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: staff = [], isLoading } = useStaffAccounts();
  const update = useUpdateStaffAccount();
  const del = useDeleteStaffAccount();
  const [dialog, setDialog] = React.useState<{ open: boolean; account?: StaffAccount }>({ open: false });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("İdarəetmə")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <UserCog className="h-6 w-6 text-accent" />
            {t("Staff")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">{t("Admin and moderator accounts with scoped permissions.")}</p>
        </div>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4" />
          {t("New staff account")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Name")}</TableHead>
              <TableHead>{t("Email")}</TableHead>
              <TableHead>{t("Role")}</TableHead>
              <TableHead>{t("Permissions")}</TableHead>
              <TableHead>{t("Created")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : staff.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("No staff accounts")}</TableCell></TableRow>
            ) : (
              staff.map((account) => {
                const granted = STAFF_PERMISSION_KEYS.filter((k) => account.staff_permissions[k]).length;
                return (
                  <TableRow key={account.id} className={account.deleted_at ? "opacity-60" : undefined}>
                    <TableCell className="font-semibold text-foreground">
                      {account.display_name}
                      {account.staff_title && <span className="ml-1.5 text-xs text-foregroundMuted">· {account.staff_title}</span>}
                    </TableCell>
                    <TableCell className="text-foregroundMuted">{account.email}</TableCell>
                    <TableCell>
                      <Badge variant={account.admin_role === "admin" ? "success" : "info"}>{t(account.admin_role)}</Badge>
                    </TableCell>
                    <TableCell className="text-foregroundMuted">
                      {account.admin_role === "admin" ? t("Full access") : `${granted}/${STAFF_PERMISSION_KEYS.length}`}
                    </TableCell>
                    <TableCell className="text-foregroundMuted">{dt(account.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, account })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {account.deleted_at ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              update.mutate(
                                { id: account.id, data: { restore: true } },
                                { onSuccess: () => toast.success(t("Staff account restored")), onError: () => toast.error(t("Alınmadı")) },
                              )
                            }
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              del.mutate(account.id, {
                                onSuccess: () => toast.success(t("Staff account removed")),
                                onError: (err) => toast.error(t("Alınmadı"), err.message),
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5 text-danger" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {dialog.open && <StaffDialog account={dialog.account} onClose={() => setDialog({ open: false })} />}
    </div>
  );
}

function defaultPermissions(role: StaffRole): StaffPermissions {
  const admin = role === "admin";
  return {
    dashboard: true,
    users: admin,
    staff: admin,
    venues: true,
    courts: true,
    bookings: true,
    games: true,
    tournaments: true,
    reports: true,
    reviews: true,
    operations: admin,
    media: true,
    push_jobs: admin,
    revenue: admin,
  };
}

function StaffDialog({ account, onClose }: { account?: StaffAccount; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const create = useCreateStaffAccount();
  const update = useUpdateStaffAccount();
  const editing = Boolean(account);
  const pending = create.isPending || update.isPending;

  const [form, setForm] = React.useState({
    email: account?.email ?? "",
    display_name: account?.display_name ?? "",
    staff_title: account?.staff_title ?? "",
    password: "",
    role: (account?.admin_role ?? "moderator") as StaffRole,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const [permissions, setPermissions] = React.useState<StaffPermissions>(
    account?.staff_permissions ?? defaultPermissions(account?.admin_role ?? "moderator"),
  );
  const togglePerm = (key: StaffPermissionKey) =>
    setPermissions((p) => ({ ...p, [key]: !p[key] }));

  function onRoleChange(role: StaffRole) {
    set("role", role);
    // Reset to that role's defaults when switching, mirroring backend behavior.
    setPermissions(defaultPermissions(role));
  }

  function submit() {
    const email = form.email.trim().toLowerCase();
    if (!email.includes("@")) {
      toast.error(t("Enter a valid email"));
      return;
    }
    if (form.display_name.trim().length < 1) {
      toast.error(t("Name is required"));
      return;
    }
    if (!editing && form.password.length < 12) {
      toast.error(t("Password must be at least 12 characters"));
      return;
    }

    const opts = {
      onSuccess: () => {
        toast.success(editing ? t("Staff account updated") : t("Staff account created"));
        onClose();
      },
      onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
    };

    if (editing && account) {
      const data: UpdateStaffPayload = {
        email,
        display_name: form.display_name.trim(),
        staff_title: form.staff_title.trim() || null,
        role: form.role,
        staff_permissions: permissions,
      };
      if (form.password.length > 0) data.password = form.password;
      update.mutate({ id: account.id, data }, opts);
    } else {
      const payload: CreateStaffPayload = {
        email,
        display_name: form.display_name.trim(),
        password: form.password,
        role: form.role,
        staff_title: form.staff_title.trim() || null,
        staff_permissions: permissions,
      };
      create.mutate(payload, opts);
    }
  }

  const isAdminRole = form.role === "admin";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit staff account") : t("New staff account")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3.5 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Name")}</span>
              <Input value={form.display_name} onChange={(e) => set("display_name", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Title")}</span>
              <Input value={form.staff_title} onChange={(e) => set("staff_title", e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Email")}</span>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Role")}</span>
              <select className={selectCls} value={form.role} onChange={(e) => onRoleChange(e.target.value as StaffRole)}>
                <option value="moderator">{t("moderator")}</option>
                <option value="admin">{t("admin")}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">
                {editing ? t("New password (optional)") : t("Password")}
              </span>
              <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder={t("min 12 chars")} />
            </label>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Permissions")}</span>
            {isAdminRole ? (
              <p className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-foregroundMuted">
                {t("Admins have full access to every module.")}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {STAFF_PERMISSION_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-foreground">
                    <input type="checkbox" checked={permissions[key]} onChange={() => togglePerm(key)} />
                    <span className="capitalize">{key.replace(/_/g, " ")}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>{t("Ləğv")}</Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? t("Yadda saxla") : t("Yarat")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
