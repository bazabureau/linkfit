"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, API_BASE_URL, apiHeaders } from "@/lib/api";
import { ACCESS_TOKEN_COOKIE, getCookie } from "@/lib/cookies";
import {
  useAdminBookings,
  useBulkUpdateBookings,
  useCancelBooking,
  useCheckInBooking,
  useClearNoShowBooking,
  useMarkBookingPaid,
  useNoShowBooking,
  useRefundBooking,
  useUndoCheckInBooking,
  type Booking,
} from "@/lib/admin-queries";
import { useVenueCourts, venuesKeys, type Venue } from "@/lib/admin-venues";
import { useI18n } from "@/lib/i18n";
import { BookingFilters, type FilterState } from "./BookingFilters";
import { BookingsTable } from "./BookingsTable";
import { BookingDetailDrawer } from "./BookingDetailDrawer";
import { StatCards, type BookingStats } from "./StatCards";
import {
  BookingEditDialog,
  CancelBookingDialog,
  CreateBookingDialog,
  RefundBookingDialog,
} from "./dialogs";
import { PAGE_SIZE, dateInputToIso, isClosed } from "./lib";

type DialogMode = "edit" | "cancel" | "refund" | "create" | null;

const INITIAL_FILTERS: FilterState = {
  q: "",
  status: "all",
  venueId: "all",
  courtId: "all",
  from: "",
  to: "",
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  });
  return qs.toString();
}

export default function BookingsPage(): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();

  const [filters, setFilters] = React.useState<FilterState>(INITIAL_FILTERS);
  const [page, setPage] = React.useState(0);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [drawerBooking, setDrawerBooking] = React.useState<Booking | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [dialogMode, setDialogMode] = React.useState<DialogMode>(null);
  const [activeBooking, setActiveBooking] = React.useState<Booking | null>(null);

  // Any filter change resets to the first page so we never land on an
  // out-of-range offset (which would render an empty list with a stale count).
  React.useEffect(() => {
    setPage(0);
  }, [filters]);

  // Admin venues endpoint covers *any* publish state (draft/pending/suspended),
  // not just published — used by both the filter and the manual-booking dialog.
  const { data: venues = [] } = useQuery({
    queryKey: venuesKeys.list({ limit: 200 }),
    queryFn: async () => {
      const res = await api.get<{ items?: Venue[]; results?: Venue[] }>(
        "/api/v1/admin/venues?limit=200&offset=0",
      );
      return res.items ?? res.results ?? [];
    },
    staleTime: 60_000,
  });
  const { data: courts = [] } = useVenueCourts(
    filters.venueId !== "all" ? filters.venueId : undefined,
  );

  const baseFilterParams = React.useMemo(
    () => ({
      status: filters.status !== "all" ? filters.status : undefined,
      venue_id: filters.venueId !== "all" ? filters.venueId : undefined,
      court_id: filters.courtId !== "all" ? filters.courtId : undefined,
      q: filters.q.trim() || undefined,
      from: dateInputToIso(filters.from),
      to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined,
    }),
    [filters],
  );

  const params = React.useMemo(
    () => ({ ...baseFilterParams, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [baseFilterParams, page],
  );

  const { data: bookingsData, isFetching, isLoading, refetch } = useAdminBookings(params);
  const bookings = React.useMemo(() => bookingsData?.results ?? [], [bookingsData]);

  // Stat cards summarise the *whole* filtered set (up to the backend's 100 cap),
  // so they stay stable as you page through results.
  const statsParams = React.useMemo(
    () => ({ ...baseFilterParams, limit: 100, offset: 0 }),
    [baseFilterParams],
  );
  const { data: statsData, isLoading: statsLoading } = useAdminBookings(statsParams);
  const statsRows = statsData?.results ?? bookings;

  const cancelBooking = useCancelBooking();
  const markPaid = useMarkBookingPaid();
  const refundBooking = useRefundBooking();
  const checkIn = useCheckInBooking();
  const undoCheckIn = useUndoCheckInBooking();
  const markNoShow = useNoShowBooking();
  const clearNoShow = useClearNoShowBooking();
  const bulkUpdate = useBulkUpdateBookings();

  // Drop selections for rows no longer present after a refetch/page change.
  React.useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => bookings.some((booking) => booking.id === id)),
    );
  }, [bookings]);

  // Keep the open drawer in sync with the freshest list row.
  React.useEffect(() => {
    if (!drawerBooking) return;
    const fresh = bookings.find((b) => b.id === drawerBooking.id);
    if (fresh && fresh !== drawerBooking) setDrawerBooking(fresh);
  }, [bookings, drawerBooking]);

  const stats = React.useMemo<BookingStats>(() => {
    const now = Date.now();
    return statsRows.reduce<BookingStats>(
      (acc, booking) => {
        const starts = new Date(booking.starts_at).getTime();
        acc.total += 1;
        if (starts >= now && !isClosed(booking.status)) acc.upcoming += 1;
        if (booking.status === "paid") {
          acc.paid += 1;
          acc.revenue += booking.total_minor;
        }
        if (booking.status === "pending_payment" || booking.status === "partially_paid") {
          acc.unpaid += 1;
        }
        if (booking.status === "cancelled" || booking.status === "refunded") acc.closed += 1;
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
  }, [statsRows]);

  function updateFilters(patch: Partial<FilterState>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function openDrawer(booking: Booking) {
    setDrawerBooking(booking);
    setDrawerOpen(true);
  }

  function openDialog(mode: DialogMode, booking?: Booking) {
    setActiveBooking(booking ?? null);
    setDialogMode(mode);
  }

  function closeDialog() {
    setDialogMode(null);
    setActiveBooking(null);
  }

  async function runBookingAction(label: string, action: () => Promise<unknown>) {
    try {
      await action();
      toast.success(label);
    } catch (error) {
      toast.error(
        t("Əməliyyat alınmadı"),
        error instanceof Error ? error.message : t("Yenidən yoxlayın"),
      );
    }
  }

  // Quick row + drawer actions (shared).
  const rowActions = React.useMemo(
    () => ({
      onOpen: openDrawer,
      onMarkPaid: (b: Booking) =>
        runBookingAction(t("Rezervasiya ödənildi"), () => markPaid.mutateAsync({ id: b.id })),
      onCheckIn: (b: Booking) =>
        runBookingAction(t("Check-in qeyd edildi"), () => checkIn.mutateAsync({ id: b.id })),
      onUndoCheckIn: (b: Booking) =>
        runBookingAction(t("Check-in geri alındı"), () =>
          undoCheckIn.mutateAsync({ id: b.id }),
        ),
      onNoShow: (b: Booking) =>
        runBookingAction(t("No-show qeyd edildi"), () => markNoShow.mutateAsync({ id: b.id })),
      onClearNoShow: (b: Booking) =>
        runBookingAction(t("No-show silindi"), () => clearNoShow.mutateAsync({ id: b.id })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markPaid, checkIn, undoCheckIn, markNoShow, clearNoShow, t],
  );

  const drawerActions = React.useMemo(
    () => ({
      ...rowActions,
      onEdit: (b: Booking) => openDialog("edit", b),
      onCancel: (b: Booking) => openDialog("cancel", b),
      onRefund: (b: Booking) => openDialog("refund", b),
    }),
    [rowActions],
  );

  async function exportCsv() {
    try {
      const qs = buildQuery({
        status: baseFilterParams.status,
        venue_id: baseFilterParams.venue_id,
        court_id: baseFilterParams.court_id,
        q: baseFilterParams.q,
        from: baseFilterParams.from,
        to: baseFilterParams.to,
      });
      const token = getCookie(ACCESS_TOKEN_COOKIE);
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/bookings/export${qs ? `?${qs}` : ""}`,
        { headers: apiHeaders(undefined, token) },
      );
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
      toast.error(
        t("Export alınmadı"),
        error instanceof Error ? error.message : t("Yenidən yoxlayın"),
      );
    }
  }

  const totalCount = bookingsData?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rangeStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(totalCount, page * PAGE_SIZE + bookings.length);
  const canPrev = page > 0;
  const canNext = (page + 1) * PAGE_SIZE < totalCount;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold   text-accent">
            {t("Rezervasiyalar")}
          </p>
          <h1 className="mt-2 font-display text-[1.6rem] font-bold  text-foreground">
            {t("Booking əməliyyatları")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Kort rezervasiyaları, ödəniş, refund və giriş qeydiyyatı.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Yenilə")}
          </Button>
          <Button variant="outline" onClick={() => void exportCsv()}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button onClick={() => openDialog("create")}>
            <CalendarPlus className="h-4 w-4" />
            {t("Manual booking")}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <StatCards stats={stats} totalCount={totalCount} loading={statsLoading && !statsData} />

      {/* Filters */}
      <BookingFilters
        value={filters}
        onChange={updateFilters}
        onReset={() => setFilters(INITIAL_FILTERS)}
        venues={venues}
        courts={courts}
      />

      {/* Bulk action bar */}
      {selectedIds.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-ink bg-ink px-4 py-3 text-white shadow-lift sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-ink">
              {selectedIds.length}
            </span>
            {t("rezervasiya seçilib")}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                runBookingAction(t("Seçilən rezervasiyalar ödənişli edildi"), async () => {
                  await bulkUpdate.mutateAsync({
                    ids: selectedIds,
                    status: "paid",
                    payment_method: "manual",
                  });
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
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/10"
              onClick={() => setSelectedIds([])}
            >
              <X className="h-3.5 w-3.5" />
              {t("Seçimi təmizlə")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Table card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold text-foreground">
              {t("Rezervasiya siyahısı")}
            </h2>
            <p className="text-xs text-foregroundMuted">
              {totalCount === 0
                ? `0 ${t("göstərilir")}`
                : `${rangeStart}–${rangeEnd} / ${totalCount}`}
            </p>
          </div>
          {isFetching ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">
              <RefreshCw className="h-3 w-3 animate-spin" />
              {t("Yenilənir")}
            </span>
          ) : null}
        </div>

        <BookingsTable
          bookings={bookings}
          loading={isLoading}
          selectedIds={selectedIds}
          onToggle={(id, checked) =>
            setSelectedIds((current) =>
              checked ? [...current, id] : current.filter((x) => x !== id),
            )
          }
          onToggleAll={(checked) =>
            setSelectedIds(checked ? bookings.map((b) => b.id) : [])
          }
          actions={rowActions}
        />

        {totalCount > PAGE_SIZE ? (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-5 py-3 sm:flex-row">
            <p className="text-sm text-foregroundMuted">
              {t("Səhifə")}{" "}
              <span className="font-semibold text-foreground">{page + 1}</span> / {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!canPrev || isFetching}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                {t("Əvvəlki")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canNext || isFetching}
                onClick={() => setPage((current) => current + 1)}
              >
                {t("Növbəti")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Detail slide-over */}
      <BookingDetailDrawer
        booking={drawerBooking}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        actions={drawerActions}
      />

      {/* Modals */}
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
