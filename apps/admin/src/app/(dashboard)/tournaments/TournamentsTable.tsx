"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarDays,
  Eye,
  MapPin,
  Pencil,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  formatDateRange,
  formatMoney,
  type Tournament,
} from "@/lib/admin-tournaments";
import {
  isTerminalStatus,
  statusDotClass,
  statusLabel,
  statusPillClass,
} from "./lib";

export interface TournamentRowActions {
  onOpen: (tournament: Tournament) => void;
  onCancel: (tournament: Tournament) => void;
}

const COL_COUNT = 7;

function StatusPill({ tournament }: { tournament: Tournament }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(tournament.status)}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(tournament.status)}`} />
      {t(statusLabel(tournament.status))}
    </span>
  );
}

function CapacityBar({
  filled,
  max,
}: {
  filled: number;
  max: number;
}): React.JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.round((filled / max) * 100)) : 0;
  const full = max > 0 && filled >= max;
  return (
    <div className="min-w-[120px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-sm font-bold tabular-nums text-foreground">
          {filled}
          <span className="text-foregroundMuted"> / {max}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surfaceElevated">
        <div
          className={`h-full rounded-full transition-all ${full ? "bg-warning" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
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

export function TournamentsTable({
  tournaments,
  loading,
  actions,
}: {
  tournaments: Tournament[];
  loading: boolean;
  actions: TournamentRowActions;
}): React.JSX.Element {
  const { t } = useI18n();
  const headClass =
    "sticky top-0 z-10 h-11 bg-surfaceElevated px-4 text-left align-middle text-[11px] font-semibold   text-foregroundMuted";

  return (
    <div className="w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[920px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={`${headClass} rounded-tl-2xl`}>{t("Turnir")}</th>
            <th className={headClass}>{t("İdman növü")}</th>
            <th className={headClass}>{t("Status")}</th>
            <th className={headClass}>{t("Tarixlər")}</th>
            <th className={headClass}>{t("Komandalar")}</th>
            <th className={`${headClass} text-right`}>{t("İştirak haqqı")}</th>
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
            tournaments.map((tournament, index) => (
              <tr
                key={tournament.id}
                onClick={() => actions.onOpen(tournament)}
                className={`group cursor-pointer border-b border-border transition-colors ${
                  index % 2 === 1
                    ? "bg-surfaceElevated/40 hover:bg-surfaceElevated"
                    : "bg-surface hover:bg-surfaceElevated/70"
                }`}
              >
                {/* Name */}
                <td className="px-4 py-3 align-middle">
                  <div className="flex min-w-[220px] items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink text-accent">
                      <Trophy className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">
                        {tournament.name}
                      </div>
                      {tournament.venue_name ? (
                        <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-foregroundMuted">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {tournament.venue_name}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-xs text-foregroundMuted">
                          {t("Onlayn / Təyin olunmayıb")}
                        </div>
                      )}
                    </div>
                  </div>
                </td>

                {/* Sport */}
                <td className="px-4 py-3 align-middle">
                  <span className="inline-flex items-center rounded-lg bg-surfaceElevated px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-inset ring-border">
                    {tournament.sport_name ?? tournament.sport_slug ?? "—"}
                  </span>
                </td>

                {/* Status */}
                <td className="px-4 py-3 align-middle">
                  <StatusPill tournament={tournament} />
                </td>

                {/* Dates */}
                <td className="px-4 py-3 align-middle">
                  <div className="flex min-w-[150px] items-center gap-1.5 whitespace-nowrap text-foreground">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0 text-foregroundMuted" />
                    {formatDateRange(tournament.starts_at, tournament.ends_at)}
                  </div>
                </td>

                {/* Capacity */}
                <td className="px-4 py-3 align-middle">
                  <CapacityBar
                    filled={tournament.entries_count ?? 0}
                    max={tournament.max_squads}
                  />
                </td>

                {/* Entry fee */}
                <td className="px-4 py-3 text-right align-middle">
                  <span className="font-display text-sm font-bold tabular-nums text-foreground">
                    {formatMoney(tournament.entry_fee_minor, tournament.currency)}
                  </span>
                </td>

                {/* Actions */}
                <td className="px-4 py-3 align-middle">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Link href={`/tournaments/${tournament.id}`}>
                        <Eye className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{t("Bax")}</span>
                      </Link>
                    </Button>
                    <Button
                      asChild
                      variant="secondary"
                      size="sm"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Link href={`/tournaments/${tournament.id}/edit`}>
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{t("Redaktə")}</span>
                      </Link>
                    </Button>
                    {!isTerminalStatus(tournament.status) ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.onCancel(tournament);
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{t("Ləğv et")}</span>
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {!loading && tournaments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
            <Users className="h-7 w-7 text-accent" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-foreground">
              {t("Turnir tapılmadı")}
            </h3>
            <p className="mt-1 max-w-xs text-sm text-foregroundMuted">
              {t("Filterləri dəyişərək yenidən yoxlayın.")}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
