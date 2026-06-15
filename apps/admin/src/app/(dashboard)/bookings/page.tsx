"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  Search,
  XCircle,
  CheckCircle2,
  DollarSign,
  AlertCircle,
  CalendarCheck,
  Building,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  useAdminBookings,
  useCancelBooking,
  useMarkBookingPaid,
  type Booking,
  type BookingStatus,
} from "@/lib/admin-queries";
import { useVenues, useVenueCourts } from "@/lib/admin-venues";
import { formatDate, formatDateTime } from "@/lib/date-format";

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

export default function BookingsPage(): React.JSX.Element {
  const toast = useToast();

  // Filters State
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [selectedVenueId, setSelectedVenueId] = useState<string>("all");
  const [selectedCourtId, setSelectedCourtId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [confirmCancel, setConfirmCancel] = useState<Booking | null>(null);
  const [confirmPaid, setConfirmPaid] = useState<Booking | null>(null);

  // Fetch Venues for selector dropdown
  const { data: venues = [] } = useVenues({ limit: 100 });
  const { data: courts = [] } = useVenueCourts(
    selectedVenueId !== "all" ? selectedVenueId : undefined
  );

  // Fetch Bookings with current filters
  const bookingsParams = useMemo(() => {
    return {
      status: status !== "all" ? status : undefined,
      venue_id: selectedVenueId !== "all" ? selectedVenueId : undefined,
      court_id: selectedCourtId !== "all" ? selectedCourtId : undefined,
      q: q.trim() || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      limit: 100,
    };
  }, [status, selectedVenueId, selectedCourtId, q, from, to]);

  const { data: bookingsData, isLoading } = useAdminBookings(bookingsParams);
  const bookings = bookingsData?.results ?? [];

  const cancelMut = useCancelBooking();
  const markPaidMut = useMarkBookingPaid();

  // Compute dynamic stats from fetched bookings
  const stats = useMemo(() => {
    let totalCount = bookings.length;
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

  const handleCancel = async (): Promise<void> => {
    if (!confirmCancel) return;
    const target = confirmCancel;
    setConfirmCancel(null);
    try {
      await cancelMut.mutateAsync({ id: target.id });
      toast.success("Rezervasiya ləğv edildi", `${target.booker_display_name} - ${target.court_name}`);
    } catch (err: any) {
      toast.error("Əməliyyat uğursuz oldu", err.message || "Rezervasiya ləğv edilə bilmədi");
    }
  };

  const handleMarkPaid = async (): Promise<void> => {
    if (!confirmPaid) return;
    const target = confirmPaid;
    setConfirmPaid(null);
    try {
      await markPaidMut.mutateAsync({ id: target.id });
      toast.success("Rezervasiya ödənildi", `${target.booker_display_name} - ${target.court_name}`);
    } catch (err: any) {
      toast.error("Əməliyyat uğursuz oldu", err.message || "Rezervasiya ödənildi olaraq qeyd edilə bilmədi");
    }
  };

  const showEmpty = !isLoading && bookings.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Court Bookings & Reservations
        </h1>
        <p className="text-sm text-foregroundMuted">
          Manage court reservations, record walk-in payments, and trigger administrative overrides.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4 flex items-center gap-4 border border-border bg-surface">
          <div className="p-3 rounded-xl bg-accent/10 text-accent">
            <CalendarCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-foregroundMuted uppercase tracking-wider font-semibold">Total Slots</p>
            <h3 className="text-xl font-bold text-foreground mt-0.5">{stats.total}</h3>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 border border-border bg-surface">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-foregroundMuted uppercase tracking-wider font-semibold">Paid Slots</p>
            <h3 className="text-xl font-bold text-foreground mt-0.5">{stats.paid}</h3>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 border border-border bg-surface">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-foregroundMuted uppercase tracking-wider font-semibold">Unpaid Slots</p>
            <h3 className="text-xl font-bold text-foreground mt-0.5">{stats.pending}</h3>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 border border-border bg-surface">
          <div className="p-3 rounded-xl bg-rose-500/10 text-rose-500">
            <XCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-foregroundMuted uppercase tracking-wider font-semibold">Cancelled</p>
            <h3 className="text-xl font-bold text-foreground mt-0.5">{stats.cancelled}</h3>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 border border-border bg-surface">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
            <DollarSign className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-foregroundMuted uppercase tracking-wider font-semibold">Total Revenue</p>
            <h3 className="text-xl font-bold text-foreground mt-0.5">{stats.revenue} AZN</h3>
          </div>
        </Card>
      </div>

      {/* Advanced Filters */}
      <Card className="p-5 border border-border bg-surface space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {/* Booker Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search booker display name or email…"
              className="pl-9"
            />
          </div>

          {/* Venue Selector */}
          <select
            value={selectedVenueId}
            onChange={(e) => {
              setSelectedVenueId(e.target.value);
              setSelectedCourtId("all");
            }}
            className="flex h-10 w-full rounded-md border border-input bg-surfaceElevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="all">All Venues (Bütün Məkanlar)</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>

          {/* Court Selector */}
          <select
            value={selectedCourtId}
            disabled={selectedVenueId === "all"}
            onChange={(e) => setSelectedCourtId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-surfaceElevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
          >
            <option value="all">All Courts (Bütün Kortlar)</option>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.sport_slug})
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as BookingStatus | "all")}
            className="flex h-10 w-full rounded-md border border-input bg-surfaceElevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="all">All Statuses (Bütün Statuslar)</option>
            <option value="pending_payment">Pending Payment</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
            <option value="failed">Failed</option>
          </select>

          {/* Date Picker Blocks */}
          <div className="flex gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-1/2"
              placeholder="From"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-1/2"
              placeholder="To"
            />
          </div>
        </div>

        {/* Clear Filters Button */}
        {(q || status !== "all" || selectedVenueId !== "all" || selectedCourtId !== "all" || from || to) && (
          <div className="flex justify-end">
            <Button
              variant="secondary"
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
              Reset Filters
            </Button>
          </div>
        )}
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
                No Reservations Found
              </h3>
              <p className="text-sm text-foregroundMuted">
                Try loosening your filters or search terms to find court bookings.
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booker</TableHead>
                <TableHead>Venue & Court</TableHead>
                <TableHead>Scheduled Slot</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
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
                  const localStart = formatDateTime(booking.starts_at);
                  const price = (booking.total_minor / 100).toFixed(2);

                  let badgeVariant: "success" | "warning" | "danger" | "neutral" = "neutral";
                  if (booking.status === "paid") {
                    badgeVariant = "success";
                  } else if (booking.status === "pending_payment" || booking.status === "partially_paid") {
                    badgeVariant = "warning";
                  } else if (booking.status === "cancelled" || booking.status === "refunded") {
                    badgeVariant = "danger";
                  }

                  return (
                    <TableRow key={booking.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">{booking.booker_display_name}</span>
                          <span className="text-[11px] text-foregroundMuted">{booking.booker_email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground inline-flex items-center gap-1">
                            <Building className="h-3 w-3 text-foregroundMuted" />
                            {booking.venue_name}
                          </span>
                          <span className="text-[11px] text-accent font-medium pl-4">{booking.court_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {localStart}
                      </TableCell>
                      <TableCell className="text-foregroundMuted">
                        {booking.duration_minutes} mins
                      </TableCell>
                      <TableCell className="font-semibold text-foreground">
                        {price} {booking.currency}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeVariant}>
                          {booking.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-foregroundMuted text-xs">
                        {formatDate(booking.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {(booking.status === "pending_payment" || booking.status === "partially_paid") && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setConfirmPaid(booking)}
                            >
                              Mark Paid
                            </Button>
                          )}
                          {booking.status !== "cancelled" && booking.status !== "refunded" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setConfirmCancel(booking)}
                            >
                              Cancel
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

      {/* Cancel Confirmation Dialog */}
      <Dialog
        open={confirmCancel !== null}
        onOpenChange={(open) => (open ? null : setConfirmCancel(null))}
        title="Rezervasiyanın Ləğvi"
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted">
            Are you sure you want to cancel the reservation for{" "}
            <span className="font-semibold text-foreground">
              {confirmCancel?.booker_display_name}
            </span>{" "}
            at court <span className="font-semibold text-foreground">{confirmCancel?.court_name}</span>? 
            This action will free up the time slot instantly.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmCancel(null)}
              disabled={cancelMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleCancel}
              disabled={cancelMut.isPending}
            >
              {cancelMut.isPending ? "Cancelling..." : "Confirm Cancellation"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Mark Paid Confirmation Dialog */}
      <Dialog
        open={confirmPaid !== null}
        onOpenChange={(open) => (open ? null : setConfirmPaid(null))}
        title="Ödənişin Təsdiqlənməsi"
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted">
            Confirm walk-in payment for{" "}
            <span className="font-semibold text-foreground">
              {confirmPaid?.booker_display_name}
            </span>{" "}
            totaling{" "}
            <span className="font-semibold text-emerald-500">
              {(Number(confirmPaid?.total_minor) / 100).toFixed(2)} {confirmPaid?.currency}
            </span>{" "}
            for court <span className="font-semibold text-foreground">{confirmPaid?.court_name}</span>?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmPaid(null)}
              disabled={markPaidMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleMarkPaid}
              disabled={markPaidMut.isPending}
            >
              {markPaidMut.isPending ? "Processing..." : "Confirm Payment"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
