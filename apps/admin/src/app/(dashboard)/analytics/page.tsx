"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarCheck2,
  CreditCard,
  Gamepad2,
  GraduationCap,
  LineChart,
  RefreshCw,
  Users,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import {
  useAnalyticsOverview,
  useRevenue,
  type RevenueParams,
} from "@/lib/admin-analytics";

const numberFmt = new Intl.NumberFormat("en-US");

function money(minor: number | null | undefined, currency = "AZN"): string {
  if (minor == null) return "—";
  const value = (minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${value} ${currency === "AZN" ? "₼" : currency}`;
}

export default function AnalyticsPage(): React.JSX.Element {
  const { t } = useI18n();
  const overview = useAnalyticsOverview();
  const [range, setRange] = React.useState<{ from: string; to: string }>({ from: "", to: "" });
  const revenueParams: RevenueParams = React.useMemo(
    () => ({ from: range.from || undefined, to: range.to || undefined }),
    [range],
  );
  const revenue = useRevenue(revenueParams);

  const o = overview.data;
  const cur = o?.currency ?? "AZN";

  const kpis = [
    { label: "Total users", value: o?.users.total, icon: Users, hint: `${numberFmt.format(o?.users.new_30d ?? 0)} ${t("new (30d)")}` },
    { label: "Active (30d)", value: o?.users.active_30d, icon: Activity, hint: `${numberFmt.format(o?.users.vip ?? 0)} ${t("VIP")}` },
    { label: "Games", value: o?.games.total, icon: Gamepad2, hint: `${numberFmt.format(o?.games.new_30d ?? 0)} ${t("new (30d)")}` },
    { label: "Bookings", value: o?.bookings.total, icon: CalendarCheck2, hint: `${numberFmt.format(o?.bookings.paid ?? 0)} ${t("paid")}` },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("Analytics")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <LineChart className="h-6 w-6 text-accent" />
            {t("Analytics")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Platform-wide growth, engagement and revenue.")}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            void overview.refetch();
            void revenue.refetch();
          }}
          disabled={overview.isFetching || revenue.isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${overview.isFetching || revenue.isFetching ? "animate-spin" : ""}`} />
          {t("Refresh")}
        </Button>
      </div>

      {overview.isError ? (
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void overview.refetch();
              void revenue.refetch();
            }}
            disabled={overview.isFetching}
            className="w-full sm:w-auto"
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold text-foregroundMuted">{t(k.label)}</span>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-[#3f6b00]">
                <k.icon className="h-4 w-4" />
              </span>
            </div>
            {overview.isLoading ? (
              <div className="mt-3 h-8 w-20 animate-pulse rounded-md bg-surfaceElevated" />
            ) : (
              <p className="mt-2 font-display text-[1.7rem] font-bold leading-none tabular-nums text-foreground">
                {numberFmt.format(k.value ?? 0)}
              </p>
            )}
            <p className="mt-1.5 truncate text-xs text-foregroundMuted">{k.hint}</p>
          </div>
        ))}
      </section>

      {/* Revenue summary cards */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RevenueCard label={t("Paid revenue")} value={money(o?.revenue.paid_booking_minor, cur)} icon={Wallet} loading={overview.isLoading} accent />
        <RevenueCard label={t("Gross bookings")} value={money(o?.revenue.gross_booking_minor, cur)} icon={CreditCard} loading={overview.isLoading} />
        <RevenueCard label={t("Gross (30d)")} value={money(o?.revenue.gross_booking_30d_minor, cur)} icon={CreditCard} loading={overview.isLoading} />
        <RevenueCard
          label={t("Venues active")}
          value={`${numberFmt.format(o?.venues.active ?? 0)} / ${numberFmt.format(o?.venues.total ?? 0)}`}
          icon={Building2}
          loading={overview.isLoading}
        />
      </section>

      {/* Learn snapshot */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RevenueCard label={t("Active coaches")} value={numberFmt.format(o?.learn.coaches ?? 0)} icon={GraduationCap} loading={overview.isLoading} />
        <RevenueCard label={t("Lessons")} value={numberFmt.format(o?.learn.lessons ?? 0)} icon={GraduationCap} loading={overview.isLoading} />
        <RevenueCard label={t("Lesson bookings")} value={numberFmt.format(o?.learn.lesson_bookings ?? 0)} icon={CalendarCheck2} loading={overview.isLoading} />
      </section>

      {/* Revenue breakdown */}
      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-[#3f6b00]">
              <Wallet className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-sm font-bold text-foreground">{t("Revenue by venue")}</h2>
              <p className="text-xs text-foregroundMuted">{t("Filter bookings by date range.")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="h-9 w-auto"
              aria-label={t("From")}
            />
            <span className="text-foregroundMuted">–</span>
            <Input
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="h-9 w-auto"
              aria-label={t("To")}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-4">
          <SummaryPill label={t("Paid")} value={money(revenue.data?.summary.paid_total_minor, cur)} tone="accent" />
          <SummaryPill label={t("Unpaid")} value={money(revenue.data?.summary.unpaid_total_minor, cur)} tone="warning" />
          <SummaryPill label={t("Cancelled")} value={money(revenue.data?.summary.cancelled_total_minor, cur)} tone="danger" />
          <SummaryPill label={t("Bookings")} value={numberFmt.format(revenue.data?.summary.bookings_count ?? 0)} tone="neutral" />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Venue")}</TableHead>
              <TableHead className="text-right">{t("Bookings")}</TableHead>
              <TableHead className="text-right">{t("Paid")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {revenue.isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell>
              </TableRow>
            ) : revenue.isError ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <p className="text-sm text-foregroundMuted">{t("Failed to load analytics")}</p>
                    <Button variant="secondary" size="sm" onClick={() => void revenue.refetch()} disabled={revenue.isFetching}>
                      {t("Retry")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (revenue.data?.by_venue.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-foregroundMuted">{t("No data")}</TableCell>
              </TableRow>
            ) : (
              revenue.data?.by_venue.map((v) => (
                <TableRow key={v.venue_name}>
                  <TableCell className="font-semibold text-foreground">{v.venue_name}</TableCell>
                  <TableCell className="text-right tabular-nums text-foregroundMuted">{numberFmt.format(v.bookings_count)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-foreground">{money(v.paid_total_minor, cur)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function RevenueCard({
  label,
  value,
  icon: Icon,
  loading,
  accent = false,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  loading: boolean;
  accent?: boolean;
}): React.JSX.Element {
  return (
    <div className={`overflow-hidden rounded-2xl border p-4 shadow-card ${accent ? "border-accent/40 bg-accent/5" : "border-border bg-surface"}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold text-foregroundMuted">{label}</span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surfaceElevated text-foreground">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-24 animate-pulse rounded-md bg-surfaceElevated" />
      ) : (
        <p className="mt-2 font-display text-[1.35rem] font-bold leading-none tabular-nums text-foreground">{value}</p>
      )}
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "accent" | "warning" | "danger" | "neutral";
}): React.JSX.Element {
  const toneCls: Record<typeof tone, string> = {
    accent: "border-accent/30 bg-accent/10 text-[#3f6b00]",
    warning: "border-warning/30 bg-warning/10 text-warning",
    danger: "border-danger/30 bg-danger/10 text-danger",
    neutral: "border-border bg-surfaceElevated text-foreground",
  };
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneCls[tone]}`}>
      <p className="text-[11px] font-semibold opacity-80">{label}</p>
      <p className="mt-1 font-display text-base font-bold tabular-nums">{value}</p>
    </div>
  );
}
