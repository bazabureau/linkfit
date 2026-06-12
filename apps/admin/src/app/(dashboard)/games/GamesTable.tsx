"use client";

/**
 * Admin Games table.
 *
 * Filters: status pill row, sport pill row, search by host name, date range
 * shortcut, free-text search. Server keeps cursor pagination but we use
 * offset under the hood for simple page-back / page-forward UX; cursor is
 * still available on the API surface for the iOS app.
 *
 * Row actions: View (→ /games/[id]), Cancel (with reason confirm),
 * Delete (only when cancelled/completed).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  Eye,
  Search,
  Trash2,
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

const PAGE_SIZE = 20;

type StatusFilter = GameStatus | "all";
type DateFilter = "this_week" | "next_30" | "past_30" | "all";
type SortKey = "starts_at" | "capacity";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "full", label: "Full" },
  { value: "cancelled", label: "Cancelled" },
  { value: "completed", label: "Completed" },
];

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "this_week", label: "This week" },
  { value: "next_30", label: "Next 30 days" },
  { value: "past_30", label: "Past 30 days" },
];

// Curated sport pill set — anything else we encounter goes into a generic
// "Other" lump on the row icon. Sport rows are pulled live below.
const SPORT_OPTIONS = ["all", "padel", "tennis", "football", "basketball", "volleyball"] as const;

function dateRangeFor(filter: DateFilter): { from?: string; to?: string } {
  const now = new Date();
  if (filter === "this_week") {
    const day = now.getDay(); // 0=Sun
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

  const [status, setStatus] = useState<StatusFilter>("all");
  const [sport, setSport] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("starts_at");
  const [sortAsc, setSortAsc] = useState(false);

  const [confirmCancel, setConfirmCancel] = useState<AdminGame | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminGame | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Debounce the search input so we don't refetch on every keystroke.
  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 280);
    return () => clearTimeout(t);
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
    onSuccess: () => toast.success("Cancelled", "Players will be notified."),
    onError: (err) =>
      toast.error("Cancel failed", err.message ?? "Try again in a moment."),
  });
  const deleteMut = useDeleteAdminGame({
    onSuccess: () => toast.success("Deleted", "Game hidden from listings."),
    onError: (err) =>
      toast.error("Delete failed", err.message ?? "Could not soft-delete game."),
  });

  const items = useMemo(() => {
    const rows = data?.items ?? [];
    // Client-side sort on top of the server's default starts_at DESC order —
    // covers "sort by capacity" and "flip starts_at to ascending".
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "starts_at") {
        const ord = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
        return sortAsc ? ord : -ord;
      }
      const ord = a.capacity - b.capacity;
      return sortAsc ? ord : -ord;
    });
    return sorted;
  }, [data?.items, sortKey, sortAsc]);

  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetOffset(): void {
    setOffset(0);
  }

  function toggleSort(key: SortKey): void {
    if (sortKey === key) setSortAsc((p) => !p);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      {/* ─── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-b border-border bg-surface/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] uppercase tracking-wider text-foregroundMuted">
            Status
          </span>
          {STATUS_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              active={status === opt.value}
              onClick={() => {
                setStatus(opt.value);
                resetOffset();
              }}
            >
              {opt.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] uppercase tracking-wider text-foregroundMuted">
            Sport
          </span>
          {SPORT_OPTIONS.map((s) => (
            <Chip
              key={s}
              active={sport === s}
              onClick={() => {
                setSport(s);
                resetOffset();
              }}
            >
              {s === "all" ? "All" : `${sportIcon(s)} ${s}`}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] uppercase tracking-wider text-foregroundMuted">
            Date
          </span>
          {DATE_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              active={dateFilter === opt.value}
              onClick={() => {
                setDateFilter(opt.value);
                resetOffset();
              }}
            >
              {opt.label}
            </Chip>
          ))}
          <div className="relative ml-auto w-72 max-w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
            <Input
              placeholder="Search by host or venue…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetOffset();
              }}
            />
          </div>
        </div>
      </div>

      {/* ─── Body ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <GamesSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Sport</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-left text-xs uppercase tracking-wider text-foregroundMuted hover:text-foreground"
                    onClick={() => toggleSort("starts_at")}
                  >
                    When <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-foregroundMuted hover:text-foreground"
                    onClick={() => toggleSort("capacity")}
                  >
                    Capacity <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="text-right">Distance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((g) => (
                <GameRow
                  key={g.id}
                  game={g}
                  onCancel={() => {
                    setCancelReason("");
                    setConfirmCancel(g);
                  }}
                  onDelete={() => setConfirmDelete(g)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ─── Pagination ─────────────────────────────────────────────────── */}
      {!isLoading && !isError && items.length > 0 && (
        <div className="flex items-center justify-between border-t border-border p-3 text-sm text-foregroundMuted">
          <div>
            Total: <span className="text-foreground">{total}</span>
            {isFetching && !isLoading ? <span className="ml-2 text-xs">· refreshing…</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <span className="px-2 text-xs tabular-nums">
              {page} / {pageCount}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ─── Cancel dialog ──────────────────────────────────────────────── */}
      <Dialog
        open={confirmCancel !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmCancel(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force-cancel game?</DialogTitle>
            <DialogDescription>
              {confirmCancel
                ? `${sportIcon(confirmCancel.sport_slug)} ${confirmCancel.sport_slug} game hosted by ${confirmCancel.host_display_name}. All confirmed participants will be notified.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor="cancel-reason"
              className="text-sm font-medium text-foreground"
            >
              Reason (optional, visible to participants)
            </label>
            <Input
              id="cancel-reason"
              placeholder="e.g. Venue maintenance"
              value={cancelReason}
              maxLength={500}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmCancel(null)}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={cancelMut.isPending}
              onClick={() => {
                if (!confirmCancel) return;
                const reason = cancelReason.trim();
                cancelMut.mutate({ id: confirmCancel.id, reason: reason || undefined });
                setConfirmCancel(null);
              }}
            >
              {cancelMut.isPending ? "Cancelling…" : "Yes, cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete dialog ──────────────────────────────────────────────── */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft-delete game?</DialogTitle>
            <DialogDescription>
              Hides this row from default listings. The underlying record (and
              its audit log) is preserved in the database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={deleteMut.isPending}
              onClick={() => {
                if (!confirmDelete) return;
                deleteMut.mutate({ id: confirmDelete.id });
                setConfirmDelete(null);
              }}
            >
              {deleteMut.isPending ? "Deleting…" : "Yes, delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ───────────────────────── Row ─────────────────────────

function GameRow({
  game,
  onCancel,
  onDelete,
}: {
  game: AdminGame;
  onCancel: () => void;
  onDelete: () => void;
}): JSX.Element {
  const canCancel = game.status === "open" || game.status === "full";
  const canDelete = game.status === "cancelled" || game.status === "completed";
  const distance = distanceFromBakuKm(game.lat, game.lng);

  return (
    <TableRow>
      <TableCell className="text-xl" title={game.sport_slug}>
        {sportIcon(game.sport_slug)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar name={game.host_display_name} photoUrl={game.host_photo_url} />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">
              {game.host_display_name}
            </span>
            <span className="text-[11px] text-foregroundMuted capitalize">
              {game.sport_slug.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-sm text-foregroundMuted">
        {game.venue_name ?? <span className="italic text-foregroundMuted/60">Free location</span>}
      </TableCell>
      <TableCell className="text-sm text-foregroundMuted tabular-nums">
        {formatDateTime(game.starts_at)}
        <div className="text-[11px] text-foregroundMuted/70">
          {game.duration_minutes} min
        </div>
      </TableCell>
      <TableCell className="text-right">
        <CapacityBar
          confirmed={game.participants_count}
          capacity={game.capacity}
        />
      </TableCell>
      <TableCell className="text-right text-sm text-foregroundMuted tabular-nums">
        {distance} km
      </TableCell>
      <TableCell>
        <StatusBadge status={game.status} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/games/${game.id}`}>
              <Eye className="h-3.5 w-3.5" />
              View
            </Link>
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!canCancel}
            onClick={onCancel}
            title={canCancel ? "Force-cancel game" : "Only open/full games can be cancelled"}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canDelete}
            onClick={onDelete}
            title={
              canDelete
                ? "Soft-delete game"
                : "Only cancelled/completed games can be deleted"
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ───────────────────────── Subcomponents ─────────────────────────

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
      className={[
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-accent/40 bg-accent/15 text-accent"
          : "border-border bg-transparent text-foregroundMuted hover:border-foregroundMuted/40 hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: GameStatus }): JSX.Element {
  switch (status) {
    case "open":
      return <Badge variant="success">Open</Badge>;
    case "full":
      return <Badge variant="info">Full</Badge>;
    case "cancelled":
      return <Badge variant="danger">Cancelled</Badge>;
    case "completed":
      return <Badge variant="neutral">Completed</Badge>;
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
    <div className="inline-flex w-24 flex-col items-end gap-1">
      <span className="text-xs tabular-nums text-foregroundMuted">
        {confirmed} / {capacity}
      </span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surfaceElevated">
        <div
          className={`h-full rounded-full ${full ? "bg-info" : "bg-accent"} transition-all`}
          style={{ width: `${String(pct)}%` }}
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
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
  const dim = `${String(size)}px`;
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        style={{ width: dim, height: dim }}
        className="rounded-full object-cover border border-border"
      />
    );
  }
  return (
    <div
      style={{ width: dim, height: dim }}
      className="flex items-center justify-center rounded-full bg-surfaceElevated text-[11px] font-medium text-foreground border border-border"
    >
      {initials || "?"}
    </div>
  );
}

function GamesSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-8 gap-3 rounded-md border border-border bg-surfaceElevated/30 p-3"
        >
          {Array.from({ length: 8 }).map((__, j) => (
            <div
              key={j}
              className="h-3 animate-pulse rounded bg-border"
              style={{ opacity: 1 - j * 0.07 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
      <div className="text-base font-medium text-foreground">No games found</div>
      <p className="max-w-sm text-sm text-foregroundMuted">
        Adjust the filters above or wait for new games to be scheduled.
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-base font-medium text-danger">Failed to load games</div>
      <p className="max-w-sm text-sm text-foregroundMuted">
        Check your network connection and try again. If the problem persists,
        verify the admin API is reachable.
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
