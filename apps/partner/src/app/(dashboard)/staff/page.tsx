"use client";

import { useMemo, useState } from "react";
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  Mail,
  ShieldCheck,
  KeyRound,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  usePartnerStaff,
  useCreatePartnerStaff,
  useUpdatePartnerStaff,
  useDeletePartnerStaff,
  type StaffMember,
  type StaffPermissions,
} from "@/lib/partner-queries";

// Human labels for the permission keys returned by the API.
const PERMISSION_LABELS: Record<string, string> = {
  dashboard: "Ümumi baxış",
  bookings: "Rezervasiyalar",
  manual_booking: "Əl ilə rezervasiya",
  calendar: "Təqvim",
  courts: "Kortlar",
  maintenance: "Texniki xidmət",
  customers: "Müştərilər",
  reviews: "Rəylər",
  reports: "Hesabatlar",
  tournaments: "Turnirlər",
  staff: "İşçi idarəetməsi",
  venue_settings: "Məkan ayarları",
  revenue: "Gəlir hesabatı",
};

function permLabel(key: string): string {
  return PERMISSION_LABELS[key] ?? key;
}

function RowSkeleton(): React.JSX.Element {
  const widths = ["w-32", "w-40", "w-24", "w-24", "w-16"];
  return (
    <TableRow className="hover:bg-transparent">
      {widths.map((w, i) => (
        <TableCell key={i} className={i === widths.length - 1 ? "text-right" : ""}>
          <div
            className={`h-4 ${w} animate-pulse rounded bg-surfaceElevated ${
              i === widths.length - 1 ? "ml-auto" : ""
            }`}
          />
        </TableCell>
      ))}
    </TableRow>
  );
}

export default function StaffPage(): React.JSX.Element {
  const toast = useToast();
  const { data, isLoading, isError, refetch, isFetching } = usePartnerStaff();

  const staff = useMemo(() => data?.items ?? [], [data]);
  const permissionOptions = useMemo(
    () => data?.permission_options ?? Object.keys(PERMISSION_LABELS),
    [data],
  );

  const createMut = useCreatePartnerStaff();
  const updateMut = useUpdatePartnerStaff();
  const deleteMut = useDeletePartnerStaff();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StaffMember | null>(null);

  // Form fields
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [staffTitle, setStaffTitle] = useState("");
  const [permissions, setPermissions] = useState<StaffPermissions>({});

  const openNew = (): void => {
    setEditing(null);
    setEmail("");
    setDisplayName("");
    setPassword("");
    setStaffTitle("");
    const base: StaffPermissions = {};
    for (const key of permissionOptions) base[key] = false;
    setPermissions(base);
    setFormOpen(true);
  };

  const openEdit = (member: StaffMember): void => {
    setEditing(member);
    setEmail(member.email);
    setDisplayName(member.display_name);
    setPassword("");
    setStaffTitle(member.staff_title ?? "");
    const base: StaffPermissions = {};
    for (const key of permissionOptions) {
      base[key] = Boolean(member.staff_permissions?.[key]);
    }
    setPermissions(base);
    setFormOpen(true);
  };

  const togglePermission = (key: string): void => {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!displayName.trim()) {
      toast.error("Form xətası", "Ad sahəsi məcburidir.");
      return;
    }
    try {
      if (editing) {
        await updateMut.mutateAsync({
          id: editing.id,
          data: {
            display_name: displayName.trim(),
            staff_title: staffTitle.trim() || null,
            staff_permissions: permissions,
            ...(password ? { password } : {}),
          },
        });
        toast.success("İşçi yeniləndi", `${displayName} uğurla yeniləndi.`);
      } else {
        if (!email.trim() || !password) {
          toast.error("Form xətası", "E-poçt və şifrə məcburidir.");
          return;
        }
        if (password.length < 8) {
          toast.error("Form xətası", "Şifrə ən azı 8 simvol olmalıdır.");
          return;
        }
        await createMut.mutateAsync({
          email: email.trim().toLowerCase(),
          display_name: displayName.trim(),
          password,
          staff_title: staffTitle.trim() || null,
          staff_permissions: permissions,
        });
        toast.success("İşçi yaradıldı", `${displayName} uğurla əlavə edildi.`);
      }
      setFormOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat baş tutmadı", message || "Xəta baş verdi.");
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteMut.mutateAsync(target.id);
      toast.success("İşçi deaktiv edildi", `${target.display_name} deaktiv edildi.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat baş tutmadı", message || "Silmək mümkün olmadı.");
    }
  };

  const handleRestore = async (member: StaffMember): Promise<void> => {
    try {
      await updateMut.mutateAsync({ id: member.id, data: { restore: true } });
      toast.success("Bərpa edildi", `${member.display_name} yenidən aktivləşdirildi.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat baş tutmadı", message || "Bərpa mümkün olmadı.");
    }
  };

  const showEmpty = !isLoading && !isError && staff.length === 0;
  const saving = createMut.isPending || updateMut.isPending;
  const activeCount = staff.filter((s) => !s.deleted_at).length;

  return (
    <div className="space-y-7">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
              <Users className="h-[18px] w-[18px]" />
            </span>
            <h1 className="font-display text-[1.6rem] font-bold text-foreground">
              İşçilər
            </h1>
          </div>
          <p className="max-w-xl text-sm text-foregroundMuted">
            Ön masa və idarəetmə işçilərini əlavə edin, onların icazələrini idarə
            edin. Hər işçi yalnız ona icazə verilmiş bölmələrə daxil ola bilər.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" />
          İşçi Əlavə Et
        </Button>
      </header>

      {/* Table */}
      <Card className="overflow-hidden p-0 shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">İşçi Siyahısı</h2>
            {!isLoading && staff.length > 0 ? (
              <Badge variant="neutral" className="tabular-nums">
                {activeCount} aktiv
              </Badge>
            ) : null}
          </div>
        </div>

        {isError ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10 ring-1 ring-danger/15">
              <AlertCircle className="h-7 w-7 text-danger" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-base font-bold text-foreground">
                İşçilər yüklənmədi
              </h3>
              <p className="mx-auto max-w-sm text-sm text-foregroundMuted">
                İşçi siyahısını almaq mümkün olmadı. Yenidən cəhd edin.
              </p>
            </div>
            <Button variant="secondary" onClick={() => refetch()} disabled={isFetching} className="gap-2">
              <RotateCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Yenidən cəhd et
            </Button>
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/15">
              <Users className="h-7 w-7 text-accent" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-base font-bold text-foreground">
                Hələ işçi yoxdur
              </h3>
              <p className="mx-auto max-w-sm text-sm text-foregroundMuted">
                Məkanınızı idarə etmək üçün ön masa işçiləri əlavə edə bilərsiniz.
              </p>
            </div>
            <Button onClick={openNew} className="gap-2">
              <Plus className="h-4 w-4" />
              İlk İşçini Əlavə Et
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">İşçi</TableHead>
                <TableHead>E-poçt</TableHead>
                <TableHead>Vəzifə</TableHead>
                <TableHead>İcazələr</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">Əməliyyatlar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              ) : (
                staff.map((member) => {
                  const grantedCount = Object.values(
                    member.staff_permissions ?? {},
                  ).filter(Boolean).length;
                  const isDeleted = Boolean(member.deleted_at);
                  return (
                    <TableRow key={member.id} className="group">
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surfaceElevated text-[13px] font-bold text-accent ring-1 ring-border">
                            {member.display_name.charAt(0).toUpperCase()}
                          </span>
                          <span className="font-semibold text-foreground">
                            {member.display_name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm text-foregroundMuted">
                          <Mail className="h-3.5 w-3.5" />
                          {member.email}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-foregroundMuted">
                        {member.staff_title ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="info" className="tabular-nums">
                          {grantedCount} icazə
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isDeleted ? (
                          <Badge variant="danger">Deaktiv</Badge>
                        ) : (
                          <Badge variant="success">Aktiv</Badge>
                        )}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <div className="flex justify-end gap-1.5 opacity-70 transition-opacity group-hover:opacity-100">
                          {isDeleted ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRestore(member)}
                              disabled={updateMut.isPending}
                              className="gap-1.5 text-foregroundMuted hover:text-foreground"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Bərpa et
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(member)}
                                className="h-8 w-8 text-foregroundMuted hover:text-foreground"
                                aria-label="Redaktə et"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setConfirmDelete(member)}
                                className="h-8 w-8 text-foregroundMuted hover:bg-danger/10 hover:text-danger"
                                aria-label="Deaktiv et"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Add / Edit dialog */}
      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? "İşçini Redaktə Et" : "Yeni İşçi Əlavə Et"}
        description={
          editing
            ? "İşçinin məlumatlarını və icazələrini yeniləyin."
            : "Yeni işçi hesabı yaradın və ona lazımi icazələri verin."
        }
        contentClassName="max-w-xl"
      >
        <form onSubmit={handleSave} className="space-y-4 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="staff-name">Ad Soyad</Label>
              <Input
                id="staff-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Məs. Aysel Məmmədova"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-title">Vəzifə (istəyə bağlı)</Label>
              <Input
                id="staff-title"
                value={staffTitle}
                onChange={(e) => setStaffTitle(e.target.value)}
                placeholder="Məs. Ön masa"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="staff-email">E-poçt</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
              <Input
                id="staff-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@linkfit.az"
                className="pl-9"
                disabled={Boolean(editing)}
                required={!editing}
              />
            </div>
            {editing ? (
              <p className="text-[10px] italic text-foregroundMuted/80">
                E-poçt ünvanı dəyişdirilə bilməz.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="staff-password">
              {editing ? "Yeni şifrə (boş buraxsanız dəyişməz)" : "Şifrə"}
            </Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
              <Input
                id="staff-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ən azı 8 simvol"
                className="pl-9"
                autoComplete="new-password"
                required={!editing}
              />
            </div>
          </div>

          {/* Permission matrix */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" />
              İcazələr
            </Label>
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-surfaceElevated/40 p-3 sm:grid-cols-2">
              {permissionOptions.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surfaceElevated"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(permissions[key])}
                    onChange={() => togglePermission(key)}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  <span className="text-foreground">{permLabel(key)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFormOpen(false)}
            >
              Ləğv et
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? "Gözləyin..." : "Yadda Saxla"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => (open ? null : setConfirmDelete(null))}
        title="İşçinin Deaktiv Edilməsi"
      >
        <div className="space-y-5 pt-2">
          <div className="flex gap-3 rounded-xl border border-danger/25 bg-danger/[0.06] p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
              <Trash2 className="h-[18px] w-[18px]" />
            </span>
            <p className="text-sm leading-relaxed text-foregroundMuted">
              <span className="font-semibold text-foreground">
                {confirmDelete?.display_name}
              </span>{" "}
              işçisini deaktiv etməyə əminsiniz? Bu hesab artıq panele daxil ola
              bilməyəcək, lakin sonradan bərpa edə bilərsiniz.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(null)}
              disabled={deleteMut.isPending}
            >
              Ləğv et
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Gözləyin..." : "Bəli, deaktiv et"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
