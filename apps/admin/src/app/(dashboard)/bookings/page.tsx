"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FilePenLine,
  RefreshCw,
  Search,
  TicketCheck,
  UserCheck,
  UserX,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { API_BASE_URL } from "@/lib/api";
import {
  ACCESS_TOKEN_COOKIE,
  getCookie,
} from "@/lib/cookies";
import {
  useAdminBooking,
  useAdminBookings,
  useBulkUpdateBookings,
  useCancelBooking,
  useCheckInBooking,
  useClearNoShowBooking,
  useCreateBooking,
  useMarkBookingPaid,
  useNoShowBooking,
  useQuoteBooking,
  useRefundBooking,
  useUndoCheckInBooking,
  useUpdateBooking,
  type Booking,
  type BookingStatus,
  type CreateBookingPayload,
} from "@/lib/admin-queries";
import { useVenueCourts, useVenues, type Court } from "@/lib/admin-venues";
import { formatDate, formatDateTime, formatTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";

type DialogMode = "detail" | "edit" | "cancel" | "refund" | "create" | null;

const BOOKING_STATUSES: Array<{ value: BookingStatus; label: string }> = [
  { value: "pending_payment", label: "Ödəniş gözləyir" },
  { value: "partially_paid", label: "Qismən ödənib" },
  { value: "paid", label: "Ödənib" },
  { value: "cancelled", label: "Ləğv edilib" },
  { value: "refunded", label: "Refund edilib" },
  { value: "failed", label: "Uğursuz" },
];

const PAYMENT_METHODS = [
  { value: "manual", label: "Manual" },
  { value: "cash", label: "Nağd" },
  { value: "bank_transfer", label: "Bank köçürməsi" },
  { value: "onsite", label: "Məkanda" },
] as const;

const REFUND_STATUSES = [
  { value: "pending_manual_review", label: "Yoxlama gözləyir" },
  { value: "approved", label: "Təsdiqlənib" },
  { value: "processed", label: "İcra olunub" },
  { value: "rejected", label: "Rədd edilib" },
  { value: "not_required", label: "Lazım deyil" },
] as const;

function money(minor: number | null | undefined, currency = "AZN"): string {
  return `${((minor ?? 0) / 100).toFixed(2)} ${currency || "AZN"}`;
}

function dateInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}

function dateTimeLocalToIso(value: string): string {
  return new Date(value).toISOString();
}

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusLabel(status: BookingStatus): string {
  return BOOKING_STATUSES.find((item) => item.value === status)?.label ?? status;
}

function statusVariant(status: BookingStatus): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "paid") return "success";
  if (status === "pending_payment" || status === "partially_paid") return "warning";
  if (status === "cancelled" || status === "refunded" || status === "failed") return "danger";
  return "neutral";
}

function customerName(booking: Booking): string {
  return booking.customer_name || booking.booker_display_name || "Adsız müştəri";
}

function customerEmail(booking: Booking): string {
  return booking.customer_email || booking.booker_email || "Email yoxdur";
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  });
  return qs.toString();
}

function SelectBox({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </select>
  );
}

function RowSkeleton(): React.JSX.Element {
  return (
    <TableRow>
      {Array.from({ length: 8 }).map((_, index) => (
        <TableCell key={index}>
          <div className="h-4 w-full max-w-[160px] animate-pulse rounded bg-surfaceElevated" />
        </TableCell>
      ))}
    </TableRow>
  );
}

export default function BookingsPage(): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [selectedVenueId, setSelectedVenueId] = useState("all");
  const [selectedCourtId, setSelectedCourtId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);

  const { data: venues = [] } = useVenues({ limit: 100 });
  const { data: courts = [] } = useVenueCourts(
    selectedVenueId !== "all" ? selectedVenueId : undefined,
  );

  const params = useMemo(
    () => ({
      status: status !== "all" ? status : undefined,
      venue_id: selectedVenueId !== "all" ? selectedVenueId : undefined,
      court_id: selectedCourtId !== "all" ? selectedCourtId : undefined,
      q: q.trim() || undefined,
      from: dateInputToIso(from),
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      limit: 100,
    }),
    [status, selectedVenueId, selectedCourtId, q, from, to],
  );

  const {
    data: bookingsData,
    isFetching,
    isLoading,
    refetch,
  } = useAdminBookings(params);
  const bookings = bookingsData?.results ?? [];

  const cancelBooking = useCancelBooking();
  const markPaid = useMarkBookingPaid();
  const refundBooking = useRefundBooking();
  const checkIn = useCheckInBooking();
  const undoCheckIn = useUndoCheckInBooking();
  const markNoShow = useNoShowBooking();
  const clearNoShow = useClearNoShowBooking();
  const bulkUpdate = useBulkUpdateBookings();

  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => bookings.some((booking) => booking.id === id)),
    );
  }, [bookings]);

  const stats = useMemo(() => {
    const now = Date.now();
    return bookings.reduce(
      (acc, booking) => {
        const starts = new Date(booking.starts_at).getTime();
        acc.total += 1;
        if (starts >= now && !["cancelled", "refunded", "failed"].includes(booking.status)) {
          acc.upcoming += 1;
        }
        if (booking.status === "paid") {
          acc.paid += 1;
          acc.revenue += booking.total_minor;
        }
        if (booking.status === "pending_payment" || booking.status === "partially_paid") {
          acc.unpaid += 1;
        }
        if (booking.status === "cancelled" || booking.status === "refunded") {
          acc.closed += 1;
        }
        if (booking.checked_in_at) acc.checkedIn += 1;
        if (booking.no_show_at) acc.noShow += 1;
        return acc;
      },
      {
        total: 0,
        upcoming: 0,
        paid: 0,
        unpaid: 0,
        closed: 0,
        checkedIn: 0,
        noShow: 0,
        revenue: 0,
      },
    );
  }, [bookings]);

  function openDialog(mode: DialogMode, booking?: Booking) {
    setActiveBooking(booking ?? null);
    setDialogMode(mode);
  }

  function closeDialog() {
    setDialogMode(null);
    setActiveBooking(null);
  }

  async function runBookingAction(
    label: string,
    action: () => Promise<unknown>,
  ) {
    try {
      await action();
      toast.success(label);
    } catch (error) {
      toast.error(t("Əməliyyat alınmadı"), error instanceof Error ? error.message : t("Yenidən yoxlayın"));
    }
  }

  async function exportCsv() {
    try {
      const qs = buildQuery({
        status: params.status,
        venue_id: params.venue_id,
        court_id: params.court_id,
        q: params.q,
        from: params.from,
        to: params.to,
      });
      const token = getCookie(ACCESS_TOKEN_COOKIE);
      const response = await fetch(`${API_BASE_URL}/api/v1/admin/bookings/export${qs ? `?${qs}` : ""}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) throw new Error(t("Export faylı yaradılmadı"));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `linkfit-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("Export hazırdır"));
    } catch (error) {
      toast.error(t("Export alınmadı"), error instanceof Error ? error.message : t("Yenidən yoxlayın"));
    }
  }

  const allSelected = bookings.length > 0 && selectedIds.length === bookings.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            {t("Rezervasiyalar")}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {t("Booking əməliyyatları")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Kort rezervasiyaları, ödəniş, refund və giriş qeydiyyatı.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className="h-4 w-4" />
            {t("Yenilə")}
          </Button>
          <Button variant="outline" onClick={() => void exportCsv()}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button onClick={() => openDialog("create")}>
            <CalendarCheck2 className="h-4 w-4" />
            Manual booking
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <StatCard icon={TicketCheck} label={t("Ümumi")} value={stats.total} />
        <StatCard icon={CalendarDays} label={t("Gələcək")} value={stats.upcoming} />
        <StatCard icon={Banknote} label={t("Gəlir")} value={money(stats.revenue)} tone="success" />
        <StatCard icon={AlertTriangle} label={t("Ödəniş gözləyir")} value={stats.unpaid} tone="warning" />
        <StatCard icon={XCircle} label={t("Bağlanıb")} value={stats.closed} tone="danger" />
        <StatCard icon={UserCheck} label={t("Check-in / No-show")} value={`${stats.checkedIn} / ${stats.noShow}`} />
      </div>

      <Card className="border border-border bg-surface p-4">
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t("Müştəri, email, məkan və ya kort üzrə axtar...")}
              className="pl-9"
            />
          </div>
          <SelectBox
            value={selectedVenueId}
            onChange={(value) => {
              setSelectedVenueId(value);
              setSelectedCourtId("all");
            }}
          >
            <option value="all">{t("Bütün məkanlar")}</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </SelectBox>
          <SelectBox
            value={selectedCourtId}
            disabled={selectedVenueId === "all"}
            onChange={setSelectedCourtId}
          >
            <option value="all">{t("Bütün kortlar")}</option>
            {courts.map((court) => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </SelectBox>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <FilterChip active={status === "all"} onClick={() => setStatus("all")}>
              {t("Hamısı")}
            </FilterChip>
            {BOOKING_STATUSES.map((item) => (
              <FilterChip
                key={item.value}
                active={status === item.value}
                onClick={() => setStatus(item.value)}
              >
                {t(item.label)}
              </FilterChip>
            ))}
          </div>
          {(q || status !== "all" || selectedVenueId !== "all" || selectedCourtId !== "all" || from || to) ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                setStatus("all");
                setSelectedVenueId("all");
                setSelectedCourtId("all");
                setFrom("");
                setTo("");
              }}
            >
              {t("Filterləri sıfırla")}
            </Button>
          ) : null}
        </div>
      </Card>

      {selectedIds.length > 0 ? (
        <Card className="flex flex-col gap-3 border border-accent/30 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-medium text-foreground">
            {selectedIds.length} {t("rezervasiya seçilib")}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                runBookingAction(t("Seçilən rezervasiyalar ödənişli edildi"), async () => {
                  await bulkUpdate.mutateAsync({ ids: selectedIds, status: "paid", payment_method: "manual" });
                  setSelectedIds([]);
                })
              }
            >
              {t("Ödənib et")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                runBookingAction(t("Seçilən rezervasiyalar ləğv edildi"), async () => {
                  await bulkUpdate.mutateAsync({
                    ids: selectedIds,
                    status: "cancelled",
                    cancellation_reason: "Admin bulk action",
                  });
                  setSelectedIds([]);
                })
              }
            >
              {t("Ləğv et")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelectedIds([])}>
              {t("Seçimi təmizlə")}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("Rezervasiya siyahısı")}</h2>
              <p className="text-sm text-foregroundMuted">
                {bookings.length} {t("göstərilir")} · total {bookingsData?.count ?? 0}
              </p>
            </div>
            {isFetching ? (
              <Badge variant="info">{t("Yenilənir")}</Badge>
            ) : null}
          </div>
        </div>

        {!isLoading && bookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10">
              <CalendarDays className="h-6 w-6 text-accent" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">{t("Rezervasiya tapılmadı")}</h3>
              <p className="text-sm text-foregroundMuted">{t("Filterləri dəyişərək yenidən yoxlayın.")}</p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) =>
                      setSelectedIds(event.target.checked ? bookings.map((booking) => booking.id) : [])
                    }
                    className="h-4 w-4 rounded border-border accent-[var(--color-accent)]"
                  />
                </TableHead>
                <TableHead>{t("Müştəri")}</TableHead>
                <TableHead>{t("Məkan və kort")}</TableHead>
                <TableHead>{t("Vaxt")}</TableHead>
                <TableHead>{t("Ödəniş")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead>{t("Giriş")}</TableHead>
                <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
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
                bookings.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(booking.id)}
                        onChange={(event) =>
                          setSelectedIds((current) =>
                            event.target.checked
                              ? [...current, booking.id]
                              : current.filter((id) => id !== booking.id),
                          )
                        }
                        className="h-4 w-4 rounded border-border accent-[var(--color-accent)]"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="min-w-[180px]">
                        <div className="font-semibold text-foreground">{t(customerName(booking))}</div>
                        <div className="mt-0.5 text-xs text-foregroundMuted">{t(customerEmail(booking))}</div>
                        <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-foregroundMuted">
                          {booking.source || "app"}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-[190px]">
                        <div className="font-medium text-foreground">{booking.venue_name}</div>
                        <div className="text-sm text-foregroundMuted">{booking.court_name}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-[150px]">
                        <div className="font-medium text-foreground">{formatDate(booking.starts_at)}</div>
                        <div className="text-sm text-foregroundMuted">
                          {formatTime(booking.starts_at)} · {booking.duration_minutes} dəq.
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-foreground">{money(booking.total_minor, booking.currency)}</div>
                      <div className="text-xs text-foregroundMuted">
                        {t(PAYMENT_METHODS.find((item) => item.value === booking.payment_method)?.label ?? "Qeyd yoxdur")}
                      </div>
                      {booking.refund_status ? (
                        <div className="mt-1 text-xs text-danger">
                          Refund: {booking.refund_status}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(booking.status)}>{t(statusLabel(booking.status))}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {booking.checked_in_at ? (
                          <Badge variant="success">Check-in</Badge>
                        ) : (
                          <Badge variant="neutral">{t("Gözləyir")}</Badge>
                        )}
                        {booking.no_show_at ? <Badge variant="danger">No-show</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <IconButton title={t("Detal")} onClick={() => openDialog("detail", booking)}>
                          <Eye className="h-4 w-4" />
                        </IconButton>
                        <IconButton title={t("Edit")} onClick={() => openDialog("edit", booking)}>
                          <FilePenLine className="h-4 w-4" />
                        </IconButton>
                        {booking.status !== "paid" && booking.status !== "cancelled" && booking.status !== "refunded" ? (
                          <IconButton
                            title={t("Ödənib et")}
                            onClick={() =>
                              runBookingAction(t("Rezervasiya ödənildi"), () => markPaid.mutateAsync({ id: booking.id }))
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                        {booking.checked_in_at ? (
                          <IconButton
                            title={t("Check-in geri al")}
                            onClick={() =>
                              runBookingAction(t("Check-in geri alındı"), () => undoCheckIn.mutateAsync({ id: booking.id }))
                            }
                          >
                            <ClipboardCheck className="h-4 w-4" />
                          </IconButton>
                        ) : (
                          <IconButton
                            title="Check-in"
                            onClick={() =>
                              runBookingAction(t("Check-in qeyd edildi"), () => checkIn.mutateAsync({ id: booking.id }))
                            }
                          >
                            <UserCheck className="h-4 w-4" />
                          </IconButton>
                        )}
                        {booking.no_show_at ? (
                          <IconButton
                            title={t("No-show sil")}
                            onClick={() =>
                              runBookingAction(t("No-show silindi"), () => clearNoShow.mutateAsync({ id: booking.id }))
                            }
                          >
                            <UserX className="h-4 w-4" />
                          </IconButton>
                        ) : (
                          <IconButton
                            title="No-show"
                            onClick={() =>
                              runBookingAction(t("No-show qeyd edildi"), () => markNoShow.mutateAsync({ id: booking.id }))
                            }
                          >
                            <UserX className="h-4 w-4" />
                          </IconButton>
                        )}
                        {booking.status !== "cancelled" && booking.status !== "refunded" ? (
                          <IconButton title={t("Ləğv et")} danger onClick={() => openDialog("cancel", booking)}>
                            <XCircle className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                        <IconButton title="Refund" danger={booking.status === "paid"} onClick={() => openDialog("refund", booking)}>
                          <Banknote className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <BookingDetailDialog
        booking={activeBooking}
        open={dialogMode === "detail"}
        onOpenChange={(open) => !open && closeDialog()}
      />
      <BookingEditDialog
        booking={activeBooking}
        open={dialogMode === "edit"}
        onOpenChange={(open) => !open && closeDialog()}
        onDone={closeDialog}
      />
      <CancelBookingDialog
        booking={activeBooking}
        open={dialogMode === "cancel"}
        pending={cancelBooking.isPending}
        onOpenChange={(open) => !open && closeDialog()}
        onSubmit={(payload) =>
          runBookingAction(t("Rezervasiya ləğv edildi"), async () => {
            if (!activeBooking) return;
            await cancelBooking.mutateAsync({ id: activeBooking.id, ...payload });
            closeDialog();
          })
        }
      />
      <RefundBookingDialog
        booking={activeBooking}
        open={dialogMode === "refund"}
        pending={refundBooking.isPending}
        onOpenChange={(open) => !open && closeDialog()}
        onSubmit={(payload) =>
          runBookingAction(t("Refund məlumatı yeniləndi"), async () => {
            if (!activeBooking) return;
            await refundBooking.mutateAsync({ id: activeBooking.id, ...payload });
            closeDialog();
          })
        }
      />
      <CreateBookingDialog
        open={dialogMode === "create"}
        venues={venues}
        onOpenChange={(open) => !open && closeDialog()}
        onDone={closeDialog}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof TicketCheck;
  label: string;
  value: string | number;
  tone?: "success" | "warning" | "danger";
}): React.JSX.Element {
  const toneClass =
    tone === "success"
      ? "bg-accent/10 text-accent"
      : tone === "warning"
        ? "bg-warning/10 text-warning"
        : tone === "danger"
          ? "bg-danger/10 text-danger"
          : "bg-surfaceElevated text-foreground";
  return (
    <Card className="border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foregroundMuted">{label}</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
        </div>
      </div>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
        active
          ? "border-accent bg-accent text-black"
          : "border-border bg-surface text-foregroundMuted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-9 w-9 place-items-center rounded-lg border transition ${
        danger
          ? "border-danger/30 bg-danger/10 text-danger hover:bg-danger/20"
          : "border-border bg-surfaceElevated text-foregroundMuted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function BookingDetailDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const { data } = useAdminBooking(open && booking ? booking.id : null);
  const current = data ?? booking;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Rezervasiya detalları")}
      contentClassName="max-w-3xl"
    >
      {current ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Detail label={t("Müştəri")} value={`${t(customerName(current))} · ${t(customerEmail(current))}`} />
          <Detail label={t("Məkan")} value={`${current.venue_name} · ${current.court_name}`} />
          <Detail label={t("Vaxt")} value={`${formatDateTime(current.starts_at)} · ${current.duration_minutes} dəq.`} />
          <Detail label={t("Məbləğ")} value={money(current.total_minor, current.currency)} />
          <Detail label={t("Status")} value={t(statusLabel(current.status))} />
          <Detail label={t("Mənbə")} value={current.source || "app"} />
          <Detail label={t("Ödəniş")} value={`${current.payment_method ?? "—"} · ${current.paid_at ? formatDateTime(current.paid_at) : "—"}`} />
          <Detail label={t("Yaradılıb")} value={formatDateTime(current.created_at)} />
          <Detail label="Check-in" value={current.checked_in_at ? formatDateTime(current.checked_in_at) : "—"} />
          <Detail label="No-show" value={current.no_show_at ? formatDateTime(current.no_show_at) : "—"} />
          <Detail label={t("Ləğv")} value={current.cancelled_at ? `${formatDateTime(current.cancelled_at)} · ${current.cancellation_reason ?? "—"}` : "—"} />
          <Detail label="Refund" value={current.refund_status ? `${current.refund_status} · ${money(current.refund_amount_minor, current.currency)}` : "—"} />
          <div className="md:col-span-2">
            <Detail label={t("Daxili qeyd")} value={current.internal_note || "—"} />
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surfaceElevated p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-foregroundMuted">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function BookingEditDialog({
  booking,
  open,
  onOpenChange,
  onDone,
}: {
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();
  const updateBooking = useUpdateBooking();
  const [startsAt, setStartsAt] = useState("");
  const [duration, setDuration] = useState(90);
  const [status, setStatus] = useState<BookingStatus>("pending_payment");
  const [paymentMethod, setPaymentMethod] = useState("manual");
  const [customerNameValue, setCustomerNameValue] = useState("");
  const [customerEmailValue, setCustomerEmailValue] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [internalNote, setInternalNote] = useState("");

  useEffect(() => {
    if (!booking) return;
    setStartsAt(toDateTimeLocal(booking.starts_at));
    setDuration(booking.duration_minutes);
    setStatus(booking.status);
    setPaymentMethod(booking.payment_method ?? "manual");
    setCustomerNameValue(booking.customer_name ?? "");
    setCustomerEmailValue(booking.customer_email ?? "");
    setPaymentNote(booking.payment_note ?? "");
    setInternalNote(booking.internal_note ?? "");
  }, [booking]);

  async function submit() {
    if (!booking || !startsAt) return;
    try {
      await updateBooking.mutateAsync({
        id: booking.id,
        data: {
          starts_at: dateTimeLocalToIso(startsAt),
          duration_minutes: duration,
          status,
          payment_method: paymentMethod as Booking["payment_method"],
          customer_name: customerNameValue || null,
          customer_email: customerEmailValue || null,
          payment_note: paymentNote || null,
          internal_note: internalNote || null,
        },
      });
      toast.success(t("Rezervasiya yeniləndi"));
      onDone();
    } catch (error) {
      toast.error(t("Yeniləmə alınmadı"), error instanceof Error ? error.message : t("Yenidən yoxlayın"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Rezervasiyanı redaktə et")} contentClassName="max-w-2xl">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("Başlama vaxtı")}>
          <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </Field>
        <Field label={t("Müddət")}>
          <Input type="number" min={15} step={15} value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
        </Field>
        <Field label={t("Status")}>
          <SelectBox value={status} onChange={(value) => setStatus(value as BookingStatus)}>
            {BOOKING_STATUSES.map((item) => (
              <option key={item.value} value={item.value}>{t(item.label)}</option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Ödəniş metodu")}>
          <SelectBox value={paymentMethod} onChange={setPaymentMethod}>
            {PAYMENT_METHODS.map((item) => (
              <option key={item.value} value={item.value}>{t(item.label)}</option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Müştəri adı")}>
          <Input value={customerNameValue} onChange={(event) => setCustomerNameValue(event.target.value)} />
        </Field>
        <Field label={t("Müştəri email")}>
          <Input type="email" value={customerEmailValue} onChange={(event) => setCustomerEmailValue(event.target.value)} />
        </Field>
        <Field label={t("Ödəniş qeydi")}>
          <Textarea value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} />
        </Field>
        <Field label={t("Daxili qeyd")}>
          <Textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Bağla")}</Button>
        <Button onClick={() => void submit()} disabled={updateBooking.isPending}>
          {t("Yadda saxla")}
        </Button>
      </div>
    </Dialog>
  );
}

function CancelBookingDialog({
  booking,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  booking: Booking | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { reason?: string | null; refund_status?: Booking["refund_status"]; refund_amount_minor?: number | null; refund_note?: string | null }) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [refundStatus, setRefundStatus] = useState<NonNullable<Booking["refund_status"]>>("not_required");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundNote, setRefundNote] = useState("");

  useEffect(() => {
    setReason("");
    setRefundStatus("not_required");
    setRefundAmount("");
    setRefundNote("");
  }, [booking]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Rezervasiyanı ləğv et")} contentClassName="max-w-xl">
      <div className="space-y-4">
        <p className="text-sm text-foregroundMuted">
          {booking ? `${t(customerName(booking))} · ${booking.venue_name} · ${formatDateTime(booking.starts_at)}` : ""}
        </p>
        <Field label={t("Ləğv səbəbi")}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("Səbəb qeyd et")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Refund status")}>
            <SelectBox value={refundStatus} onChange={(value) => setRefundStatus(value as NonNullable<Booking["refund_status"]>)}>
              {REFUND_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>{t(item.label)}</option>
              ))}
            </SelectBox>
          </Field>
          <Field label={t("Refund məbləği")}>
            <Input value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <Field label={t("Refund qeydi")}>
          <Textarea value={refundNote} onChange={(event) => setRefundNote(event.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Bağla")}</Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              onSubmit({
                reason: reason || null,
                refund_status: refundStatus,
                refund_amount_minor: refundAmount ? Math.round(Number(refundAmount) * 100) : null,
                refund_note: refundNote || null,
              })
            }
          >
            {t("Ləğv et")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RefundBookingDialog({
  booking,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  booking: Booking | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { refund_status?: Booking["refund_status"]; refund_amount_minor?: number | null; refund_note?: string | null }) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<NonNullable<Booking["refund_status"]>>("processed");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    setStatus(booking?.refund_status ?? "processed");
    setAmount(booking ? String((booking.refund_amount_minor ?? booking.total_minor) / 100) : "");
    setNote(booking?.refund_note ?? "");
  }, [booking]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Refund idarəsi")} contentClassName="max-w-xl">
      <div className="space-y-4">
        <p className="text-sm text-foregroundMuted">
          {booking ? `${t(customerName(booking))} · ${money(booking.total_minor, booking.currency)}` : ""}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Refund status")}>
            <SelectBox value={status} onChange={(value) => setStatus(value as NonNullable<Booking["refund_status"]>)}>
              {REFUND_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>{t(item.label)}</option>
              ))}
            </SelectBox>
          </Field>
          <Field label={t("Məbləğ")}>
            <Input value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
        </div>
        <Field label={t("Qeyd")}>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Bağla")}</Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSubmit({
                refund_status: status,
                refund_amount_minor: amount ? Math.round(Number(amount) * 100) : null,
                refund_note: note || null,
              })
            }
          >
            {t("Yadda saxla")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CreateBookingDialog({
  open,
  venues,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  venues: Array<{ id: string; name: string }>;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();
  const [venueId, setVenueId] = useState("");
  const [courtId, setCourtId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [duration, setDuration] = useState(90);
  const [status, setStatus] = useState<CreateBookingPayload["status"]>("pending_payment");
  const [customerNameValue, setCustomerNameValue] = useState("");
  const [customerEmailValue, setCustomerEmailValue] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("manual");
  const [paymentNote, setPaymentNote] = useState("");
  const { data: courts = [] } = useVenueCourts(venueId || undefined);
  const createBooking = useCreateBooking();
  const quoteBooking = useQuoteBooking();

  useEffect(() => {
    if (!open) return;
    setVenueId("");
    setCourtId("");
    setStartsAt("");
    setDuration(90);
    setStatus("pending_payment");
    setCustomerNameValue("");
    setCustomerEmailValue("");
    setPaymentMethod("manual");
    setPaymentNote("");
    quoteBooking.reset();
  }, [open]);

  async function quote() {
    if (!courtId || !startsAt) return;
    try {
      await quoteBooking.mutateAsync({
        court_id: courtId,
        starts_at: dateTimeLocalToIso(startsAt),
        duration_minutes: duration,
      });
      toast.success(t("Slot mövcuddur"));
    } catch (error) {
      toast.error(t("Slot yoxlanmadı"), error instanceof Error ? error.message : t("Yenidən yoxlayın"));
    }
  }

  async function submit() {
    if (!courtId || !startsAt) {
      toast.error(t("Kort və vaxt seçilməlidir"));
      return;
    }
    try {
      await createBooking.mutateAsync({
        court_id: courtId,
        starts_at: dateTimeLocalToIso(startsAt),
        duration_minutes: duration,
        status,
        customer_name: customerNameValue || null,
        customer_email: customerEmailValue || null,
        payment_method: paymentMethod as Booking["payment_method"],
        payment_note: paymentNote || null,
      });
      toast.success(t("Manual booking yaradıldı"));
      onDone();
    } catch (error) {
      toast.error(t("Booking yaradılmadı"), error instanceof Error ? error.message : t("Yenidən yoxlayın"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Manual booking yarat")} contentClassName="max-w-2xl">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("Məkan")}>
          <SelectBox value={venueId} onChange={(value) => {
            setVenueId(value);
            setCourtId("");
          }}>
            <option value="">{t("Məkan seç")}</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>{venue.name}</option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Kort")}>
          <SelectBox value={courtId} disabled={!venueId} onChange={setCourtId}>
            <option value="">{t("Kort seç")}</option>
            {(courts as Court[]).map((court) => (
              <option key={court.id} value={court.id}>{court.name}</option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Başlama vaxtı")}>
          <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </Field>
        <Field label={t("Müddət")}>
          <Input type="number" min={15} step={15} value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
        </Field>
        <Field label={t("Status")}>
          <SelectBox value={status ?? "pending_payment"} onChange={(value) => setStatus(value as CreateBookingPayload["status"])}>
            <option value="pending_payment">{t("Ödəniş gözləyir")}</option>
            <option value="paid">{t("Ödənib")}</option>
          </SelectBox>
        </Field>
        <Field label={t("Ödəniş metodu")}>
          <SelectBox value={paymentMethod} onChange={setPaymentMethod}>
            {PAYMENT_METHODS.map((item) => (
              <option key={item.value} value={item.value}>{t(item.label)}</option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Müştəri adı")}>
          <Input value={customerNameValue} onChange={(event) => setCustomerNameValue(event.target.value)} />
        </Field>
        <Field label={t("Müştəri email")}>
          <Input type="email" value={customerEmailValue} onChange={(event) => setCustomerEmailValue(event.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <Field label={t("Ödəniş qeydi")}>
            <Textarea value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} />
          </Field>
        </div>
      </div>
      {quoteBooking.data ? (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm font-medium text-foreground">
          {t("Slot açıqdır")} · {money(quoteBooking.data.total_minor, quoteBooking.data.currency)} · {t("bitiş")} {formatTime(quoteBooking.data.ends_at)}
        </div>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Bağla")}</Button>
        <Button variant="outline" onClick={() => void quote()} disabled={quoteBooking.isPending}>{t("Yoxla")}</Button>
        <Button onClick={() => void submit()} disabled={createBooking.isPending}>{t("Yarat")}</Button>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-foregroundMuted">{label}</span>
      {children}
    </Label>
  );
}
