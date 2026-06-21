"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useAdminTournaments,
  useDeleteTournament,
  useSports,
  type Tournament,
} from "@/lib/admin-tournaments";
import { TournamentFilters, type FilterState } from "./TournamentFilters";
import { TournamentsTable } from "./TournamentsTable";
import { TournamentDrawer } from "./TournamentDrawer";
import { StatCards, type TournamentStats } from "./StatCards";
import { PAGE_LIMIT } from "./lib";

const INITIAL_FILTERS: FilterState = { q: "", status: "all", sport: "all" };

interface ErrorWithStatus {
  status?: number;
  message?: string;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const e = err as ErrorWithStatus;
    if (e.status === 409) return e.message ?? fallback;
    if (e.message) return e.message;
  }
  return fallback;
}

function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export default function TournamentsPage(): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();

  const [filters, setFilters] = React.useState<FilterState>(INITIAL_FILTERS);
  const debouncedQuery = useDebouncedValue(filters.q);
  const [drawer, setDrawer] = React.useState<Tournament | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState<Tournament | null>(null);

  const { data: sports = [] } = useSports();

  const queryFilters = React.useMemo(
    () => ({
      status: filters.status !== "all" ? filters.status : undefined,
      sport: filters.sport !== "all" ? filters.sport : undefined,
      q: debouncedQuery.trim().length > 0 ? debouncedQuery.trim() : undefined,
      limit: PAGE_LIMIT,
    }),
    [filters.status, filters.sport, debouncedQuery],
  );

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = useAdminTournaments(queryFilters);

  const deleteMut = useDeleteTournament();

  const tournaments = React.useMemo<Tournament[]>(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  // Keep the open drawer in sync with the freshest list row.
  React.useEffect(() => {
    if (!drawer) return;
    const fresh = tournaments.find((item) => item.id === drawer.id);
    if (fresh && fresh !== drawer) setDrawer(fresh);
  }, [tournaments, drawer]);

  const stats = React.useMemo<TournamentStats>(
    () =>
      tournaments.reduce<TournamentStats>(
        (acc, item) => {
          acc.total += 1;
          if (item.status === "registration_open") acc.open += 1;
          if (item.status === "in_progress") acc.live += 1;
          if (item.status === "completed") acc.completed += 1;
          if (item.status === "cancelled") acc.cancelled += 1;
          acc.squads += item.entries_count ?? 0;
          return acc;
        },
        { total: 0, open: 0, live: 0, completed: 0, cancelled: 0, squads: 0 },
      ),
    [tournaments],
  );

  function updateFilters(patch: Partial<FilterState>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function openDrawer(tournament: Tournament) {
    setDrawer(tournament);
    setDrawerOpen(true);
  }

  async function handleCancel() {
    if (!confirmCancel) return;
    try {
      await deleteMut.mutateAsync(confirmCancel.id);
      toast.success(t("Turnir ləğv edildi"), confirmCancel.name);
      setConfirmCancel(null);
      setDrawerOpen(false);
    } catch (err) {
      toast.error(t("Ləğv alınmadı"), getErrorMessage(err, t("Yenidən yoxlayın")));
    }
  }

  const totalCount = tournaments.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold   text-accent">
            {t("Tournaments")}
          </p>
          <h1 className="mt-2 font-display text-[1.6rem] font-bold  text-foreground">
            {t("Turnir idarəetməsi")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Turnirləri planlaşdır, dərc et və komandaları idarə et.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Yenilə")}
          </Button>
          <Button asChild>
            <Link href="/tournaments/new">
              <Plus className="h-4 w-4" />
              {t("Yeni turnir")}
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <StatCards stats={stats} loading={isLoading} />

      {/* Filters */}
      <TournamentFilters
        value={filters}
        onChange={updateFilters}
        onReset={() => setFilters(INITIAL_FILTERS)}
        sports={sports}
      />

      {/* Table card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold text-foreground">
              {t("Turnir siyahısı")}
            </h2>
            <p className="text-xs text-foregroundMuted">
              {totalCount} {t("göstərilir")}
            </p>
          </div>
          {isFetching && !isFetchingNextPage ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">
              <RefreshCw className="h-3 w-3 animate-spin" />
              {t("Yenilənir")}
            </span>
          ) : null}
        </div>

        <TournamentsTable
          tournaments={tournaments}
          loading={isLoading}
          actions={{ onOpen: openDrawer, onCancel: (item) => setConfirmCancel(item) }}
        />

        {hasNextPage ? (
          <div className="flex justify-center border-t border-border px-5 py-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("Daha çox yüklə")}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Detail slide-over */}
      <TournamentDrawer
        tournament={drawer}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        actions={{ onCancel: (item) => setConfirmCancel(item) }}
      />

      {/* Cancel confirm */}
      <Dialog
        open={confirmCancel !== null}
        onOpenChange={(open) => (open ? null : setConfirmCancel(null))}
        title={t("Turniri ləğv et?")}
        description={t(
          "Turnir ləğv edilmiş kimi işarələnəcək və ictimai siyahılardan gizlənəcək. Qeydiyyatdan keçən komandalar audit üçün qalır.",
        )}
        contentClassName="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            {t("Bu turniri ləğv etmək istədiyinizə əminsiniz?")}{" "}
            <span className="font-semibold">{confirmCancel?.name}</span>
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmCancel(null)}
              disabled={deleteMut.isPending}
            >
              {t("Saxla")}
            </Button>
            <Button variant="danger" onClick={() => void handleCancel()} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("Bəli, ləğv et")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
