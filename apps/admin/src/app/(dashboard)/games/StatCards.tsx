"use client";

import * as React from "react";
import {
  CalendarClock,
  CircleDot,
  Trophy,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface GameStats {
  total: number;
  open: number;
  full: number;
  completed: number;
  cancelled: number;
  upcoming: number;
  participants: number;
}

type Tone = "accent" | "info" | "success" | "warning" | "danger" | "neutral";

const TONE_RING: Record<Tone, string> = {
  accent: "bg-accent/15 text-[#3f6b00]",
  info: "bg-info/10 text-info",
  success: "bg-accent/15 text-[#3f6b00]",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-surfaceElevated text-foreground",
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
  loading?: boolean;
}): React.JSX.Element {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-card transition hover:shadow-lift">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold   text-foregroundMuted">
          {label}
        </span>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TONE_RING[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-16 animate-pulse rounded-md bg-surfaceElevated" />
      ) : (
        <p className="mt-2 font-display text-[1.7rem] font-bold leading-none tabular-nums text-foreground">
          {value}
        </p>
      )}
      {sub ? <p className="mt-1.5 truncate text-xs text-foregroundMuted">{sub}</p> : null}
    </div>
  );
}

export function StatCards({
  stats,
  totalCount,
  loading,
}: {
  stats: GameStats;
  totalCount: number;
  loading: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard
        icon={CircleDot}
        label={t("Ümumi")}
        value={totalCount}
        sub={t("Filtrə uyğun oyunlar")}
        tone="neutral"
        loading={loading}
      />
      <StatCard
        icon={Zap}
        label={t("Açıq")}
        value={stats.open}
        sub={t("Qeydiyyata açıq")}
        tone="success"
        loading={loading}
      />
      <StatCard
        icon={Users}
        label={t("Dolu")}
        value={stats.full}
        sub={t("Tutum dolub")}
        tone="info"
        loading={loading}
      />
      <StatCard
        icon={CalendarClock}
        label={t("Gələcək")}
        value={stats.upcoming}
        sub={t("Planlaşdırılmış")}
        tone="warning"
        loading={loading}
      />
      <StatCard
        icon={Trophy}
        label={t("İştirakçılar")}
        value={stats.participants}
        sub={t("Təsdiqli yerlər")}
        tone="accent"
        loading={loading}
      />
      <StatCard
        icon={XCircle}
        label={t("Ləğv / Bitib")}
        value={`${stats.cancelled} / ${stats.completed}`}
        sub={t("Bağlanmış oyunlar")}
        tone="danger"
        loading={loading}
      />
    </div>
  );
}
