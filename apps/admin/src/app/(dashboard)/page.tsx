"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAdminStats } from "@/lib/admin-overview";
import { useAudit, type AuditEntry } from "@/lib/admin-audit";
import { useI18n } from "@/lib/i18n";

const numberFmt = new Intl.NumberFormat("en-US");

type Tone = "accent" | "info" | "success" | "warning" | "danger" | "neutral";

const TONE_RING: Record<Tone, string> = {
  accent: "bg-accent/15 text-[#3f6b00]",
  info: "bg-info/10 text-info",
  success: "bg-accent/15 text-[#3f6b00]",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-surfaceElevated text-foreground",
};

type Kpi = {
  label: string;
  value: number | undefined;
  icon: typeof Users;
  hint: string;
  tone: Tone;
};

export default function AdminOverviewPage(): React.JSX.Element {
  const { data, isLoading, isError, refetch, isFetching } = useAdminStats();
  const {
    data: auditData,
    isLoading: auditLoading,
    isError: auditError,
    refetch: refetchAudit,
  } = useAudit(8);
  const { t } = useI18n();

  const firstAuditPage = auditData?.pages?.[0];
  const recentActivity: AuditEntry[] = firstAuditPage
    ? firstAuditPage.items.slice(0, 8)
    : [];

  const kpis: Kpi[] = [
    {
      label: "Total users",
      value: data?.users_total,
      icon: Users,
      hint: "All registered accounts",
      tone: "neutral",
    },
    {
      label: "New this week",
      value: data?.users_new_7d,
      icon: UserPlus,
      hint: "Sign-ups in the last 7 days",
      tone: "info",
    },
    {
      label: "Games this week",
      value: data?.games_this_week,
      icon: CalendarDays,
      hint: "Scheduled in the last 7 days",
      tone: "accent",
    },
    {
      label: "Games completed",
      value: data?.games_completed_total,
      icon: CheckCircle2,
      hint: "All-time finished games",
      tone: "success",
    },
  ];

  const topVenues = data?.top_venues ?? [];
  const pendingReports = data?.pending_reports ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold   text-accent">
            {t("Overview")}
          </p>
          <h1 className="mt-2 font-display text-[1.6rem] font-bold  text-foreground">
            {t("Overview")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("High-level activity across LinkFit.")}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            void refetch();
            void refetchAudit();
          }}
          disabled={isFetching}
          className="w-full lg:w-auto"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          {t("Refresh")}
        </Button>
      </div>

      {/* Stats load error */}
      {isError ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <p className="font-medium text-foreground">
                {t("Failed to load admin stats")}
              </p>
              <p className="text-sm text-foregroundMuted">
                {t("Check your connection and try again.")}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            className="w-full sm:w-auto"
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}

      {/* KPI strip */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiTile
            key={k.label}
            label={t(k.label)}
            value={k.value}
            icon={k.icon}
            hint={t(k.hint)}
            tone={k.tone}
            loading={isLoading}
          />
        ))}
      </section>

      {/* Chart + pending reports */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Top venues */}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card lg:col-span-2">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-[#3f6b00]">
                <Trophy className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-display text-sm font-bold text-foreground">
                  {t("Top venues")}
                </h2>
                <p className="text-xs text-foregroundMuted">
                  {t("Venues hosting the most games right now.")}
                </p>
              </div>
            </div>
          </div>

          <div className="p-5">
            {isLoading ? (
              <ChartSkeleton />
            ) : topVenues.length > 0 ? (
              <div className="space-y-5">
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topVenues.slice(0, 6)}
                      margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="venueBar"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor="#B7F233" stopOpacity={1} />
                          <stop
                            offset="100%"
                            stopColor="#B7F233"
                            stopOpacity={0.55}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(92,102,117,0.14)"
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "#5C6675", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        tickFormatter={(v: string) =>
                          v.length > 12 ? `${v.slice(0, 11)}…` : v
                        }
                      />
                      <YAxis
                        tick={{ fill: "#5C6675", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                        width={32}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(183,242,51,0.12)" }}
                        contentStyle={{
                          background: "#0E1116",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 10,
                          fontSize: 12,
                          color: "#FFFFFF",
                          boxShadow: "0 8px 24px rgba(14,17,22,0.28)",
                        }}
                        labelStyle={{ color: "#AEB6C2", marginBottom: 2 }}
                        itemStyle={{ color: "#B7F233", fontWeight: 600 }}
                        formatter={(value: number) => [
                          numberFmt.format(value),
                          t("Games"),
                        ]}
                      />
                      <Bar
                        dataKey="game_count"
                        fill="url(#venueBar)"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={48}
                      >
                        {topVenues.slice(0, 6).map((v) => (
                          <Cell key={v.id} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Ranked list */}
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surfaceElevated/60">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold   text-foregroundMuted">
                          {t("Venue")}
                        </th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold   text-foregroundMuted">
                          {t("Games")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topVenues.map((v, i) => (
                        <tr
                          key={v.id}
                          className="border-b border-border last:border-0 transition-colors hover:bg-surfaceElevated/50"
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surfaceElevated text-[11px] font-bold tabular-nums text-foregroundMuted">
                                {i + 1}
                              </span>
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-foregroundMuted" />
                              <span className="truncate font-medium text-foreground">
                                {v.name}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-display text-sm font-bold tabular-nums text-foreground">
                            {numberFmt.format(v.game_count)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={Trophy}
                message={t("No venue activity yet.")}
              />
            )}
          </div>
        </div>

        {/* Pending reports highlight */}
        <div
          className={`relative flex flex-col overflow-hidden rounded-2xl border shadow-card ${
            pendingReports > 0
              ? "border-warning/40 bg-warning/5"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                pendingReports > 0 ? TONE_RING.warning : TONE_RING.success
              }`}
            >
              {pendingReports > 0 ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
            </span>
            <div>
              <h2 className="font-display text-sm font-bold text-foreground">
                {t("Pending reports")}
              </h2>
              <p className="text-xs text-foregroundMuted">
                {t("Moderation queue awaiting review.")}
              </p>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-between gap-5 p-5">
            <div>
              {isLoading ? (
                <div className="h-14 w-24 animate-pulse rounded-lg bg-surfaceElevated" />
              ) : (
                <div
                  className={`font-display text-[3.25rem] font-bold leading-none tabular-nums ${
                    pendingReports > 0 ? "text-warning" : "text-foreground"
                  }`}
                >
                  {numberFmt.format(pendingReports)}
                </div>
              )}
              <p className="mt-2 text-xs text-foregroundMuted">
                {pendingReports > 0
                  ? t("Awaiting moderator action")
                  : t("All clear")}
              </p>
            </div>
            <Button
              asChild
              variant={pendingReports > 0 ? "primary" : "secondary"}
              className="w-full"
            >
              <Link href="/reports">
                {t("Review queue")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Recent activity */}
      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-[#3f6b00]">
              <Activity className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-sm font-bold text-foreground">
                {t("Recent activity")}
              </h2>
              <p className="text-xs text-foregroundMuted">
                {t("Latest actions across the admin panel.")}
              </p>
            </div>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/audit">
              {t("View all")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="p-5">
          {auditLoading ? (
            <div className="space-y-2.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-12 w-full animate-pulse rounded-lg bg-surfaceElevated/60"
                />
              ))}
            </div>
          ) : auditError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-danger/10 text-danger">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <p className="text-sm text-foregroundMuted">
                {t("Failed to load recent activity.")}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void refetchAudit()}
              >
                {t("Retry")}
              </Button>
            </div>
          ) : recentActivity.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surfaceElevated/60">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold   text-foregroundMuted">
                      {t("Action")}
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold   text-foregroundMuted">
                      {t("Entity")}
                    </th>
                    <th className="hidden px-4 py-2.5 text-left text-[11px] font-semibold   text-foregroundMuted sm:table-cell">
                      {t("Actor")}
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold   text-foregroundMuted">
                      {t("When")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-border last:border-0 transition-colors hover:bg-surfaceElevated/50"
                    >
                      <td className="px-4 py-3">
                        <ActivityBadge action={entry.action} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground">
                          {entry.entity}
                        </span>
                        <span className="ml-1.5 rounded bg-surfaceElevated px-1.5 py-0.5 font-mono text-[11px] text-foregroundMuted">
                          {entry.entity_id.slice(0, 8)}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-foregroundMuted sm:table-cell">
                        {entry.actor_display_name ?? t("Unknown actor")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-foregroundMuted">
                        {formatRelative(entry.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Activity}
              message={t("No recent activity yet.")}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function KpiTile({
  label,
  value,
  icon: Icon,
  hint,
  tone,
  loading,
}: {
  label: string;
  value: number | undefined;
  icon: typeof Users;
  hint: string;
  tone: Tone;
  loading: boolean;
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
        <div className="mt-3 h-8 w-20 animate-pulse rounded-md bg-surfaceElevated" />
      ) : (
        <p className="mt-2 font-display text-[1.7rem] font-bold leading-none tabular-nums text-foreground">
          {numberFmt.format(value ?? 0)}
        </p>
      )}
      <p className="mt-1.5 truncate text-xs text-foregroundMuted">{hint}</p>
    </div>
  );
}

function ActivityBadge({ action }: { action: string }): React.JSX.Element {
  const lower = action.toLowerCase();
  let variant: "success" | "warning" | "danger" | "info" | "neutral" =
    "neutral";
  if (lower.includes("create") || lower.includes("add")) variant = "success";
  else if (lower.includes("delete") || lower.includes("remove"))
    variant = "danger";
  else if (lower.includes("update") || lower.includes("edit"))
    variant = "info";
  else if (lower.includes("review") || lower.includes("dismiss"))
    variant = "warning";
  return <Badge variant={variant}>{action}</Badge>;
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: typeof Activity;
  message: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-surfaceElevated text-foregroundMuted">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm text-foregroundMuted">{message}</p>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

function ChartSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-5">
      <div className="flex h-52 w-full items-end gap-3 px-2">
        {[0.55, 0.85, 0.4, 0.7, 0.5, 0.3].map((h, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-t-md bg-surfaceElevated"
            style={{ height: `${h * 100}%` }}
          />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-9 w-full animate-pulse rounded-md bg-surfaceElevated/60"
          />
        ))}
      </div>
    </div>
  );
}
