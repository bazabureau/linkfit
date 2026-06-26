"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, Rocket, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useAdminUsers,
  useRestoreUser,
  useSoftDeleteUser,
  useSuspendUser,
  useUnsuspendUser,
  useUpdateUserRole,
  useUpdateUserVerification,
  useUpdateUserVip,
  useUpdateUserVerifiedBadge,
  useUpdateUserAmbassador,
  useUpdateUserMembership,
  type User,
} from "@/lib/admin-queries";
import { StatCards } from "./StatCards";
import { UserFilters, type UserFilterState } from "./UserFilters";
import { UsersTable, type UserRowActions } from "./UsersTable";
import { UserDetailDrawer } from "./UserDetailDrawer";
import { DeleteDialog, SuspendDialog, VipDialog, MembershipDialog } from "./dialogs";
import { CreateUserDialog } from "./CreateUserDialog";
import { PAGE_SIZE, toDateInputValue, type MutableAdminRole } from "./lib";

const INITIAL_FILTERS: UserFilterState = {
  q: "",
  role: "all",
  status: "all",
  verification: "all",
  vip: "all",
};

export default function UsersPage(): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();

  const [filters, setFilters] = React.useState<UserFilterState>(INITIAL_FILTERS);
  const [searchInput, setSearchInput] = React.useState("");
  const [offset, setOffset] = React.useState(0);

  // Drawer + dialog state.
  const [drawerUser, setDrawerUser] = React.useState<User | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [deleteFor, setDeleteFor] = React.useState<User | null>(null);
  const [suspendFor, setSuspendFor] = React.useState<User | null>(null);
  const [suspendReason, setSuspendReason] = React.useState("");
  const [vipFor, setVipFor] = React.useState<User | null>(null);
  const [vipLabel, setVipLabel] = React.useState("VIP");
  const [vipExpiresAt, setVipExpiresAt] = React.useState("");
  const [membershipFor, setMembershipFor] = React.useState<User | null>(null);
  const [membershipTier, setMembershipTier] = React.useState<"free" | "premium">("premium");
  const [membershipMonths, setMembershipMonths] = React.useState("1");
  const [createOpen, setCreateOpen] = React.useState(false);

  // Debounce the free-text search into the applied filter (250ms).
  React.useEffect(() => {
    const id = setTimeout(() => {
      setFilters((current) => ({ ...current, q: searchInput.trim() }));
    }, 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Any filter change resets to the first page.
  React.useEffect(() => {
    setOffset(0);
  }, [filters]);

  const params = React.useMemo(
    () => ({
      q: filters.q || undefined,
      role: filters.role,
      status: filters.status,
      verification: filters.verification,
      vip: filters.vip,
      limit: PAGE_SIZE,
      offset,
    }),
    [filters, offset],
  );

  const { data, isLoading, isError, isFetching, refetch } = useAdminUsers(params);
  const users = React.useMemo(() => data?.results ?? [], [data]);
  const total = data?.count ?? 0;
  const summary = data?.summary;

  // Keep an open drawer in sync with the freshest list row.
  React.useEffect(() => {
    if (!drawerUser) return;
    const fresh = users.find((u) => u.id === drawerUser.id);
    if (fresh && fresh !== drawerUser) setDrawerUser(fresh);
  }, [users, drawerUser]);

  const updateRole = useUpdateUserRole({
    onSuccess: () => toast.success(t("Rol yeniləndi")),
    onError: () => toast.error(t("Rol yenilənmədi")),
  });
  const updateVerification = useUpdateUserVerification({
    onSuccess: () => toast.success(t("Email statusu yeniləndi")),
    onError: () => toast.error(t("Email statusu yenilənmədi")),
  });
  const updateVip = useUpdateUserVip({
    onSuccess: () => toast.success(t("VIP badge yeniləndi")),
    onError: () => toast.error(t("VIP badge yenilənmədi")),
  });
  const updateVerifiedBadge = useUpdateUserVerifiedBadge({
    onSuccess: () => toast.success(t("Təsdiq nişanı yeniləndi")),
    onError: () => toast.error(t("Təsdiq nişanı yenilənmədi")),
  });
  const updateAmbassador = useUpdateUserAmbassador({
    onSuccess: () => toast.success(t("Ambassador statusu yeniləndi")),
    onError: () => toast.error(t("Ambassador statusu yenilənmədi")),
  });
  const updateMembership = useUpdateUserMembership({
    onSuccess: () => toast.success(t("Üzvlük yeniləndi")),
    onError: () => toast.error(t("Üzvlük yenilənmədi")),
  });
  const suspend = useSuspendUser({
    onSuccess: () => toast.success(t("İstifadəçi bloklandı")),
    onError: () => toast.error(t("Bloklama alınmadı")),
  });
  const unsuspend = useUnsuspendUser({
    onSuccess: () => toast.success(t("Blok aradan qaldırıldı")),
    onError: () => toast.error(t("Blok aradan qaldırılmadı")),
  });
  const softDelete = useSoftDeleteUser({
    onSuccess: () => toast.success(t("İstifadəçi silindi")),
    onError: () => toast.error(t("İstifadəçi silinmədi")),
  });
  const restore = useRestoreUser({
    onSuccess: () => toast.success(t("İstifadəçi bərpa edildi")),
    onError: () => toast.error(t("Bərpa alınmadı")),
  });

  function updateFilters(patch: Partial<UserFilterState>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function resetFilters() {
    setSearchInput("");
    setFilters(INITIAL_FILTERS);
  }

  function openDrawer(user: User) {
    setDrawerUser(user);
    setDrawerOpen(true);
  }

  const actions = React.useMemo<UserRowActions>(
    () => ({
      onOpenDetail: openDrawer,
      onChangeRole: (user: User, role: MutableAdminRole) =>
        updateRole.mutate({ id: user.id, role }),
      onToggleVerification: (user: User) =>
        updateVerification.mutate({ id: user.id, verified: !user.email_is_verified }),
      onToggleVerifiedBadge: (user: User) =>
        updateVerifiedBadge.mutate({ id: user.id, is_verified: !user.is_verified }),
      onToggleAmbassador: (user: User) =>
        updateAmbassador.mutate({ id: user.id, is_ambassador: !user.is_ambassador }),
      onOpenVip: (user: User) => {
        setVipFor(user);
        setVipLabel(user.vip_badge_label || "VIP");
        setVipExpiresAt(toDateInputValue(user.vip_expires_at));
      },
      onDisableVip: (user: User) => updateVip.mutate({ id: user.id, is_vip: false }),
      onOpenMembership: (user: User) => {
        setMembershipFor(user);
        setMembershipTier(user.membership_tier === "premium" ? "premium" : "free");
        setMembershipMonths("1");
      },
      onOpenSuspend: (user: User) => {
        setSuspendFor(user);
        setSuspendReason(user.suspension_reason || "");
      },
      onUnsuspend: (user: User) => unsuspend.mutate({ id: user.id }),
      onSoftDelete: (user: User) => setDeleteFor(user),
      onRestore: (user: User) => restore.mutate({ id: user.id }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateRole, updateVerification, updateVip, updateVerifiedBadge, updateAmbassador, updateMembership, unsuspend, restore],
  );

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold   text-accent">
            {t("İdarəetmə")}
          </p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold  text-foreground">
            <Users className="h-6 w-6 text-accent" />
            {t("İstifadəçilər")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("İstifadəçiləri, rolları və hesab statusunu idarə edin.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary">
            <Link href="/users/launch-waitlist">
              <Rocket className="h-4 w-4" />
              {t("Launch siyahısı")}
            </Link>
          </Button>
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Yenilə")}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4" />
            {t("Yeni istifadəçi")}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <StatCards summary={summary} loading={isLoading && !summary} />

      {/* Filters */}
      <UserFilters
        value={filters}
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onChange={updateFilters}
        onReset={resetFilters}
        refreshing={isFetching && !isLoading}
      />

      {/* Table card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold text-foreground">
              {t("İstifadəçi siyahısı")}
            </h2>
            <p className="text-xs text-foregroundMuted">
              {total === 0
                ? `0 ${t("göstərilir")}`
                : `${rangeStart}–${rangeEnd} / ${total}`}
            </p>
          </div>
          {isFetching && !isLoading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">
              <RefreshCw className="h-3 w-3 animate-spin" />
              {t("Yenilənir")}
            </span>
          ) : null}
        </div>

        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10">
              <Users className="h-7 w-7 text-danger" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-danger">
                {t("Yükləmə xətası")}
              </h3>
              <p className="mt-1 max-w-xs text-sm text-foregroundMuted">
                {t("Şəbəkəni və admin sessiyasını yoxlayın, sonra yenidən cəhd edin.")}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="h-4 w-4" />
              {t("Yenidən cəhd et")}
            </Button>
          </div>
        ) : (
          <UsersTable users={users} loading={isLoading} actions={actions} />
        )}

        {!isError && total > PAGE_SIZE ? (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-5 py-3 sm:flex-row">
            <p className="text-sm text-foregroundMuted">
              {t("Səhifə")}{" "}
              <span className="font-semibold text-foreground">{page}</span> / {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!canPrev || isFetching}
                onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              >
                <ChevronLeft className="h-4 w-4" />
                {t("Əvvəlki")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canNext || isFetching}
                onClick={() => setOffset((current) => current + PAGE_SIZE)}
              >
                {t("Növbəti")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Detail slide-over */}
      <UserDetailDrawer
        user={drawerUser}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        actions={actions}
      />

      {/* Dialogs */}
      <DeleteDialog
        user={deleteFor}
        onOpenChange={(open) => !open && setDeleteFor(null)}
        onConfirm={() => {
          if (!deleteFor) return;
          softDelete.mutate({ id: deleteFor.id });
          setDeleteFor(null);
        }}
      />

      <SuspendDialog
        user={suspendFor}
        reason={suspendReason}
        onReasonChange={setSuspendReason}
        onOpenChange={(open) => !open && setSuspendFor(null)}
        onConfirm={() => {
          if (!suspendFor) return;
          const reason = suspendReason.trim();
          if (reason.length < 2) {
            toast.error(t("Blok səbəbi yazılmalıdır"));
            return;
          }
          suspend.mutate({ id: suspendFor.id, reason });
          setSuspendFor(null);
          setSuspendReason("");
        }}
      />

      <VipDialog
        user={vipFor}
        label={vipLabel}
        expiresAt={vipExpiresAt}
        onLabelChange={setVipLabel}
        onExpiresAtChange={setVipExpiresAt}
        onOpenChange={(open) => !open && setVipFor(null)}
        onConfirm={() => {
          if (!vipFor) return;
          updateVip.mutate({
            id: vipFor.id,
            is_vip: true,
            vip_badge_label: vipLabel.trim() || "VIP",
            vip_expires_at: vipExpiresAt ? new Date(vipExpiresAt).toISOString() : null,
          });
          setVipFor(null);
        }}
      />

      <MembershipDialog
        user={membershipFor}
        tier={membershipTier}
        months={membershipMonths}
        onTierChange={setMembershipTier}
        onMonthsChange={setMembershipMonths}
        onOpenChange={(open) => !open && setMembershipFor(null)}
        onConfirm={() => {
          if (!membershipFor) return;
          updateMembership.mutate({
            id: membershipFor.id,
            tier: membershipTier,
            months: membershipTier === "free" ? undefined : Math.max(1, Number(membershipMonths) || 1),
          });
          setMembershipFor(null);
        }}
      />

      {/* Create user */}
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
