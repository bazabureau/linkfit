"use client";

import React from "react";
import {
  X,
  Clock,
  CalendarDays,
  MapPin,
  Mail,
  User as UserIcon,
  Hash,
  Wallet,
  CheckCircle2,
  Ban,
  Gamepad2,
  LogIn,
  UserX,
  Undo2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Booking } from "@/lib/partner-queries";
import { formatDate, formatDateTime, formatTime } from "@/lib/date-format";
import {
  getBookerName,
  getBookerEmail,
  isDoublesBooking,
  initialsOf,
  statusMeta,
  StatusPill,
} from "./booking-utils";

interface BookingDrawerProps {
  booking: Booking | null;
  onClose: () => void;
  onMarkPaid: (b: Booking) => void;
  onCancel: (b: Booking) => void;
  onCheckIn: (b: Booking) => void;
  onUndoCheckIn: (b: Booking) => void;
  onNoShow: (b: Booking) => void;
  onClearNoShow: (b: Booking) => void;
  onRefund: (b: Booking) => void;
  /** Disable action buttons while a mutation is in flight. */
  busy?: boolean;
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-surfaceElevated text-foregroundMuted">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold text-foregroundMuted">
          {label}
        </p>
        <div className="mt-0.5 text-sm font-medium text-foreground break-words">
          {children}
        </div>
      </div>
    </div>
  );
}

export function BookingDrawer({
  booking,
  onClose,
  onMarkPaid,
  onCancel,
  onCheckIn,
  onUndoCheckIn,
  onNoShow,
  onClearNoShow,
  onRefund,
  busy = false,
}: BookingDrawerProps): React.JSX.Element {
  const open = booking !== null;

  // Keep the last booking around during the slide-out animation so content
  // doesn't flash empty as it closes.
  const [shown, setShown] = React.useState<Booking | null>(booking);
  React.useEffect(() => {
    if (booking) setShown(booking);
  }, [booking]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    if (open) {
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
    return undefined;
  }, [open, onClose]);

  const b = shown;
  const meta = b ? statusMeta(b.status) : null;
  const doubles = b ? isDoublesBooking(b) : false;
  const name = b ? getBookerName(b) : "";
  const email = b ? getBookerEmail(b) : "";

  const start = b ? new Date(b.starts_at) : null;
  const end =
    b && start ? new Date(start.getTime() + b.duration_minutes * 60 * 1000) : null;

  const canMarkPaid =
    b && (b.status === "pending_payment" || b.status === "partially_paid");
  const canCancel = b && b.status !== "cancelled" && b.status !== "refunded";
  // Front-desk actions only make sense for live (non-cancelled/refunded) bookings.
  const isActive =
    b && b.status !== "cancelled" && b.status !== "refunded" && b.status !== "failed";
  const checkedIn = Boolean(b?.checked_in_at);
  const noShow = Boolean(b?.no_show_at);
  const canRefund = b && (b.status === "paid" || b.status === "partially_paid");

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* Scrim */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-lift transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {b && meta ? (
          <>
            {/* Header */}
            <div className="relative shrink-0 border-b border-border px-6 pb-5 pt-6">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-50"
                style={{
                  background:
                    "radial-gradient(120% 80% at 100% 0%, rgba(197,242,53,0.08), transparent 70%)",
                }}
              />
              <button
                onClick={onClose}
                className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg text-foregroundMuted transition-colors hover:bg-surfaceElevated hover:text-foreground"
                aria-label="Bağla"
              >
                <X className="h-4 w-4" />
              </button>

              <p className="text-[10px] font-bold text-accent">
                Rezervasiya Detalları
              </p>

              <div className="mt-3 flex items-center gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/15 font-display text-base font-bold text-accent">
                  {initialsOf(name)}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg font-bold text-foreground">
                    {name}
                  </h2>
                  <p className="truncate text-xs text-foregroundMuted">
                    {email || "E-poçt qeyd edilməyib"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <StatusPill status={b.status} />
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none ${
                    doubles
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-info/30 bg-info/10 text-info"
                  }`}
                >
                  <Gamepad2 className="h-3 w-3" />
                  {doubles ? "Cütlü (2v2)" : "Təkli (1v1)"}
                </span>
              </div>
            </div>

            {/* Price highlight */}
            <div className="shrink-0 border-b border-border px-6 py-5">
              <div className="flex items-end justify-between rounded-xl border border-border bg-surfaceElevated/50 px-4 py-3.5">
                <div>
                  <p className="text-[10px] font-bold text-foregroundMuted">
                    Cəmi Məbləğ
                  </p>
                  <p className="mt-1 font-display text-[1.7rem] font-bold leading-none  text-foreground tabular-nums">
                    {(b.total_minor / 100).toFixed(2)}
                    <span className="ml-1 text-sm font-semibold text-foregroundMuted">
                      {b.currency}
                    </span>
                  </p>
                </div>
                <div className={`text-right text-xs font-semibold ${meta.text}`}>
                  {b.status === "paid" && b.paid_at
                    ? `Ödənildi · ${formatDate(b.paid_at)}`
                    : meta.label}
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="flex-1 overflow-y-auto px-6 py-2">
              <div className="divide-y divide-border">
                <Field icon={MapPin} label="Kort">
                  <span className="text-accent">{b.court_name}</span>
                  {b.venue_name ? (
                    <span className="text-foregroundMuted">
                      {" "}
                      · {b.venue_name}
                    </span>
                  ) : null}
                </Field>

                <Field icon={CalendarDays} label="Tarix">
                  {start ? formatDate(start) : "—"}
                </Field>

                <Field icon={Clock} label="Vaxt aralığı">
                  {start && end ? (
                    <span className="tabular-nums">
                      {formatTime(start)} – {formatTime(end)}{" "}
                      <span className="text-foregroundMuted">
                        ({b.duration_minutes} dəq)
                      </span>
                    </span>
                  ) : (
                    "—"
                  )}
                </Field>

                <Field icon={UserIcon} label="Müştəri">
                  {name}
                </Field>

                <Field icon={Mail} label="E-poçt">
                  {email || "—"}
                </Field>

                <Field icon={Wallet} label="Ödəniş statusu">
                  <span className={meta.text}>{meta.label}</span>
                </Field>

                <Field icon={Hash} label="Rezervasiya ID">
                  <span className="font-mono text-xs text-foregroundMuted">
                    {b.id}
                  </span>
                </Field>

                <Field icon={CalendarDays} label="Yaradılma">
                  {formatDateTime(b.created_at)}
                </Field>

                {b.cancelled_at ? (
                  <Field icon={Ban} label="Ləğv edilmə">
                    {formatDateTime(b.cancelled_at)}
                  </Field>
                ) : null}

                {b.checked_in_at ? (
                  <Field icon={LogIn} label="Qeydiyyat (Check-in)">
                    <span className="text-accent">
                      {formatDateTime(b.checked_in_at)}
                    </span>
                  </Field>
                ) : null}

                {b.no_show_at ? (
                  <Field icon={UserX} label="Gəlmədi (No-show)">
                    <span className="text-warning">
                      {formatDateTime(b.no_show_at)}
                    </span>
                  </Field>
                ) : null}

                {b.refunded_at ? (
                  <Field icon={RotateCcw} label="Geri qaytarılma">
                    {formatDateTime(b.refunded_at)}
                  </Field>
                ) : null}
              </div>
            </div>

            {/* Actions */}
            {(canMarkPaid || canCancel || isActive || canRefund) && (
              <div className="shrink-0 space-y-2.5 border-t border-border bg-surface/60 px-6 py-4">
                {/* Front-desk: check-in / no-show */}
                {isActive ? (
                  <div className="flex gap-2">
                    {checkedIn ? (
                      <Button
                        variant="secondary"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => onUndoCheckIn(b)}
                      >
                        <Undo2 className="h-4 w-4" />
                        Qeydiyyatı geri al
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => onCheckIn(b)}
                      >
                        <LogIn className="h-4 w-4" />
                        Check-in
                      </Button>
                    )}
                    {noShow ? (
                      <Button
                        variant="secondary"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => onClearNoShow(b)}
                      >
                        <Undo2 className="h-4 w-4" />
                        Gəlmədi qeydini sil
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => onNoShow(b)}
                      >
                        <UserX className="h-4 w-4" />
                        Gəlmədi
                      </Button>
                    )}
                  </div>
                ) : null}

                {/* Payment: mark-paid / refund / cancel */}
                {(canMarkPaid || canCancel || canRefund) && (
                  <div className="flex gap-2">
                    {canMarkPaid ? (
                      <Button
                        variant="primary"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => onMarkPaid(b)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Ödənildi
                      </Button>
                    ) : null}
                    {canRefund ? (
                      <Button
                        variant="secondary"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => onRefund(b)}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Geri qaytar
                      </Button>
                    ) : null}
                    {canCancel ? (
                      <Button
                        variant={canMarkPaid || canRefund ? "secondary" : "danger"}
                        className="flex-1"
                        disabled={busy}
                        onClick={() => onCancel(b)}
                      >
                        <Ban className="h-4 w-4" />
                        Ləğv et
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </aside>
    </div>
  );
}
