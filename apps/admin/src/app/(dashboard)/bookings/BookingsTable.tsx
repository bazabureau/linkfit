"use client";

import * as React from "react";
import {
  Ban,
  CalendarDays,
  CheckCircle2,
  ClipboardX,
  MapPin,
  MoreHorizontal,
  Undo2,
  UserCheck,
  UserX,
} from "lucide-react";
import { formatDate, formatTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import type { Booking } from "@/lib/admin-queries";
import {
  customerEmail,
  customerName,
  formatDuration,
  initials,
  isClosed,
  money,
  paymentMethodLabel,
  statusDotClass,
  statusLabel,
  statusPillClass,
} from "./lib";

export interface BookingRowActions {
  onOpen: (booking: Booking) => void;
  onMarkPaid: (booking: Booking) => void;
  onCheckIn: (booking: Booking) => void;
  onUndoCheckIn: (booking: Booking) => void;
  onNoShow: (booking: Booking) => void;
  onClearNoShow: (booking: Booking) => void;
}

const COL_COUNT = 8;

function StatusPill({ booking }: { booking: Booking }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(booking.status)}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(booking.status)}`} />
      {t(statusLabel(booking.status))}
    </span>
  );
}

function QuickAction({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: (event: React.MouseEvent) => void;
  children: React.ReactNode;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition ${
        danger
          ? "border-danger/20 text-danger/80 hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          : "border-border text-foregroundMuted hover:border-borderStrong hover:bg-surfaceElevated hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function RowSkeleton(): React.JSX.Element {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: COL_COUNT }).map((_, index) => (
        <td key={index} className="px-4 py-3.5">
          <div
            className="h-4 animate-pulse rounded bg-surfaceElevated"
            style={{ width: index === 0 ? 16 : `${50 + ((index * 13) % 45)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

export function BookingsTable({
  bookings,
  loading,
  selectedIds,
  onToggle,
  onToggleAll,
  actions,
}: {
  bookings: Booking[];
  loading: boolean;
  selectedIds: string[];
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  actions: BookingRowActions;
}): React.JSX.Element {
  const { t } = useI18n();
  const allSelected = bookings.length > 0 && selectedIds.length === bookings.length;

  const headClass =
    "sticky top-0 z-10 h-11 bg-surfaceElevated px-4 text-left align-middle text-[11px] font-semibold   text-foregroundMuted";

  return (
    <div className="w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[920px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={`${headClass} w-10 rounded-tl-2xl`}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => onToggleAll(event.target.checked)}
                disabled={bookings.length === 0}
                className="h-4 w-4 rounded border-borderStrong accent-[var(--color-accent,#B7F233)]"
                aria-label={t("Hamısını seç")}
              />
            </th>
            <th className={headClass}>{t("Müştəri")}</th>
            <th className={headClass}>{t("Məkan və kort")}</th>
            <th className={headClass}>{t("Vaxt")}</th>
            <th className={`${headClass} text-right`}>{t("Ödəniş")}</th>
            <th className={headClass}>{t("Status")}</th>
            <th className={headClass}>{t("Giriş")}</th>
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
            bookings.map((booking, index) => {
              const selected = selectedIds.includes(booking.id);
              return (
                <tr
                  key={booking.id}
                  onClick={() => actions.onOpen(booking)}
                  className={`group cursor-pointer border-b border-border transition-colors ${
                    selected
                      ? "bg-accent/[0.06]"
                      : index % 2 === 1
                        ? "bg-surfaceElevated/40 hover:bg-surfaceElevated"
                        : "bg-surface hover:bg-surfaceElevated/70"
                  }`}
                >
                  {/* Select */}
                  <td className="px-4 py-3 align-middle">
                    <input
                      type="checkbox"
                      checked={selected}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onToggle(booking.id, event.target.checked)}
                      className="h-4 w-4 rounded border-borderStrong accent-[var(--color-accent,#B7F233)]"
                      aria-label={t("Seç")}
                    />
                  </td>

                  {/* Customer */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-[200px] items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-accent">
                        {initials(customerName(booking))}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">
                          {customerName(booking)}
                        </div>
                        <div className="truncate text-xs text-foregroundMuted">
                          {customerEmail(booking)}
                        </div>
                        <div className="mt-0.5 text-[10px] font-semibold   text-muted">
                          {booking.source || "app"}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Venue + court */}
                  <td className="px-4 py-3 align-middle">
                    <div className="min-w-[170px]">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-foregroundMuted" />
                        <span className="truncate">{booking.venue_name}</span>
                      </div>
                      <div className="mt-0.5 truncate pl-5 text-xs text-foregroundMuted">
                        {booking.court_name}
                      </div>
                    </div>
                  </td>

                  {/* Time */}
                  <td className="px-4 py-3 align-middle">
                    <div className="min-w-[130px]">
                      <div className="font-medium text-foreground">
                        {formatDate(booking.starts_at)}
                      </div>
                      <div className="text-xs text-foregroundMuted">
                        {formatTime(booking.starts_at)} · {formatDuration(booking.duration_minutes)}
                      </div>
                    </div>
                  </td>

                  {/* Payment */}
                  <td className="px-4 py-3 text-right align-middle">
                    <div className="font-display text-sm font-bold tabular-nums text-foreground">
                      {money(booking.total_minor, booking.currency)}
                    </div>
                    <div className="text-xs text-foregroundMuted">
                      {t(paymentMethodLabel(booking.payment_method))}
                    </div>
                    {booking.refund_status && booking.refund_status !== "not_required" ? (
                      <div className="mt-0.5 text-[11px] font-medium text-danger">
                        Refund: {booking.refund_status}
                      </div>
                    ) : null}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 align-middle">
                    <StatusPill booking={booking} />
                  </td>

                  {/* Entry */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-[96px] flex-col items-start gap-1">
                      {booking.checked_in_at ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-[#3f6b00]">
                          <UserCheck className="h-3 w-3" />
                          Check-in
                        </span>
                      ) : (
                        <span className="text-xs text-foregroundMuted">{t("Gözləyir")}</span>
                      )}
                      {booking.no_show_at ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
                          <UserX className="h-3 w-3" />
                          No-show
                        </span>
                      ) : null}
                    </div>
                  </td>

                  {/* Quick actions */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      {!isClosed(booking.status) && booking.status !== "paid" ? (
                        <QuickAction
                          title={t("Ödənib et")}
                          onClick={() => actions.onMarkPaid(booking)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </QuickAction>
                      ) : null}
                      {booking.checked_in_at ? (
                        <QuickAction
                          title={t("Check-in geri al")}
                          onClick={() => actions.onUndoCheckIn(booking)}
                        >
                          <Undo2 className="h-4 w-4" />
                        </QuickAction>
                      ) : (
                        <QuickAction
                          title="Check-in"
                          onClick={() => actions.onCheckIn(booking)}
                        >
                          <UserCheck className="h-4 w-4" />
                        </QuickAction>
                      )}
                      {booking.no_show_at ? (
                        <QuickAction
                          title={t("No-show sil")}
                          onClick={() => actions.onClearNoShow(booking)}
                        >
                          <ClipboardX className="h-4 w-4" />
                        </QuickAction>
                      ) : (
                        <QuickAction
                          title="No-show"
                          danger
                          onClick={() => actions.onNoShow(booking)}
                        >
                          <Ban className="h-4 w-4" />
                        </QuickAction>
                      )}
                      <QuickAction
                        title={t("Detal")}
                        onClick={() => actions.onOpen(booking)}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </QuickAction>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {!loading && bookings.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
            <CalendarDays className="h-7 w-7 text-accent" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-foreground">
              {t("Rezervasiya tapılmadı")}
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
