"use client";

import * as React from "react";
import {
  Ban,
  BadgeCheck,
  Crown,
  Eye,
  MailCheck,
  MailQuestion,
  Medal,
  MoreHorizontal,
  RotateCcw,
  Shield,
  Sparkles,
  Trash2,
  UserRound,
  Users as UsersIcon,
  XCircle,
} from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/admin-queries";
import {
  Avatar,
  accountState,
  roleMeta,
  rolePillClass,
  stateMeta,
  type MutableAdminRole,
} from "./lib";

export interface UserRowActions {
  onOpenDetail: (user: User) => void;
  onChangeRole: (user: User, role: MutableAdminRole) => void;
  onToggleVerification: (user: User) => void;
  onToggleVerifiedBadge: (user: User) => void;
  onToggleAmbassador: (user: User) => void;
  onOpenVip: (user: User) => void;
  onDisableVip: (user: User) => void;
  onOpenMembership: (user: User) => void;
  onOpenSuspend: (user: User) => void;
  onUnsuspend: (user: User) => void;
  onSoftDelete: (user: User) => void;
  onRestore: (user: User) => void;
}

const COL_COUNT = 6;

function StatePill({ user }: { user: User }): React.JSX.Element {
  const { t } = useI18n();
  const meta = stateMeta(accountState(user));
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {t(meta.label)}
    </span>
  );
}

function RolePill({ user }: { user: User }): React.JSX.Element {
  const { t } = useI18n();
  const meta = roleMeta(user.admin_role);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${rolePillClass(user.admin_role)}`}
    >
      {user.admin_role && user.admin_role !== "partner" ? (
        <Shield className="h-3 w-3" />
      ) : null}
      {t(meta.label)}
    </span>
  );
}

function MenuButton({
  children,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-foregroundMuted/40"
          : danger
            ? "text-danger hover:bg-danger/10"
            : "text-foreground hover:bg-surface",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {children}
    </button>
  );
}

function RowMenu({
  user,
  actions,
}: {
  user: User;
  actions: UserRowActions;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [above, setAbove] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    function onDocClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isDeleted = Boolean(user.deleted_at);
  const isSuspended = Boolean(user.suspended_at);

  function toggle(event: React.MouseEvent) {
    event.stopPropagation();
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setAbove(window.innerHeight - rect.bottom < 360);
    setOpen((value) => !value);
  }

  function run(fn: () => void) {
    fn();
    setOpen(false);
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={t("İstifadəçi əməliyyatları")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded-lg border border-border text-foregroundMuted transition hover:border-borderStrong hover:bg-surfaceElevated hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "absolute right-0 z-30 w-60 overflow-hidden rounded-xl border border-border bg-surfaceElevated p-1 shadow-lift",
            above ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          <MenuButton icon={Eye} onClick={() => run(() => actions.onOpenDetail(user))}>
            {t("Detallara bax")}
          </MenuButton>
          <MenuButton
            icon={user.email_is_verified ? XCircle : MailCheck}
            disabled={isDeleted}
            onClick={() => run(() => actions.onToggleVerification(user))}
          >
            {user.email_is_verified ? t("Email təsdiqini sil") : t("Email təsdiqlə")}
          </MenuButton>
          {user.is_vip ? (
            <MenuButton
              icon={Medal}
              disabled={isDeleted}
              onClick={() => run(() => actions.onDisableVip(user))}
            >
              {t("VIP badge sil")}
            </MenuButton>
          ) : (
            <MenuButton
              icon={Medal}
              disabled={isDeleted}
              onClick={() => run(() => actions.onOpenVip(user))}
            >
              {t("VIP badge ver")}
            </MenuButton>
          )}
          <MenuButton
            icon={user.is_verified ? XCircle : BadgeCheck}
            disabled={isDeleted}
            onClick={() => run(() => actions.onToggleVerifiedBadge(user))}
          >
            {user.is_verified ? t("Təsdiq nişanını sil") : t("Təsdiqlənmiş et")}
          </MenuButton>
          <MenuButton
            icon={user.is_ambassador ? XCircle : Sparkles}
            disabled={isDeleted}
            onClick={() => run(() => actions.onToggleAmbassador(user))}
          >
            {user.is_ambassador ? t("Ambassador nişanını sil") : t("Ambassador təyin et")}
          </MenuButton>
          <MenuButton
            icon={Crown}
            disabled={isDeleted}
            onClick={() => run(() => actions.onOpenMembership(user))}
          >
            {t("Üzvlük (Premium)")}
          </MenuButton>

          <div className="my-1 border-t border-border" />

          <MenuButton
            icon={Shield}
            disabled={user.admin_role === "admin" || isDeleted}
            onClick={() => run(() => actions.onChangeRole(user, "admin"))}
          >
            {t("Admin et")}
          </MenuButton>
          <MenuButton
            icon={Shield}
            disabled={user.admin_role === "moderator" || isDeleted}
            onClick={() => run(() => actions.onChangeRole(user, "moderator"))}
          >
            {t("Moderator et")}
          </MenuButton>
          <MenuButton
            icon={UserRound}
            disabled={
              user.admin_role === null || user.admin_role === "partner" || isDeleted
            }
            onClick={() => run(() => actions.onChangeRole(user, null))}
          >
            {t("Adi istifadəçi et")}
          </MenuButton>

          <div className="my-1 border-t border-border" />

          {isSuspended ? (
            <MenuButton
              icon={RotateCcw}
              disabled={isDeleted}
              onClick={() => run(() => actions.onUnsuspend(user))}
            >
              {t("Bloku aç")}
            </MenuButton>
          ) : (
            <MenuButton
              icon={Ban}
              danger
              disabled={isDeleted}
              onClick={() => run(() => actions.onOpenSuspend(user))}
            >
              {t("Blokla")}
            </MenuButton>
          )}
          {isDeleted ? (
            <MenuButton icon={RotateCcw} onClick={() => run(() => actions.onRestore(user))}>
              {t("Bərpa et")}
            </MenuButton>
          ) : (
            <MenuButton
              icon={Trash2}
              danger
              onClick={() => run(() => actions.onSoftDelete(user))}
            >
              {t("Sil")}
            </MenuButton>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RowSkeleton(): React.JSX.Element {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: COL_COUNT }).map((_, index) => (
        <td key={index} className="px-4 py-3.5">
          <div
            className="h-4 animate-pulse rounded bg-surfaceElevated"
            style={{ width: `${45 + ((index * 17) % 45)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

export function UsersTable({
  users,
  loading,
  actions,
}: {
  users: User[];
  loading: boolean;
  actions: UserRowActions;
}): React.JSX.Element {
  const { t } = useI18n();
  const headClass =
    "sticky top-0 z-10 h-11 bg-surfaceElevated px-4 text-left align-middle text-[11px] font-semibold   text-foregroundMuted";

  return (
    <div className="w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={`${headClass} rounded-tl-2xl`}>{t("İstifadəçi")}</th>
            <th className={headClass}>{t("Status")}</th>
            <th className={headClass}>{t("Email")}</th>
            <th className={headClass}>{t("Rol")}</th>
            <th className={headClass}>{t("Aktivlik")}</th>
            <th className={`${headClass} rounded-tr-2xl text-right`}>{t("Əməliyyat")}</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            users.map((user, index) => {
              const isDeleted = Boolean(user.deleted_at);
              return (
                <tr
                  key={user.id}
                  onClick={() => actions.onOpenDetail(user)}
                  className={cn(
                    "group cursor-pointer border-b border-border transition-colors",
                    isDeleted && "opacity-60",
                    index % 2 === 1
                      ? "bg-surfaceElevated/40 hover:bg-surfaceElevated"
                      : "bg-surface hover:bg-surfaceElevated/70",
                  )}
                >
                  {/* User */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-[220px] items-center gap-3">
                      <Avatar name={user.display_name} vip={user.is_vip} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold text-foreground group-hover:text-foreground">
                            {user.display_name || t("Adsız istifadəçi")}
                          </span>
                          {user.is_verified ? (
                            <BadgeCheck className="h-4 w-4 shrink-0 text-accent" aria-label={t("Təsdiqlənmiş")} />
                          ) : null}
                          {user.is_premium ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-bold text-accent">
                              <Crown className="h-2.5 w-2.5" />
                              Premium
                            </span>
                          ) : null}
                          {user.is_ambassador ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#C5F235]/20 px-2 py-0.5 text-[10px] font-bold text-[#3f6b00] ring-1 ring-inset ring-[#B7F233]/50">
                              <Sparkles className="h-2.5 w-2.5" />
                              Ambassador
                            </span>
                          ) : null}
                          {user.is_vip ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 text-[10px] font-bold   text-warning">
                              <Medal className="h-2.5 w-2.5" />
                              {user.vip_badge_label || "VIP"}
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-foregroundMuted">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 align-middle">
                    <StatePill user={user} />
                  </td>

                  {/* Email verification */}
                  <td className="px-4 py-3 align-middle">
                    {user.email_is_verified ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-[#3f6b00]">
                        <MailCheck className="h-3.5 w-3.5" />
                        {t("Təsdiqli")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-1 text-xs font-semibold text-warning">
                        <MailQuestion className="h-3.5 w-3.5" />
                        {t("Təsdiqsiz")}
                      </span>
                    )}
                  </td>

                  {/* Role */}
                  <td className="px-4 py-3 align-middle">
                    <RolePill user={user} />
                  </td>

                  {/* Activity */}
                  <td className="px-4 py-3 align-middle">
                    <div className="min-w-[150px]">
                      <div className="text-sm font-medium text-foreground">
                        {user.last_seen_at
                          ? formatDateTime(user.last_seen_at)
                          : t("Aktivlik yoxdur")}
                      </div>
                      <div className="text-xs text-foregroundMuted">
                        {t("Qeydiyyat")}: {formatDate(user.created_at)}
                        {" · "}
                        {user.games_played_total} {t("oyun")}
                      </div>
                      {user.vip_expires_at ? (
                        <div className="mt-0.5 text-[11px] font-medium text-warning">
                          VIP: {formatDate(user.vip_expires_at)}
                        </div>
                      ) : null}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex justify-end">
                      <RowMenu user={user} actions={actions} />
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {!loading && users.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
            <UsersIcon className="h-7 w-7 text-accent" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-foreground">
              {t("İstifadəçi tapılmadı")}
            </h3>
            <p className="mt-1 max-w-xs text-sm text-foregroundMuted">
              {t("Filterləri dəyişərək yenidən yoxlayın.")}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
