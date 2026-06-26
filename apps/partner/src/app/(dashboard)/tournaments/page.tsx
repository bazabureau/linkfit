"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trophy,
  Plus,
  Users,
  Calendar,
  AlertCircle,
  RefreshCw,
  XCircle,
  Eye,
  Ban,
  CalendarClock,
  Coins,
  CheckCircle2,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useSportsOptions } from "@/lib/partner-queries";
import { formatDate, formatDateTime } from "@/lib/date-format";

type TournamentStatus =
  | "announced"
  | "registration_open"
  | "registration_closed"
  | "in_progress"
  | "completed"
  | "cancelled";

type EntryStatus = "pending" | "confirmed" | "withdrawn" | "disqualified";

interface Tournament {
  id: string;
  name: string;
  description: string | null;
  sport_id: string;
  sport_slug: string | null;
  sport_name: string | null;
  starts_at: string;
  ends_at: string;
  registration_deadline: string | null;
  max_squads: number;
  squad_size: number;
  entry_fee_minor: number;
  currency: string;
  status: TournamentStatus;
  entries_count?: number;
  created_at?: string | null;
}

interface TournamentEntry {
  id: string;
  tournament_id: string;
  captain_user_id: string;
  captain_display_name: string | null;
  captain_email: string | null;
  squad_name: string;
  status: EntryStatus;
  created_at: string;
}

const STATUS_LABEL: Record<TournamentStatus, string> = {
  announced: "Elan edilib",
  registration_open: "Qeydiyyat açıq",
  registration_closed: "Qeydiyyat bağlı",
  in_progress: "Davam edir",
  completed: "Tamamlanıb",
  cancelled: "Ləğv edilib",
};

const STATUS_OPTIONS: TournamentStatus[] = [
  "announced",
  "registration_open",
  "registration_closed",
  "in_progress",
  "completed",
  "cancelled",
];

const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  pending: "Gözləyir",
  confirmed: "Təsdiqlənib",
  withdrawn: "Geri çəkilib",
  disqualified: "Diskvalifikasiya",
};

function statusBadge(status: TournamentStatus): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "registration_open" || status === "in_progress") return "success";
  if (status === "announced" || status === "registration_closed") return "info";
  if (status === "completed") return "neutral";
  return "danger";
}

function entryBadge(status: EntryStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "confirmed") return "success";
  if (status === "pending") return "warning";
  return "danger";
}

function money(minor: number, currency: string): string {
  if (minor === 0) return "Pulsuz";
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

const tournamentKeys = {
  list: (status: string) => ["partner", "tournaments", status] as const,
  detail: (id: string) => ["partner", "tournament", id] as const,
};

function KpiCard({
  label,
  value,
  icon,
  tone,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
  loading: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-foregroundMuted">{label}</p>
          {loading ? (
            <div className="mt-2 h-8 w-12 animate-pulse rounded-md bg-surfaceElevated" />
          ) : (
            <p className="mt-1 font-display text-3xl font-bold tabular-nums text-foreground">{value}</p>
          )}
        </div>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}>{icon}</span>
      </div>
    </div>
  );
}

export default function TournamentsPage(): React.JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<TournamentStatus | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Tournament | null>(null);

  // Create form fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sportId, setSportId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [regDeadline, setRegDeadline] = useState("");
  const [maxSquads, setMaxSquads] = useState("8");
  const [squadSize, setSquadSize] = useState("2");
  const [entryFee, setEntryFee] = useState("0");

  const { data: sports = [] } = useSportsOptions();
  // Backend only allows padel / tennis tournaments.
  const allowedSports = useMemo(
    () => sports.filter((s) => s.slug === "padel" || s.slug === "tennis"),
    [sports],
  );

  const queryString = useMemo(() => {
    const usp = new URLSearchParams();
    if (statusFilter !== "all") usp.set("status", statusFilter);
    usp.set("limit", "100");
    const s = usp.toString();
    return s ? `?${s}` : "";
  }, [statusFilter]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: tournamentKeys.list(statusFilter),
    queryFn: () => api.get<{ items: Tournament[] }>(`/api/v1/partner/tournaments${queryString}`),
    staleTime: 20_000,
  });
  const tournaments = useMemo(() => data?.items ?? [], [data]);

  const stats = useMemo(() => {
    return {
      total: tournaments.length,
      live: tournaments.filter((t) => t.status === "registration_open" || t.status === "in_progress").length,
      squads: tournaments.reduce((sum, t) => sum + (t.entries_count ?? 0), 0),
    };
  }, [tournaments]);

  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<Tournament>("/api/v1/partner/tournaments", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partner", "tournaments"] }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.post<Tournament>(`/api/v1/partner/tournaments/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partner", "tournaments"] }),
  });

  const resetForm = (): void => {
    setName("");
    setDescription("");
    setSportId(allowedSports[0]?.id ?? "");
    setStartsAt("");
    setEndsAt("");
    setRegDeadline("");
    setMaxSquads("8");
    setSquadSize("2");
    setEntryFee("0");
  };

  const openNew = (): void => {
    resetForm();
    setFormOpen(true);
  };

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || !sportId || !startsAt || !endsAt) {
      toast.error("Form xətası", "Ad, idman növü və tarixlər məcburidir.");
      return;
    }
    if (new Date(endsAt) < new Date(startsAt)) {
      toast.error("Tarix xətası", "Bitmə tarixi başlama tarixindən sonra olmalıdır.");
      return;
    }
    if (regDeadline && new Date(regDeadline) > new Date(startsAt)) {
      toast.error("Tarix xətası", "Qeydiyyatın son tarixi başlama tarixindən gec ola bilməz.");
      return;
    }
    const feeMinor = Math.round((parseFloat(entryFee) || 0) * 100);
    try {
      await createMut.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        sport_id: sportId,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        registration_deadline: regDeadline ? new Date(regDeadline).toISOString() : null,
        max_squads: Number(maxSquads),
        squad_size: Number(squadSize),
        entry_fee_minor: feeMinor,
        currency: "AZN",
        status: "announced",
      });
      toast.success("Turnir yaradıldı", `"${name}" uğurla əlavə edildi.`);
      setFormOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Yaradıla bilmədi", message || "Turniri yaratmaq mümkün olmadı.");
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (!confirmCancel) return;
    const target = confirmCancel;
    setConfirmCancel(null);
    try {
      await cancelMut.mutateAsync(target.id);
      toast.success("Turnir ləğv edildi", `"${target.name}" ləğv edildi.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz", message || "Turniri ləğv etmək mümkün olmadı.");
    }
  };

  const showEmpty = !isLoading && !isError && tournaments.length === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="flex items-center gap-2.5 font-display text-[1.6rem] font-bold text-foreground">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent">
              <Trophy className="h-5 w-5" />
            </span>
            Turnirlər
          </h1>
          <p className="max-w-2xl text-sm text-foregroundMuted">
            Məkanınızda padel və tennis turnirləri yaradın, qeydiyyatları və komandaları idarə edin.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Yenilə
          </Button>
          <Button size="sm" onClick={openNew} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Turnir Yarat
          </Button>
        </div>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Cəmi Turnir"
          value={stats.total}
          loading={isLoading}
          tone="bg-accent/10 text-accent"
          icon={<Trophy className="h-5 w-5" />}
        />
        <KpiCard
          label="Aktiv / Açıq"
          value={stats.live}
          loading={isLoading}
          tone="bg-info/10 text-info"
          icon={<Activity className="h-5 w-5" />}
        />
        <KpiCard
          label="Qeydiyyatlı Komanda"
          value={stats.squads}
          loading={isLoading}
          tone="bg-surfaceElevated text-foregroundMuted"
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      {/* Filter toolbar */}
      <div className="rounded-2xl border border-border bg-surface p-2 shadow-card">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              statusFilter === "all"
                ? "bg-accent text-accent-ink shadow-[0_4px_12px_rgba(197,242,53,0.18)]"
                : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground"
            }`}
          >
            Hamısı
          </button>
          {STATUS_OPTIONS.map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-accent text-accent-ink shadow-[0_4px_12px_rgba(197,242,53,0.18)]"
                    : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-danger/10">
              <AlertCircle className="h-6 w-6 text-danger" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Turnirlər yüklənmədi</h3>
            <p className="text-sm text-foregroundMuted">Şəbəkə bağlantınızı yoxlayıb yenidən cəhd edin.</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-1">
              Yenidən cəhd et
            </Button>
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10">
              <Trophy className="h-6 w-6 text-accent" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Turnir yoxdur</h3>
            <p className="max-w-sm text-sm text-foregroundMuted">
              İlk turniri yaradaraq oyunçuları rəqabətə dəvət edin.
            </p>
            <Button size="sm" onClick={openNew} className="mt-1 gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Turnir Yarat
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Ad</TableHead>
                <TableHead>İdman</TableHead>
                <TableHead>Tarix</TableHead>
                <TableHead>Komandalar</TableHead>
                <TableHead>İştirak haqqı</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">Əməliyyatlar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 w-full max-w-[120px] animate-pulse rounded bg-surfaceElevated" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!isLoading &&
                tournaments.map((t) => {
                  const filled = t.entries_count ?? 0;
                  const pct = t.max_squads > 0 ? Math.min(100, Math.round((filled / t.max_squads) * 100)) : 0;
                  const full = filled >= t.max_squads && t.max_squads > 0;
                  return (
                    <TableRow key={t.id} className="group cursor-pointer" onClick={() => setDetailId(t.id)}>
                      <TableCell className="pl-6">
                        <span className="font-semibold text-foreground transition-colors group-hover:text-accent">
                          {t.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral" className="text-[10px]  ">
                          {t.sport_slug ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="font-display tabular-nums text-foreground">{formatDate(t.starts_at)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="w-32 space-y-1">
                          <div className="flex items-baseline justify-between font-display text-xs tabular-nums">
                            <span className={`font-bold ${full ? "text-accent" : "text-foreground"}`}>{filled}</span>
                            <span className="text-foregroundMuted">/ {t.max_squads}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surfaceElevated">
                            <div
                              className={`h-full rounded-full transition-all ${full ? "bg-accent" : "bg-info"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-display font-semibold tabular-nums text-foreground">
                          {money(t.entry_fee_minor, t.currency)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadge(t.status)}>{STATUS_LABEL[t.status]}</Badge>
                      </TableCell>
                      <TableCell className="pr-6 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setDetailId(t.id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Bax
                          </Button>
                          {t.status !== "cancelled" && t.status !== "completed" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="p-2 text-foregroundMuted hover:text-danger"
                              aria-label="Turniri ləğv et"
                              onClick={() => setConfirmCancel(t)}
                            >
                              <Ban className="h-3.5 w-3.5" />
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
      </div>

      {/* Create dialog */}
      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title="Yeni Turnir Yarat"
        description="Padel və ya tennis turniri üçün format, tarix və iştirak şərtlərini təyin edin."
        contentClassName="max-w-xl"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="t-name">Turnirin Adı</Label>
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Məs. Yaz Padel Kuboku" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-sport">İdman Növü</Label>
            <select
              id="t-sport"
              value={sportId}
              onChange={(e) => setSportId(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent/60"
              required
            >
              <option value="">İdman növünü seçin...</option>
              {allowedSports.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {allowedSports.length === 0 && (
              <p className="text-[11px] text-warning">Yalnız padel və tennis turnirləri dəstəklənir.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-starts">Başlama</Label>
              <Input id="t-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-ends">Bitmə</Label>
              <Input id="t-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-deadline">Qeydiyyatın son tarixi (istəyə görə)</Label>
            <Input id="t-deadline" type="datetime-local" value={regDeadline} onChange={(e) => setRegDeadline(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-max">Maks. komanda</Label>
              <Input id="t-max" type="number" min="2" max="256" value={maxSquads} onChange={(e) => setMaxSquads(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-size">Komanda ölçüsü</Label>
              <Input id="t-size" type="number" min="1" max="20" value={squadSize} onChange={(e) => setSquadSize(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-fee">İştirak haqqı (AZN)</Label>
              <Input id="t-fee" type="number" min="0" step="0.01" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Təsvir (istəyə görə)</Label>
            <Textarea id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Turnir qaydaları, format və digər məlumatlar..." className="min-h-[90px]" />
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>Ləğv et</Button>
            <Button type="submit" disabled={createMut.isPending} className="gap-1.5">
              {createMut.isPending ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Yaradılır...
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" /> Turniri Yarat
                </>
              )}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Detail dialog */}
      <TournamentDetailDialog
        tournamentId={detailId}
        onClose={() => setDetailId(null)}
        onCancelClick={(t) => {
          setDetailId(null);
          setConfirmCancel(t);
        }}
      />

      {/* Cancel confirmation */}
      <Dialog
        open={confirmCancel !== null}
        onOpenChange={(open) => (open ? null : setConfirmCancel(null))}
        title="Turniri ləğv et"
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4">
            <Ban className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <p className="text-sm leading-relaxed text-foreground/90">
              <span className="font-semibold text-foreground">&quot;{confirmCancel?.name}&quot;</span> turnirini ləğv etmək istədiyinizə əminsiniz? Bu əməliyyat turniri ləğv edilmiş statusuna keçirəcək və geri qaytarıla bilməz.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmCancel(null)} disabled={cancelMut.isPending}>İmtina</Button>
            <Button variant="danger" onClick={handleCancel} disabled={cancelMut.isPending} className="gap-1.5">
              {cancelMut.isPending ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Ləğv edilir...
                </>
              ) : (
                "Bəli, ləğv et"
              )}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ─── Tournament detail + entries management dialog ──────────────────────

function TournamentDetailDialog({
  tournamentId,
  onClose,
  onCancelClick,
}: {
  tournamentId: string | null;
  onClose: () => void;
  onCancelClick: (t: Tournament) => void;
}): React.JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: tournamentKeys.detail(tournamentId ?? "none"),
    enabled: Boolean(tournamentId),
    queryFn: () => api.get<Tournament & { entries: TournamentEntry[] }>(`/api/v1/partner/tournaments/${tournamentId}`),
  });

  const entryMut = useMutation({
    mutationFn: ({ entryId, status }: { entryId: string; status: EntryStatus }) =>
      api.patch<TournamentEntry>(`/api/v1/partner/tournaments/${tournamentId}/entries/${entryId}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tournamentKeys.detail(tournamentId ?? "none") });
      qc.invalidateQueries({ queryKey: ["partner", "tournaments"] });
    },
  });

  // Wires PATCH /partner/tournaments/{id} so the partner can advance the
  // lifecycle (announced → registration_open → … → completed). Cancellation
  // keeps its dedicated confirm flow, so it is excluded from this selector.
  const updateMut = useMutation({
    mutationFn: (status: TournamentStatus) =>
      api.patch<Tournament & { entries: TournamentEntry[] }>(
        `/api/v1/partner/tournaments/${tournamentId}`,
        { status },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tournamentKeys.detail(tournamentId ?? "none") });
      qc.invalidateQueries({ queryKey: ["partner", "tournaments"] });
    },
  });

  const handleEntry = async (entry: TournamentEntry, status: EntryStatus): Promise<void> => {
    try {
      await entryMut.mutateAsync({ entryId: entry.id, status });
      toast.success("Komanda yeniləndi", `${entry.squad_name}: ${ENTRY_STATUS_LABEL[status]}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz", message || "Komandanı yeniləmək mümkün olmadı.");
    }
  };

  const handleStatusChange = async (next: TournamentStatus): Promise<void> => {
    if (!data || next === data.status) return;
    try {
      await updateMut.mutateAsync(next);
      toast.success("Status yeniləndi", STATUS_LABEL[next]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz", message || "Statusu yeniləmək mümkün olmadı.");
    }
  };

  const entries = data?.entries ?? [];
  const confirmedCount = entries.filter((e) => e.status === "confirmed").length;

  return (
    <Dialog
      open={tournamentId !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title={data?.name ?? "Turnir Detalları"}
      contentClassName="max-w-2xl"
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-14">
          <RefreshCw className="h-6 w-6 animate-spin text-accent" />
          <p className="text-sm text-foregroundMuted">Yüklənir...</p>
        </div>
      ) : isError || !data ? (
        <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
          <AlertCircle className="h-6 w-6 text-danger" />
          <p className="text-sm text-foregroundMuted">Turnir məlumatı yüklənmədi.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Status + fee banner */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadge(data.status)}>{STATUS_LABEL[data.status]}</Badge>
            <Badge variant="neutral" className="text-[10px]  ">
              {data.sport_name ?? data.sport_slug ?? "—"}
            </Badge>
            <span className="ml-auto flex items-center gap-1.5 font-display text-sm font-semibold tabular-nums text-foreground">
              <Coins className="h-3.5 w-3.5 text-accent" />
              {money(data.entry_fee_minor, data.currency)}
            </span>
          </div>

          {/* Status lifecycle control (wires PATCH /partner/tournaments/{id}) */}
          {data.status !== "cancelled" && (
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surfaceElevated/40 p-3">
              <label htmlFor="t-status-edit" className="shrink-0 text-xs font-semibold text-foregroundMuted">
                Statusu dəyiş
              </label>
              <select
                id="t-status-edit"
                value={data.status}
                disabled={updateMut.isPending}
                onChange={(e) => handleStatusChange(e.target.value as TournamentStatus)}
                className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent/60 disabled:opacity-60"
              >
                {STATUS_OPTIONS.filter((s) => s !== "cancelled").map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              {updateMut.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />}
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Meta
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              label="Başlama"
              value={formatDateTime(data.starts_at)}
            />
            <Meta
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              label="Bitmə"
              value={formatDateTime(data.ends_at)}
            />
            <Meta
              icon={<Users className="h-3.5 w-3.5" />}
              label="Komandalar"
              value={`${data.entries_count ?? entries.length} / ${data.max_squads}`}
            />
            <Meta
              icon={<Calendar className="h-3.5 w-3.5" />}
              label="Qeydiyyat sonu"
              value={data.registration_deadline ? formatDate(data.registration_deadline) : "—"}
            />
          </div>

          {data.description && (
            <p className="whitespace-pre-wrap rounded-xl border border-border bg-surfaceElevated/40 p-4 text-sm leading-relaxed text-foreground/90">
              {data.description}
            </p>
          )}

          {/* Entries */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Users className="h-4 w-4 text-accent" /> Qeydiyyatlar
              </h4>
              <span className="font-display text-xs font-semibold tabular-nums text-foregroundMuted">
                {confirmedCount} təsdiq · {entries.length} cəmi
              </span>
            </div>
            {entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surfaceElevated/20 py-8 text-center">
                <Users className="h-6 w-6 text-foregroundMuted" />
                <p className="text-sm text-foregroundMuted">Hələ heç bir komanda qeydiyyatdan keçməyib.</p>
              </div>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surfaceElevated/40 p-3 transition-colors hover:border-borderStrong"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface text-xs font-bold text-accent">
                        {entry.squad_name.charAt(0).toUpperCase() || "?"}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{entry.squad_name}</p>
                        <p className="truncate text-[11px] text-foregroundMuted">
                          Kapitan: {entry.captain_display_name ?? entry.captain_email ?? "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant={entryBadge(entry.status)} className="text-[10px]">
                        {ENTRY_STATUS_LABEL[entry.status]}
                      </Badge>
                      {entry.status !== "confirmed" && entry.status !== "withdrawn" && (
                        <Button
                          variant="primary"
                          size="sm"
                          className="h-7 gap-1 px-2 text-[11px]"
                          disabled={entryMut.isPending}
                          onClick={() => handleEntry(entry, "confirmed")}
                        >
                          <CheckCircle2 className="h-3 w-3" /> Təsdiqlə
                        </Button>
                      )}
                      {entry.status !== "disqualified" && entry.status !== "withdrawn" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px] text-foregroundMuted hover:text-danger"
                          disabled={entryMut.isPending}
                          onClick={() => handleEntry(entry, "disqualified")}
                        >
                          DQ
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex justify-between gap-2 border-t border-border pt-4">
            {data.status !== "cancelled" && data.status !== "completed" ? (
              <Button
                variant="ghost"
                className="gap-1.5 text-foregroundMuted hover:text-danger"
                onClick={() => onCancelClick(data)}
              >
                <XCircle className="h-4 w-4" /> Turniri Ləğv Et
              </Button>
            ) : (
              <span />
            )}
            <Button variant="secondary" onClick={onClose}>Bağla</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surfaceElevated/40 p-3">
      <p className="flex items-center gap-1 text-[10px] font-bold text-foregroundMuted">
        {icon} {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
