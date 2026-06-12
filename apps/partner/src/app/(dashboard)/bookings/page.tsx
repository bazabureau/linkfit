"use client";

import React, { useMemo, useState } from "react";
import {
  CalendarDays,
  Search,
  CheckCircle2,
  DollarSign,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  usePartnerBookings,
  useCancelPartnerBooking,
  useMarkPartnerBookingPaid,
  usePartnerCourts,
  useCreatePartnerBooking,
  type Booking,
  type BookingStatus,
} from "@/lib/partner-queries";

function RowSkeleton(): React.JSX.Element {
  return (
    <TableRow>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-surfaceElevated" />
        </TableCell>
      ))}
    </TableRow>
  );
}

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

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
  const [matchmakingFilter, setMatchmakingFilter] = useState<"all" | "singles" | "doubles">("all");

  // CALENDAR SCHEDULER STATE
  const getTodayString = (): string => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const r = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${r}`;
  };
  const [schedulerDate, setSchedulerDate] = useState<string>(getTodayString());

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
  const [durationMode, setDurationMode] = useState<"standard" | "custom">("standard");
  const [standardDuration, setStandardDuration] = useState(60);
  const [customMinutes, setCustomMinutes] = useState(75);
  // Matchmaking selection during Walk-in creation
  const [matchType, setMatchType] = useState<"singles" | "doubles">("doubles");

  // Fetch Courts
  const { data: courts = [] } = usePartnerCourts();

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
        limit: 100,
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

  const { data: bookingsData, isLoading, refetch } = usePartnerBookings(bookingsParams);
  const bookingsRaw = useMemo(() => bookingsData?.results ?? [], [bookingsData]);

  // Dynamic filter for matchmaking view on the frontend
  const bookings = useMemo(() => {
    return bookingsRaw.filter((b) => {
      if (matchmakingFilter === "all") return true;
      const isDoubles = b.booker_display_name.includes("[Doubles]") || b.booker_display_name.includes("[Cütlü]");
      const isSingles = b.booker_display_name.includes("[Singles]") || b.booker_display_name.includes("[Təkli]");
      
      if (matchmakingFilter === "doubles") return isDoubles;
      if (matchmakingFilter === "singles") return isSingles || (!isDoubles && !isSingles); // default to singles if no tag present
      return true;
    });
  }, [bookingsRaw, matchmakingFilter]);

  const cancelMut = useCancelPartnerBooking();
  const markPaidMut = useMarkPartnerBookingPaid();
  const createMut = useCreatePartnerBooking();

  // Compute dynamic stats
  const stats = useMemo(() => {
    const totalCount = bookings.length;
    let paidCount = 0;
    let pendingCount = 0;
    let cancelledCount = 0;
    let revenueMinor = 0;

    bookings.forEach((b) => {
      if (b.status === "paid") {
        paidCount++;
        revenueMinor += b.total_minor;
      } else if (b.status === "pending_payment" || b.status === "partially_paid") {
        pendingCount++;
      } else if (b.status === "cancelled" || b.status === "refunded") {
        cancelledCount++;
      }
    });

    return {
      total: totalCount,
      paid: paidCount,
      pending: pendingCount,
      cancelled: cancelledCount,
      revenue: (revenueMinor / 100).toFixed(2),
    };
  }, [bookings]);

  // Actions handlers
  const handleCancel = async (): Promise<void> => {
    if (!confirmCancel) return;
    const target = confirmCancel;
    setConfirmCancel(null);
    try {
      await cancelMut.mutateAsync({ id: target.id });
      toast.success("Rezervasiya ləğv edildi", `${target.booker_display_name} - ${target.court_name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz oldu", message || "Rezervasiya ləğv edilə bilmədi");
    }
  };

  const handleMarkPaid = async (): Promise<void> => {
    if (!confirmPaid) return;
    const target = confirmPaid;
    setConfirmPaid(null);
    try {
      await markPaidMut.mutateAsync({ id: target.id });
      toast.success("Rezervasiya ödənildi", `${target.booker_display_name} - ${target.court_name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz oldu", message || "Rezervasiya ödənildi olaraq qeyd edilə bilmədi");
    }
  };

  const handleCreateWalkIn = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!createSlot) return;

    if (!bookerName.trim()) {
      toast.error("Məlumat çatışmır", "Zəhmət olmasa müştəri adını daxil edin.");
      return;
    }
    if (!bookerEmail.trim()) {
      toast.error("Məlumat çatışmır", "Zəhmət olmasa müştəri e-mailini daxil edin.");
      return;
    }

    try {
      const formatTag = matchType === "doubles" ? "[Cütlü / Doubles]" : "[Təkli / Singles]";
      const finalBookerName = `${bookerName.trim()} ${formatTag}`;
      const idempotencyKey = `walkin_${createSlot.courtId}_${createSlot.startsAt.getTime()}_${Math.random().toString(36).substring(7)}`;

      await createMut.mutateAsync({
        court_id: createSlot.courtId,
        starts_at: createSlot.startsAt.toISOString(),
        duration_minutes: durationMinutes,
        booker_display_name: finalBookerName,
        booker_email: bookerEmail.trim().toLowerCase(),
        idempotency_key: idempotencyKey,
      });

      toast.success("Rezervasiya yaradıldı", `${bookerName} üçün yerində (walk-in) sifariş təsdiqləndi.`);
      setIsCreateOpen(false);
      setBookerName("");
      setBookerEmail("");
      setDurationMode("standard");
      setStandardDuration(60);
      setMatchType("doubles");
      setCreateSlot(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Rezervasiya alınmadı", message || "Vaxt toqquşması baş verdi və ya xəta yarandı.");
    }
  };

  // Helper: check if a booking overlaps a court and time cell
  const getBookingForCell = (courtId: string, hour: number): Booking | undefined => {
    const cellStart = new Date(schedulerDate + "T" + String(hour).padStart(2, "0") + ":00:00");
    const cellEnd = new Date(cellStart.getTime() + 60 * 60 * 1000);

    return bookings.find((b) => {
      if (b.court_id !== courtId) return false;
      if (b.status === "cancelled" || b.status === "refunded") return false;

      const bookingStart = new Date(b.starts_at);
      const bookingEnd = new Date(bookingStart.getTime() + b.duration_minutes * 60 * 1000);

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

  const showEmpty = !isLoading && bookings.length === 0;

  // Live Price Calculation in dialog
  const calculatedPrice = useMemo(() => {
    if (!createSlot) return "0.00";
    const hours = durationMinutes / 60;
    return ((createSlot.hourlyPriceMinor * hours) / 100).toFixed(2);
  }, [createSlot, durationMinutes]);

  return (
    <div className="space-y-6">
      {/* Page Heading & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            Rezervasiyalar və Təqvim Planı
            <Badge variant="neutral" className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 ml-2">
              Baku Padel Club
            </Badge>
          </h1>
          <p className="text-sm font-normal text-foregroundMuted/90 leading-relaxed">
            Məkanınızın həm saatlıq təqvim planını izləyin, həm də daxil olan bütün rezervasiyaları cədvəl üzərindən idarə edin.
          </p>
        </div>

        {/* Premium View Switcher */}
        <div className="flex items-center self-start sm:self-center gap-1 bg-surfaceElevated p-1 rounded-xl border border-border">
          <Button
            variant={viewTab === "calendar" ? "primary" : "secondary"}
            size="sm"
            className="rounded-lg py-1.5 px-3 flex items-center gap-1.5 text-xs font-semibold"
            onClick={() => setViewTab("calendar")}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Vizual Təqvim
          </Button>
          <Button
            variant={viewTab === "list" ? "primary" : "secondary"}
            size="sm"
            className="rounded-lg py-1.5 px-3 flex items-center gap-1.5 text-xs font-semibold"
            onClick={() => setViewTab("list")}
          >
            <List className="h-3.5 w-3.5" />
            Siyahı Görünüşü
          </Button>
        </div>
      </div>

      {/* Spacing Patch: Harmonized KPI Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="border border-border bg-surface">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 rounded-xl bg-accent/10 text-accent">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-foregroundMuted">Cəmi Sifariş</p>
              <h3 className="text-2xl font-bold text-foreground mt-0.5 tabular-nums">{stats.total}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border bg-surface">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-foregroundMuted">Ödənilib</p>
              <h3 className="text-2xl font-bold text-foreground mt-0.5 tabular-nums">{stats.paid}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border bg-surface">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-foregroundMuted">Gözləyir</p>
              <h3 className="text-2xl font-bold text-foreground mt-0.5 tabular-nums">{stats.pending}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border bg-surface">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 rounded-xl bg-rose-500/10 text-rose-500">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-foregroundMuted">Ləğv edilib</p>
              <h3 className="text-2xl font-bold text-foreground mt-0.5 tabular-nums">{stats.cancelled}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border bg-surface">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-foregroundMuted">Gəlir</p>
              <h3 className="text-2xl font-bold text-foreground mt-0.5 tabular-nums">{stats.revenue} AZN</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Matchmaking View Filter tabs (Baku Padel Premium Focus) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surfaceElevated/40 p-2.5 rounded-xl border border-border">
        <div className="flex items-center gap-1.5">
          <Gamepad2 className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-foregroundMuted">Matchmaking Görünüşü:</span>
        </div>
        <div className="flex items-center gap-1 bg-background/60 p-0.5 rounded-lg border border-border">
          <Button
            variant={matchmakingFilter === "all" ? "primary" : "secondary"}
            size="sm"
            className="text-[11px] h-7 px-2.5 font-medium rounded-md"
            onClick={() => setMatchmakingFilter("all")}
          >
            Bütün Oyunlar
          </Button>
          <Button
            variant={matchmakingFilter === "singles" ? "primary" : "secondary"}
            size="sm"
            className="text-[11px] h-7 px-2.5 font-medium rounded-md"
            onClick={() => setMatchmakingFilter("singles")}
          >
            Təkli (1v1)
          </Button>
          <Button
            variant={matchmakingFilter === "doubles" ? "primary" : "secondary"}
            size="sm"
            className="text-[11px] h-7 px-2.5 font-medium rounded-md"
            onClick={() => setMatchmakingFilter("doubles")}
          >
            Cütlü (2v2)
          </Button>
        </div>
      </div>

      {/* ───────────────────────── TAB 1: CALENDAR VIEW ───────────────────────── */}
      {viewTab === "calendar" && (
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          {/* Day Navigation Bar */}
          <Card className="border border-border bg-surface">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigateDate(-1)}
                  className="p-2 rounded-lg border border-border hover:bg-surfaceElevated"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input
                  type="date"
                  value={schedulerDate}
                  onChange={(e) => setSchedulerDate(e.target.value)}
                  className="w-40 h-9 font-semibold text-center border-border bg-surfaceElevated focus:ring-accent"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigateDate(1)}
                  className="p-2 rounded-lg border border-border hover:bg-surfaceElevated"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSchedulerDate(getTodayString())}
                  className="text-xs font-medium"
                >
                  Bugün
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => refetch()}
                  className="text-xs font-medium"
                >
                  Yenilə
                </Button>
              </div>
            </CardContent>
          </Card>

          {courts.length === 0 ? (
            <Card className="border border-border bg-surface text-center">
              <CardContent className="p-16 flex flex-col items-center justify-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-amber-500/10 grid place-items-center text-amber-500">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Kort Tapılmadı</h3>
                  <p className="text-sm text-foregroundMuted mt-1">
                    Təqvim planını görmək üçün öncə &quot;Kortlarım&quot; bölməsindən kort əlavə edin.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="border border-border bg-surface rounded-2xl shadow-card overflow-hidden overflow-x-auto">
              <table className="w-full border-collapse text-left min-w-[700px]">
                <thead>
                  <tr className="border-b border-border bg-surfaceElevated/50">
                    <th className="p-4 w-28 text-center text-xs font-semibold text-foregroundMuted uppercase tracking-wider border-r border-border">
                      Saat
                    </th>
                    {courts.map((court) => (
                      <th
                        key={court.id}
                        className="p-4 text-center text-sm font-bold text-accent tracking-wide border-r border-border last:border-r-0"
                      >
                        {court.name}
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-foregroundMuted mt-0.5">
                          {court.sport_slug.toUpperCase()} • {(court.hourly_price_minor / 100).toFixed(2)} {court.currency}/saat
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HOURS.map((hour) => {
                    const timeLabel = `${String(hour).padStart(2, "0")}:00`;
                    return (
                      <tr key={hour} className="border-b border-border last:border-b-0 hover:bg-surfaceElevated/10">
                        {/* Hour column */}
                        <td className="p-3 text-center text-xs font-bold text-foregroundMuted bg-surfaceElevated/20 border-r border-border select-none tabular-nums">
                          {timeLabel}
                        </td>

                        {/* Court columns */}
                        {courts.map((court) => {
                          const activeBooking = getBookingForCell(court.id, hour);

                          if (activeBooking) {
                            const bStart = new Date(activeBooking.starts_at);
                            const startsInThisCell = bStart.getHours() === hour;

                            const isPaid = activeBooking.status === "paid";
                            const isPending =
                              activeBooking.status === "pending_payment" ||
                              activeBooking.status === "partially_paid";

                            const isMatchDoubles = activeBooking.booker_display_name.includes("[Doubles]") || activeBooking.booker_display_name.includes("[Cütlü]");

                            // Clean Booker Name for display (remove tag)
                            const displayNameClean = activeBooking.booker_display_name
                              .replace(/\[Cütlü \/ Doubles\]/g, "")
                              .replace(/\[Təkli \/ Singles\]/g, "")
                              .trim();

                            return (
                              <td
                                key={court.id}
                                className="p-2 border-r border-border last:border-r-0 align-middle w-1/4"
                              >
                                <div
                                  onClick={() => {
                                    // Clicking cell triggers clean detailed action modal instead of micro actions
                                    if (isPending) setConfirmPaid(activeBooking);
                                    else setConfirmCancel(activeBooking);
                                  }}
                                  className={`rounded-xl p-3 flex flex-col gap-1.5 border transition-all cursor-pointer hover:scale-[1.02] shadow-md transition-premium ${
                                    isPaid
                                      ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-200 hover:bg-emerald-950/40"
                                      : isPending
                                        ? "bg-amber-950/20 border-amber-500/30 text-amber-200 hover:bg-amber-950/40"
                                        : "bg-surfaceElevated border-border text-foregroundMuted"
                                  }`}
                                >
                                  {startsInThisCell ? (
                                    <>
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex flex-col min-w-0">
                                          <span className="font-bold text-xs truncate max-w-[130px] text-foreground">
                                            {displayNameClean}
                                          </span>
                                          <div className="flex gap-1 mt-0.5">
                                            {isMatchDoubles ? (
                                              <Badge variant="success" className="text-[8px] font-bold uppercase tracking-wide px-1 py-0 h-3.5">
                                                Cütlü (2v2)
                                              </Badge>
                                            ) : (
                                              <Badge variant="warning" className="text-[8px] font-bold uppercase tracking-wide px-1 py-0 h-3.5 bg-blue-500/10 text-blue-400 border-blue-500/20">
                                                Təkli (1v1)
                                              </Badge>
                                            )}
                                          </div>
                                        </div>
                                        <Badge
                                          variant={isPaid ? "success" : isPending ? "warning" : "neutral"}
                                          className="text-[9px] px-1.5 py-0 shrink-0"
                                        >
                                          {isPaid ? "Ödənilib" : isPending ? "Gözləyir" : "Qeyd"}
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between text-[10px] opacity-90 mt-1">
                                        <span className="flex items-center gap-1 font-medium">
                                          <Clock className="h-3.5 w-3.5 text-foregroundMuted" />
                                          {bStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({activeBooking.duration_minutes}d)
                                        </span>
                                        <span className="font-bold text-foreground">
                                          {(activeBooking.total_minor / 100).toFixed(2)} {activeBooking.currency}
                                        </span>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="text-[10px] text-center italic opacity-60 py-1 font-medium">
                                      Davamı: {displayNameClean}
                                    </div>
                                  )}
                                </div>
                              </td>
                            );
                          }

                          // Free Slot
                          const cellStart = new Date(schedulerDate + "T" + String(hour).padStart(2, "0") + ":00:00");
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
                              className="p-3 border-r border-border last:border-r-0 text-center cursor-pointer group hover:bg-accent/5 transition-all select-none transition-premium"
                            >
                              <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-foregroundMuted group-hover:text-accent transition-all opacity-30 group-hover:opacity-100">
                                <Plus className="h-3 w-3" />
                                <span>Sifariş et</span>
                              </div>
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
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          {/* Advanced Filters */}
          <Card className="border border-border bg-surface">
            <CardContent className="p-6 space-y-4">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {/* Booker Search */}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Müştəri adı və ya e-poçt ilə axtar…"
                    className="pl-9 bg-surfaceElevated border-border"
                  />
                </div>

                {/* Court Selector */}
                <select
                  value={selectedCourtId}
                  onChange={(e) => setSelectedCourtId(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-all cursor-pointer"
                >
                  <option value="all">Bütün Kortlar (All Courts)</option>
                  {courts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.sport_slug.toUpperCase()})
                    </option>
                  ))}
                </select>

                {/* Status Filter */}
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as BookingStatus | "all")}
                  className="flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-all cursor-pointer"
                >
                  <option value="all">Bütün Statuslar (All Statuses)</option>
                  <option value="pending_payment">Ödəniş Gözləyir</option>
                  <option value="partially_paid">Qismən Ödənilib</option>
                  <option value="paid">Ödənilib</option>
                  <option value="cancelled">Ləğv edilib</option>
                  <option value="refunded">Geri qaytarılıb</option>
                  <option value="failed">Uğursuz</option>
                </select>

                {/* Date Picker Blocks */}
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-1/2 bg-surfaceElevated border-border text-xs"
                    placeholder="Başlanğıc"
                  />
                  <Input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-1/2 bg-surfaceElevated border-border text-xs"
                    placeholder="Son"
                  />
                </div>
              </div>

              {/* Clear Filters Button */}
              {(q || status !== "all" || selectedCourtId !== "all" || from || to) && (
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQ("");
                      setStatus("all");
                      setSelectedCourtId("all");
                      setFrom("");
                      setTo("");
                    }}
                  >
                    Filtrləri Təmizlə
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bookings Table */}
          <Card className="border border-border bg-surface overflow-hidden">
            {showEmpty ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10">
                  <CalendarDays className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    Rezervasiya Tapılmadı
                  </h3>
                  <p className="text-sm text-foregroundMuted">
                    Seçilmiş filtrlərə uyğun heç bir rezervasiya tapılmadı.
                  </p>
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Müştəri</TableHead>
                    <TableHead>Kort</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Sifariş Vaxtı</TableHead>
                    <TableHead>Müddət</TableHead>
                    <TableHead>Məbləğ</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Yaradılma Tarixi</TableHead>
                    <TableHead className="text-right pr-6">Əməliyyatlar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <>
                      <RowSkeleton />
                      <RowSkeleton />
                      <RowSkeleton />
                    </>
                  )}
                  {!isLoading &&
                    bookings.map((booking) => {
                      const localStart = new Date(booking.starts_at).toLocaleString("az-AZ", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      const price = (booking.total_minor / 100).toFixed(2);

                      let badgeVariant: "success" | "warning" | "danger" | "neutral" = "neutral";
                      let statusLabel: string = booking.status;
                      if (booking.status === "paid") {
                        badgeVariant = "success";
                        statusLabel = "Ödənilib";
                      } else if (booking.status === "pending_payment") {
                        badgeVariant = "warning";
                        statusLabel = "Ödəniş Gözləyir";
                      } else if (booking.status === "partially_paid") {
                        badgeVariant = "warning";
                        statusLabel = "Qismən Ödənilib";
                      } else if (booking.status === "cancelled") {
                        badgeVariant = "danger";
                        statusLabel = "Ləğv edilib";
                      } else if (booking.status === "refunded") {
                        badgeVariant = "neutral";
                        statusLabel = "Geri qaytarılıb";
                      } else if (booking.status === "failed") {
                        badgeVariant = "danger";
                        statusLabel = "Uğursuz";
                      }

                      const isMatchDoubles = booking.booker_display_name.includes("[Doubles]") || booking.booker_display_name.includes("[Cütlü]");
                      const displayNameClean = booking.booker_display_name
                        .replace(/\[Cütlü \/ Doubles\]/g, "")
                        .replace(/\[Təkli \/ Singles\]/g, "")
                        .trim();

                      return (
                        <TableRow key={booking.id} className="hover:bg-surfaceElevated/5">
                          <TableCell className="pl-6">
                            <div className="flex flex-col">
                              <span className="font-semibold text-foreground">{displayNameClean}</span>
                              <span className="text-[11px] text-foregroundMuted">{booking.booker_email}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-semibold text-accent">{booking.court_name}</span>
                          </TableCell>
                          <TableCell>
                            {isMatchDoubles ? (
                              <Badge variant="success" className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5">
                                Cütlü (2v2)
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 bg-blue-500/10 text-blue-400 border-blue-500/20">
                                Təkli (1v1)
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-medium text-foreground">
                            {localStart}
                          </TableCell>
                          <TableCell className="text-foregroundMuted">
                            {booking.duration_minutes} dəqiqə
                          </TableCell>
                          <TableCell className="font-semibold text-foreground">
                            {price} {booking.currency}
                          </TableCell>
                          <TableCell>
                            <Badge variant={badgeVariant}>
                              {statusLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-foregroundMuted text-xs">
                            {new Date(booking.created_at).toLocaleDateString("az-AZ")}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex justify-end gap-1.5">
                              {(booking.status === "pending_payment" || booking.status === "partially_paid") && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => setConfirmPaid(booking)}
                                >
                                  Ödənildi
                                </Button>
                              )}
                              {booking.status !== "cancelled" && booking.status !== "refunded" && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setConfirmCancel(booking)}
                                >
                                  Ləğv et
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* ───────────────────────── DIALOG 1: NEW WALK-IN RESERVATION ───────────────────────── */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setCreateSlot(null);
            setBookerName("");
            setBookerEmail("");
            setDurationMode("standard");
            setStandardDuration(60);
          }
        }}
        title="Yeni Rezervasiya (Walk-in Sifariş)"
      >
        <form onSubmit={handleCreateWalkIn} className="space-y-4">
          {createSlot && (
            <div className="bg-surfaceElevated p-4 rounded-xl border border-border space-y-1">
              <div className="text-[10px] text-foregroundMuted uppercase font-bold tracking-wider flex items-center gap-1">
                <MapPin className="h-3 w-3 text-accent" />
                Seçilmiş Kort və Vaxt
              </div>
              <div className="text-sm font-bold text-accent">{createSlot.courtName}</div>
              <div className="text-xs text-foreground font-medium">
                {createSlot.startsAt.toLocaleDateString("az-AZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} saat {createSlot.startsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          )}

          {/* Matchmaking Selection Tab */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider text-foregroundMuted">Oyun Formatı</Label>
            <div className="grid grid-cols-2 gap-2 bg-surfaceElevated/50 p-1 rounded-xl border border-border">
              <Button
                type="button"
                variant={matchType === "singles" ? "primary" : "secondary"}
                className="w-full text-xs font-semibold rounded-lg h-9"
                onClick={() => setMatchType("singles")}
              >
                Təkli (1v1)
              </Button>
              <Button
                type="button"
                variant={matchType === "doubles" ? "primary" : "secondary"}
                className="w-full text-xs font-semibold rounded-lg h-9"
                onClick={() => setMatchType("doubles")}
              >
                Cütlü (2v2)
              </Button>
            </div>
          </div>

          {/* Booker Display Name */}
          <div className="space-y-1.5">
            <Label htmlFor="booker-name" className="text-xs font-bold uppercase tracking-wider text-foregroundMuted">Müştərinin Adı və Soyadı</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foregroundMuted" />
              <Input
                id="booker-name"
                value={bookerName}
                onChange={(e) => setBookerName(e.target.value)}
                placeholder="Məs. Kamran Namazov"
                className="pl-9 bg-surfaceElevated border-border"
                required
              />
            </div>
          </div>

          {/* Booker Email */}
          <div className="space-y-1.5">
            <Label htmlFor="booker-email" className="text-xs font-bold uppercase tracking-wider text-foregroundMuted">Müştərinin E-poçt Ünvanı</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foregroundMuted" />
              <Input
                id="booker-email"
                type="email"
                value={bookerEmail}
                onChange={(e) => setBookerEmail(e.target.value)}
                placeholder="Məs. kamran@linkfit.az"
                className="pl-9 bg-surfaceElevated border-border"
                required
              />
            </div>
            <p className="text-[10px] text-foregroundMuted/80 italic">
              Qeyd edilən e-poçt üzrə sistemdə istifadəçi yoxdursa, avtomatik müvəqqəti qonaq hesabı yaradılacaq.
            </p>
          </div>

          {/* Duration Mode Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider text-foregroundMuted">Sifarişin Müddəti</Label>
            <div className="grid grid-cols-2 gap-2 bg-surfaceElevated/50 p-1 rounded-xl border border-border">
              <Button
                type="button"
                variant={durationMode === "standard" ? "primary" : "secondary"}
                className="w-full text-xs font-semibold rounded-lg h-9"
                onClick={() => setDurationMode("standard")}
              >
                Standart Saatlar
              </Button>
              <Button
                type="button"
                variant={durationMode === "custom" ? "primary" : "secondary"}
                className="w-full text-xs font-semibold rounded-lg h-9"
                onClick={() => setDurationMode("custom")}
              >
                Xüsusi Müddət
              </Button>
            </div>
          </div>

          {/* Duration Selector */}
          {durationMode === "standard" ? (
            <div className="space-y-1.5">
              <select
                id="duration-minutes-select"
                value={standardDuration}
                onChange={(e) => setStandardDuration(Number(e.target.value))}
                className="flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent cursor-pointer"
              >
                <option value={60}>60 dəqiqə (1 saat)</option>
                <option value={90}>90 dəqiqə (1.5 saat)</option>
                <option value={120}>120 dəqiqə (2 saat)</option>
                <option value={180}>180 dəqiqə (3 saat)</option>
                <option value={240}>240 dəqiqə (4 saat)</option>
              </select>
            </div>
          ) : (
            <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-150">
              <Label htmlFor="custom-duration-input" className="text-xs text-foregroundMuted">Müddət (Dəqiqə ilə, addım: 15 dəqiqə)</Label>
              <div className="flex gap-2">
                <Input
                  id="custom-duration-input"
                  type="number"
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(Math.max(15, Number(e.target.value)))}
                  step={15}
                  min={15}
                  max={480}
                  className="bg-surfaceElevated border-border text-center font-bold tabular-nums"
                />
                <span className="flex items-center text-xs font-bold text-foreground bg-surfaceElevated px-3 rounded-lg border border-border shrink-0">
                  {(customMinutes / 60).toFixed(2)} saat
                </span>
              </div>
            </div>
          )}

          {/* Instant Price / Cost calculation Display - High Contrast premium layout */}
          <div className="bg-surfaceElevated p-4 rounded-xl border border-border flex items-center justify-between shadow-inner">
            <div>
              <span className="text-xs text-foregroundMuted font-bold uppercase tracking-wider flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5 text-accent" />
                Ödəniləcək Məbləğ
              </span>
              <p className="text-[10px] text-foregroundMuted/80 italic mt-0.5">Nağd / Terminal yerində ödəniş</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-accent tabular-nums">
                {calculatedPrice} {createSlot?.currency || "AZN"}
              </span>
            </div>
          </div>

          {/* Dialog Action Buttons */}
          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsCreateOpen(false);
                setBookerName("");
                setBookerEmail("");
                setDurationMode("standard");
                setStandardDuration(60);
                setCreateSlot(null);
              }}
              disabled={createMut.isPending}
            >
              İmtina
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={createMut.isPending}
              className="flex items-center gap-1.5"
            >
              {createMut.isPending ? "Rezervasiya edilir..." : "Sifarişi Təsdiqlə"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ───────────────────────── DIALOG 2: CANCEL CONFIRMATION ───────────────────────── */}
      <Dialog
        open={confirmCancel !== null}
        onOpenChange={(open) => (open ? null : setConfirmCancel(null))}
        title="Rezervasiyanın Ləğv Edilməsi"
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted leading-relaxed">
            Kort <span className="font-semibold text-foreground">&quot;{confirmCancel?.court_name}&quot;</span> üçün{" "}
            <span className="font-semibold text-foreground">
              {confirmCancel?.booker_display_name.replace(/\[Cütlü \/ Doubles\]/g, "").replace(/\[Təkli \/ Singles\]/g, "").trim()}
            </span>{" "}
            tərəfindən edilmiş sifarişi ləğv etməyə əminsiniz? Seçilmiş vaxt slotu dərhal boşalacaqdır.
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
              {cancelMut.isPending ? "Ləğv edilir..." : "Bəli, ləğv edilsin"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ───────────────────────── DIALOG 3: MARK PAID CONFIRMATION ───────────────────────── */}
      <Dialog
        open={confirmPaid !== null}
        onOpenChange={(open) => (open ? null : setConfirmPaid(null))}
        title="Ödənişin Təsdiq Edilməsi"
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted leading-relaxed">
            <span className="font-semibold text-foreground">
              {confirmPaid?.booker_display_name.replace(/\[Cütlü \/ Doubles\]/g, "").replace(/\[Təkli \/ Singles\]/g, "").trim()}
            </span>{" "}
            tərəfindən kort <span className="font-semibold text-foreground">&quot;{confirmPaid?.court_name}&quot;</span> üçün yerində (walk-in) edilən{" "}
            <span className="font-semibold text-emerald-500">
              {(Number(confirmPaid?.total_minor) / 100).toFixed(2)} {confirmPaid?.currency}
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
              {markPaidMut.isPending ? "Gözləyin..." : "Ödənişi Təsdiqlə"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
