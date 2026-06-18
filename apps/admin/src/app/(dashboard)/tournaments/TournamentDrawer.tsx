"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Hourglass,
  MapPin,
  Pencil,
  Trophy,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/date-format";
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

export interface TournamentDrawerActions {
  onCancel: (tournament: Tournament) => void;
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surfaceElevated text-foregroundMuted">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold   text-foregroundMuted">
          {label}
        </div>
        <div className="mt-0.5 break-words text-sm font-medium text-foreground">{children}</div>
      </div>
    </div>
  );
}

export function TournamentDrawer({
  tournament,
  open,
  onClose,
  actions,
}: {
  tournament: Tournament | null;
  open: boolean;
  onClose: () => void;
  actions: TournamentDrawerActions;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    return undefined;
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !tournament) return null;

  const terminal = isTerminalStatus(tournament.status);
  const filled = tournament.entries_count ?? 0;

  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim */}
      <button
        type="button"
        aria-label={t("Bağla")}
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-background shadow-lift transition-transform duration-300 ease-out sm:max-w-lg ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink text-accent">
              <Trophy className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-display text-base font-bold text-foreground">
                {tournament.name}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPillClass(tournament.status)}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(tournament.status)}`} />
                  {t(statusLabel(tournament.status))}
                </span>
                <span className="text-[11px] font-semibold   text-muted">
                  {tournament.sport_name ?? tournament.sport_slug ?? "—"}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Bağla")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foregroundMuted transition hover:bg-surfaceElevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {/* Capacity highlight */}
          <div className="my-3 flex items-center justify-between rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div>
              <div className="text-[11px] font-semibold   text-foregroundMuted">
                {t("Komandalar")}
              </div>
              <div className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">
                {filled}
                <span className="text-base text-foregroundMuted"> / {tournament.max_squads}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold   text-foregroundMuted">
                {t("İştirak haqqı")}
              </div>
              <div className="mt-1 font-display text-lg font-bold tabular-nums text-foreground">
                {formatMoney(tournament.entry_fee_minor, tournament.currency)}
              </div>
            </div>
          </div>

          {tournament.description ? (
            <p className="mb-3 whitespace-pre-line rounded-2xl border border-border bg-surface p-4 text-sm text-foregroundMuted shadow-card">
              {tournament.description}
            </p>
          ) : null}

          <div className="divide-y divide-border rounded-2xl border border-border bg-surface px-4 shadow-card">
            <Row icon={CalendarClock} label={t("Tarixlər")}>
              {formatDateRange(tournament.starts_at, tournament.ends_at)}
            </Row>
            <Row icon={MapPin} label={t("Məkan")}>
              {tournament.venue_name ?? t("Onlayn / Təyin olunmayıb")}
            </Row>
            <Row icon={Users} label={t("Komanda ölçüsü")}>
              {tournament.squad_size} {t("oyunçu")}
            </Row>
            <Row icon={Hourglass} label={t("Qeydiyyat son tarixi")}>
              {tournament.registration_deadline
                ? formatDateTime(tournament.registration_deadline)
                : "—"}
            </Row>
            <Row icon={CircleDollarSign} label={t("İştirak haqqı")}>
              {formatMoney(tournament.entry_fee_minor, tournament.currency)}
            </Row>
            {tournament.created_at ? (
              <Row icon={CalendarClock} label={t("Yaradılıb")}>
                {formatDateTime(tournament.created_at)}
              </Row>
            ) : null}
          </div>

          <div className="h-2" />
        </div>

        {/* Footer actions */}
        <div className="border-t border-border bg-surface px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Button asChild>
              <Link href={`/tournaments/${tournament.id}`}>
                <ArrowUpRight className="h-4 w-4" />
                {t("Detallar və komandalar")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/tournaments/${tournament.id}/edit`}>
                <Pencil className="h-4 w-4" />
                {t("Redaktə et")}
              </Link>
            </Button>
            {!terminal ? (
              <Button
                variant="danger"
                className="col-span-2"
                onClick={() => actions.onCancel(tournament)}
              >
                <XCircle className="h-4 w-4" />
                {t("Turniri ləğv et")}
              </Button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
