"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  CalendarDays,
  Clock3,
  Eye,
  MapPin,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  distanceFromBakuKm,
  sportIcon,
  useAdminGames,
  useCancelAdminGame,
  useDeleteAdminGame,
  type AdminGame,
  type GameStatus,
} from "@/lib/admin-games";
import { formatDateTime } from "@/lib/date-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

const PAGE_SIZE = 20;

type StatusFilter = GameStatus | "all";
type DateFilter = "this_week" | "next_30" | "past_30" | "all";
type SportFilter = "all" | "padel" | "tennis";
type SortKey = "starts_at" | "capacity";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Hamısı" },
  { value: "open", label: "Açıq" },
  { value: "full", label: "Dolu" },
  { value: "cancelled", label: "Ləğv" },
  { value: "completed", label: "Bitib" },
];

const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "Bütün tarixlər" },
  { value: "this_week", label: "Bu həftə" },
  { value: "next_30", label: "Növbəti 30 gün" },
  { value: "past_30", label: "Son 30 gün" },
];

const SPORT_OPTIONS: Array<{ value: SportFilter; label: string }> = [
  { value: "all", label: "Hamısı" },
  { value: "padel", label: "Padel" },
  { value: "tennis", label: "Tenis" },
];

function dateRangeFor(filter: DateFilter): { from?: string; to?: string } {
  const now = new Date();
  if (filter === "this_week") {
    const day = now.getDay();
    const diffToMon = (day + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMon);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { from: monday.toISOString(), to: sunday.toISOString() };
  }
  if (filter === "next_30") {
    const to = new Date(now);
    to.setDate(now.getDate() + 30);
    return { from: now.toISOString(), to: to.toISOString() };
  }
  if (filter === "past_30") {
    const from = new Date(now);
    from.setDate(now.getDate() - 30);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  return {};
}

export function GamesTable(): JSX.Element {
  const toast = useToast();
  const { t } = useI18n();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sport, setSport] = useState<SportFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("starts_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<AdminGame | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminGame | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const range = useMemo(() => dateRangeFor(dateFilter), [dateFilter]);
  const params = useMemo(
    () => ({
      status,
      sport: sport === "all" ? undefined : sport,
      q: debouncedSearch || undefined,
      from: range.from,
      to: range.to,
      limit: PAGE_SIZE,
      offset,
    }),
    [status, sport, debouncedSearch, range.from, range.to, offset],
  );

  const { data, isLoading, isError, refetch, isFetching } = useAdminGames(params);

  const cancelMut = useCancelAdminGame({
    onSuccess: () => toast.success(t("Oyun ləğv edildi"), t("İştirakçılar bildiriş alacaq.")),
    onError: (err) => toast.error(t("Ləğv alınmadı"), err.message),
  });
  const deleteMut = useDeleteAdminGame({
    onSuccess: () => toast.success(t("Oyun silindi"), t("Oyun siyahılardan gizlədildi.")),
    onError: (err) => toast.error(t("Silmək alınmadı"), err.message),
  });

  const items = useMemo(() => {
    const rows = data?.items ?? [];
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "starts_at") {
        const ord = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
        return sortAsc ? ord : -ord;
      }
      const ord = a.capacity - b.capacity;
      return sortAsc ? ord : -ord;
    });
    return sorted;
  }, [data?.items, sortAsc, sortKey]);

  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleSummary = useMemo(() => summarizeGames(items), [items]);
  const hasFilters =
    status !== "all" ||
    sport !== "all" ||
    dateFilter !== "all" ||
    debouncedSearch.length > 0;

  function resetOffset(): void {
    setOffset(0);
  }

  function resetFilters(): void {
    setStatus("all");
    setSport("all");
    setDateFilter("all");
    setSearch("");
    setDebouncedSearch("");
    setOffset(0);
  }

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
      return;
    }
    setSortKey(key);
    setSortAsc(false);
  }

  return (
    <Card className="overflow-hidden rounded-xl border-border bg-surface p-0">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-lg font-semibold text-foreground">{t("Oyun siyahısı")}</div>
            <div className="mt-1 text-sm text-foregroundMuted">
              {total === 0
                ? t("Oyun yoxdur")
                : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} / ${total} ${t("oyun")}`}
              {isFetching && !isLoading ? ` · ${t("yenilənir")}` : ""}
            </div>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-3 xl:max-w-xl">
            <SummaryBox label={t("Açıq")} value={visibleSummary.open} />
            <SummaryBox label={t("Dolu")} value={visibleSummary.full} />
            <SummaryBox label={t("Ləğv")} value={visibleSummary.cancelled} />
          </div>
        </div>
      </div>

      <div className="border-b border-border bg-background/30 px-5 py-4">
        <div className="grid gap-4 2xl:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <FilterRow label={t("Status")}>
              {STATUS_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  active={status === option.value}
                  onClick={() => {
                    setStatus(option.value);
                    resetOffset();
                  }}
                >
                  {t(option.label)}
                </Chip>
              ))}
            </FilterRow>
            <FilterRow label={t("Tarix")}>
              {DATE_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  active={dateFilter === option.value}
                  onClick={() => {
                    setDateFilter(option.value);
                    resetOffset();
                  }}
                >
                  {t(option.label)}
                </Chip>
              ))}
            </FilterRow>
          </div>

          <div className="flex flex-col gap-3 2xl:w-[520px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedSport value={sport} onChange={setSportWithReset(setSport, resetOffset)} />
              <div className="flex items-center gap-2">
                {hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={resetFilters}>
                    {t("Sıfırla")}
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" onClick={() => refetch()}>
                  <RefreshCw className={cn("h-4 w-4", isFetching ? "animate-spin" : "")} />
                  {t("Yenilə")}
                </Button>
              </div>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
              <Input
                placeholder={t("Host və ya məkan üzrə axtar")}
                className="h-11 pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <GamesSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-surface">
              <TableHead className="min-w-[300px]">{t("Oyun")}</TableHead>
              <TableHead className="min-w-[230px]">{t("Məkan")}</TableHead>
              <TableHead className="min-w-[210px]">
                <SortButton active={sortKey === "starts_at"} onClick={() => toggleSort("starts_at")}>
                  {t("Vaxt")}
                </SortButton>
              </TableHead>
              <TableHead className="min-w-[160px] text-right">
                <SortButton active={sortKey === "capacity"} onClick={() => toggleSort("capacity")}>
                  {t("Tutum")}
                </SortButton>
              </TableHead>
              <TableHead className="w-28 text-right">{t("Status")}</TableHead>
              <TableHead className="w-36 text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((game) => (
              <GameRow
                key={game.id}
                game={game}
                onCancel={() => {
                  setCancelReason("");
                  setConfirmCancel(game);
                }}
                onDelete={() => setConfirmDelete(game)}
              />
            ))}
          </TableBody>
        </Table>
      )}

      {!isLoading && !isError && items.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-sm text-foregroundMuted sm:flex-row sm:items-center sm:justify-between">
          <div>
            {t("Səhifə")} <span className="text-foreground">{page}</span> /{" "}
            <span className="text-foreground">{pageCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t("Əvvəlki")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t("Növbəti")}
            </Button>
          </div>
        </div>
      ) : null}

      <CancelDialog
        game={confirmCancel}
        reason={cancelReason}
        pending={cancelMut.isPending}
        onReasonChange={setCancelReason}
        onOpenChange={(open) => {
          if (!open) setConfirmCancel(null);
        }}
        onConfirm={() => {
          if (!confirmCancel) return;
          const reason = cancelReason.trim();
          cancelMut.mutate({ id: confirmCancel.id, reason: reason || undefined });
          setConfirmCancel(null);
        }}
      />

      <DeleteDialog
        game={confirmDelete}
        pending={deleteMut.isPending}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        onConfirm={() => {
          if (!confirmDelete) return;
          deleteMut.mutate({ id: confirmDelete.id });
          setConfirmDelete(null);
        }}
      />
    </Card>
  );
}

function setSportWithReset(
  setSport: (sport: SportFilter) => void,
  resetOffset: () => void,
) {
  return (next: SportFilter) => {
    setSport(next);
    resetOffset();
  };
}

function summarizeGames(items: AdminGame[]) {
  return items.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { open: 0, full: 0, cancelled: 0, completed: 0 } satisfies Record<GameStatus, number>,
  );
}

function SummaryBox({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surfaceElevated px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-foregroundMuted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="grid gap-2 md:grid-cols-[84px_1fr] md:items-center">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-foregroundMuted">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-accent bg-accent text-black"
          : "border-border bg-surfaceElevated text-foregroundMuted hover:border-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SegmentedSport({
  value,
  onChange,
}: {
  value: SportFilter;
  onChange: (value: SportFilter) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="inline-flex rounded-xl border border-border bg-surfaceElevated p-1">
      {SPORT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            value === option.value
              ? "bg-accent text-black"
              : "text-foregroundMuted hover:text-foreground",
          )}
        >
          {option.value === "all" ? t(option.label) : `${sportIcon(option.value)} ${t(option.label)}`}
        </button>
      ))}
    </div>
  );
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider hover:text-foreground",
        active ? "text-foreground" : "text-foregroundMuted",
      )}
    >
      {children}
      <ArrowDownUp className="h-3.5 w-3.5" />
    </button>
  );
}

function GameRow({
  game,
  onCancel,
  onDelete,
}: {
  game: AdminGame;
  onCancel: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const canCancel = game.status === "open" || game.status === "full";
  const canDelete = game.status === "cancelled" || game.status === "completed";
  const distance = distanceFromBakuKm(game.lat, game.lng);

  return (
    <TableRow className="hover:bg-surfaceElevated/35">
      <TableCell className="py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-background text-xl">
            {sportIcon(game.sport_slug)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/games/${game.id}`}
                className="truncate font-semibold text-foreground hover:text-accent"
              >
                {game.host_display_name}
              </Link>
              <StatusBadge status={game.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foregroundMuted">
              <span className="capitalize">{sportLabel(game.sport_slug)}</span>
              <span>·</span>
              <span>{game.visibility === "public" ? "Public" : "Invite"}</span>
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-3">
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-foregroundMuted" />
          <div className="min-w-0">
            <div className="truncate text-foreground">
              {game.venue_name ?? t("Sərbəst lokasiya")}
            </div>
            <div className="mt-1 text-xs tabular-nums text-foregroundMuted">
              {distance} km
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-3">
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2 text-foreground">
            <CalendarDays className="h-4 w-4 text-foregroundMuted" />
            <span className="tabular-nums">{formatDateTime(game.starts_at)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-foregroundMuted">
            <Clock3 className="h-3.5 w-3.5" />
            {game.duration_minutes} dəq.
          </div>
        </div>
      </TableCell>
      <TableCell className="py-3 text-right">
        <CapacityBar confirmed={game.participants_count} capacity={game.capacity} />
      </TableCell>
      <TableCell className="py-3 text-right">
        <StatusBadge status={game.status} />
      </TableCell>
      <TableCell className="py-3 text-right">
        <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-surfaceElevated p-1">
          <Button asChild variant="ghost" size="icon" title={t("Bax")}>
            <Link href={`/games/${game.id}`}>
              <Eye className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!canCancel}
            onClick={onCancel}
            title={canCancel ? t("Oyunu ləğv et") : t("Yalnız açıq/dolu oyun ləğv edilə bilər")}
            className="text-danger hover:bg-danger/10"
          >
            <X className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!canDelete}
            onClick={onDelete}
            title={canDelete ? t("Oyunu sil") : t("Yalnız ləğv/bitmiş oyun silinə bilər")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function StatusBadge({ status }: { status: GameStatus }): JSX.Element {
  const { t } = useI18n();
  switch (status) {
    case "open":
      return <Badge variant="success">{t("Açıq")}</Badge>;
    case "full":
      return <Badge variant="info">{t("Dolu")}</Badge>;
    case "cancelled":
      return <Badge variant="danger">{t("Ləğv")}</Badge>;
    case "completed":
      return <Badge variant="neutral">{t("Bitib")}</Badge>;
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
}

export function CapacityBar({
  confirmed,
  capacity,
}: {
  confirmed: number;
  capacity: number;
}): JSX.Element {
  const pct = Math.min(100, Math.round((confirmed / Math.max(1, capacity)) * 100));
  const full = confirmed >= capacity;
  return (
    <div className="ml-auto inline-flex w-36 max-w-full flex-col items-end gap-1.5">
      <div className="flex items-center gap-2 text-sm tabular-nums text-foreground">
        <Users className="h-4 w-4 text-foregroundMuted" />
        {confirmed} / {capacity}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div
          className={cn("h-full rounded-full transition-all", full ? "bg-info" : "bg-accent")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Avatar({
  name,
  photoUrl,
  size = 28,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}): JSX.Element {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
  const dim = `${size}px`;

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        style={{ width: dim, height: dim }}
        className="rounded-full border border-border object-cover"
      />
    );
  }

  return (
    <div
      style={{ width: dim, height: dim }}
      className="flex items-center justify-center rounded-full border border-border bg-surfaceElevated text-[11px] font-medium text-foreground"
    >
      {initials || "?"}
    </div>
  );
}

function sportLabel(slug: string): string {
  if (slug === "padel") return "Padel";
  if (slug === "tennis") return "Tenis";
  return slug.replace(/_/g, " ");
}

function CancelDialog({
  game,
  reason,
  pending,
  onReasonChange,
  onOpenChange,
  onConfirm,
}: {
  game: AdminGame | null;
  reason: string;
  pending: boolean;
  onReasonChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={game !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Oyunu ləğv et?")}</DialogTitle>
          <DialogDescription>
            {game
              ? `${game.host_display_name} ${t("tərəfindən yaradılmış")} ${sportLabel(game.sport_slug)} ${t("oyunu ləğv olunacaq.")}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="cancel-reason" className="text-sm font-medium text-foreground">
            {t("Səbəb")}
          </label>
          <Input
            id="cancel-reason"
            placeholder={t("Məsələn: məkan texniki səbəbə görə bağlıdır")}
            value={reason}
            maxLength={500}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Geri")}
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? t("Ləğv edilir") : t("Ləğv et")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  game,
  pending,
  onOpenChange,
  onConfirm,
}: {
  game: AdminGame | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={game !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Oyunu sil?")}</DialogTitle>
          <DialogDescription>
            {t("Oyun default siyahılardan gizlənəcək, audit və database qeydi saxlanacaq.")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Geri")}
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? t("Silinir") : t("Sil")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GamesSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: 7 }).map((_, index) => (
        <div
          key={index}
          className="grid grid-cols-[2fr_1.4fr_1.2fr_0.8fr] gap-3 rounded-xl border border-border bg-surfaceElevated p-3"
        >
          {Array.from({ length: 4 }).map((__, cell) => (
            <div
              key={cell}
              className="h-4 animate-pulse rounded bg-border"
              style={{ opacity: 1 - cell * 0.12 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
      <div className="text-base font-medium text-foreground">{t("Oyun tapılmadı")}</div>
      <p className="max-w-sm text-sm text-foregroundMuted">
        {t("Filterləri dəyişin və ya yeni oyunlar yaradıldıqda burada görünəcək.")}
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-base font-medium text-danger">{t("Oyunlar yüklənmədi")}</div>
      <p className="max-w-sm text-sm text-foregroundMuted">
        {t("API bağlantısını və admin sessiyasını yoxlayın.")}
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t("Yenidən cəhd et")}
      </Button>
    </div>
  );
}
