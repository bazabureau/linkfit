"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, RotateCcw, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  TOURNAMENT_STATUSES,
  TOURNAMENT_STATUS_LABEL,
  useAdminTournaments,
  useDeleteTournament,
  useSports,
  type Tournament,
  type TournamentStatus,
} from "@/lib/admin-tournaments";
import { TournamentsTable } from "./TournamentsTable";

interface ErrorWithStatus {
  status?: number;
  message?: string;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const e = err as ErrorWithStatus;
    if (e.status === 409) {
      return e.message ?? "Cannot complete this action right now.";
    }
    if (e.message) return e.message;
  }
  return fallback;
}

function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function TournamentsPage(): React.JSX.Element {
  const toast = useToast();
  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = React.useState<TournamentStatus | "">("");
  const [sport, setSport] = React.useState<string>(""); // sport slug
  const [confirmCancel, setConfirmCancel] = React.useState<Tournament | null>(null);

  const { data: sports = [] } = useSports();

  const filters = React.useMemo(
    () => ({
      status: status === "" ? undefined : status,
      sport: sport === "" ? undefined : sport,
      q: debouncedSearch.trim().length > 0 ? debouncedSearch.trim() : undefined,
      limit: 25,
    }),
    [status, sport, debouncedSearch],
  );

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useAdminTournaments(filters);

  const deleteMut = useDeleteTournament();

  const tournaments: Tournament[] = React.useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const totalCount = tournaments.length;
  const hasFilters =
    status !== "" || sport !== "" || debouncedSearch.trim().length > 0;
  const reset = () => {
    setSearch("");
    setStatus("");
    setSport("");
  };

  const handleCancel = async () => {
    if (!confirmCancel) return;
    try {
      await deleteMut.mutateAsync(confirmCancel.id);
      toast.success("Tournament cancelled", confirmCancel.name);
      setConfirmCancel(null);
    } catch (err) {
      toast.error(
        "Cancel failed",
        getErrorMessage(err, "Could not cancel this tournament"),
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tournaments</h1>
          <p className="text-sm text-foregroundMuted">
            Schedule, publish, and manage tournaments end-to-end.
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href="/tournaments/new">
            <Plus className="h-3.5 w-3.5" />
            New tournament
          </Link>
        </Button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_180px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or description…"
              className="pl-9"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TournamentStatus | "")}
            className="flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <option value="">All statuses</option>
            {TOURNAMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TOURNAMENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <option value="">All sports</option>
            {sports.map((s) => (
              <option key={s.id} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            onClick={reset}
            disabled={!hasFilters}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </Card>

      {/* Empty state: no tournaments AND no filters → big CTA */}
      {!isLoading && totalCount === 0 && !hasFilters ? (
        <EmptyState />
      ) : (
        <Card>
          <TournamentsTable
            tournaments={tournaments}
            isLoading={isLoading}
            onDelete={(t) => setConfirmCancel(t)}
          />
          {hasNextPage && (
            <div className="flex justify-center border-t border-border p-4">
              <Button
                variant="secondary"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </Card>
      )}

      <Dialog
        open={confirmCancel !== null}
        onOpenChange={(open) => (open ? null : setConfirmCancel(null))}
        title="Cancel tournament?"
        description="The tournament will be marked as cancelled and hidden from public listings. Registered squads stay on the record for audit."
      >
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            Are you sure you want to cancel{" "}
            <span className="font-semibold">{confirmCancel?.name}</span>?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmCancel(null)}
              disabled={deleteMut.isPending}
            >
              Keep tournament
            </Button>
            <Button
              variant="danger"
              onClick={handleCancel}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Cancelling…" : "Yes, cancel"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="rounded-2xl bg-accent/10 p-4 text-accent">
        <Trophy className="h-8 w-8" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">
          No tournaments yet
        </h2>
        <p className="max-w-sm text-sm text-foregroundMuted">
          Spin up your first tournament in under a minute. Pick a sport, set
          dates, define the format, and publish — captains can start
          registering immediately.
        </p>
      </div>
      <Button asChild>
        <Link href="/tournaments/new">
          <Plus className="h-3.5 w-3.5" />
          Create your first tournament
        </Link>
      </Button>
    </Card>
  );
}
