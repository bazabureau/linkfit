"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Search,
  CheckCircle2,
  AlertCircle,
  CalendarCheck,
  Plus,
  List,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  Mail,
  Gamepad2,
  MapPin,
  XCircle,
  Hourglass,
  Wallet,
  Download,
  Filter,
  X,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePartnerBookings,
  useCancelPartnerBooking,
  useMarkPartnerBookingPaid,
  useCheckInPartnerBooking,
  useUndoCheckInPartnerBooking,
  useMarkPartnerBookingNoShow,
  useClearPartnerBookingNoShow,
  useRefundPartnerBooking,
  usePartnerCourts,
  usePartnerVenue,
  deriveVenueAggregates,
  partnerKeys,
  type Booking,
  type BookingStatus,
} from "@/lib/partner-queries";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/date-format";
import {
  getBookerName,
  getBookerEmail,
  isDoublesBooking,
  initialsOf,
  statusMeta,
  StatusPill,
  money,
} from "./booking-utils";
import { BookingDrawer } from "./booking-drawer";

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const PAGE_SIZE = 12;

// ─── CSV export (pure client side, no backend hook needed) ────────────────────
function exportBookingsCsv(rows: Booking[]): void {
  const header = [
    "Müştəri",
    "E-poçt",
    "Kort",
    "Format",
    "Başlama",
    "Müddət (dəq)",
    "Məbləğ",
    "Valyuta",
    "Status",
    "Yaradılma",
  ];
  const escape = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((b) =>
    [
      getBookerName(b),
      getBookerEmail(b),
      b.court_name,
      isDoublesBooking(b) ? "Cütlü" : "Təkli",
      formatDateTime(b.starts_at),
      String(b.duration_minutes),
      (b.total_minor / 100).toFixed(2),
      b.currency,
      statusMeta(b.status).label,
      formatDateTime(b.created_at),
    ]
      .map(escape)
      .join(","),
  );
  // UTF-8 BOM so Excel renders Azerbaijani characters correctly.
  const csv = "﻿" + [header.map(escape).join(","), ...lines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rezervasiyalar-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Stat strip cell ──────────────────────────────────────────────────────────
function StatCell({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone: string;
}): React.JSX.Element {
  return (
    <div className="group relative flex items-center gap-3.5 px-5 py-4">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}
      >
        <Icon className="h-[1.15rem] w-[1.15rem]" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-foregroundMuted">
          {label}
        </p>
        <p className="mt-0.5 font-display text-xl font-bold leading-none  text-foreground tabular-nums">
          {value}
        </p>
      </div>
    </div>
  );
}

function RowSkeleton(): React.JSX.Element {
  return (
    <tr className="border-b border-border">
      <td className="py-4 pl-6 pr-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-surfaceElevated" />
          <div className="space-y-1.5">
            <div className="h-3.5 w-28 animate-pulse rounded bg-surfaceElevated" />
            <div className="h-2.5 w-36 animate-pulse rounded bg-surfaceElevated/70" />
          </div>
        </div>
      </td>
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-3.5 w-20 animate-pulse rounded bg-surfaceElevated" />
        </td>
      ))}
      <td className="py-4 pl-4 pr-6">
        <div className="ml-auto h-7 w-24 animate-pulse rounded-lg bg-surfaceElevated" />
      </td>
    </tr>
  );
}

export default function ReservationsPage(): React.JSX.Element {
  const toast = useToast();

  // Tab View state
  const [viewTab, setViewTab] = useState<"list" | "calendar">("calendar");

  // FILTERS
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [selectedCourtId, setSelectedCourtId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Singles vs Doubles view filter
  const [matchmakingFilter, setMatchmakingFilter] = useState<
    "all" | "singles" | "doubles"
  >("all");

  // CALENDAR SCHEDULER STATE
  const getTodayString = (): string => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const r = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${r}`;
  };
  const [schedulerDate, setSchedulerDate] = useState<string>(getTodayString());

  // Pagination (list view)
  const [page, setPage] = useState(0);

  // Detail drawer
  const [detail, setDetail] = useState<Booking | null>(null);

  // Confirmations
  const [confirmCancel, setConfirmCancel] = useState<Booking | null>(null);
  const [confirmPaid, setConfirmPaid] = useState<Booking | null>(null);

  // New Booking walk-in state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createSlot, setCreateSlot] = useState<{
    courtId: string;
    courtName: string;
    startsAt: Date;
    hourlyPriceMinor: number;
    currency: string;
  } | null>(null);

  const [bookerName, setBookerName] = useState("");
  const [bookerEmail, setBookerEmail] = useState("");
  const [durationMode, setDurationMode] = useState<"standard" | "custom">(
    "standard",
  );
  const [standardDuration, setStandardDuration] = useState(60);
  const [customMinutes, setCustomMinutes] = useState(75);
  // Matchmaking selection during Walk-in creation
  const [matchType, setMatchType] = useState<"singles" | "doubles">("doubles");
  // Whether the walk-in is paid on the spot (cash/terminal) at creation time.
  const [markPaidOnCreate, setMarkPaidOnCreate] = useState(false);

  // Fetch Courts & venue (for header label)
  const { data: courtsData } = usePartnerCourts();
  const courts = useMemo(() => courtsData ?? [], [courtsData]);
  const { data: venue } = usePartnerVenue();
  // Venue aggregates (active courts + starting price) derived from the courts
  // list — mirrors the catalog `courts_count` / `from_price_minor` fields.
  const venueAgg = useMemo(() => deriveVenueAggregates(courts), [courts]);

  const durationMinutes = useMemo(() => {
    return durationMode === "standard" ? standardDuration : customMinutes;
  }, [durationMode, standardDuration, customMinutes]);

  // Query Bookings based on selected Tab
  const bookingsParams = useMemo(() => {
    if (viewTab === "list") {
      return {
        status: status !== "all" ? status : undefined,
        court_id: selectedCourtId !== "all" ? selectedCourtId : undefined,
        q: q.trim() || undefined,
        from: from ? new Date(from + "T00:00:00").toISOString() : undefined,
        to: to ? new Date(to + "T23:59:59").toISOString() : undefined,
        limit: 200,
      };
    } else {
      // Calendar Grid query: strictly fetch all bookings for selected day
      const startOfDay = new Date(schedulerDate + "T00:00:00").toISOString();
      const endOfDay = new Date(schedulerDate + "T23:59:59").toISOString();
      return {
        from: startOfDay,
        to: endOfDay,
        limit: 100,
      };
    }
  }, [viewTab, status, selectedCourtId, q, from, to, schedulerDate]);

  const { data: bookingsData, isLoading, isFetching, isError, refetch } =
    usePartnerBookings(bookingsParams);
  const bookingsRaw = useMemo(() => bookingsData?.results ?? [], [bookingsData]);

  // Dynamic filter for matchmaking view on the frontend
  const bookings = useMemo(() => {
    return bookingsRaw.filter((b) => {
      if (matchmakingFilter === "all") return true;
      const doubles = isDoublesBooking(b);
      if (matchmakingFilter === "doubles") return doubles;
      // "singles" view: anything not explicitly tagged doubles.
      return !doubles;
    });
  }, [bookingsRaw, matchmakingFilter]);

  // Reset to first page whenever the filtered result set changes.
  React.useEffect(() => {
    setPage(0);
  }, [q, status, selectedCourtId, from, to, matchmakingFilter, viewTab]);

  const pageCount = Math.max(1, Math.ceil(bookings.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedBookings = useMemo(
    () => bookings.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [bookings, safePage],
  );

  const qc = useQueryClient();
  const cancelMut = useCancelPartnerBooking();
  const markPaidMut = useMarkPartnerBookingPaid();
  const checkInMut = useCheckInPartnerBooking();
  const undoCheckInMut = useUndoCheckInPartnerBooking();
  const noShowMut = useMarkPartnerBookingNoShow();
  const clearNoShowMut = useClearPartnerBookingNoShow();
  const refundMut = useRefundPartnerBooking();
  const [creating, setCreating] = useState(false);

  // Refund confirmation target.
  const [confirmRefund, setConfirmRefund] = useState<Booking | null>(null);

  // Compute dynamic stats
  const stats = useMemo(() => {
    let paidCount = 0;
    let pendingCount = 0;
    let cancelledCount = 0;
    let revenueMinor = 0;

    bookings.forEach((b) => {
      if (b.status === "paid") {
        paidCount++;
        revenueMinor += b.total_minor;
      } else if (
        b.status === "pending_payment" ||
        b.status === "partially_paid"
      ) {
        pendingCount++;
      } else if (b.status === "cancelled" || b.status === "refunded") {
        cancelledCount++;
      }
    });

    return {
      total: bookings.length,
      paid: paidCount,
      pending: pendingCount,
      cancelled: cancelledCount,
      revenue: (revenueMinor / 100).toFixed(2),
    };
  }, [bookings]);

  const hasActiveFilters =
    Boolean(q) ||
    status !== "all" ||
    selectedCourtId !== "all" ||
    Boolean(from) ||
    Boolean(to);

  const clearFilters = (): void => {
    setQ("");
    setStatus("all");
    setSelectedCourtId("all");
    setFrom("");
    setTo("");
  };

  // Actions handlers
  const handleCancel = async (): Promise<void> => {
    if (!confirmCancel) return;
    const target = confirmCancel;
    setConfirmCancel(null);
    try {
      await cancelMut.mutateAsync({ id: target.id });
      toast.success(
        "Rezervasiya ləğv edildi",
        `${getBookerName(target)} - ${target.court_name}`,
      );
      setDetail((d) => (d && d.id === target.id ? null : d));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        "Əməliyyat uğursuz oldu",
        message || "Rezervasiya ləğv edilə bilmədi",
      );
    }
  };

  const handleMarkPaid = async (): Promise<void> => {
    if (!confirmPaid) return;
    const target = confirmPaid;
    setConfirmPaid(null);
    try {
      await markPaidMut.mutateAsync({ id: target.id });
      toast.success(
        "Rezervasiya ödənildi",
        `${getBookerName(target)} - ${target.court_name}`,
      );
      setDetail((d) =>
        d && d.id === target.id ? { ...d, status: "paid" } : d,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        "Əməliyyat uğursuz oldu",
        message || "Rezervasiya ödənildi olaraq qeyd edilə bilmədi",
      );
    }
  };

  // ── Venue-ops actions (check-in / no-show / refund) ──
  // Optimistically reflect the action in the open drawer too.
  const patchDetail = (id: string, patch: Partial<Booking>): void => {
    setDetail((d) => (d && d.id === id ? { ...d, ...patch } : d));
  };

  const nowIso = (): string => new Date().toISOString();

  const handleCheckIn = async (b: Booking): Promise<void> => {
    try {
      await checkInMut.mutateAsync({ id: b.id });
      patchDetail(b.id, { checked_in_at: nowIso(), no_show_at: null });
      toast.success("Qeydiyyat alındı", `${getBookerName(b)} kortda qeydə alındı.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz oldu", message || "Qeydiyyat alınmadı.");
    }
  };

  const handleUndoCheckIn = async (b: Booking): Promise<void> => {
    try {
      await undoCheckInMut.mutateAsync({ id: b.id });
      patchDetail(b.id, { checked_in_at: null });
      toast.success("Qeydiyyat ləğv edildi", `${getBookerName(b)} üçün qeydiyyat geri alındı.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz oldu", message || "Geri alınmadı.");
    }
  };

  const handleNoShow = async (b: Booking): Promise<void> => {
    try {
      await noShowMut.mutateAsync({ id: b.id });
      patchDetail(b.id, { no_show_at: nowIso(), checked_in_at: null });
      toast.success("Gəlmədi qeyd edildi", `${getBookerName(b)} gəlmədi olaraq işarələndi.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz oldu", message || "Qeyd edilmədi.");
    }
  };

  const handleClearNoShow = async (b: Booking): Promise<void> => {
    try {
      await clearNoShowMut.mutateAsync({ id: b.id });
      patchDetail(b.id, { no_show_at: null });
      toast.success("Təmizləndi", `${getBookerName(b)} üçün "gəlmədi" qeydi silindi.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz oldu", message || "Silinmədi.");
    }
  };

  const handleRefund = async (): Promise<void> => {
    if (!confirmRefund) return;
    const target = confirmRefund;
    setConfirmRefund(null);
    try {
      await refundMut.mutateAsync({ id: target.id, refund_status: "processed" });
      patchDetail(target.id, {
        status: "refunded",
        refund_status: "processed",
        refunded_at: nowIso(),
      });
      toast.success(
        "Geri qaytarıldı",
        `${getBookerName(target)} üçün ${money(target.total_minor, target.currency)} geri qaytarıldı.`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz oldu", message || "Geri qaytarılmadı.");
    }
  };

  const resetCreateForm = (): void => {
    setBookerName("");
    setBookerEmail("");
    setDurationMode("standard");
    setStandardDuration(60);
    setMatchType("doubles");
    setMarkPaidOnCreate(false);
  };

  const handleCreateWalkIn = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!createSlot) return;

    if (!bookerName.trim()) {
      toast.error("Məlumat çatışmır", "Zəhmət olmasa müştəri adını daxil edin.");
      return;
    }
    if (!bookerEmail.trim()) {
      toast.error(
        "Məlumat çatışmır",
        "Zəhmət olmasa müştəri e-mailini daxil edin.",
      );
      return;
    }

    setCreating(true);
    try {
      const formatTag =
        matchType === "doubles" ? "[Cütlü / Doubles]" : "[Təkli / Singles]";
      const finalCustomerName = `${bookerName.trim()} ${formatTag}`;

      // Wired to the real backend createBooking endpoint, which expects
      // `customer_name` / `customer_email` (not booker_*). Sending the correct
      // fields ensures the walk-in customer is persisted and displayed.
      await api.post<Booking>("/api/v1/partner/bookings", {
        court_id: createSlot.courtId,
        starts_at: createSlot.startsAt.toISOString(),
        duration_minutes: durationMinutes,
        customer_name: finalCustomerName,
        customer_email: bookerEmail.trim().toLowerCase(),
        payment_method: markPaidOnCreate ? "onsite" : "manual",
        status: markPaidOnCreate ? "paid" : "pending_payment",
      });

      await qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      await qc.invalidateQueries({ queryKey: partnerKeys.stats });

      toast.success(
        "Rezervasiya yaradıldı",
        markPaidOnCreate
          ? `${bookerName} üçün ödənişli walk-in sifariş təsdiqləndi.`
          : `${bookerName} üçün yerində (walk-in) sifariş yaradıldı.`,
      );
      setIsCreateOpen(false);
      resetCreateForm();
      setCreateSlot(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        "Rezervasiya alınmadı",
        message || "Vaxt toqquşması baş verdi və ya xəta yarandı.",
      );
    } finally {
      setCreating(false);
    }
  };

  // Helper: check if a booking overlaps a court and time cell
  const getBookingForCell = (
    courtId: string,
    hour: number,
  ): Booking | undefined => {
    const cellStart = new Date(
      schedulerDate + "T" + String(hour).padStart(2, "0") + ":00:00",
    );
    const cellEnd = new Date(cellStart.getTime() + 60 * 60 * 1000);

    return bookings.find((b) => {
      if (b.court_id !== courtId) return false;
      if (b.status === "cancelled" || b.status === "refunded") return false;

      const bookingStart = new Date(b.starts_at);
      const bookingEnd = new Date(
        bookingStart.getTime() + b.duration_minutes * 60 * 1000,
      );

      return bookingStart < cellEnd && cellStart < bookingEnd;
    });
  };

  const navigateDate = (days: number): void => {
    const curr = new Date(schedulerDate + "T00:00:00");
    curr.setDate(curr.getDate() + days);
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, "0");
    const d = String(curr.getDate()).padStart(2, "0");
    setSchedulerDate(`${y}-${m}-${d}`);
  };

  const showEmpty = !isLoading && !isError && bookings.length === 0;

  // Live Price Calculation in dialog
  const calculatedPrice = useMemo(() => {
    if (!createSlot) return "0.00";
    const hours = durationMinutes / 60;
    return ((createSlot.hourlyPriceMinor * hours) / 100).toFixed(2);
  }, [createSlot, durationMinutes]);

  const schedulerDateLabel = useMemo(() => {
    const d = new Date(schedulerDate + "T00:00:00");
    return d.toLocaleDateString("az-AZ", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }, [schedulerDate]);

  return (
    <div className="space-y-6">
      {/* ─── Page Heading & Tabs ─────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-[1.6rem] font-bold leading-tight  text-foreground">
              Rezervasiyalar
            </h1>
            {venue?.name ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surfaceElevated px-2.5 py-1 text-[10px] font-bold text-foregroundMuted">
                <MapPin className="h-3 w-3 text-accent" />
                {venue.name}
              </span>
            ) : null}
            {courts.length > 0 ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surfaceElevated px-2.5 py-1 text-[10px] font-bold text-foregroundMuted">
                  <MapPin className="h-3 w-3 text-info" />
                  {venueAgg.courts_count} aktiv kort
                </span>
                {venueAgg.from_price_minor != null ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[10px] font-bold text-accent">
                    <Wallet className="h-3 w-3" />
                    {money(venueAgg.from_price_minor, venueAgg.currency)}-dən
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-foregroundMuted">
            Saatlıq təqvim planını izləyin və daxil olan bütün rezervasiyaları
            tək cədvəldən idarə edin.
          </p>
        </div>

        {/* View Switcher + cross-links */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="gap-1.5 text-xs font-semibold"
          >
            <Link href="/waitlist">
              <Hourglass className="h-3.5 w-3.5" />
              Gözləmə Siyahısı
            </Link>
          </Button>
          <div
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1"
            role="group"
            aria-label="Görünüş seçimi"
          >
            <button
              onClick={() => setViewTab("calendar")}
              aria-pressed={viewTab === "calendar"}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewTab === "calendar"
                  ? "bg-accent text-accent-ink"
                  : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Təqvim
            </button>
            <button
              onClick={() => setViewTab("list")}
              aria-pressed={viewTab === "list"}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewTab === "list"
                  ? "bg-accent text-accent-ink"
                  : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground"
              }`}
            >
              <List className="h-3.5 w-3.5" />
              Siyahı
            </button>
          </div>
        </div>
      </header>

      {/* ─── KPI Stat Strip ──────────────────────────────────────────────── */}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-2 divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-x [&>*]:border-b [&>*]:border-border lg:[&>*]:border-b-0">
          <StatCell
            icon={CalendarCheck}
            label="Cəmi Sifariş"
            value={stats.total}
            tone="bg-accent/10 text-accent"
          />
          <StatCell
            icon={CheckCircle2}
            label="Ödənilib"
            value={stats.paid}
            tone="bg-accent/10 text-accent"
          />
          <StatCell
            icon={AlertCircle}
            label="Gözləyir"
            value={stats.pending}
            tone="bg-warning/10 text-warning"
          />
          <StatCell
            icon={XCircle}
            label="Ləğv edilib"
            value={stats.cancelled}
            tone="bg-danger/10 text-danger"
          />
          <StatCell
            icon={Wallet}
            label="Gəlir"
            value={`${stats.revenue} AZN`}
            tone="bg-accent/10 text-accent"
          />
        </div>
      </Card>

      {/* ─── Matchmaking View Filter ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Gamepad2 className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-foregroundMuted">
            Matchmaking Görünüşü
          </span>
        </div>
        <div
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background/60 p-0.5"
          role="group"
          aria-label="Matchmaking görünüşü"
        >
          {(
            [
              ["all", "Bütün Oyunlar"],
              ["singles", "Təkli (1v1)"],
              ["doubles", "Cütlü (2v2)"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMatchmakingFilter(key)}
              aria-pressed={matchmakingFilter === key}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                matchmakingFilter === key
                  ? "bg-accent text-accent-ink"
                  : "text-foregroundMuted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Load error banner (shared across both tabs) ─────────────────── */}
      {isError ? (
        <div className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-danger/30 bg-danger/[0.07] p-5 sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger/15 text-danger">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-foreground">
                Rezervasiyalar yüklənmədi
              </p>
              <p className="text-sm text-foregroundMuted">
                Şəbəkə bağlantınızı yoxlayıb yenidən cəhd edin.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5 self-start sm:self-auto"
          >
            <RotateCw
              className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            Yenidən cəhd et
          </Button>
        </div>
      ) : null}

      {/* ───────────────────────── TAB 1: CALENDAR VIEW ───────────────────── */}
      {viewTab === "calendar" && (
        <div className="animate-in fade-in-50 space-y-4 duration-200">
          {/* Day Navigation Bar */}
          <Card className="p-0">
            <div className="flex flex-col items-center justify-between gap-4 p-4 sm:flex-row">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => navigateDate(-1)}
                  aria-label="Əvvəlki gün"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input
                  type="date"
                  value={schedulerDate}
                  onChange={(e) => setSchedulerDate(e.target.value)}
                  className="h-9 w-40 text-center font-semibold"
                />
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => navigateDate(1)}
                  aria-label="Növbəti gün"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="ml-1 hidden text-xs font-medium capitalize text-foregroundMuted md:inline">
                  {schedulerDateLabel}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSchedulerDate(getTodayString())}
                  className="text-xs font-semibold"
                >
                  Bugün
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => refetch()}
                  className="gap-1.5 text-xs font-semibold"
                >
                  <RotateCw
                    className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
                  />
                  Yenilə
                </Button>
              </div>
            </div>
          </Card>

          {courts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 p-16 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-warning/10 text-warning">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">
                    Kort Tapılmadı
                  </h3>
                  <p className="mt-1 text-sm text-foregroundMuted">
                    Təqvim planını görmək üçün öncə &quot;Kortlarım&quot;
                    bölməsindən kort əlavə edin.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto overflow-y-hidden rounded-2xl border border-border bg-surface shadow-card">
              <table className="w-full min-w-[700px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-surfaceElevated/40">
                    <th className="w-24 border-r border-border p-4 text-center text-[10px] font-bold text-foregroundMuted">
                      Saat
                    </th>
                    {courts.map((court) => (
                      <th
                        key={court.id}
                        className="border-r border-border p-4 text-center last:border-r-0"
                      >
                        <span className="font-display text-sm font-bold text-foreground">
                          {court.name}
                        </span>
                        <span className="mt-0.5 block text-[9px] font-bold text-foregroundMuted">
                          {court.sport_slug.toUpperCase()} ·{" "}
                          {(court.hourly_price_minor / 100).toFixed(0)}{" "}
                          {court.currency}/saat
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HOURS.map((hour) => {
                    const timeLabel = `${String(hour).padStart(2, "0")}:00`;
                    return (
                      <tr
                        key={hour}
                        className="border-b border-border last:border-b-0"
                      >
                        {/* Hour column */}
                        <td className="select-none border-r border-border bg-surfaceElevated/20 p-3 text-center text-xs font-bold tabular-nums text-foregroundMuted">
                          {timeLabel}
                        </td>

                        {/* Court columns */}
                        {courts.map((court) => {
                          const activeBooking = getBookingForCell(
                            court.id,
                            hour,
                          );

                          if (activeBooking) {
                            const bStart = new Date(activeBooking.starts_at);
                            const startsInThisCell = bStart.getHours() === hour;
                            const meta = statusMeta(activeBooking.status);
                            const isMatchDoubles =
                              isDoublesBooking(activeBooking);
                            const displayNameClean =
                              getBookerName(activeBooking);

                            return (
                              <td
                                key={court.id}
                                className="w-1/4 border-r border-border p-2 align-middle last:border-r-0"
                              >
                                <div
                                  onClick={() => setDetail(activeBooking)}
                                  className={`cursor-pointer rounded-xl border p-2.5 transition-premium hover:shadow-lift hover:-translate-y-px ${meta.soft}`}
                                >
                                  {startsInThisCell ? (
                                    <div className="flex flex-col gap-1.5">
                                      <div className="flex items-start justify-between gap-2">
                                        <span className="flex items-center gap-1.5 truncate">
                                          <span
                                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`}
                                          />
                                          <span className="truncate text-xs font-bold text-foreground">
                                            {displayNameClean}
                                          </span>
                                        </span>
                                        <span className="font-display text-xs font-bold tabular-nums text-foreground">
                                          {(
                                            activeBooking.total_minor / 100
                                          ).toFixed(0)}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between text-[10px] text-foregroundMuted">
                                        <span className="flex items-center gap-1 font-medium tabular-nums">
                                          <Clock className="h-3 w-3" />
                                          {bStart.toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })}
                                          {" · "}
                                          {activeBooking.duration_minutes}d
                                        </span>
                                        <span
                                          className={`font-bold ${
                                            isMatchDoubles
                                              ? "text-accent"
                                              : "text-info"
                                          }`}
                                        >
                                          {isMatchDoubles ? "2v2" : "1v1"}
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="py-0.5 text-center text-[10px] font-medium italic text-foregroundMuted/70">
                                      ↑ {displayNameClean}
                                    </div>
                                  )}
                                </div>
                              </td>
                            );
                          }

                          // Free Slot
                          const cellStart = new Date(
                            schedulerDate +
                              "T" +
                              String(hour).padStart(2, "0") +
                              ":00:00",
                          );
                          return (
                            <td
                              key={court.id}
                              onClick={() => {
                                setCreateSlot({
                                  courtId: court.id,
                                  courtName: court.name,
                                  startsAt: cellStart,
                                  hourlyPriceMinor: court.hourly_price_minor,
                                  currency: court.currency,
                                });
                                setIsCreateOpen(true);
                              }}
                              className="group cursor-pointer select-none border-r border-border p-3 text-center transition-premium last:border-r-0 hover:bg-accent/5"
                            >
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foregroundMuted opacity-25 transition-all group-hover:text-accent group-hover:opacity-100">
                                <Plus className="h-3 w-3" />
                                Sifariş et
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────── TAB 2: LIST VIEW ───────────────────────── */}
      {viewTab === "list" && (
        <div className="animate-in fade-in-50 space-y-4 duration-200">
          {/* Toolbar: search + filters + export */}
          <Card className="p-0">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                {/* Booker Search */}
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Müştəri adı və ya e-poçt ilə axtar…"
                    className="pl-9"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex lg:items-center">
                  {/* Court Selector */}
                  <select
                    value={selectedCourtId}
                    onChange={(e) => setSelectedCourtId(e.target.value)}
                    aria-label="Kort filtri"
                    className="h-10 cursor-pointer rounded-lg border border-border bg-surfaceElevated px-3 text-sm text-foreground transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent lg:w-44"
                  >
                    <option value="all">Bütün Kortlar</option>
                    {courts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.sport_slug.toUpperCase()})
                      </option>
                    ))}
                  </select>

                  {/* Status Filter */}
                  <select
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as BookingStatus | "all")
                    }
                    aria-label="Status filtri"
                    className="h-10 cursor-pointer rounded-lg border border-border bg-surfaceElevated px-3 text-sm text-foreground transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent lg:w-44"
                  >
                    <option value="all">Bütün Statuslar</option>
                    <option value="pending_payment">Ödəniş Gözləyir</option>
                    <option value="partially_paid">Qismən Ödənilib</option>
                    <option value="paid">Ödənilib</option>
                    <option value="cancelled">Ləğv edilib</option>
                    <option value="refunded">Geri qaytarılıb</option>
                    <option value="failed">Uğursuz</option>
                  </select>

                  {/* Date Range */}
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      className="text-xs"
                      aria-label="Başlanğıc tarix"
                    />
                    <span className="text-foregroundMuted">–</span>
                    <Input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className="text-xs"
                      aria-label="Son tarix"
                    />
                  </div>
                </div>
              </div>

              {/* Active filters row */}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex items-center gap-2 text-xs text-foregroundMuted">
                  <Filter className="h-3.5 w-3.5" />
                  <span className="font-medium tabular-nums">
                    {bookings.length} nəticə
                  </span>
                  {hasActiveFilters ? (
                    <button
                      onClick={clearFilters}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-accent transition-colors hover:bg-accent/10"
                    >
                      <X className="h-3 w-3" />
                      Filtrləri təmizlə
                    </button>
                  ) : null}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => exportBookingsCsv(bookings)}
                  disabled={bookings.length === 0}
                  className="gap-1.5 text-xs font-semibold"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV İxrac
                </Button>
              </div>
            </div>
          </Card>

          {/* Bookings Table */}
          <Card className="overflow-hidden p-0">
            {showEmpty ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10">
                  <CalendarDays className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    Rezervasiya Tapılmadı
                  </h3>
                  <p className="mt-1 text-sm text-foregroundMuted">
                    {hasActiveFilters
                      ? "Seçilmiş filtrlərə uyğun heç bir rezervasiya tapılmadı."
                      : "Hələ heç bir rezervasiya qeydə alınmayıb."}
                  </p>
                </div>
                {hasActiveFilters ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Filtrləri təmizlə
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        "Müştəri",
                        "Kort",
                        "Format",
                        "Sifariş Vaxtı",
                        "Müddət",
                        "Məbləğ",
                        "Status",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3.5 text-left text-[10px] font-bold text-foregroundMuted first:pl-6"
                        >
                          {h}
                        </th>
                      ))}
                      <th className="px-4 py-3.5 pr-6 text-right text-[10px] font-bold text-foregroundMuted">
                        Əməliyyatlar
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading && (
                      <>
                        <RowSkeleton />
                        <RowSkeleton />
                        <RowSkeleton />
                        <RowSkeleton />
                        <RowSkeleton />
                      </>
                    )}
                    {!isLoading &&
                      pagedBookings.map((booking) => {
                        const isMatchDoubles = isDoublesBooking(booking);
                        const displayNameClean = getBookerName(booking);

                        return (
                          <tr
                            key={booking.id}
                            onClick={() => setDetail(booking)}
                            className="group cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-surfaceElevated/40"
                          >
                            <td className="py-3 pl-6 pr-4">
                              <div className="flex items-center gap-3">
                                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 font-display text-[11px] font-bold text-accent">
                                  {initialsOf(displayNameClean)}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-foreground">
                                    {displayNameClean}
                                  </p>
                                  <p className="truncate text-[11px] text-foregroundMuted">
                                    {getBookerEmail(booking) || "—"}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm font-semibold text-accent">
                                {booking.court_name}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                                  isMatchDoubles
                                    ? "border-accent/30 bg-accent/10 text-accent"
                                    : "border-info/30 bg-info/10 text-info"
                                }`}
                              >
                                {isMatchDoubles ? "Cütlü" : "Təkli"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium tabular-nums text-foreground">
                              {formatDateTime(booking.starts_at)}
                            </td>
                            <td className="px-4 py-3 text-sm tabular-nums text-foregroundMuted">
                              {booking.duration_minutes} dəq
                            </td>
                            <td className="px-4 py-3 font-display text-sm font-bold tabular-nums text-foreground">
                              {(booking.total_minor / 100).toFixed(2)}{" "}
                              <span className="text-xs font-semibold text-foregroundMuted">
                                {booking.currency}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <StatusPill status={booking.status} />
                            </td>
                            <td
                              className="py-3 pl-4 pr-6 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex justify-end gap-1.5">
                                {(booking.status === "pending_payment" ||
                                  booking.status === "partially_paid") && (
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => setConfirmPaid(booking)}
                                  >
                                    Ödənildi
                                  </Button>
                                )}
                                {(booking.status === "paid" ||
                                  booking.status === "partially_paid") && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setConfirmRefund(booking)}
                                  >
                                    Geri qaytar
                                  </Button>
                                )}
                                {booking.status !== "cancelled" &&
                                  booking.status !== "refunded" && (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => setConfirmCancel(booking)}
                                    >
                                      Ləğv et
                                    </Button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {!isLoading && bookings.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3.5">
                <p className="text-xs text-foregroundMuted tabular-nums">
                  <span className="font-semibold text-foreground">
                    {safePage * PAGE_SIZE + 1}–
                    {Math.min((safePage + 1) * PAGE_SIZE, bookings.length)}
                  </span>{" "}
                  / {bookings.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Əvvəlki
                  </Button>
                  <span className="px-1 text-xs font-semibold text-foregroundMuted tabular-nums">
                    {safePage + 1} / {pageCount}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setPage((p) => Math.min(pageCount - 1, p + 1))
                    }
                    disabled={safePage >= pageCount - 1}
                    className="gap-1"
                  >
                    Növbəti
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      )}

      {/* ─── Detail Slide-over Drawer ────────────────────────────────────── */}
      <BookingDrawer
        booking={detail}
        onClose={() => setDetail(null)}
        onMarkPaid={(b) => setConfirmPaid(b)}
        onCancel={(b) => setConfirmCancel(b)}
        onCheckIn={handleCheckIn}
        onUndoCheckIn={handleUndoCheckIn}
        onNoShow={handleNoShow}
        onClearNoShow={handleClearNoShow}
        onRefund={(b) => setConfirmRefund(b)}
        busy={
          checkInMut.isPending ||
          undoCheckInMut.isPending ||
          noShowMut.isPending ||
          clearNoShowMut.isPending ||
          refundMut.isPending
        }
      />

      {/* ─── DIALOG 1: NEW WALK-IN RESERVATION ───────────────────────────── */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setCreateSlot(null);
            resetCreateForm();
          }
        }}
        title="Yeni Rezervasiya (Walk-in)"
      >
        <form onSubmit={handleCreateWalkIn} className="space-y-4">
          {createSlot && (
            <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-4">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-accent">
                <MapPin className="h-3 w-3" />
                Seçilmiş Kort və Vaxt
              </div>
              <div className="mt-1.5 font-display text-sm font-bold text-foreground">
                {createSlot.courtName}
              </div>
              <div className="text-xs font-medium text-foregroundMuted">
                {formatDateTime(createSlot.startsAt)}
              </div>
            </div>
          )}

          {/* Matchmaking Selection */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold text-foregroundMuted">
              Oyun Formatı
            </Label>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surfaceElevated/50 p-1">
              {(
                [
                  ["singles", "Təkli (1v1)"],
                  ["doubles", "Cütlü (2v2)"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMatchType(key)}
                  className={`h-9 rounded-lg text-xs font-semibold transition-colors ${
                    matchType === key
                      ? "bg-accent text-accent-ink"
                      : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Booker Name */}
          <div className="space-y-1.5">
            <Label
              htmlFor="booker-name"
              className="text-[10px] font-bold text-foregroundMuted"
            >
              Müştərinin Adı və Soyadı
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
              <Input
                id="booker-name"
                value={bookerName}
                onChange={(e) => setBookerName(e.target.value)}
                placeholder="Məs. Kamran Namazov"
                className="pl-9"
                required
              />
            </div>
          </div>

          {/* Booker Email */}
          <div className="space-y-1.5">
            <Label
              htmlFor="booker-email"
              className="text-[10px] font-bold text-foregroundMuted"
            >
              Müştərinin E-poçt Ünvanı
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
              <Input
                id="booker-email"
                type="email"
                value={bookerEmail}
                onChange={(e) => setBookerEmail(e.target.value)}
                placeholder="Məs. kamran@linkfit.az"
                className="pl-9"
                required
              />
            </div>
            <p className="text-[10px] italic text-foregroundMuted/80">
              Qeyd edilən e-poçt üzrə sistemdə istifadəçi yoxdursa, avtomatik
              müvəqqəti qonaq hesabı yaradılacaq.
            </p>
          </div>

          {/* Duration Mode */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold text-foregroundMuted">
              Sifarişin Müddəti
            </Label>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surfaceElevated/50 p-1">
              {(
                [
                  ["standard", "Standart Saatlar"],
                  ["custom", "Xüsusi Müddət"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDurationMode(key)}
                  className={`h-9 rounded-lg text-xs font-semibold transition-colors ${
                    durationMode === key
                      ? "bg-accent text-accent-ink"
                      : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration Selector */}
          {durationMode === "standard" ? (
            <select
              id="duration-minutes-select"
              value={standardDuration}
              onChange={(e) => setStandardDuration(Number(e.target.value))}
              className="h-10 w-full cursor-pointer rounded-lg border border-border bg-surfaceElevated px-3 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value={60}>60 dəqiqə (1 saat)</option>
              <option value={90}>90 dəqiqə (1.5 saat)</option>
              <option value={120}>120 dəqiqə (2 saat)</option>
              <option value={180}>180 dəqiqə (3 saat)</option>
              <option value={240}>240 dəqiqə (4 saat)</option>
            </select>
          ) : (
            <div className="animate-in slide-in-from-top-1 space-y-1.5 duration-150">
              <Label
                htmlFor="custom-duration-input"
                className="text-xs text-foregroundMuted"
              >
                Müddət (Dəqiqə ilə, addım: 15 dəqiqə)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="custom-duration-input"
                  type="number"
                  value={customMinutes}
                  onChange={(e) =>
                    setCustomMinutes(Math.max(15, Number(e.target.value)))
                  }
                  step={15}
                  min={15}
                  max={480}
                  className="text-center font-bold tabular-nums"
                />
                <span className="flex shrink-0 items-center rounded-lg border border-border bg-surfaceElevated px-3 text-xs font-bold text-foreground">
                  {(customMinutes / 60).toFixed(2)} saat
                </span>
              </div>
            </div>
          )}

          {/* Live price quote */}
          <div className="flex items-center justify-between rounded-xl border border-border bg-surfaceElevated p-4">
            <div>
              <span className="flex items-center gap-1 text-[10px] font-bold text-foregroundMuted">
                <Wallet className="h-3.5 w-3.5 text-accent" />
                Ödəniləcək Məbləğ
              </span>
              <p className="mt-0.5 text-[10px] italic text-foregroundMuted/80">
                Nağd / Terminal yerində ödəniş
              </p>
            </div>
            <span className="font-display text-2xl font-bold tabular-nums text-accent">
              {calculatedPrice}{" "}
              <span className="text-sm text-foregroundMuted">
                {createSlot?.currency || "AZN"}
              </span>
            </span>
          </div>

          {/* Paid-on-create toggle */}
          <label className="flex cursor-pointer select-none items-center gap-3 rounded-xl border border-border bg-surfaceElevated/50 p-3">
            <input
              type="checkbox"
              checked={markPaidOnCreate}
              onChange={(e) => setMarkPaidOnCreate(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span className="text-sm font-medium text-foreground">
              Ödəniş yerində alınıb (nağd / terminal)
              <span className="block text-[10px] font-normal text-foregroundMuted/80">
                İşarələnsə, sifariş dərhal &quot;Ödənilib&quot; statusu ilə
                yaradılacaq.
              </span>
            </span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsCreateOpen(false);
                resetCreateForm();
                setCreateSlot(null);
              }}
              disabled={creating}
            >
              İmtina
            </Button>
            <Button type="submit" variant="primary" disabled={creating}>
              {creating ? "Rezervasiya edilir…" : "Sifarişi Təsdiqlə"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ─── DIALOG 2: CANCEL CONFIRMATION ───────────────────────────────── */}
      <Dialog
        open={confirmCancel !== null}
        onOpenChange={(open) => (open ? null : setConfirmCancel(null))}
        title="Rezervasiyanın Ləğv Edilməsi"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-foregroundMuted">
            Kort{" "}
            <span className="font-semibold text-foreground">
              &quot;{confirmCancel?.court_name}&quot;
            </span>{" "}
            üçün{" "}
            <span className="font-semibold text-foreground">
              {confirmCancel ? getBookerName(confirmCancel) : ""}
            </span>{" "}
            tərəfindən edilmiş sifarişi ləğv etməyə əminsiniz? Seçilmiş vaxt
            slotu dərhal boşalacaqdır.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmCancel(null)}
              disabled={cancelMut.isPending}
            >
              İmtina
            </Button>
            <Button
              variant="danger"
              onClick={handleCancel}
              disabled={cancelMut.isPending}
            >
              {cancelMut.isPending ? "Ləğv edilir…" : "Bəli, ləğv edilsin"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ─── DIALOG 3: MARK PAID CONFIRMATION ────────────────────────────── */}
      <Dialog
        open={confirmPaid !== null}
        onOpenChange={(open) => (open ? null : setConfirmPaid(null))}
        title="Ödənişin Təsdiq Edilməsi"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-foregroundMuted">
            <span className="font-semibold text-foreground">
              {confirmPaid ? getBookerName(confirmPaid) : ""}
            </span>{" "}
            tərəfindən kort{" "}
            <span className="font-semibold text-foreground">
              &quot;{confirmPaid?.court_name}&quot;
            </span>{" "}
            üçün yerində (walk-in) edilən{" "}
            <span className="font-semibold text-accent">
              {confirmPaid
                ? money(confirmPaid.total_minor, confirmPaid.currency)
                : ""}
            </span>{" "}
            həcmində ödənişin qəbul edildiyini təsdiqləyirsiniz?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmPaid(null)}
              disabled={markPaidMut.isPending}
            >
              İmtina
            </Button>
            <Button
              variant="primary"
              onClick={handleMarkPaid}
              disabled={markPaidMut.isPending}
            >
              {markPaidMut.isPending ? "Gözləyin…" : "Ödənişi Təsdiqlə"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ─── DIALOG 4: REFUND CONFIRMATION ───────────────────────────────── */}
      <Dialog
        open={confirmRefund !== null}
        onOpenChange={(open) => (open ? null : setConfirmRefund(null))}
        title="Geri Qaytarmanın Təsdiqi"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-foregroundMuted">
            <span className="font-semibold text-foreground">
              {confirmRefund ? getBookerName(confirmRefund) : ""}
            </span>{" "}
            tərəfindən kort{" "}
            <span className="font-semibold text-foreground">
              &quot;{confirmRefund?.court_name}&quot;
            </span>{" "}
            üçün ödənilmiş{" "}
            <span className="font-semibold text-accent">
              {confirmRefund
                ? money(confirmRefund.total_minor, confirmRefund.currency)
                : ""}
            </span>{" "}
            məbləğini geri qaytarmaq istədiyinizə əminsiniz? Rezervasiyanın
            statusu &quot;Geri qaytarılıb&quot; olaraq dəyişəcək.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmRefund(null)}
              disabled={refundMut.isPending}
            >
              İmtina
            </Button>
            <Button
              variant="danger"
              onClick={handleRefund}
              disabled={refundMut.isPending}
            >
              {refundMut.isPending ? "Gözləyin…" : "Bəli, geri qaytar"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
