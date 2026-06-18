"use client";

import * as React from "react";
import {
  CalendarClock,
  CheckCircle2,
  PlayCircle,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface TournamentStats {
  total: number;
  open: number;
  live: number;
  completed: number;
  cancelled: number;
  squads: number;
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
  icon: typeof Trophy;
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
        <div className="mt-3 h-8 w-20 animate-pulse rounded-md bg-surfaceElevated" />
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
  loading,
}: {
  stats: TournamentStats;
  loading: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard
        icon={Trophy}
        label={t("Ümumi")}
        value={stats.total}
        sub={t("Yüklənmiş turnirlər")}
        tone="neutral"
        loading={loading}
      />
      <StatCard
        icon={CalendarClock}
        label={t("Qeydiyyat açıq")}
        value={stats.open}
        sub={t("Qeydiyyata açıq")}
        tone="success"
        loading={loading}
      />
      <StatCard
        icon={PlayCircle}
        label={t("Davam edir")}
        value={stats.live}
        sub={t("Hazırda keçirilir")}
        tone="info"
        loading={loading}
      />
      <StatCard
        icon={CheckCircle2}
        label={t("Tamamlanıb")}
        value={stats.completed}
        sub={t("Bitmiş turnirlər")}
        tone="accent"
        loading={loading}
      />
      <StatCard
        icon={XCircle}
        label={t("Ləğv edilib")}
        value={stats.cancelled}
        sub={t("Ləğv olunmuş")}
        tone="danger"
        loading={loading}
      />
      <StatCard
        icon={Users}
        label={t("Komandalar")}
        value={stats.squads}
        sub={t("Qeydiyyatdan keçən")}
        tone="warning"
        loading={loading}
      />
    </div>
  );
}
