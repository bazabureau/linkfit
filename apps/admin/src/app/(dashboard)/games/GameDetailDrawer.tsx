"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  Eye,
  Gauge,
  MapPin,
  Sparkles,
  StickyNote,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import {
  distanceFromBakuKm,
  sportIcon,
  useAdminGameDetail,
  type AdminGame,
  type GameStatus,
} from "@/lib/admin-games";
import {
  Avatar,
  CapacityBar,
  canCancel,
  canDelete,
  formatDuration,
  participantLabel,
  participantPillClass,
  sportLabel,
  statusDotClass,
  statusLabel,
  statusPillClass,
  visibilityLabel,
  type ParticipantStatus,
} from "./lib";

const STATUS_TRANSITIONS: Array<{ value: GameStatus; label: string }> = [
  { value: "open", label: "Açıq" },
  { value: "full", label: "Dolu" },
  { value: "completed", label: "Bitib" },
  { value: "cancelled", label: "Ləğv" },
];

export interface DrawerActions {
  onCancel: (game: AdminGame) => void;
  onDelete: (game: AdminGame) => void;
  onTransition: (game: AdminGame, status: GameStatus) => void;
  transitionPending: boolean;
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

export function GameDetailDrawer({
  game,
  open,
  onClose,
  actions,
}: {
  game: AdminGame | null;
  open: boolean;
  onClose: () => void;
  actions: DrawerActions;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const { data } = useAdminGameDetail(open && game ? game.id : undefined);
  const detail = data ?? null;
  const current = detail ?? game;
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

  if (!open || !current) return null;

  const closable = canCancel(current.status);
  const deletable = canDelete(current.status);
  const distance = distanceFromBakuKm(current.lat, current.lng);
  const participants = detail?.participants ?? [];

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
        aria-labelledby="game-drawer-title"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-background shadow-lift transition-transform duration-300 ease-out sm:max-w-lg ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border bg-background text-2xl">
              {sportIcon(current.sport_slug)}
            </span>
            <div className="min-w-0">
              <h2
                id="game-drawer-title"
                className="truncate font-display text-base font-bold capitalize text-foreground"
              >
                {t(sportLabel(current.sport_slug))} {t("oyunu")}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPillClass(current.status)}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(current.status)}`} />
                  {t(statusLabel(current.status))}
                </span>
                <span className="text-[11px] font-semibold   text-muted">
                  {visibilityLabel(current.visibility)}
                </span>
                {current.deleted_at ? (
                  <span className="inline-flex items-center rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold   text-danger">
                    {t("Silinib")}
                  </span>
                ) : null}
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
          {/* Host + capacity highlight */}
          <div className="my-3 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar
                name={current.host_display_name}
                photoUrl={current.host_photo_url}
                size={44}
              />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold   text-foregroundMuted">
                  {t("Host")}
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-foreground">
                  {current.host_display_name}
                </div>
              </div>
            </div>
            <CapacityBar
              confirmed={current.participants_count}
              capacity={current.capacity}
              className="shrink-0"
            />
          </div>

          <div className="divide-y divide-border rounded-2xl border border-border bg-surface px-4 shadow-card">
            <Row icon={MapPin} label={t("Məkan")}>
              <div>{current.venue_name ?? t("Sərbəst lokasiya")}</div>
              <div className="text-foregroundMuted">
                {distance} km {t("mərkəzdən")}
              </div>
            </Row>
            <Row icon={CalendarClock} label={t("Vaxt")}>
              {formatDateTime(current.starts_at)} · {formatDuration(current.duration_minutes)}
            </Row>
            <Row icon={Users} label={t("Tutum")}>
              {current.participants_count} / {current.capacity} {t("iştirakçı")}
            </Row>
            <Row icon={Gauge} label={t("Elo aralığı")}>
              <span className="tabular-nums">
                {current.skill_min_elo ?? "—"} – {current.skill_max_elo ?? "—"}
              </span>
            </Row>
            {detail?.notes ? (
              <Row icon={StickyNote} label={t("Qeyd")}>
                <span className="whitespace-pre-line">{detail.notes}</span>
              </Row>
            ) : null}
            <Row icon={CalendarClock} label={t("Yaradılıb")}>
              {formatDateTime(current.created_at)}
            </Row>
          </div>

          {/* Participants */}
          <div className="mt-3 rounded-2xl border border-border bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-[11px] font-semibold   text-foregroundMuted">
                {t("İştirakçılar")}
              </h3>
              <span className="font-display text-sm font-bold tabular-nums text-foreground">
                {participants.length}
              </span>
            </div>
            {participants.length === 0 ? (
              <p className="px-4 py-5 text-sm text-foregroundMuted">
                {t("Hələ kimsə qoşulmayıb.")}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {participants.map((p) => (
                  <li key={p.user_id} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar name={p.display_name} photoUrl={p.photo_url} size={32} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {p.display_name}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${participantPillClass(p.status as ParticipantStatus)}`}
                    >
                      {t(participantLabel(p.status as ParticipantStatus))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Manual status transition */}
          <div className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold   text-foregroundMuted">
              <Sparkles className="h-3.5 w-3.5" />
              {t("Status dəyişimi")}
            </div>
            <p className="mt-1.5 text-xs text-foregroundMuted">
              {t("Yalnız data düzəlişi üçün. İştirakçıları xəbərdar etmək üçün qırmızı ləğv düyməsini istifadə edin.")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {STATUS_TRANSITIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={opt.value === current.status ? "primary" : "secondary"}
                  size="sm"
                  disabled={
                    opt.value === current.status ||
                    actions.transitionPending ||
                    current.deleted_at !== null
                  }
                  onClick={() => actions.onTransition(current, opt.value)}
                >
                  {t(opt.label)}
                </Button>
              ))}
            </div>
          </div>

          <div className="h-2" />
        </div>

        {/* Footer actions */}
        <div className="border-t border-border bg-surface px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="outline" className="col-span-2">
              <Link href={`/games/${current.id}`}>
                <Eye className="h-4 w-4" />
                {t("Tam detalı aç")}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button
              variant="danger"
              disabled={!closable}
              onClick={() => actions.onCancel(current)}
            >
              <X className="h-4 w-4" />
              {t("Ləğv et")}
            </Button>
            <Button
              variant="secondary"
              disabled={!deletable}
              onClick={() => actions.onDelete(current)}
            >
              <Trash2 className="h-4 w-4" />
              {t("Sil")}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
