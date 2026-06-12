"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Phone,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  useCreateCourt,
  useDeleteCourt,
  useUpdateCourt,
  useVenue,
  useVenueCourts,
  type Court,
  type CourtPayload,
} from "@/lib/admin-venues";
import {
  useAdminBookings,
  useCancelBooking,
  useMarkBookingPaid,
  type Booking,
} from "@/lib/admin-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  CourtForm,
  type SportOption,
} from "@/components/venues/CourtForm";

interface SportsListResponse {
  items: SportOption[];
}

interface ErrorWithStatus {
  status?: number;
  message?: string;
}

function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const e = err as ErrorWithStatus;
    if (e.status === 409) {
      return (
        e.message ?? "Conflict — the court is referenced by existing records."
      );
    }
    if (e.message) return e.message;
  }
  return fallback;
}

function formatPrice(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export default function VenueDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const venueId = params.id;
  const toast = useToast();

  const venueQuery = useVenue(venueId);
  const courtsQuery = useVenueCourts(venueId);
  const sportsQuery = useQuery({
    queryKey: ["sports"],
    queryFn: async () => {
      const res = await api.get<SportsListResponse>("/api/v1/sports");
      return res.items ?? [];
    },
    staleTime: 1000 * 60 * 10,
  });

  const createMut = useCreateCourt(venueId);
  const updateMut = useUpdateCourt(venueId);
  const deleteMut = useDeleteCourt(venueId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Court | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Court | null>(null);

  const [activeTab, setActiveTab] = useState<"courts" | "reservations">("courts");
  const [confirmCancelBooking, setConfirmCancelBooking] = useState<Booking | null>(null);
  const [confirmPaidBooking, setConfirmPaidBooking] = useState<Booking | null>(null);

  // Fetch bookings for this venue
  const { data: bookingsData, isLoading: isBookingsLoading } = useAdminBookings({
    venue_id: venueId,
    limit: 100,
  });
  const bookings = bookingsData?.results ?? [];

  const cancelBookingMut = useCancelBooking();
  const markBookingPaidMut = useMarkBookingPaid();

  const handleCancelBooking = async (): Promise<void> => {
    if (!confirmCancelBooking) return;
    const target = confirmCancelBooking;
    setConfirmCancelBooking(null);
    try {
      await cancelBookingMut.mutateAsync({ id: target.id });
      toast.success("Rezervasiya ləğv edildi", target.booker_display_name);
    } catch (err: any) {
      toast.error("Ləğv edilə bilmədi", err.message || "Əməliyyat baş tutmadı");
    }
  };

  const handleMarkBookingPaid = async (): Promise<void> => {
    if (!confirmPaidBooking) return;
    const target = confirmPaidBooking;
    setConfirmPaidBooking(null);
    try {
      await markBookingPaidMut.mutateAsync({ id: target.id });
      toast.success("Rezervasiya ödənildi", target.booker_display_name);
    } catch (err: any) {
      toast.error("Ödəniş qeyd edilə bilmədi", err.message || "Əməliyyat baş tutmadı");
    }
  };

  const sports: SportOption[] = sportsQuery.data ?? [];

  const openNew = (): void => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (court: Court): void => {
    setEditing(court);
    setFormOpen(true);
  };
  const closeForm = (): void => {
    setFormOpen(false);
    setEditing(null);
  };

  const handleSubmit = async (payload: CourtPayload): Promise<void> => {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload });
        toast.success("Court updated", payload.name);
      } else {
        await createMut.mutateAsync(payload);
        toast.success("Court added", payload.name);
      }
      closeForm();
    } catch (err) {
      toast.error("Save failed", describeError(err, "Could not save court"));
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteMut.mutateAsync(target.id);
      toast.success("Court deleted", target.name);
    } catch (err) {
      toast.error("Delete failed", describeError(err, "Could not delete court"));
    }
  };

  const venue = venueQuery.data;
  const courts = courtsQuery.data ?? [];
  const submitting = createMut.isPending || updateMut.isPending;

  if (venueQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-40 animate-pulse rounded bg-surfaceElevated" />
        <Card>
          <CardContent>
            <div className="h-32 w-full animate-pulse rounded bg-surfaceElevated" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (venueQuery.isError || !venue) {
    return (
      <div className="space-y-4">
        <Link
          href="/venues"
          className="inline-flex items-center gap-2 text-sm text-foregroundMuted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to venues
        </Link>
        <Card>
          <CardContent>
            <p className="text-sm text-danger">
              Venue not found or you don&apos;t have access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/venues"
            className="mb-2 inline-flex items-center gap-1 text-xs text-foregroundMuted hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> All venues
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {venue.name}
          </h1>
          <p className="mt-1 inline-flex items-center gap-1 text-sm text-foregroundMuted">
            <MapPin className="h-3.5 w-3.5" />
            {venue.address}
          </p>
        </div>
        {venue.is_partner && <Badge variant="success">Partner</Badge>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1 overflow-hidden">
          {venue.photo_url ? (
            <div className="relative aspect-square w-full bg-surfaceElevated">
              <Image
                src={venue.photo_url}
                alt={venue.name}
                fill
                sizes="(min-width: 768px) 33vw, 100vw"
                unoptimized
                className="object-cover"
              />
            </div>
          ) : (
            <div className="grid aspect-square w-full place-items-center bg-surfaceElevated text-foregroundMuted">
              <Building2 className="h-10 w-10" />
            </div>
          )}
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 text-foregroundMuted" />
              <div>
                <p className="text-foreground">{venue.address}</p>
                <p className="text-xs text-foregroundMuted">
                  Lat {venue.lat.toFixed(5)}, Lng {venue.lng.toFixed(5)}
                </p>
              </div>
            </div>
            {venue.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-foregroundMuted" />
                <a
                  href={`tel:${venue.phone}`}
                  className="text-foreground hover:text-accent"
                >
                  {venue.phone}
                </a>
              </div>
            )}
            {venue.description && (
              <p className="whitespace-pre-line text-foregroundMuted">
                {venue.description}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tab Switcher */}
      <div className="flex border-b border-border gap-4">
        <button
          onClick={() => setActiveTab("courts")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "courts"
              ? "border-accent text-accent"
              : "border-transparent text-foregroundMuted hover:text-foreground"
          }`}
        >
          Courts (Kortlar)
        </button>
        <button
          onClick={() => setActiveTab("reservations")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "reservations"
              ? "border-accent text-accent"
              : "border-transparent text-foregroundMuted hover:text-foreground"
          }`}
        >
          Reservations (Rezervasiyalar)
        </button>
      </div>

      {activeTab === "courts" ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Courts</CardTitle>
              <p className="text-xs text-foregroundMuted">
                {courts.length} court{courts.length === 1 ? "" : "s"} configured
              </p>
            </div>
            <Button
              onClick={openNew}
              disabled={sports.length === 0 || sportsQuery.isLoading}
            >
              <Plus className="h-4 w-4" /> Add court
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {courtsQuery.isLoading ? (
              <div className="space-y-2 p-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-10 w-full animate-pulse rounded bg-surfaceElevated"
                  />
                ))}
              </div>
            ) : courts.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <Building2 className="h-6 w-6 text-foregroundMuted" />
                <p className="text-sm text-foregroundMuted">
                  No courts yet. Add the first one to enable bookings.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openNew}
                  disabled={sports.length === 0}
                >
                  <Plus className="h-3.5 w-3.5" /> Add court
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Sport</TableHead>
                    <TableHead>Hourly price</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courts.map((court) => (
                    <TableRow key={court.id}>
                      <TableCell className="font-medium text-foreground">
                        {court.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral">{court.sport_slug}</Badge>
                      </TableCell>
                      <TableCell className="text-foreground">
                        {formatPrice(court.hourly_price_minor, court.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openEdit(court)}
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setConfirmDelete(court)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Reservations</CardTitle>
            <p className="text-xs text-foregroundMuted">
              {bookings.length} reservation{bookings.length === 1 ? "" : "s"} found for this venue
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {isBookingsLoading ? (
              <div className="space-y-2 p-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-10 w-full animate-pulse rounded bg-surfaceElevated"
                  />
                ))}
              </div>
            ) : bookings.length === 0 ? (
              <div className="py-12 text-center text-sm text-foregroundMuted">
                No reservations found for this venue.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Booker</TableHead>
                    <TableHead>Court</TableHead>
                    <TableHead>Starts At</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((booking) => {
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
                        <TableCell className="font-semibold text-accent">
                          {booking.court_name}
                        </TableCell>
                        <TableCell className="font-medium text-foreground">
                          {new Date(booking.starts_at).toLocaleString()}
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
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            {(booking.status === "pending_payment" || booking.status === "partially_paid") && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => setConfirmPaidBooking(booking)}
                              >
                                Mark Paid
                              </Button>
                            )}
                            {booking.status !== "cancelled" && booking.status !== "refunded" && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setConfirmCancelBooking(booking)}
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
          </CardContent>
        </Card>
      )}

      {/* Court Forms & Deletes */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}
        title={editing ? "Edit court" : "Add court"}
      >
        <CourtForm
          initial={editing}
          sports={sports}
          submitting={submitting}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      </Dialog>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => (open ? null : setConfirmDelete(null))}
        title="Delete court"
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">
              {confirmDelete?.name}
            </span>
            ? The court must not have any future bookings.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(null)}
              disabled={deleteMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Booking Cancel Dialog */}
      <Dialog
        open={confirmCancelBooking !== null}
        onOpenChange={(open) => (open ? null : setConfirmCancelBooking(null))}
        title="Cancel Booking"
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted">
            Are you sure you want to cancel the reservation for{" "}
            <span className="font-semibold text-foreground">
              {confirmCancelBooking?.booker_display_name}
            </span>{" "}
            at court <span className="font-semibold text-foreground">{confirmCancelBooking?.court_name}</span>? 
            This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmCancelBooking(null)}
              disabled={cancelBookingMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleCancelBooking}
              disabled={cancelBookingMut.isPending}
            >
              {cancelBookingMut.isPending ? "Processing..." : "Confirm Cancellation"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Booking Mark Paid Dialog */}
      <Dialog
        open={confirmPaidBooking !== null}
        onOpenChange={(open) => (open ? null : setConfirmPaidBooking(null))}
        title="Mark Booking Paid"
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted">
            Confirm cash/walk-in payment for{" "}
            <span className="font-semibold text-foreground">
              {confirmPaidBooking?.booker_display_name}
            </span>{" "}
            totaling{" "}
            <span className="font-semibold text-emerald-500">
              {(Number(confirmPaidBooking?.total_minor) / 100).toFixed(2)} {confirmPaidBooking?.currency}
            </span>?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmPaidBooking(null)}
              disabled={markBookingPaidMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleMarkBookingPaid}
              disabled={markBookingPaidMut.isPending}
            >
              {markBookingPaidMut.isPending ? "Processing..." : "Confirm Payment"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
