"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Wallet,
  Percent,
  RefreshCw,
  XCircle,
  AlertCircle,
  ArrowUpRight,
  TrendingUp,
  Activity,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePartnerStats, usePartnerBookings } from "@/lib/partner-queries";
import { formatDateTime, formatShortDate } from "@/lib/date-format";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  getBookerName,
  getBookerEmail,
  initialsOf,
  StatusPill,
} from "./bookings/booking-utils";

const numberFmt = new Intl.NumberFormat("az-AZ");
const ACCENT = "#C5F235";

type Kpi = {
  label: string;
  value: string | number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  tone: string;
  /** Render the value with the display font (big number look). */
  big?: boolean;
};

export default function PartnerOverviewPage(): React.JSX.Element {
  const {
    data: statsData,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
    isFetching: statsFetching,
  } = usePartnerStats();
  const {
    data: bookingsData,
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = usePartnerBookings({ limit: 100 });

  const bookings = useMemo(() => bookingsData?.results ?? [], [bookingsData]);
  const paidBookings = useMemo(
    () => bookings.filter((b) => b.status === "paid"),
    [bookings],
  );

  // Aggregate daily, weekly, monthly revenue dynamically
  const revenueStats = useMemo(() => {
    const todayStr = new Date().toDateString();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyMinor = paidBookings
      .filter((b) => new Date(b.starts_at).toDateString() === todayStr)
      .reduce((sum, b) => sum + b.total_minor, 0);

    const weeklyMinor = paidBookings
      .filter((b) => new Date(b.starts_at) >= sevenDaysAgo)
      .reduce((sum, b) => sum + b.total_minor, 0);

    const monthlyMinor = paidBookings
      .filter((b) => new Date(b.starts_at) >= thirtyDaysAgo)
      .reduce((sum, b) => sum + b.total_minor, 0);

    return {
      daily: (dailyMinor / 100).toFixed(2),
      weekly: (weeklyMinor / 100).toFixed(2),
      monthly: (monthlyMinor / 100).toFixed(2),
    };
  }, [paidBookings]);

  // Dynamic Chart Data for the last 7 days of revenue
  const chartData = useMemo(() => {
    const dataMap: Record<string, number> = {};

    // Initialize past 7 days with zero values
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = formatShortDate(d);
      dataMap[dateStr] = 0;
    }

    paidBookings.forEach((b) => {
      const bDate = new Date(b.starts_at);
      const dateStr = formatShortDate(bDate);
      const currentVal = dataMap[dateStr];
      if (currentVal !== undefined) {
        dataMap[dateStr] = currentVal + b.total_minor / 100;
      }
    });

    return Object.entries(dataMap).map(([day, amount]) => ({
      day,
      revenue: parseFloat(amount.toFixed(2)),
    }));
  }, [paidBookings]);

  const peakRevenue = useMemo(
    () => Math.max(0, ...chartData.map((d) => d.revenue)),
    [chartData],
  );

  const recentTransactions = useMemo(() => bookings.slice(0, 6), [bookings]);

  const overallRevenue = statsData
    ? ((statsData.total_revenue_minor ?? 0) / 100).toFixed(2)
    : "0.00";
  const currencySymbol = statsData?.currency || "AZN";

  const kpis: Kpi[] = [
    {
      label: "Ümumi Gəlir",
      value: statsData ? `${overallRevenue} ${currencySymbol}` : undefined,
      icon: Wallet,
      hint: "Uğurlu ödənişlərin cəmi",
      tone: "bg-accent/12 text-accent",
      big: true,
    },
    {
      label: "Doluluq Nisbəti",
      value: statsData ? `${statsData.occupancy_rate ?? 0}%` : undefined,
      icon: Percent,
      hint: "Məkanın ümumi doluluq faizi",
      tone: "bg-info/12 text-info",
      big: true,
    },
    {
      label: "Cəmi Rezervasiyalar",
      value: statsData?.total_bookings,
      icon: CalendarDays,
      hint: "Yaradılmış cəmi slot sayı",
      tone: "bg-accent/12 text-accent",
      big: true,
    },
    {
      label: "Ödənilmiş Sifarişlər",
      value: statsData?.paid_bookings,
      icon: CheckCircle2,
      hint: "Tam ödənişi tamamlanmış slotlar",
      tone: "bg-accent/12 text-accent",
    },
    {
      label: "Ödəniş Gözləyənlər",
      value: statsData?.pending_bookings,
      icon: AlertCircle,
      hint: "Təsdiq və ya ödəniş gözləyən slotlar",
      tone: "bg-warning/12 text-warning",
    },
    {
      label: "Ləğv Edilmiş Sifarişlər",
      value: statsData?.cancelled_bookings,
      icon: XCircle,
      hint: "İmtina və ya ləğv edilmiş slotlar",
      tone: "bg-danger/12 text-danger",
    },
  ];

  const handleRefresh = (): void => {
    refetchStats();
    refetchBookings();
  };

  const isAnyLoading = statsLoading || bookingsLoading;

  const periods = [
    {
      label: "Bugünkü Gəlir",
      hint: "Son 24 saat ərzində",
      value: revenueStats.daily,
    },
    {
      label: "Həftəlik Gəlir",
      hint: "Son 7 gün ərzində",
      value: revenueStats.weekly,
    },
    {
      label: "Aylıq Gəlir",
      hint: "Son 30 gün ərzində",
      value: revenueStats.monthly,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-[1.6rem] font-bold leading-tight  text-foreground">
            İdarəetmə Paneli
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-foregroundMuted">
            Məkanınızın ümumi fəaliyyəti, doluluq dərəcəsi və gəlir
            statistikasına ümumi baxış.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRefresh}
          disabled={statsFetching}
          className="gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw
            className={`h-4 w-4 ${statsFetching ? "animate-spin" : ""}`}
          />
          Yenilə
        </Button>
      </header>

      {/* ─── Error banner ────────────────────────────────────────────────── */}
      {statsError ? (
        <div className="flex flex-col items-start gap-4 rounded-2xl border border-danger/30 bg-danger/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger/15 text-danger">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-foreground">
                Göstəriciləri yükləmək mümkün olmadı
              </p>
              <p className="text-sm text-foregroundMuted">
                Şəbəkə bağlantınızı yoxlayın və yenidən cəhd edin.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={statsFetching}
            className="shrink-0 gap-1.5 self-start sm:self-auto"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${statsFetching ? "animate-spin" : ""}`}
            />
            Yenidən Cəhd Et
          </Button>
        </div>
      ) : null}

      {/* ─── KPI Stat Grid ───────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => (
          <Card
            key={k.label}
            className="group relative overflow-hidden transition-premium hover:border-borderStrong hover:shadow-lift"
          >
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-foregroundMuted">
                  {k.label}
                </span>
                <span
                  className={`grid h-9 w-9 place-items-center rounded-xl ${k.tone}`}
                >
                  <k.icon className="h-[1.1rem] w-[1.1rem]" />
                </span>
              </div>
              {isAnyLoading ? (
                <div className="h-9 w-28 animate-pulse rounded-lg bg-surfaceElevated" />
              ) : (
                <div
                  className={`text-foreground tabular-nums ${
                    k.big
                      ? "font-display text-3xl font-bold "
                      : "font-display text-3xl font-bold "
                  }`}
                >
                  {typeof k.value === "number"
                    ? numberFmt.format(k.value)
                    : k.value ?? "0"}
                </div>
              )}
              {k.hint ? (
                <p className="text-xs text-foregroundMuted">{k.hint}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* ─── Revenue: periods + chart ────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Periodical Revenue */}
        <Card className="p-0 lg:col-span-1">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/12 text-accent">
                <TrendingUp className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Dövrlər Üzrə Gəlir
                </h2>
              </div>
            </div>
          </div>
          <div className="space-y-2.5 p-5">
            {periods.map((p) => (
              <div
                key={p.label}
                className="flex items-center justify-between rounded-xl border border-border bg-surfaceElevated/40 px-4 py-3"
              >
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {p.label}
                  </p>
                  <p className="text-[11px] text-foregroundMuted">{p.hint}</p>
                </div>
                {isAnyLoading ? (
                  <div className="h-6 w-20 animate-pulse rounded bg-surfaceElevated" />
                ) : (
                  <span className="font-display text-base font-bold tabular-nums text-accent">
                    {p.value}{" "}
                    <span className="text-xs font-semibold text-foregroundMuted">
                      {currencySymbol}
                    </span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Revenue Chart */}
        <Card className="p-0 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/12 text-accent">
                <BarChart3 className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Son 7 Günün Gəlir Qrafiki
                </h2>
                <p className="text-[11px] text-foregroundMuted">
                  Uğurlu ödənişlər əsasında gündəlik gəlir axını
                </p>
              </div>
            </div>
            {peakRevenue > 0 ? (
              <div className="hidden text-right sm:block">
                <p className="text-[10px] font-bold text-foregroundMuted">
                  Pik
                </p>
                <p className="font-display text-sm font-bold tabular-nums text-foreground">
                  {peakRevenue.toFixed(0)} {currencySymbol}
                </p>
              </div>
            ) : null}
          </div>
          <div className="h-[240px] w-full px-2 py-4 pr-4">
            {isAnyLoading ? (
              <div className="flex h-full items-end gap-2 px-4 pb-6">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 animate-pulse rounded-t-md bg-surfaceElevated"
                    style={{ height: `${30 + ((i * 37) % 60)}%` }}
                  />
                ))}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 8, left: -18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
                      <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="rgba(255,255,255,0.05)"
                  />
                  <XAxis
                    dataKey="day"
                    stroke="rgba(156,166,184,0.5)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="rgba(156,166,184,0.5)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(197,242,53,0.25)", strokeWidth: 1 }}
                    contentStyle={{
                      backgroundColor: "#1E2530",
                      borderColor: "#33404F",
                      borderRadius: 12,
                      color: "#E6EAF2",
                      fontSize: 12,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    }}
                    labelStyle={{ fontWeight: 700, color: "#9CA6B8" }}
                    formatter={(value: number) => [
                      `${value.toFixed(2)} ${currencySymbol}`,
                      "Gəlir",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={ACCENT}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#revFill)"
                    dot={{ r: 0 }}
                    activeDot={{
                      r: 4,
                      fill: ACCENT,
                      stroke: "#0A0D12",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </section>

      {/* ─── Recent Bookings ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/12 text-accent">
              <Activity className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Son Rezervasiyalar
              </h2>
              <p className="text-[11px] text-foregroundMuted">
                Məkanınız üzrə ən son 6 sifariş və ödəniş statusu
              </p>
            </div>
          </div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="gap-1 text-xs font-semibold text-accent hover:bg-accent/10"
          >
            <Link href="/bookings">
              Hamısı
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        {isAnyLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                <div className="h-9 w-9 animate-pulse rounded-lg bg-surfaceElevated" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-32 animate-pulse rounded bg-surfaceElevated" />
                  <div className="h-2.5 w-44 animate-pulse rounded bg-surfaceElevated/70" />
                </div>
                <div className="h-6 w-20 animate-pulse rounded-full bg-surfaceElevated" />
              </div>
            ))}
          </div>
        ) : recentTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/10">
              <Activity className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Sifariş Tapılmadı
              </h3>
              <p className="text-xs text-foregroundMuted">
                Məkanınızda hələ heç bir rezervasiya qeydə alınmayıb.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  {["Müştəri", "Kort", "Sifariş Vaxtı", "Müddət"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-bold text-foregroundMuted first:pl-5"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-[10px] font-bold text-foregroundMuted">
                    Məbləğ
                  </th>
                  <th className="px-4 py-3 pr-5 text-right text-[10px] font-bold text-foregroundMuted">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((booking) => {
                  const name = getBookerName(booking);
                  return (
                    <tr
                      key={booking.id}
                      className="border-b border-border transition-colors last:border-b-0 hover:bg-surfaceElevated/40"
                    >
                      <td className="py-3 pl-5 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 font-display text-[11px] font-bold text-accent">
                            {initialsOf(name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {name}
                            </p>
                            <p className="truncate text-[11px] text-foregroundMuted">
                              {getBookerEmail(booking) || "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-semibold text-accent">
                          {booking.court_name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium tabular-nums text-foreground">
                        {formatDateTime(booking.starts_at)}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-foregroundMuted">
                        {booking.duration_minutes} dəq
                      </td>
                      <td className="px-4 py-3 text-right font-display text-sm font-bold tabular-nums text-foreground">
                        {(booking.total_minor / 100).toFixed(2)}{" "}
                        <span className="text-xs font-semibold text-foregroundMuted">
                          {booking.currency}
                        </span>
                      </td>
                      <td className="px-4 py-3 pr-5 text-right">
                        <StatusPill status={booking.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
