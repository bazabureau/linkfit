"use client";

import * as React from "react";
import {
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  Handshake,
  PauseCircle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface VenueCounts {
  total: number;
  published: number;
  pending: number;
  draft: number;
  suspended: number;
  partners: number;
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
  icon: typeof Building2;
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

export function VenueStats({
  counts,
  loading,
}: {
  counts: VenueCounts;
  loading: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard
        icon={Building2}
        label={t("Total")}
        value={counts.total}
        sub={t("All venues")}
        tone="neutral"
        loading={loading}
      />
      <StatCard
        icon={CheckCircle2}
        label={t("Published")}
        value={counts.published}
        sub={t("Live and bookable")}
        tone="success"
        loading={loading}
      />
      <StatCard
        icon={Clock3}
        label={t("Pending")}
        value={counts.pending}
        sub={t("Awaiting review")}
        tone="warning"
        loading={loading}
      />
      <StatCard
        icon={FileText}
        label={t("Draft")}
        value={counts.draft}
        sub={t("Not yet submitted")}
        tone="info"
        loading={loading}
      />
      <StatCard
        icon={PauseCircle}
        label={t("Suspended")}
        value={counts.suspended}
        sub={t("Temporarily hidden")}
        tone="danger"
        loading={loading}
      />
      <StatCard
        icon={Handshake}
        label={t("Partners")}
        value={counts.partners}
        sub={t("Partner venues")}
        tone="accent"
        loading={loading}
      />
    </div>
  );
}
