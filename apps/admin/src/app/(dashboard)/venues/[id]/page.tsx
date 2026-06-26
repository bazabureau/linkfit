"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Images,
  Settings2,
  Users,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  useCreateCourt,
  useDeleteCourt,
  useUpdateCourt,
  useUpdateVenue,
  useUpdateVenueStatus,
  useVenue,
  useVenueCourts,
  type Court,
  type CourtPayload,
  type Venue,
  type VenuePayload,
} from "@/lib/admin-venues";
import {
  useAdminBookings,
  useCancelBooking,
  useMarkBookingPaid,
  type Booking,
} from "@/lib/admin-queries";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { CourtForm, type SportOption } from "@/components/venues/CourtForm";
import { VenueForm } from "../VenueForm";
import { VenueDetailHeader } from "../VenueDetailHeader";
import { CourtsPanel } from "../CourtsPanel";
import { BlocksPanel } from "../BlocksPanel";
import { VenueBookingsPanel } from "../VenueBookingsPanel";
import { VenueRulesPanel } from "../VenueRulesPanel";
import { VenueMediaPanel, type VenueMediaDraft } from "../VenueMediaPanel";
import { PartnersPanel } from "../PartnersPanel";
import { ConfirmDialog } from "../detail-ui";
import { money } from "../lib";

interface SportsListResponse {
  items: SportOption[];
}

type TabKey = "courts" | "media" | "blocks" | "bookings" | "partners" | "settings";

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "courts", label: "Kortlar", icon: Building2 },
  { key: "media", label: "Şəkillər", icon: Images },
  { key: "blocks", label: "Maintenance", icon: Wrench },
  { key: "bookings", label: "Rezervasiyalar", icon: CalendarClock },
  { key: "partners", label: "Tərəfdaşlar", icon: Users },
  { key: "settings", label: "Qaydalar", icon: Settings2 },
];

function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: string }).message;
    if (message) return message;
  }
  return fallback;
}

export default function VenueDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const venueId = params.id;
  const toast = useToast();

  const [activeTab, setActiveTab] = React.useState<TabKey>("courts");
  const [courtFormOpen, setCourtFormOpen] = React.useState(false);
  const [editingCourt, setEditingCourt] = React.useState<Court | null>(null);
  const [deleteCourt, setDeleteCourt] = React.useState<Court | null>(null);
  const [selectedCourtId, setSelectedCourtId] = React.useState<string | undefined>();
  const [cancelBooking, setCancelBooking] = React.useState<Booking | null>(null);
  const [paidBooking, setPaidBooking] = React.useState<Booking | null>(null);
  const [venueFormOpen, setVenueFormOpen] = React.useState(false);

  const venueQuery = useVenue(venueId);
  const courtsQuery = useVenueCourts(venueId);
  const sportsQuery = useQuery({
    queryKey: ["sports", "admin-courts"],
    queryFn: async () => {
      const res = await api.get<SportsListResponse>("/api/v1/sports");
      return (res.items ?? []).filter((sport) => ["padel", "tennis"].includes(sport.slug));
    },
    staleTime: 1000 * 60 * 10,
  });

  const bookingsQuery = useAdminBookings({ venue_id: venueId, limit: 100 });
  const createCourt = useCreateCourt(venueId);
  const updateCourt = useUpdateCourt(venueId);
  const removeCourt = useDeleteCourt(venueId);
  const updateVenue = useUpdateVenue();
  const updateVenueStatus = useUpdateVenueStatus();
  const cancelBookingMut = useCancelBooking();
  const markPaidMut = useMarkBookingPaid();

  const venue = venueQuery.data;
  const courts = React.useMemo(() => courtsQuery.data ?? [], [courtsQuery.data]);
  const sports = sportsQuery.data ?? [];
  const bookings = React.useMemo(() => bookingsQuery.data?.results ?? [], [bookingsQuery.data]);
  const selectedCourt = courts.find((court) => court.id === selectedCourtId) ?? courts[0];

  const upcomingBookings = React.useMemo(
    () =>
      bookings.filter(
        (booking) =>
          new Date(booking.starts_at).getTime() >= Date.now() &&
          !["cancelled", "refunded", "failed"].includes(booking.status),
      ),
    [bookings],
  );

  const courtSummary = React.useMemo(
    () =>
      courts.reduce(
        (acc, court) => {
          const status = court.status ?? "active";
          acc[status] += 1;
          return acc;
        },
        { active: 0, inactive: 0, maintenance: 0 },
      ),
    [courts],
  );

  function openNewCourt(): void {
    setEditingCourt(null);
    setCourtFormOpen(true);
  }

  function openEditCourt(court: Court): void {
    setEditingCourt(court);
    setCourtFormOpen(true);
  }

  async function handleCourtSubmit(payload: CourtPayload): Promise<void> {
    try {
      if (editingCourt) {
        await updateCourt.mutateAsync({ id: editingCourt.id, data: payload });
        toast.success("Kort yeniləndi", payload.name);
      } else {
        await createCourt.mutateAsync(payload);
        toast.success("Kort əlavə edildi", payload.name);
      }
      setCourtFormOpen(false);
      setEditingCourt(null);
    } catch (err) {
      toast.error("Kort saxlanmadı", describeError(err, "Əməliyyat alınmadı"));
    }
  }

  async function handleVenueSubmit(payload: VenuePayload): Promise<void> {
    try {
      await updateVenue.mutateAsync({ id: venueId, data: payload });
      toast.success("Məkan yeniləndi", payload.name);
      setVenueFormOpen(false);
    } catch (err) {
      toast.error("Məkan yenilənmədi", describeError(err, "Əməliyyat alınmadı"));
    }
  }

  async function handleDeleteCourt(): Promise<void> {
    if (!deleteCourt) return;
    const target = deleteCourt;
    setDeleteCourt(null);
    try {
      await removeCourt.mutateAsync(target.id);
      toast.success("Kort silindi", target.name);
    } catch (err) {
      toast.error("Kort silinmədi", describeError(err, "Kortun booking-ləri ola bilər"));
    }
  }

  async function handleMediaSave(data: VenueMediaDraft): Promise<void> {
    try {
      await updateVenue.mutateAsync({ id: venueId, data });
      toast.success("Şəkillər yeniləndi");
    } catch (err) {
      toast.error("Şəkillər yenilənmədi", describeError(err, "Əməliyyat alınmadı"));
      throw err;
    }
  }

  async function handleVenueStatus(status: NonNullable<Venue["status"]>): Promise<void> {
    try {
      await updateVenueStatus.mutateAsync({ id: venueId, status });
      toast.success("Məkan statusu yeniləndi", status);
    } catch (err) {
      toast.error("Status yenilənmədi", describeError(err, "Əməliyyat alınmadı"));
    }
  }

  async function handleCancelBooking(): Promise<void> {
    if (!cancelBooking) return;
    const target = cancelBooking;
    setCancelBooking(null);
    try {
      await cancelBookingMut.mutateAsync({ id: target.id });
      toast.success("Rezervasiya ləğv edildi", target.booker_display_name);
    } catch (err) {
      toast.error("Rezervasiya ləğv edilmədi", describeError(err, "Əməliyyat alınmadı"));
    }
  }

  async function handleMarkPaid(): Promise<void> {
    if (!paidBooking) return;
    const target = paidBooking;
    setPaidBooking(null);
    try {
      await markPaidMut.mutateAsync({ id: target.id });
      toast.success("Ödəniş qeyd edildi", target.booker_display_name);
    } catch (err) {
      toast.error("Ödəniş qeyd edilmədi", describeError(err, "Əməliyyat alınmadı"));
    }
  }

  if (venueQuery.isLoading) {
    return <VenueSkeleton />;
  }

  if (venueQuery.isError || !venue) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <p className="text-sm text-danger">Məkan tapılmadı və ya giriş icazəsi yoxdur.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BackLink />

      <VenueDetailHeader
        venue={venue}
        courtsTotal={courts.length}
        upcomingBookings={upcomingBookings.length}
        courtSummary={courtSummary}
        onStatusChange={handleVenueStatus}
        onEdit={() => setVenueFormOpen(true)}
        busy={updateVenueStatus.isPending}
      />

      {/* Tabs */}
      <div className="inline-flex w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1 shadow-card sm:w-auto">
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
                active
                  ? "bg-ink text-white shadow-sm"
                  : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground",
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "courts" ? (
        <CourtsPanel
          courts={courts}
          loading={courtsQuery.isLoading}
          sportsReady={sports.length > 0}
          onAdd={openNewCourt}
          onEdit={openEditCourt}
          onDelete={setDeleteCourt}
          onManageBlocks={(court) => {
            setSelectedCourtId(court.id);
            setActiveTab("blocks");
          }}
        />
      ) : null}

      {activeTab === "media" ? (
        <VenueMediaPanel
          venue={venue}
          busy={updateVenue.isPending}
          onSave={handleMediaSave}
        />
      ) : null}

      {activeTab === "blocks" ? (
        <BlocksPanel
          courts={courts}
          selectedCourt={selectedCourt}
          selectedCourtId={selectedCourt?.id}
          onSelectCourt={setSelectedCourtId}
        />
      ) : null}

      {activeTab === "bookings" ? (
        <VenueBookingsPanel
          bookings={bookings}
          loading={bookingsQuery.isLoading}
          onCancel={setCancelBooking}
          onMarkPaid={setPaidBooking}
        />
      ) : null}

      {activeTab === "partners" ? <PartnersPanel venueId={venueId} /> : null}

      {activeTab === "settings" ? (
        <VenueRulesPanel
          venue={venue}
          busy={updateVenue.isPending}
          onSave={async (data) => {
            try {
              await updateVenue.mutateAsync({ id: venueId, data });
              toast.success("Məkan qaydaları yeniləndi");
            } catch (err) {
              toast.error("Qaydalar yenilənmədi", describeError(err, "Əməliyyat alınmadı"));
              throw err;
            }
          }}
        />
      ) : null}

      {/* Court create / edit */}
      <Dialog
        open={courtFormOpen}
        onOpenChange={(open) => {
          setCourtFormOpen(open);
          if (!open) setEditingCourt(null);
        }}
        title={editingCourt ? "Kortu redaktə et" : "Yeni kort"}
        contentClassName="max-w-xl"
      >
        <CourtForm
          initial={editingCourt}
          sports={sports}
          submitting={createCourt.isPending || updateCourt.isPending}
          onSubmit={handleCourtSubmit}
          onCancel={() => {
            setCourtFormOpen(false);
            setEditingCourt(null);
          }}
        />
      </Dialog>

      {/* Venue edit */}
      <Dialog
        open={venueFormOpen}
        onOpenChange={setVenueFormOpen}
        title="Məkanı redaktə et"
        description="Məkan detalları, şəkil və ya partnyor statusunu yenilə."
        contentClassName="max-w-2xl"
      >
        <VenueForm
          initial={venue}
          submitting={updateVenue.isPending}
          onSubmit={handleVenueSubmit}
          onCancel={() => setVenueFormOpen(false)}
        />
      </Dialog>

      <ConfirmDialog
        open={deleteCourt !== null}
        title="Kort silinsin?"
        description={
          deleteCourt
            ? `${deleteCourt.name} silinəcək. Əgər court üzrə booking varsa, backend silməyə icazə verməyəcək.`
            : ""
        }
        confirmLabel="Sil"
        danger
        busy={removeCourt.isPending}
        onOpenChange={(open) => !open && setDeleteCourt(null)}
        onConfirm={handleDeleteCourt}
      />

      <ConfirmDialog
        open={cancelBooking !== null}
        title="Rezervasiya ləğv edilsin?"
        description={
          cancelBooking
            ? `${cancelBooking.booker_display_name} üçün ${cancelBooking.court_name} rezervasiyası ləğv ediləcək.`
            : ""
        }
        confirmLabel="Ləğv et"
        danger
        busy={cancelBookingMut.isPending}
        onOpenChange={(open) => !open && setCancelBooking(null)}
        onConfirm={handleCancelBooking}
      />

      <ConfirmDialog
        open={paidBooking !== null}
        title="Ödəniş qeyd edilsin?"
        description={
          paidBooking
            ? `${paidBooking.booker_display_name}: ${money(paidBooking.total_minor, paidBooking.currency)}`
            : ""
        }
        confirmLabel="Ödənildi et"
        busy={markPaidMut.isPending}
        onOpenChange={(open) => !open && setPaidBooking(null)}
        onConfirm={handleMarkPaid}
      />
    </div>
  );
}

function BackLink(): React.JSX.Element {
  return (
    <Link
      href="/venues"
      className="inline-flex items-center gap-2 text-sm font-medium text-foregroundMuted transition hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Bütün məkanlar
    </Link>
  );
}

function VenueSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-5">
      <div className="h-5 w-36 animate-pulse rounded bg-surfaceElevated" />
      <div className="h-64 animate-pulse rounded-2xl border border-border bg-surface" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl border border-border bg-surface" />
        ))}
      </div>
      <div className="h-12 w-80 animate-pulse rounded-2xl border border-border bg-surface" />
      <div className="h-72 animate-pulse rounded-2xl border border-border bg-surface" />
    </div>
  );
}
