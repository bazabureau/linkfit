"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  Coins,
  ImageIcon,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  useCourtBlocks,
  useCreateCourt,
  useCreateCourtBlock,
  useDeleteCourt,
  useDeleteCourtBlock,
  useUpdateCourt,
  useUpdateVenue,
  useUpdateVenueStatus,
  useVenue,
  useVenueCourts,
  type Court,
  type CourtBlock,
  type CourtPayload,
  type Venue,
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
import { formatDateTime } from "@/lib/date-format";
import { cn } from "@/lib/cn";
import { CourtForm, type SportOption } from "@/components/venues/CourtForm";

interface SportsListResponse {
  items: SportOption[];
}

type TabKey = "courts" | "blocks" | "bookings" | "settings";

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "courts", label: "Kortlar", icon: Building2 },
  { key: "blocks", label: "Maintenance", icon: Wrench },
  { key: "bookings", label: "Rezervasiyalar", icon: CalendarClock },
  { key: "settings", label: "Qaydalar", icon: Settings2 },
];

function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: string }).message;
    if (message) return message;
  }
  return fallback;
}

function formatMoney(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export default function VenueDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const venueId = params.id;
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>("courts");
  const [formOpen, setFormOpen] = useState(false);
  const [editingCourt, setEditingCourt] = useState<Court | null>(null);
  const [deleteCourt, setDeleteCourt] = useState<Court | null>(null);
  const [selectedCourtId, setSelectedCourtId] = useState<string | undefined>();
  const [cancelBooking, setCancelBooking] = useState<Booking | null>(null);
  const [paidBooking, setPaidBooking] = useState<Booking | null>(null);

  const venueQuery = useVenue(venueId);
  const courtsQuery = useVenueCourts(venueId);
  const sportsQuery = useQuery({
    queryKey: ["sports", "admin-courts"],
    queryFn: async () => {
      const res = await api.get<SportsListResponse>("/api/v1/sports");
      return (res.items ?? []).filter((sport) =>
        ["padel", "tennis"].includes(sport.slug),
      );
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
  const courts = courtsQuery.data ?? [];
  const sports = sportsQuery.data ?? [];
  const bookings = bookingsQuery.data?.results ?? [];
  const selectedCourt = courts.find((court) => court.id === selectedCourtId) ?? courts[0];
  const upcomingBookings = bookings.filter(
    (booking) =>
      new Date(booking.starts_at).getTime() >= Date.now() &&
      !["cancelled", "refunded", "failed"].includes(booking.status),
  );

  const courtSummary = useMemo(() => {
    return courts.reduce(
      (acc, court) => {
        const status = court.status ?? "active";
        acc[status] += 1;
        return acc;
      },
      { active: 0, inactive: 0, maintenance: 0 },
    );
  }, [courts]);

  function openNewCourt(): void {
    setEditingCourt(null);
    setFormOpen(true);
  }

  function openEditCourt(court: Court): void {
    setEditingCourt(court);
    setFormOpen(true);
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
      setFormOpen(false);
      setEditingCourt(null);
    } catch (err) {
      toast.error("Kort saxlanmadı", describeError(err, "Əməliyyat alınmadı"));
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
        <Card>
          <CardContent>
            <p className="text-sm text-danger">Məkan tapılmadı və ya giriş icazəsi yoxdur.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <VenueHeader
        venue={venue}
        courtsTotal={courts.length}
        upcomingBookings={upcomingBookings.length}
        courtSummary={courtSummary}
        onStatusChange={handleVenueStatus}
        busy={updateVenueStatus.isPending}
      />

      <div className="rounded-xl border border-border bg-surface p-1">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "bg-accent text-black"
                  : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground",
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
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

      {activeTab === "blocks" ? (
        <BlocksPanel
          courts={courts}
          selectedCourt={selectedCourt}
          selectedCourtId={selectedCourt?.id}
          onSelectCourt={setSelectedCourtId}
        />
      ) : null}

      {activeTab === "bookings" ? (
        <BookingsPanel
          bookings={bookings}
          loading={bookingsQuery.isLoading}
          onCancel={setCancelBooking}
          onMarkPaid={setPaidBooking}
        />
      ) : null}

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
            }
          }}
        />
      ) : null}

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
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
            setFormOpen(false);
            setEditingCourt(null);
          }}
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
            ? `${paidBooking.booker_display_name}: ${formatMoney(paidBooking.total_minor, paidBooking.currency)}`
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

function BackLink(): JSX.Element {
  return (
    <Link
      href="/venues"
      className="inline-flex items-center gap-2 text-sm text-foregroundMuted hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Bütün məkanlar
    </Link>
  );
}

function VenueHeader({
  venue,
  courtsTotal,
  upcomingBookings,
  courtSummary,
  onStatusChange,
  busy,
}: {
  venue: Venue;
  courtsTotal: number;
  upcomingBookings: number;
  courtSummary: { active: number; inactive: number; maintenance: number };
  onStatusChange: (status: NonNullable<Venue["status"]>) => void;
  busy: boolean;
}) {
  return (
    <Card className="overflow-hidden rounded-xl">
      <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
        <div className="relative min-h-64 bg-surfaceElevated">
          {venue.photo_url ? (
            <Image
              src={venue.photo_url}
              alt={venue.name}
              fill
              sizes="280px"
              unoptimized
              className="object-cover"
            />
          ) : (
            <div className="grid h-full min-h-64 place-items-center text-foregroundMuted">
              <ImageIcon className="h-10 w-10" />
            </div>
          )}
        </div>
        <div className="space-y-5 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {venue.name}
                </h1>
                <VenueStatusBadge status={venue.status} />
                {venue.is_partner ? <Badge variant="success">Partner</Badge> : null}
              </div>
              <p className="mt-2 flex items-center gap-2 text-sm text-foregroundMuted">
                <MapPin className="h-4 w-4" />
                {venue.address}
              </p>
              {venue.phone ? (
                <p className="mt-1 text-sm text-foregroundMuted">{venue.phone}</p>
              ) : null}
            </div>
            <select
              value={venue.status ?? "published"}
              disabled={busy}
              onChange={(event) =>
                onStatusChange(event.target.value as NonNullable<Venue["status"]>)
              }
              className="h-10 rounded-lg border border-border bg-surfaceElevated px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <option value="draft">Draft</option>
              <option value="pending">Pending</option>
              <option value="published">Published</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Kort" value={courtsTotal} icon={Building2} />
            <Metric label="Aktiv" value={courtSummary.active} icon={CheckCircle2} />
            <Metric label="Maintenance" value={courtSummary.maintenance} icon={Wrench} />
            <Metric label="Gələcək booking" value={upcomingBookings} icon={CalendarClock} />
          </div>
          {venue.description ? (
            <p className="max-w-4xl whitespace-pre-line text-sm leading-6 text-foregroundMuted">
              {venue.description}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-surfaceElevated px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-foregroundMuted">{label}</span>
        <Icon className="h-4 w-4 text-accent" />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function CourtsPanel({
  courts,
  loading,
  sportsReady,
  onAdd,
  onEdit,
  onDelete,
  onManageBlocks,
}: {
  courts: Court[];
  loading: boolean;
  sportsReady: boolean;
  onAdd: () => void;
  onEdit: (court: Court) => void;
  onDelete: (court: Court) => void;
  onManageBlocks: (court: Court) => void;
}) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Kort idarəsi</CardTitle>
          <p className="mt-1 text-sm text-foregroundMuted">
            Kort əlavə et, qiymət/status dəyiş, şəkil və maintenance idarə et.
          </p>
        </div>
        <Button onClick={onAdd} disabled={!sportsReady}>
          <Plus className="h-4 w-4" />
          Kort əlavə et
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <RowsSkeleton />
        ) : courts.length === 0 ? (
          <EmptyPanel
            icon={Building2}
            title="Kort yoxdur"
            text="Booking qəbul etmək üçün ən azı bir padel və ya tenis kortu əlavə edin."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kort</TableHead>
                <TableHead>İdman</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Saatlıq qiymət</TableHead>
                <TableHead className="text-right">Əməliyyat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {courts.map((court) => (
                <TableRow key={court.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="relative h-12 w-12 overflow-hidden rounded-xl border border-border bg-surfaceElevated">
                        {court.photo_url ? (
                          <Image
                            src={court.photo_url}
                            alt={court.name}
                            fill
                            sizes="48px"
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-lg">
                            {court.sport_slug === "tennis" ? "🎾" : "🎾"}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{court.name}</div>
                        <div className="mt-1 text-xs text-foregroundMuted">{court.id}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{court.sport_name ?? court.sport_slug}</Badge>
                  </TableCell>
                  <TableCell>
                    <CourtStatusBadge status={court.status} />
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    {formatMoney(court.hourly_price_minor, court.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-surfaceElevated p-1">
                      <Button variant="ghost" size="icon" onClick={() => onEdit(court)} title="Redaktə et">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => onManageBlocks(court)} title="Maintenance">
                        <Wrench className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(court)}
                        title="Sil"
                        className="text-danger hover:bg-danger/10"
                      >
                        <Trash2 className="h-4 w-4" />
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
  );
}

function BlocksPanel({
  courts,
  selectedCourt,
  selectedCourtId,
  onSelectCourt,
}: {
  courts: Court[];
  selectedCourt: Court | undefined;
  selectedCourtId: string | undefined;
  onSelectCourt: (id: string) => void;
}) {
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("Maintenance");
  const [force, setForce] = useState(false);
  const toast = useToast();
  const blocksQuery = useCourtBlocks(selectedCourtId);
  const createBlock = useCreateCourtBlock(selectedCourtId ?? "");
  const deleteBlock = useDeleteCourtBlock(selectedCourtId ?? "");

  async function submitBlock(): Promise<void> {
    if (!selectedCourtId) return;
    if (!startsAt || !endsAt) {
      toast.error("Başlama və bitmə vaxtı lazımdır");
      return;
    }
    try {
      await createBlock.mutateAsync({
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        reason: reason.trim() || null,
        force,
      });
      setStartsAt("");
      setEndsAt("");
      setReason("Maintenance");
      setForce(false);
      toast.success("Maintenance bloku əlavə edildi");
    } catch (err) {
      toast.error("Blok əlavə edilmədi", describeError(err, "Vaxt aralığında booking ola bilər"));
    }
  }

  if (courts.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyPanel
            icon={Wrench}
            title="Maintenance üçün court yoxdur"
            text="Əvvəlcə court əlavə edin."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Court seç</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {courts.map((court) => (
            <button
              key={court.id}
              type="button"
              onClick={() => onSelectCourt(court.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition-colors",
                selectedCourt?.id === court.id
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surfaceElevated hover:border-accent/50",
              )}
            >
              <span>
                <span className="block font-medium text-foreground">{court.name}</span>
                <span className="text-xs text-foregroundMuted">{court.sport_slug}</span>
              </span>
              <CourtStatusBadge status={court.status} />
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>{selectedCourt?.name ?? "Court"} maintenance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Başlama">
              <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
            </Field>
            <Field label="Bitmə">
              <Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
            </Field>
            <Field label="Səbəb">
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
            <label className="flex items-center gap-2 pt-7 text-sm text-foreground">
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
                className="h-4 w-4 rounded border-border bg-surfaceElevated text-accent"
              />
              Booking varsa da force et
            </label>
          </div>
          <Button onClick={submitBlock} disabled={createBlock.isPending || !selectedCourtId}>
            <Plus className="h-4 w-4" />
            Blok əlavə et
          </Button>

          <div className="border-t border-border pt-4">
            {blocksQuery.isLoading ? (
              <RowsSkeleton />
            ) : (blocksQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-foregroundMuted">Bu court üçün maintenance bloku yoxdur.</p>
            ) : (
              <div className="space-y-2">
                {(blocksQuery.data ?? []).map((block) => (
                  <BlockRow
                    key={block.id}
                    block={block}
                    busy={deleteBlock.isPending}
                    onDelete={async () => {
                      try {
                        await deleteBlock.mutateAsync(block.id);
                        toast.success("Blok silindi");
                      } catch (err) {
                        toast.error("Blok silinmədi", describeError(err, "Əməliyyat alınmadı"));
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BlockRow({
  block,
  busy,
  onDelete,
}: {
  block: CourtBlock;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surfaceElevated p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium text-foreground">
          {formatDateTime(block.starts_at)} → {formatDateTime(block.ends_at)}
        </div>
        <div className="mt-1 text-sm text-foregroundMuted">{block.reason || "Maintenance"}</div>
      </div>
      <Button variant="danger" size="sm" onClick={onDelete} disabled={busy}>
        <Trash2 className="h-4 w-4" />
        Sil
      </Button>
    </div>
  );
}

function BookingsPanel({
  bookings,
  loading,
  onCancel,
  onMarkPaid,
}: {
  bookings: Booking[];
  loading: boolean;
  onCancel: (booking: Booking) => void;
  onMarkPaid: (booking: Booking) => void;
}) {
  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle>Rezervasiyalar</CardTitle>
        <p className="mt-1 text-sm text-foregroundMuted">Bu məkana aid son 100 rezervasiya.</p>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <RowsSkeleton />
        ) : bookings.length === 0 ? (
          <EmptyPanel icon={CalendarClock} title="Rezervasiya yoxdur" text="Bu məkan üçün booking tapılmadı." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müştəri</TableHead>
                <TableHead>Kort</TableHead>
                <TableHead>Vaxt</TableHead>
                <TableHead>Qiymət</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Əməliyyat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => (
                <TableRow key={booking.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{booking.booker_display_name}</div>
                    <div className="text-xs text-foregroundMuted">{booking.booker_email}</div>
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{booking.court_name}</TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{formatDateTime(booking.starts_at)}</div>
                    <div className="text-xs text-foregroundMuted">{booking.duration_minutes} dəq.</div>
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    {formatMoney(booking.total_minor, booking.currency)}
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={booking.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-surfaceElevated p-1">
                      {["pending_payment", "partially_paid"].includes(booking.status) ? (
                        <Button variant="ghost" size="icon" onClick={() => onMarkPaid(booking)} title="Ödənildi et">
                          <Coins className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {!["cancelled", "refunded", "failed"].includes(booking.status) ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onCancel(booking)}
                          title="Ləğv et"
                          className="text-danger hover:bg-danger/10"
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function VenueRulesPanel({
  venue,
  busy,
  onSave,
}: {
  venue: Venue;
  busy: boolean;
  onSave: (data: Partial<Venue>) => Promise<void>;
}) {
  const [slot, setSlot] = useState(String(venue.booking_slot_minutes ?? 30));
  const [min, setMin] = useState(String(venue.min_booking_minutes ?? 60));
  const [max, setMax] = useState(String(venue.max_booking_minutes ?? 120));
  const [cancelWindow, setCancelWindow] = useState(String(venue.cancellation_window_minutes ?? 120));
  const [hoursJson, setHoursJson] = useState(
    JSON.stringify(venue.opening_hours ?? {}, null, 2),
  );

  async function submit(): Promise<void> {
    let openingHours: Record<string, unknown> | null = null;
    try {
      openingHours = hoursJson.trim() ? JSON.parse(hoursJson) : null;
    } catch {
      alert("Opening hours JSON düzgün deyil");
      return;
    }
    await onSave({
      booking_slot_minutes: Number(slot),
      min_booking_minutes: Number(min),
      max_booking_minutes: Number(max),
      cancellation_window_minutes: Number(cancelWindow),
      opening_hours: openingHours,
    });
  }

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle>Booking qaydaları</CardTitle>
        <p className="mt-1 text-sm text-foregroundMuted">
          Slot, minimum/maksimum rezervasiya müddəti və açılış saatları.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Slot dəqiqəsi">
            <Input type="number" min={5} value={slot} onChange={(event) => setSlot(event.target.value)} />
          </Field>
          <Field label="Minimum dəqiqə">
            <Input type="number" min={5} value={min} onChange={(event) => setMin(event.target.value)} />
          </Field>
          <Field label="Maksimum dəqiqə">
            <Input type="number" min={5} value={max} onChange={(event) => setMax(event.target.value)} />
          </Field>
          <Field label="Cancellation window">
            <Input type="number" min={0} value={cancelWindow} onChange={(event) => setCancelWindow(event.target.value)} />
          </Field>
        </div>
        <Field label="Opening hours JSON">
          <Textarea
            rows={10}
            value={hoursJson}
            onChange={(event) => setHoursJson(event.target.value)}
            placeholder='{"1":{"open":"07:00","close":"23:00"},"sunday":{"closed":true}}'
            className="font-mono text-xs"
          />
        </Field>
        <Button onClick={submit} disabled={busy}>
          <RefreshCw className={cn("h-4 w-4", busy ? "animate-spin" : "")} />
          Qaydaları yadda saxla
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function VenueStatusBadge({ status }: { status?: Venue["status"] }) {
  if (status === "published") return <Badge variant="success">Published</Badge>;
  if (status === "pending") return <Badge variant="warning">Pending</Badge>;
  if (status === "suspended") return <Badge variant="danger">Suspended</Badge>;
  return <Badge variant="neutral">Draft</Badge>;
}

function CourtStatusBadge({ status }: { status?: Court["status"] }) {
  if (status === "active") return <Badge variant="success">Aktiv</Badge>;
  if (status === "maintenance") return <Badge variant="warning">Maintenance</Badge>;
  if (status === "inactive") return <Badge variant="neutral">Passiv</Badge>;
  return <Badge variant="success">Aktiv</Badge>;
}

function BookingStatusBadge({ status }: { status: Booking["status"] }) {
  if (status === "paid") return <Badge variant="success">Ödənilib</Badge>;
  if (status === "pending_payment" || status === "partially_paid") {
    return <Badge variant="warning">{status.replace("_", " ")}</Badge>;
  }
  if (status === "cancelled" || status === "refunded" || status === "failed") {
    return <Badge variant="danger">{status}</Badge>;
  }
  return <Badge variant="neutral">{status}</Badge>;
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-foregroundMuted">{description}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Geri
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Gözləyin..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
      <Icon className="h-7 w-7 text-foregroundMuted" />
      <div className="font-medium text-foreground">{title}</div>
      <p className="max-w-sm text-sm text-foregroundMuted">{text}</p>
    </div>
  );
}

function RowsSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-xl bg-surfaceElevated" />
      ))}
    </div>
  );
}

function VenueSkeleton(): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="h-5 w-36 animate-pulse rounded bg-surfaceElevated" />
      <div className="h-80 animate-pulse rounded-xl border border-border bg-surface" />
      <div className="h-16 animate-pulse rounded-xl border border-border bg-surface" />
      <RowsSkeleton />
    </div>
  );
}
