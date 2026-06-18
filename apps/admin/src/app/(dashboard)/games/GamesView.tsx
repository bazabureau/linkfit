"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useAdminGames,
  useCancelAdminGame,
  useDeleteAdminGame,
  useUpdateAdminGame,
  type AdminGame,
  type GameStatus,
} from "@/lib/admin-games";
import { GamesFilters, type FilterState } from "./GamesFilters";
import { GamesTable, type SortKey } from "./GamesTable";
import { GameDetailDrawer } from "./GameDetailDrawer";
import { StatCards, type GameStats } from "./StatCards";
import { CancelGameDialog, DeleteGameDialog } from "./dialogs";
import { PAGE_SIZE, dateRangeFor, isClosed } from "./lib";

type DialogMode = "cancel" | "delete" | null;

const INITIAL_FILTERS: FilterState = {
  q: "",
  status: "all",
  sport: "all",
  date: "all",
};

export function GamesView(): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();

  const [filters, setFilters] = React.useState<FilterState>(INITIAL_FILTERS);
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [sortKey, setSortKey] = React.useState<SortKey>("starts_at");
  const [sortAsc, setSortAsc] = React.useState(false);
  const [drawerGame, setDrawerGame] = React.useState<AdminGame | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [dialogMode, setDialogMode] = React.useState<DialogMode>(null);
  const [activeGame, setActiveGame] = React.useState<AdminGame | null>(null);

  // Debounce the free-text search so we don't refetch on every keystroke.
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(filters.q.trim()), 250);
    return () => clearTimeout(id);
  }, [filters.q]);

  // Any structured-filter change resets to the first page.
  React.useEffect(() => {
    setOffset(0);
  }, [filters.status, filters.sport, filters.date, debouncedQ]);

  const range = React.useMemo(() => dateRangeFor(filters.date), [filters.date]);

  const params = React.useMemo(
    () => ({
      status: filters.status,
      sport: filters.sport === "all" ? undefined : filters.sport,
      q: debouncedQ || undefined,
      from: range.from,
      to: range.to,
      limit: PAGE_SIZE,
      offset,
    }),
    [filters.status, filters.sport, debouncedQ, range.from, range.to, offset],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminGames(params);

  const cancelMut = useCancelAdminGame({
    onSuccess: () => toast.success(t("Oyun ləğv edildi"), t("İştirakçılar bildiriş alacaq.")),
    onError: (err) => toast.error(t("Ləğv alınmadı"), err.message),
  });
  const deleteMut = useDeleteAdminGame({
    onSuccess: () => toast.success(t("Oyun silindi"), t("Oyun siyahılardan gizlədildi.")),
    onError: (err) => toast.error(t("Silmək alınmadı"), err.message),
  });
  const updateMut = useUpdateAdminGame({
    onSuccess: () => toast.success(t("Oyun yeniləndi"), t("Status dəyişdirildi.")),
    onError: (err) => toast.error(t("Yeniləmə alınmadı"), err.message),
  });

  const rows = React.useMemo(() => data?.items ?? [], [data]);

  // Client-side sort over the current page (matches the previous behaviour).
  const items = React.useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "starts_at") {
        const ord = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
        return sortAsc ? ord : -ord;
      }
      const ord = a.capacity - b.capacity;
      return sortAsc ? ord : -ord;
    });
    return sorted;
  }, [rows, sortKey, sortAsc]);

  // Keep the open drawer in sync with the freshest list row.
  React.useEffect(() => {
    if (!drawerGame) return;
    const fresh = rows.find((g) => g.id === drawerGame.id);
    if (fresh && fresh !== drawerGame) setDrawerGame(fresh);
  }, [rows, drawerGame]);

  const stats = React.useMemo<GameStats>(() => {
    const now = Date.now();
    return rows.reduce<GameStats>(
      (acc, game) => {
        acc.total += 1;
        acc[game.status] += 1;
        acc.participants += game.participants_count;
        if (new Date(game.starts_at).getTime() >= now && !isClosed(game.status)) {
          acc.upcoming += 1;
        }
        return acc;
      },
      { total: 0, open: 0, full: 0, completed: 0, cancelled: 0, upcoming: 0, participants: 0 },
    );
  }, [rows]);

  function updateFilters(patch: Partial<FilterState>): void {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
      return;
    }
    setSortKey(key);
    setSortAsc(false);
  }

  function openDrawer(game: AdminGame): void {
    setDrawerGame(game);
    setDrawerOpen(true);
  }

  function openDialog(mode: DialogMode, game: AdminGame): void {
    setActiveGame(game);
    setDialogMode(mode);
  }

  function closeDialog(): void {
    setDialogMode(null);
    setActiveGame(null);
  }

  const rowActions = React.useMemo(
    () => ({
      onOpen: openDrawer,
      onCancel: (g: AdminGame) => openDialog("cancel", g),
      onDelete: (g: AdminGame) => openDialog("delete", g),
    }),
    [],
  );

  const drawerActions = React.useMemo(
    () => ({
      onCancel: (g: AdminGame) => openDialog("cancel", g),
      onDelete: (g: AdminGame) => openDialog("delete", g),
      onTransition: (g: AdminGame, status: GameStatus) =>
        updateMut.mutate({ id: g.id, data: { status } }),
      transitionPending: updateMut.isPending,
    }),
    [updateMut],
  );

  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(total, offset + items.length);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold   text-accent">
            {t("Oyunlar")}
          </p>
          <h1 className="mt-2 font-display text-[1.6rem] font-bold  text-foreground">
            {t("Oyun moderasiyası")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Padel və tenis oyunlarını yoxlayın, ləğv edin və idarə edin.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Yenilə")}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <StatCards stats={stats} totalCount={total} loading={isLoading && !data} />

      {/* Filters */}
      <GamesFilters
        value={filters}
        onChange={updateFilters}
        onReset={() => setFilters(INITIAL_FILTERS)}
      />

      {/* Table card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold text-foreground">
              {t("Oyun siyahısı")}
            </h2>
            <p className="text-xs text-foregroundMuted">
              {total === 0 ? `0 ${t("oyun")}` : `${rangeStart}–${rangeEnd} / ${total}`}
            </p>
          </div>
          {isFetching && !isLoading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">
              <RefreshCw className="h-3 w-3 animate-spin" />
              {t("Yenilənir")}
            </span>
          ) : null}
        </div>

        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <h3 className="font-display text-base font-bold text-danger">
              {t("Oyunlar yüklənmədi")}
            </h3>
            <p className="max-w-xs text-sm text-foregroundMuted">
              {t("API bağlantısını və admin sessiyasını yoxlayın.")}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              {t("Yenidən cəhd et")}
            </Button>
          </div>
        ) : (
          <GamesTable
            games={items}
            loading={isLoading}
            sortKey={sortKey}
            sortAsc={sortAsc}
            onSort={toggleSort}
            actions={rowActions}
          />
        )}

        {total > PAGE_SIZE ? (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-5 py-3 sm:flex-row">
            <p className="text-sm text-foregroundMuted">
              {t("Səhifə")} <span className="font-semibold text-foreground">{page}</span> /{" "}
              {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!canPrev || isFetching}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft className="h-4 w-4" />
                {t("Əvvəlki")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canNext || isFetching}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t("Növbəti")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Detail slide-over */}
      <GameDetailDrawer
        game={drawerGame}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        actions={drawerActions}
      />

      {/* Confirmation dialogs */}
      <CancelGameDialog
        game={activeGame}
        open={dialogMode === "cancel"}
        pending={cancelMut.isPending}
        onOpenChange={(open) => !open && closeDialog()}
        onConfirm={(reason) => {
          if (!activeGame) return;
          cancelMut.mutate({ id: activeGame.id, reason });
          closeDialog();
        }}
      />
      <DeleteGameDialog
        game={activeGame}
        open={dialogMode === "delete"}
        pending={deleteMut.isPending}
        onOpenChange={(open) => !open && closeDialog()}
        onConfirm={() => {
          if (!activeGame) return;
          deleteMut.mutate({ id: activeGame.id });
          closeDialog();
        }}
      />
    </div>
  );
}
