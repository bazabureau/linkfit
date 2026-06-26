"use client";

import * as React from "react";
import {
  Ban,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ClipboardX,
  CreditCard,
  Mail,
  MapPin,
  Pencil,
  StickyNote,
  Undo2,
  UserCheck,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import { useAdminBooking, type Booking } from "@/lib/admin-queries";
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

export interface DrawerActions {
  onEdit: (booking: Booking) => void;
  onCancel: (booking: Booking) => void;
  onRefund: (booking: Booking) => void;
  onMarkPaid: (booking: Booking) => void;
  onCheckIn: (booking: Booking) => void;
  onUndoCheckIn: (booking: Booking) => void;
  onNoShow: (booking: Booking) => void;
  onClearNoShow: (booking: Booking) => void;
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
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

export function BookingDetailDrawer({
  booking,
  open,
  onClose,
  actions,
}: {
  booking: Booking | null;
  open: boolean;
  onClose: () => void;
  actions: DrawerActions;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const { data } = useAdminBooking(open && booking ? booking.id : null);
  const current = data ?? booking;
  // Drive the slide-in transition with a one-frame delay so the panel mounts
  // off-screen, then animates in. (No tailwindcss-animate plugin available.)
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

  const closed = isClosed(current.status);
  const act = (fn: (b: Booking) => void) => () => fn(current);

  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim */}
      <button
        type="button"
        aria-label={t("Bağla")}
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-drawer-title"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-background shadow-lift transition-transform duration-300 ease-out sm:max-w-lg ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-accent">
              {initials(customerName(current))}
            </span>
            <div className="min-w-0">
              <h2
                id="booking-drawer-title"
                className="truncate font-display text-base font-bold text-foreground"
              >
                {customerName(current)}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPillClass(current.status)}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(current.status)}`} />
                  {t(statusLabel(current.status))}
                </span>
                <span className="text-[11px] font-semibold   text-muted">
                  {current.source || "app"}
                </span>
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
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {/* Amount highlight */}
          <div className="my-3 flex items-center justify-between rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div>
              <div className="text-[11px] font-semibold   text-foregroundMuted">
                {t("Məbləğ")}
              </div>
              <div className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">
                {money(current.total_minor, current.currency)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold   text-foregroundMuted">
                {t("Ödəniş metodu")}
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {t(paymentMethodLabel(current.payment_method))}
              </div>
            </div>
          </div>

          <div className="divide-y divide-border rounded-2xl border border-border bg-surface px-4 shadow-card">
            <Row icon={Mail} label={t("Müştəri")}>
              <div>{customerName(current)}</div>
              <div className="text-foregroundMuted">{customerEmail(current)}</div>
            </Row>
            <Row icon={MapPin} label={t("Məkan və kort")}>
              {current.venue_name} · {current.court_name}
            </Row>
            <Row icon={CalendarClock} label={t("Vaxt")}>
              {formatDateTime(current.starts_at)} · {formatDuration(current.duration_minutes)}
            </Row>
            <Row icon={CreditCard} label={t("Ödəniş")}>
              {current.paid_at ? formatDateTime(current.paid_at) : t("Ödənilməyib")}
            </Row>
            <Row icon={UserCheck} label="Check-in / No-show">
              <div>
                Check-in: {current.checked_in_at ? formatDateTime(current.checked_in_at) : "—"}
              </div>
              <div>No-show: {current.no_show_at ? formatDateTime(current.no_show_at) : "—"}</div>
            </Row>
            {current.cancelled_at ? (
              <Row icon={XCircle} label={t("Ləğv")}>
                <div>{formatDateTime(current.cancelled_at)}</div>
                {current.cancellation_reason ? (
                  <div className="text-foregroundMuted">{current.cancellation_reason}</div>
                ) : null}
              </Row>
            ) : null}
            {current.refund_status && current.refund_status !== "not_required" ? (
              <Row icon={Banknote} label="Refund">
                {current.refund_status} ·{" "}
                {money(current.refund_amount_minor, current.currency)}
                {current.refund_note ? (
                  <div className="text-foregroundMuted">{current.refund_note}</div>
                ) : null}
              </Row>
            ) : null}
            {current.internal_note ? (
              <Row icon={StickyNote} label={t("Daxili qeyd")}>
                {current.internal_note}
              </Row>
            ) : null}
            <Row icon={CalendarClock} label={t("Yaradılıb")}>
              {formatDateTime(current.created_at)}
            </Row>
          </div>

          <div className="h-2" />
        </div>

        {/* Footer actions */}
        <div className="border-t border-border bg-surface px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            {!closed && current.status !== "paid" ? (
              <Button onClick={act(actions.onMarkPaid)}>
                <CheckCircle2 className="h-4 w-4" />
                {t("Ödənib et")}
              </Button>
            ) : null}

            {current.checked_in_at ? (
              <Button variant="secondary" onClick={act(actions.onUndoCheckIn)}>
                <Undo2 className="h-4 w-4" />
                {t("Check-in geri al")}
              </Button>
            ) : (
              <Button variant="secondary" onClick={act(actions.onCheckIn)}>
                <UserCheck className="h-4 w-4" />
                Check-in
              </Button>
            )}

            {current.no_show_at ? (
              <Button variant="secondary" onClick={act(actions.onClearNoShow)}>
                <ClipboardX className="h-4 w-4" />
                {t("No-show sil")}
              </Button>
            ) : (
              <Button variant="secondary" onClick={act(actions.onNoShow)}>
                <Ban className="h-4 w-4" />
                No-show
              </Button>
            )}

            <Button variant="outline" onClick={act(actions.onEdit)}>
              <Pencil className="h-4 w-4" />
              {t("Redaktə et")}
            </Button>

            <Button variant="outline" onClick={act(actions.onRefund)}>
              <Banknote className="h-4 w-4" />
              Refund
            </Button>

            {!closed ? (
              <Button variant="danger" onClick={act(actions.onCancel)}>
                <XCircle className="h-4 w-4" />
                {t("Ləğv et")}
              </Button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
