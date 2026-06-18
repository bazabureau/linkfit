"use client";

import * as React from "react";
import {
  Ban,
  BadgeCheck,
  CalendarClock,
  Crown,
  Eye,
  Gamepad2,
  Mail,
  MailCheck,
  Medal,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import { useAdminUser, type User, type UserDetail } from "@/lib/admin-queries";
import {
  Avatar,
  accountState,
  roleMeta,
  rolePillClass,
  stateMeta,
} from "./lib";
import type { UserRowActions } from "./UsersTable";

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gamepad2;
  label: string;
  value: number;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3.5 shadow-card">
      <div className="flex items-center gap-2 text-foregroundMuted">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold  ">
          {label}
        </span>
      </div>
      <p className="mt-1.5 font-display text-xl font-bold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surfaceElevated text-foregroundMuted">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold   text-foregroundMuted">
          {label}
        </div>
        <div className="mt-0.5 break-words text-sm font-medium text-foreground">
          {children}
        </div>
      </div>
    </div>
  );
}

export function UserDetailDrawer({
  user,
  open,
  onClose,
  actions,
}: {
  user: User | null;
  open: boolean;
  onClose: () => void;
  actions: UserRowActions;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const { data, isLoading, isError } = useAdminUser(open && user ? user.id : null);
  // Prefer fresh detail; fall back to the list row while it loads.
  const current: UserDetail | User | null = data ?? user;
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    return undefined;
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !current) return null;

  const detail = data ?? null;
  const state = accountState(current);
  const stMeta = stateMeta(state);
  const rMeta = roleMeta(current.admin_role);
  const isDeleted = state === "deleted";
  const isSuspended = state === "suspended";

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t("Bağla")}
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-background shadow-lift transition-transform duration-300 ease-out sm:max-w-lg ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header — the drawer is flush to the top of the viewport, so give the
            header generous top padding (with a safe-area inset) so it never sits
            jammed against / clipped by the very top edge. */}
        <div className="flex items-start justify-between gap-3 border-b border-border bg-surface px-5 pb-4 pt-[max(1.5rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={current.display_name} vip={current.is_vip} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate font-display text-base font-bold text-foreground">
                {current.display_name || t("Adsız istifadəçi")}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${stMeta.pill}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${stMeta.dot}`} />
                  {t(stMeta.label)}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${rolePillClass(current.admin_role)}`}
                >
                  {t(rMeta.label)}
                </span>
                {current.is_verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-[#3f6b00]">
                    <BadgeCheck className="h-3 w-3" />
                    {t("Təsdiqlənmiş")}
                  </span>
                ) : null}
                {current.is_premium ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-bold text-accent">
                    <Crown className="h-3 w-3" />
                    {current.membership_tier === "premium" ? "Premium" : "Plus"}
                  </span>
                ) : null}
                {current.is_ambassador ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#C5F235]/20 px-2 py-0.5 text-[11px] font-bold text-[#3f6b00] ring-1 ring-inset ring-[#B7F233]/50">
                    <Sparkles className="h-3 w-3" />
                    Ambassador
                  </span>
                ) : null}
                {current.is_vip ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-bold  text-warning">
                    <Medal className="h-3 w-3" />
                    {current.vip_badge_label || "VIP"}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Bağla")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foregroundMuted transition hover:bg-surfaceElevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isError && !detail ? (
            <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
              {t("Məlumat yüklənmədi.")}
            </div>
          ) : null}

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <Metric
              icon={Gamepad2}
              label={t("Oynadığı oyun")}
              value={current.games_played_total}
            />
            <Metric
              icon={Gamepad2}
              label={t("Host olduğu oyun")}
              value={detail?.games_hosted_total ?? 0}
            />
            <Metric
              icon={CalendarClock}
              label={t("Booking")}
              value={detail?.bookings_total ?? 0}
            />
            <Metric
              icon={ShieldAlert}
              label={t("Report")}
              value={detail?.reports_received_count ?? 0}
            />
          </div>
          {isLoading && !detail ? (
            <p className="mt-2 text-center text-xs text-foregroundMuted">
              {t("Yenilənir")}
            </p>
          ) : null}

          {/* Info */}
          <div className="mt-4 divide-y divide-border rounded-2xl border border-border bg-surface px-4 shadow-card">
            <InfoRow icon={Mail} label={t("Email")}>
              <div>{current.email}</div>
              <div className="text-foregroundMuted">
                {current.email_is_verified
                  ? `${t("Təsdiqli")} · ${formatDateTime(current.email_verified_at)}`
                  : t("Təsdiqsiz")}
              </div>
            </InfoRow>
            <InfoRow icon={CalendarClock} label={t("Qeydiyyat")}>
              {formatDateTime(current.created_at)}
            </InfoRow>
            <InfoRow icon={CalendarClock} label={t("Son aktivlik")}>
              {formatDateTime(current.last_seen_at)}
            </InfoRow>
            {current.is_vip ? (
              <InfoRow icon={Medal} label={t("VIP bitmə tarixi")}>
                {current.vip_expires_at ? formatDate(current.vip_expires_at) : t("Müddətsiz")}
              </InfoRow>
            ) : null}
          </div>

          {current.suspension_reason ? (
            <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/10 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold   text-danger">
                <Ban className="h-3.5 w-3.5" />
                {t("Blok səbəbi")}
              </div>
              <p className="mt-2 text-sm text-foreground">{current.suspension_reason}</p>
            </div>
          ) : null}

          <div className="h-2" />
        </div>

        {/* Footer actions */}
        <div className="border-t border-border bg-surface px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              disabled={isDeleted}
              onClick={() => actions.onToggleVerification(current)}
            >
              <MailCheck className="h-4 w-4" />
              {current.email_is_verified ? t("Təsdiqi sil") : t("Email təsdiqlə")}
            </Button>

            {current.is_vip ? (
              <Button
                variant="secondary"
                disabled={isDeleted}
                onClick={() => actions.onDisableVip(current)}
              >
                <Medal className="h-4 w-4" />
                {t("VIP badge sil")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={isDeleted}
                onClick={() => actions.onOpenVip(current)}
              >
                <Medal className="h-4 w-4" />
                {t("VIP badge ver")}
              </Button>
            )}

            <Button
              variant="secondary"
              disabled={isDeleted}
              onClick={() => actions.onToggleVerifiedBadge(current)}
            >
              <BadgeCheck className="h-4 w-4" />
              {current.is_verified ? t("Təsdiq nişanını sil") : t("Təsdiqlənmiş et")}
            </Button>

            <Button
              variant="secondary"
              disabled={isDeleted}
              onClick={() => actions.onToggleAmbassador(current)}
            >
              <Sparkles className="h-4 w-4" />
              {current.is_ambassador ? t("Ambassador nişanını sil") : t("Ambassador təyin et")}
            </Button>

            <Button
              variant="secondary"
              disabled={isDeleted}
              onClick={() => actions.onOpenMembership(current)}
            >
              <Crown className="h-4 w-4" />
              {current.is_premium ? t("Üzvlüyü dəyiş") : t("Premium ver")}
            </Button>

            {isSuspended ? (
              <Button
                variant="outline"
                disabled={isDeleted}
                onClick={() => actions.onUnsuspend(current)}
              >
                <RotateCcw className="h-4 w-4" />
                {t("Bloku aç")}
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={isDeleted}
                onClick={() => actions.onOpenSuspend(current)}
              >
                <Ban className="h-4 w-4" />
                {t("Blokla")}
              </Button>
            )}

            {isDeleted ? (
              <Button onClick={() => actions.onRestore(current)}>
                <RotateCcw className="h-4 w-4" />
                {t("Bərpa et")}
              </Button>
            ) : (
              <Button variant="danger" onClick={() => actions.onSoftDelete(current)}>
                <Trash2 className="h-4 w-4" />
                {t("Sil")}
              </Button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-foregroundMuted">
            <Eye className="h-3 w-3" />
            {t("Rol dəyişiklikləri cədvəl menyusundadır")}
          </div>
        </div>
      </aside>
    </div>
  );
}
