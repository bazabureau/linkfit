"use client";

import * as React from "react";
import {
  ArrowDownUp,
  CalendarClock,
  Clock3,
  Gamepad2,
  MapPin,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { formatDate, formatTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import {
  distanceFromBakuKm,
  sportIcon,
  type AdminGame,
  type GameStatus,
} from "@/lib/admin-games";
import {
  CapacityBar,
  canCancel,
  canDelete,
  formatDuration,
  sportLabel,
  statusDotClass,
  statusLabel,
  statusPillClass,
  visibilityLabel,
} from "./lib";

export type SortKey = "starts_at" | "capacity";

export interface GameRowActions {
  onOpen: (game: AdminGame) => void;
  onCancel: (game: AdminGame) => void;
  onDelete: (game: AdminGame) => void;
}

const COL_COUNT = 7;

function StatusPill({ status }: { status: GameStatus }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(status)}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`} />
      {t(statusLabel(status))}
    </span>
  );
}

function QuickAction({
  title,
  onClick,
  disabled,
  children,
  danger,
}: {
  title: string;
  onClick: (event: React.MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onClick(event);
      }}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "border-danger/20 text-danger/80 hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          : "border-border text-foregroundMuted hover:border-borderStrong hover:bg-surfaceElevated hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SortHead({
  active,
  asc,
  onClick,
  align = "left",
  children,
}: {
  active: boolean;
  asc: boolean;
  onClick: () => void;
  align?: "left" | "right";
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold   transition hover:text-foreground ${
        active ? "text-foreground" : "text-foregroundMuted"
      } ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      {children}
      <ArrowDownUp className={`h-3 w-3 transition ${active && asc ? "rotate-180" : ""}`} />
    </button>
  );
}

function RowSkeleton(): React.JSX.Element {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: COL_COUNT }).map((_, index) => (
        <td key={index} className="px-4 py-3.5">
          <div
            className="h-4 animate-pulse rounded bg-surfaceElevated"
            style={{ width: `${50 + ((index * 13) % 45)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

export function GamesTable({
  games,
  loading,
  sortKey,
  sortAsc,
  onSort,
  actions,
}: {
  games: AdminGame[];
  loading: boolean;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  actions: GameRowActions;
}): React.JSX.Element {
  const { t } = useI18n();

  const headClass =
    "sticky top-0 z-10 h-11 bg-surfaceElevated px-4 text-left align-middle text-[11px] font-semibold   text-foregroundMuted";

  return (
    <div className="w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[940px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={`${headClass} rounded-tl-2xl`}>{t("Oyun")}</th>
            <th className={headClass}>{t("Məkan")}</th>
            <th className={headClass}>
              <SortHead
                active={sortKey === "starts_at"}
                asc={sortAsc}
                onClick={() => onSort("starts_at")}
              >
                {t("Vaxt")}
              </SortHead>
            </th>
            <th className={`${headClass} text-right`}>
              <SortHead
                active={sortKey === "capacity"}
                asc={sortAsc}
                onClick={() => onSort("capacity")}
                align="right"
              >
                {t("Tutum")}
              </SortHead>
            </th>
            <th className={headClass}>{t("Görünüş")}</th>
            <th className={headClass}>{t("Status")}</th>
            <th className={`${headClass} rounded-tr-2xl text-right`}>{t("Əməliyyat")}</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            games.map((game, index) => {
              const distance = distanceFromBakuKm(game.lat, game.lng);
              return (
                <tr
                  key={game.id}
                  onClick={() => actions.onOpen(game)}
                  className={`group cursor-pointer border-b border-border transition-colors ${
                    index % 2 === 1
                      ? "bg-surfaceElevated/40 hover:bg-surfaceElevated"
                      : "bg-surface hover:bg-surfaceElevated/70"
                  } ${game.deleted_at ? "opacity-60" : ""}`}
                >
                  {/* Game + host */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-[220px] items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-lg">
                        {sportIcon(game.sport_slug)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">
                          {game.host_display_name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-foregroundMuted">
                          <span className="capitalize">{t(sportLabel(game.sport_slug))}</span>
                          {game.deleted_at ? (
                            <span className="inline-flex items-center rounded-full bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold   text-danger">
                              {t("Silinib")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Venue */}
                  <td className="px-4 py-3 align-middle">
                    <div className="min-w-[170px]">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-foregroundMuted" />
                        <span className="truncate">
                          {game.venue_name ?? t("Sərbəst lokasiya")}
                        </span>
                      </div>
                      <div className="mt-0.5 pl-5 text-xs tabular-nums text-foregroundMuted">
                        {distance} km {t("mərkəzdən")}
                      </div>
                    </div>
                  </td>

                  {/* Time */}
                  <td className="px-4 py-3 align-middle">
                    <div className="min-w-[140px]">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <CalendarClock className="h-3.5 w-3.5 shrink-0 text-foregroundMuted" />
                        <span className="tabular-nums">{formatDate(game.starts_at)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 pl-5 text-xs text-foregroundMuted">
                        <Clock3 className="h-3 w-3" />
                        {formatTime(game.starts_at)} · {formatDuration(game.duration_minutes)}
                      </div>
                    </div>
                  </td>

                  {/* Capacity */}
                  <td className="px-4 py-3 align-middle">
                    <CapacityBar
                      confirmed={game.participants_count}
                      capacity={game.capacity}
                      className="ml-auto"
                    />
                  </td>

                  {/* Visibility */}
                  <td className="px-4 py-3 align-middle">
                    <span className="inline-flex items-center rounded-full bg-surfaceElevated px-2.5 py-1 text-[11px] font-semibold text-foregroundMuted ring-1 ring-inset ring-border">
                      {visibilityLabel(game.visibility)}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 align-middle">
                    <StatusPill status={game.status} />
                  </td>

                  {/* Quick actions */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      <QuickAction
                        title={t("Oyunu ləğv et")}
                        danger
                        disabled={!canCancel(game.status)}
                        onClick={() => actions.onCancel(game)}
                      >
                        <X className="h-4 w-4" />
                      </QuickAction>
                      <QuickAction
                        title={t("Oyunu sil")}
                        disabled={!canDelete(game.status)}
                        onClick={() => actions.onDelete(game)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </QuickAction>
                      <QuickAction title={t("Detal")} onClick={() => actions.onOpen(game)}>
                        <MoreHorizontal className="h-4 w-4" />
                      </QuickAction>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {!loading && games.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
            <Gamepad2 className="h-7 w-7 text-accent" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-foreground">
              {t("Oyun tapılmadı")}
            </h3>
            <p className="mt-1 max-w-xs text-sm text-foregroundMuted">
              {t("Filterləri dəyişin və ya yeni oyunlar yaradıldıqda burada görünəcək.")}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
