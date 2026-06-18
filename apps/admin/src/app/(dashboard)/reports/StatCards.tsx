"use client";

import * as React from "react";
import {
  CheckCircle2,
  Clock,
  Inbox,
  XCircle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface ReportStats {
  total: number;
  pending: number;
  reviewed: number;
  dismissed: number;
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
  icon: typeof Inbox;
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
  stats: ReportStats;
  loading: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={Inbox}
        label={t("Ümumi")}
        value={stats.total}
        sub={t("Filtrə uyğun şikayətlər")}
        tone="neutral"
        loading={loading}
      />
      <StatCard
        icon={Clock}
        label={t("Gözləyir")}
        value={stats.pending}
        sub={t("Moderasiya gözləyir")}
        tone="warning"
        loading={loading}
      />
      <StatCard
        icon={CheckCircle2}
        label={t("Baxılıb")}
        value={stats.reviewed}
        sub={t("Tədbir görülüb")}
        tone="success"
        loading={loading}
      />
      <StatCard
        icon={XCircle}
        label={t("Rədd edilib")}
        value={stats.dismissed}
        sub={t("Tədbir tələb olunmur")}
        tone="danger"
        loading={loading}
      />
    </div>
  );
}
