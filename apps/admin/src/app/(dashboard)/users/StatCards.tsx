"use client";

import * as React from "react";
import {
  Ban,
  CheckCircle2,
  MailCheck,
  Medal,
  Shield,
  Users,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { UserSummary } from "@/lib/admin-queries";

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
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TONE_RING[tone]}`}
        >
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
  summary,
  loading,
}: {
  summary: UserSummary | undefined;
  loading: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const adminTeam = (summary?.admin ?? 0) + (summary?.moderator ?? 0);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard
        icon={Users}
        label={t("Cəmi")}
        value={summary?.total ?? 0}
        sub={t("Bütün hesablar")}
        tone="neutral"
        loading={loading}
      />
      <StatCard
        icon={CheckCircle2}
        label={t("Aktiv")}
        value={summary?.active ?? 0}
        sub={t("Bloklanmayıb")}
        tone="success"
        loading={loading}
      />
      <StatCard
        icon={Ban}
        label={t("Blok")}
        value={summary?.suspended ?? 0}
        sub={t("Bloklanıb")}
        tone="danger"
        loading={loading}
      />
      <StatCard
        icon={MailCheck}
        label={t("Email təsdiqli")}
        value={summary?.verified ?? 0}
        sub={t("Təsdiqlənmiş email")}
        tone="info"
        loading={loading}
      />
      <StatCard
        icon={Medal}
        label="VIP"
        value={summary?.vip ?? 0}
        sub={t("VIP badge")}
        tone="warning"
        loading={loading}
      />
      <StatCard
        icon={Shield}
        label={t("Admin komandası")}
        value={adminTeam}
        sub={t("Admin / moderator")}
        tone="accent"
        loading={loading}
      />
    </div>
  );
}
