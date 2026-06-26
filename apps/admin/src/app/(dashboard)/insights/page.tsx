"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, AlertTriangle, Building2, RefreshCw, TrendingUp, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import {
  useClubs,
  useEngagement,
  useFunnel,
  useGrowth,
  type GrowthCountPoint,
  type GrowthResponse,
} from "@/lib/admin-analytics";

const numberFmt = new Intl.NumberFormat("en-US");

function money(minor: number | null | undefined, currency = "AZN"): string {
  if (minor == null) return "—";
  const value = (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${value} ${currency === "AZN" ? "₼" : currency}`;
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("az-AZ", { day: "2-digit", month: "short" });

function mergeGrowth(g: GrowthResponse): { date: string; users: number; games: number; bookings: number; revenue: number }[] {
  const map = new Map<string, { date: string; users: number; games: number; bookings: number; revenue: number }>();
  const ensure = (date: string) => {
    const key = date.slice(0, 10);
    if (!map.has(key)) map.set(key, { date: key, users: 0, games: 0, bookings: 0, revenue: 0 });
    return map.get(key)!;
  };
  (g.new_users ?? []).forEach((p: GrowthCountPoint) => { ensure(p.date).users = p.count; });
  (g.new_games ?? []).forEach((p: GrowthCountPoint) => { ensure(p.date).games = p.count; });
  (g.new_bookings ?? []).forEach((p: GrowthCountPoint) => { ensure(p.date).bookings = p.count; });
  (g.revenue ?? []).forEach((p) => { ensure(p.date).revenue = Math.round(p.amount_minor / 100); });
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

const RANGE_OPTIONS = [7, 30, 90] as const;

export default function InsightsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [days, setDays] = React.useState<(typeof RANGE_OPTIONS)[number]>(30);
  const growth = useGrowth(days);
  const clubs = useClubs();
  const engagement = useEngagement();
  const funnel = useFunnel();

  const refetchAll = () => {
    void growth.refetch();
    void clubs.refetch();
    void engagement.refetch();
    void funnel.refetch();
  };
  const fetching = growth.isFetching || clubs.isFetching || engagement.isFetching || funnel.isFetching;
  const anyError = growth.isError || clubs.isError || engagement.isError || funnel.isError;

  const series = growth.data ? mergeGrowth(growth.data) : [];
  const cur = clubs.data?.currency ?? "AZN";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("Analytics")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <TrendingUp className="h-6 w-6 text-accent" />
            {t("Insights")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Growth time series, club performance, engagement and the activation funnel.")}
          </p>
        </div>
        <Button variant="secondary" onClick={refetchAll} disabled={fetching}>
          <RefreshCw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
          {t("Refresh")}
        </Button>
      </div>

      {anyError ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <p className="font-medium text-foreground">{t("Failed to load analytics")}</p>
              <p className="text-sm text-foregroundMuted">{t("Check your connection and try again.")}</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={refetchAll} disabled={fetching} className="w-full sm:w-auto">
            {t("Retry")}
          </Button>
        </div>
      ) : null}

      {/* Growth */}
      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-[#3f6b00]"><Users className="h-4 w-4" /></span>
            <div>
              <h2 className="font-display text-sm font-bold text-foreground">{t("Growth")}</h2>
              <p className="text-xs text-foregroundMuted">{t("New sign-ups, games and bookings per day.")}</p>
            </div>
          </div>
          <div className="flex w-fit gap-1 rounded-pill border border-border bg-surface p-1">
            {RANGE_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-pill px-3.5 py-1.5 text-sm font-medium transition ${days === d ? "bg-accent text-ink" : "text-foregroundMuted hover:text-foreground"}`}
              >
                {d}{t("d")}
              </button>
            ))}
          </div>
        </div>
        <div className="px-2 py-4 sm:px-4">
          {growth.isLoading ? (
            <div className="h-72 animate-pulse rounded-xl bg-surfaceElevated" />
          ) : series.length === 0 ? (
            <p className="py-16 text-center text-sm text-foregroundMuted">{t("No data")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={288}>
              <AreaChart data={series} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#B7F233" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#B7F233" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E9ED" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "#5C6675" }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: "#5C6675" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid #E4E9ED", fontSize: 12 }}
                  labelFormatter={(v) => shortDate(String(v))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="users" name={t("Users")} stroke="#B7F233" fill="url(#gUsers)" strokeWidth={2} />
                <Area type="monotone" dataKey="games" name={t("Games")} stroke="#3B82F6" fillOpacity={0} strokeWidth={2} />
                <Area type="monotone" dataKey="bookings" name={t("Bookings")} stroke="#F59E0B" fillOpacity={0} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Funnel + engagement */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-sm font-bold text-foreground">
            <Activity className="h-4 w-4 text-accent" />
            {t("Activation funnel")}
          </h2>
          {funnel.isLoading ? (
            <div className="h-40 animate-pulse rounded-xl bg-surfaceElevated" />
          ) : !funnel.data ? (
            <p className="py-12 text-center text-sm text-foregroundMuted">{t("No data")}</p>
          ) : (
            <FunnelBars
              registered={funnel.data.registered}
              rows={[
                { label: t("Registered"), value: funnel.data.registered },
                { label: t("Played a game"), value: funnel.data.played_a_game },
                { label: t("Booked a court"), value: funnel.data.booked_a_court },
                { label: t("Came via referral"), value: funnel.data.came_via_referral },
              ]}
            />
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-sm font-bold text-foreground">
            <TrendingUp className="h-4 w-4 text-accent" />
            {t("Engagement (30d)")}
          </h2>
          {engagement.isLoading ? (
            <div className="h-40 animate-pulse rounded-xl bg-surfaceElevated" />
          ) : !engagement.data ? (
            <p className="py-12 text-center text-sm text-foregroundMuted">{t("No data")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Stat label={t("Games created")} value={engagement.data.games_created_30d} />
              <Stat label={t("Game joins")} value={engagement.data.game_joins_30d} />
              <Stat label={t("Lesson bookings")} value={engagement.data.lesson_bookings_30d} />
              <Stat label={t("Messages")} value={engagement.data.messages_30d} />
              <Stat label={t("New follows")} value={engagement.data.follows_30d} />
              <Stat label={t("Avg / game")} value={engagement.data.avg_participants_per_game} raw />
            </div>
          )}
        </section>
      </div>

      {/* Match type breakdown */}
      {engagement.data && engagement.data.by_match_type.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="mb-4 font-display text-sm font-bold text-foreground">{t("Games by match type")}</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={engagement.data.by_match_type} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E9ED" vertical={false} />
              <XAxis dataKey="match_type" tick={{ fontSize: 11, fill: "#5C6675" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#5C6675" }} tickLine={false} axisLine={false} width={36} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E4E9ED", fontSize: 12 }} cursor={{ fill: "#F8FAFB" }} />
              <Bar dataKey="count" name={t("Games")} radius={[6, 6, 0, 0]}>
                {engagement.data.by_match_type.map((_, i) => (
                  <Cell key={i} fill={["#B7F233", "#3B82F6", "#F59E0B", "#7C3AED", "#EF4444"][i % 5]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Clubs */}
      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-[#3f6b00]"><Building2 className="h-4 w-4" /></span>
          <div>
            <h2 className="font-display text-sm font-bold text-foreground">{t("Club performance")}</h2>
            <p className="text-xs text-foregroundMuted">{t("Top venues by bookings, with court count and revenue.")}</p>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Venue")}</TableHead>
              <TableHead className="text-right">{t("Courts")}</TableHead>
              <TableHead className="text-right">{t("Bookings")}</TableHead>
              <TableHead className="text-right">{t("Revenue")}</TableHead>
              <TableHead className="text-right">{t("Paid")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clubs.isLoading ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : (clubs.data?.items.length ?? 0) === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">{t("No data")}</TableCell></TableRow>
            ) : (
              clubs.data?.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold text-foreground">{c.name}</TableCell>
                  <TableCell className="text-right tabular-nums text-foregroundMuted">{c.courts}</TableCell>
                  <TableCell className="text-right tabular-nums text-foregroundMuted">{numberFmt.format(c.bookings)}</TableCell>
                  <TableCell className="text-right tabular-nums text-foregroundMuted">{money(c.revenue_minor, cur)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-foreground">{money(c.paid_revenue_minor, cur)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function Stat({ label, value, raw = false }: { label: string; value: number; raw?: boolean }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surfaceElevated px-3 py-2.5">
      <p className="text-[10.5px] font-semibold text-foregroundMuted">{label}</p>
      <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-foreground">
        {raw ? value : numberFmt.format(value)}
      </p>
    </div>
  );
}

function FunnelBars({
  registered,
  rows,
}: {
  registered: number;
  rows: { label: string; value: number }[];
}): React.JSX.Element {
  const { t } = useI18n();
  const base = Math.max(1, registered);
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = Math.round((r.value / base) * 100);
        return (
          <div key={r.label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-foreground">{r.label}</span>
              <span className="tabular-nums text-foregroundMuted">
                {numberFmt.format(r.value)} <span className="text-xs">({pct}%)</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surfaceElevated">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-foregroundMuted">{t("Percentages are relative to registered users.")}</p>
    </div>
  );
}
