"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Hourglass,
  Bell,
  XCircle,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
  Mail,
  Filter,
  CalendarClock,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { usePartnerCourts } from "@/lib/partner-queries";
import { formatDate, formatTime } from "@/lib/date-format";

type WaitlistStatus = "active" | "notified" | "cancelled" | "expired";

interface WaitlistEntry {
  id: string;
  user_id: string;
  user: { id: string; display_name: string | null; email: string | null; photo_url: string | null };
  court_id: string;
  court_name: string;
  venue_id: string;
  venue_name: string;
  sport_slug: string | null;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  status: WaitlistStatus;
  notified_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WaitlistResponse {
  items: WaitlistEntry[];
  pagination: { limit: number; offset: number; total: number };
}

const STATUS_LABEL: Record<WaitlistStatus, string> = {
  active: "Aktiv",
  notified: "Xəbərdar edilib",
  cancelled: "Ləğv edilib",
  expired: "Vaxtı keçib",
};

const STATUS_FILTERS: { value: WaitlistStatus | "all"; label: string }[] = [
  { value: "active", label: "Aktiv" },
  { value: "notified", label: "Xəbərdar edilib" },
  { value: "cancelled", label: "Ləğv edilib" },
  { value: "expired", label: "Vaxtı keçib" },
  { value: "all", label: "Hamısı" },
];

function statusBadge(status: WaitlistStatus): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "active") return "info";
  if (status === "notified") return "success";
  if (status === "cancelled") return "danger";
  return "neutral";
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

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
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-foregroundMuted">{label}</p>
          {loading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded-md bg-surfaceElevated" />
          ) : (
            <p className="mt-1 font-display text-3xl font-bold tabular-nums text-foreground">{value}</p>
          )}
        </div>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}>{icon}</span>
      </div>
    </div>
  );
}

function RowSkeleton(): React.JSX.Element {
  return (
    <TableRow>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 w-full max-w-[120px] animate-pulse rounded bg-surfaceElevated" />
        </TableCell>
      ))}
    </TableRow>
  );
}

export default function WaitlistPage(): React.JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<WaitlistStatus | "all">("active");
  const [courtFilter, setCourtFilter] = useState<string>("all");
  const [date, setDate] = useState<string>("");

  const { data: courtsData } = usePartnerCourts();
  const courts = courtsData ?? [];

  const queryString = useMemo(() => {
    const usp = new URLSearchParams();
    if (statusFilter !== "all") usp.set("status", statusFilter);
    if (courtFilter !== "all") usp.set("court_id", courtFilter);
    if (date) usp.set("date", date);
    usp.set("limit", "100");
    const s = usp.toString();
    return s ? `?${s}` : "";
  }, [statusFilter, courtFilter, date]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["partner", "waitlist", statusFilter, courtFilter, date],
    queryFn: () => api.get<WaitlistResponse>(`/api/v1/partner/waitlist${queryString}`),
    staleTime: 15_000,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WaitlistStatus }) =>
      api.patch<WaitlistEntry>(`/api/v1/partner/waitlist/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partner", "waitlist"] }),
  });

  const entries = useMemo(() => data?.items ?? [], [data]);

  const stats = useMemo(() => {
    return {
      active: entries.filter((e) => e.status === "active").length,
      notified: entries.filter((e) => e.status === "notified").length,
      total: data?.pagination.total ?? entries.length,
    };
  }, [entries, data]);

  const handleUpdate = async (entry: WaitlistEntry, status: WaitlistStatus, label: string): Promise<void> => {
    try {
      await updateMut.mutateAsync({ id: entry.id, status });
      toast.success(label, `${entry.user.display_name ?? "İstifadəçi"} — ${entry.court_name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz", message || "Statusu yeniləmək mümkün olmadı.");
    }
  };

  const hasFilters = statusFilter !== "active" || courtFilter !== "all" || date !== "";
  const resetFilters = (): void => {
    setStatusFilter("active");
    setCourtFilter("all");
    setDate("");
  };

  const showEmpty = !isLoading && !isError && entries.length === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="flex items-center gap-2.5 font-display text-[1.6rem] font-bold text-foreground">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent">
              <Hourglass className="h-5 w-5" />
            </span>
            Gözləmə Siyahısı
          </h1>
          <p className="max-w-2xl text-sm text-foregroundMuted">
            Dolu slotlar üçün gözləyən oyunçuları idarə edin. Slot boşaldıqda onları xəbərdar edə bilərsiniz.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching} className="self-start gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Yenilə
        </Button>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Aktiv Gözləyən"
          value={stats.active}
          loading={isLoading}
          tone="bg-info/10 text-info"
          icon={<Hourglass className="h-5 w-5" />}
        />
        <KpiCard
          label="Xəbərdar edilib"
          value={stats.notified}
          loading={isLoading}
          tone="bg-accent/10 text-accent"
          icon={<Bell className="h-5 w-5" />}
        />
        <KpiCard
          label="Cəmi Qeyd"
          value={stats.total}
          loading={isLoading}
          tone="bg-surfaceElevated text-foregroundMuted"
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      {/* Toolbar */}
      <div className="rounded-2xl border border-border bg-surface p-3 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Status segmented control */}
          <div
            className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surfaceElevated/60 p-1"
            role="group"
            aria-label="Status filtri"
          >
            {STATUS_FILTERS.map((f) => {
              const active = statusFilter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(f.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-accent text-accent-ink shadow-[0_4px_12px_rgba(197,242,53,0.18)]"
                      : "text-foregroundMuted hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Court + date */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foregroundMuted" />
              <select
                value={courtFilter}
                onChange={(e) => setCourtFilter(e.target.value)}
                aria-label="Kort filtri"
                className="h-10 cursor-pointer rounded-lg border border-border bg-surfaceElevated pl-8 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/60"
              >
                <option value="all">Bütün kortlar</option>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <CalendarClock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foregroundMuted" />
              <Input
                aria-label="Tarix"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 w-[11.5rem] pl-8"
              />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5 text-foregroundMuted">
                <RotateCcw className="h-3.5 w-3.5" />
                Sıfırla
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-danger/10">
              <AlertCircle className="h-6 w-6 text-danger" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Siyahı yüklənmədi</h3>
            <p className="text-sm text-foregroundMuted">Şəbəkə bağlantınızı yoxlayıb yenidən cəhd edin.</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-1">
              Yenidən cəhd et
            </Button>
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10">
              <Hourglass className="h-6 w-6 text-accent" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Gözləyən yoxdur</h3>
            <p className="max-w-sm text-sm text-foregroundMuted">
              Seçilmiş filtrlərə uyğun gözləmə qeydi tapılmadı.
            </p>
            {hasFilters && (
              <Button variant="secondary" size="sm" onClick={resetFilters} className="mt-1 gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Filtrləri sıfırla
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Oyunçu</TableHead>
                <TableHead>Kort</TableHead>
                <TableHead>İstənilən Vaxt</TableHead>
                <TableHead>Müddət</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">Əməliyyatlar</TableHead>
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
                entries.map((entry) => (
                  <TableRow key={entry.id} className="group">
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-surfaceElevated text-xs font-bold text-foreground">
                          {initials(entry.user.display_name)}
                        </span>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-semibold text-foreground">
                            {entry.user.display_name ?? "İstifadəçi"}
                          </span>
                          {entry.user.email && (
                            <span className="flex items-center gap-1 truncate text-[11px] text-foregroundMuted">
                              <Mail className="h-3 w-3 shrink-0" /> {entry.user.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-accent">{entry.court_name}</span>
                      {entry.sport_slug && (
                        <span className="ml-1.5 text-[10px]   text-foregroundMuted">
                          {entry.sport_slug}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col leading-tight">
                        <span className="font-medium text-foreground">{formatDate(entry.starts_at)}</span>
                        <span className="font-display text-xs font-semibold tabular-nums text-foregroundMuted">
                          {formatTime(entry.starts_at)}–{formatTime(entry.ends_at)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-display tabular-nums text-foregroundMuted">
                      {entry.duration_minutes} dəq
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadge(entry.status)}>{STATUS_LABEL[entry.status]}</Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex justify-end gap-1.5">
                        {entry.status === "active" && (
                          <Button
                            variant="primary"
                            size="sm"
                            className="gap-1"
                            onClick={() => handleUpdate(entry, "notified", "Oyunçu xəbərdar edildi")}
                            disabled={updateMut.isPending}
                          >
                            <Bell className="h-3.5 w-3.5" />
                            Xəbər et
                          </Button>
                        )}
                        {entry.status === "notified" && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="gap-1"
                            onClick={() => handleUpdate(entry, "active", "Yenidən aktivləşdirildi")}
                            disabled={updateMut.isPending}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Aktivləşdir
                          </Button>
                        )}
                        {(entry.status === "active" || entry.status === "notified") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-foregroundMuted hover:text-danger"
                            onClick={() => handleUpdate(entry, "cancelled", "Qeyd ləğv edildi")}
                            disabled={updateMut.isPending}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Ləğv et
                          </Button>
                        )}
                        {(entry.status === "cancelled" || entry.status === "expired") && (
                          <span className="text-xs text-foregroundMuted">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
