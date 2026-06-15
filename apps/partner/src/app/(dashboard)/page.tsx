"use client";

import React, { useMemo } from "react";
import {
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Percent,
  RefreshCw,
  XCircle,
  AlertCircle,
  Building,
  TrendingUp,
  CreditCard,
  Activity,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const numberFmt = new Intl.NumberFormat("az-AZ");

type Kpi = {
  label: string;
  value: string | number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  colorClass?: string;
};

export default function PartnerOverviewPage(): React.JSX.Element {
  const { data: statsData, isLoading: statsLoading, isError: statsError, refetch: refetchStats, isFetching: statsFetching } = usePartnerStats();
  const { data: bookingsData, isLoading: bookingsLoading, refetch: refetchBookings } = usePartnerBookings({ limit: 100 });

  const bookings = useMemo(() => bookingsData?.results ?? [], [bookingsData]);
  const paidBookings = useMemo(() => bookings.filter((b) => b.status === "paid"), [bookings]);

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
      "Gəlir (AZN)": parseFloat(amount.toFixed(2)),
    }));
  }, [paidBookings]);

  const recentTransactions = useMemo(() => {
    return bookings.slice(0, 5);
  }, [bookings]);

  const overallRevenue = statsData ? (statsData.total_revenue_minor / 100).toFixed(2) : "0.00";
  const currencySymbol = statsData?.currency || "AZN";

  const kpis: Kpi[] = [
    {
      label: "Ümumi Gəlir",
      value: statsData ? `${overallRevenue} ${currencySymbol}` : undefined,
      icon: DollarSign,
      hint: "Uğurlu ödənişlərin cəmi",
      colorClass: "bg-emerald-500/10 text-emerald-500",
    },
    {
      label: "Doluluq Nisbəti",
      value: statsData ? `${statsData.occupancy_rate}%` : undefined,
      icon: Percent,
      hint: "Məkanın ümumi doluluq faizi",
      colorClass: "bg-blue-500/10 text-blue-500",
    },
    {
      label: "Cəmi Rezervasiyalar",
      value: statsData?.total_bookings,
      icon: CalendarDays,
      hint: "Məkan üzrə yaradılmış cəmi slot sayı",
      colorClass: "bg-accent/10 text-accent",
    },
    {
      label: "Ödənilmiş Sifarişlər",
      value: statsData?.paid_bookings,
      icon: CheckCircle2,
      hint: "Tam ödənişi tamamlanmış slotlar",
      colorClass: "bg-emerald-500/10 text-emerald-500",
    },
    {
      label: "Ödəniş Gözləyənlər",
      value: statsData?.pending_bookings,
      icon: AlertCircle,
      hint: "Təsdiq və ya ödəniş gözləyən slotlar",
      colorClass: "bg-amber-500/10 text-amber-500",
    },
    {
      label: "Ləğv Edilmiş Sifarişlər",
      value: statsData?.cancelled_bookings,
      icon: XCircle,
      hint: "İmtina və ya ləğv edilmiş slotlar",
      colorClass: "bg-rose-500/10 text-rose-500",
    },
  ];

  const handleRefresh = (): void => {
    refetchStats();
    refetchBookings();
  };

  const isAnyLoading = statsLoading || bookingsLoading;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Məkan İdarəetmə Paneli
          </h1>
          <p className="text-sm text-foregroundMuted">
            Məkanınızın ümumi fəaliyyəti, saatlıq doluluq dərəcəsi və gəlir statistikası.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRefresh}
          disabled={statsFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${statsFetching ? "animate-spin" : ""}`}
          />
          Yenilə
        </Button>
      </header>

      {statsError ? (
        <Card className="border-danger/40 bg-danger/10">
          <CardContent className="flex items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-danger" />
              <div>
                <p className="font-medium text-foreground">
                  Göstəriciləri yükləmək mümkün olmadı
                </p>
                <p className="text-sm text-foregroundMuted">
                  Şəbəkə bağlantınızı yoxlayın və yenidən cəhd edin.
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={handleRefresh}>
              Yenidən Cəhd Et
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* KPI Section */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="flex flex-col gap-3 p-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-foregroundMuted">
                  {k.label}
                </span>
                <span className={`rounded-md p-1.5 ${k.colorClass || "bg-accent/10 text-accent"}`}>
                  <k.icon className="h-4 w-4" />
                </span>
              </div>
              {isAnyLoading ? (
                <div className="h-9 w-24 animate-pulse rounded-md bg-surfaceElevated" />
              ) : (
                <div className="text-3xl font-semibold tabular-nums text-foreground">
                  {typeof k.value === "number" ? numberFmt.format(k.value) : k.value ?? "0"}
                </div>
              )}
              {k.hint ? (
                <p className="text-xs text-foregroundMuted">{k.hint}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Advanced Revenue Statistics Breakdown */}
      <section className="grid gap-6 md:grid-cols-3">
        {/* Dynamic Periodical Revenue Card */}
        <Card className="border border-border bg-surface md:col-span-1">
          <CardHeader className="p-6 pb-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              Dövrlər Üzrə Gəlir
            </CardTitle>
            <CardDescription>
              Fərqli zaman intervalları üzrə xalis gəlir.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-4">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-surfaceElevated/50 border border-border">
              <div className="space-y-0.5">
                <span className="text-xs text-foregroundMuted font-medium">Bugünkü Gəlir</span>
                <p className="text-xs text-foregroundMuted italic">Son 24 saat ərzində</p>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold text-emerald-400 tabular-nums">
                  {revenueStats.daily} {currencySymbol}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-surfaceElevated/50 border border-border">
              <div className="space-y-0.5">
                <span className="text-xs text-foregroundMuted font-medium">Həftəlik Gəlir</span>
                <p className="text-xs text-foregroundMuted italic">Son 7 gün ərzində</p>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold text-emerald-400 tabular-nums">
                  {revenueStats.weekly} {currencySymbol}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-surfaceElevated/50 border border-border">
              <div className="space-y-0.5">
                <span className="text-xs text-foregroundMuted font-medium">Aylıq Gəlir</span>
                <p className="text-xs text-foregroundMuted italic">Son 30 gün ərzində</p>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold text-emerald-400 tabular-nums">
                  {revenueStats.monthly} {currencySymbol}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dynamic Recharts Chart */}
        <Card className="border border-border bg-surface md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-accent" />
              Son 7 Günün Gəlir Qrafiki
            </CardTitle>
            <CardDescription>
              Uğurlu ödənişlər əsasında formalaşan gündəlik gəlir axını.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[230px] w-full pr-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" stroke="rgba(255,255,255,0.4)" fontSize={10} tickLine={false} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={10} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155", color: "#f8fafc" }}
                  labelStyle={{ fontWeight: "bold" }}
                />
                <Area type="monotone" dataKey="Gəlir (AZN)" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      {/* Transaction History & Recent Bookings Table */}
      <Card className="border border-border bg-surface overflow-hidden">
        <CardHeader className="border-b border-border bg-surfaceElevated/10">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-accent" />
            Son Əməliyyatlar və Sifariş Tarixçəsi
          </CardTitle>
          <CardDescription>
            Məkanınız üzrə edilən son 5 rezervasiya və onların ödəniş statusları.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {recentTransactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/10">
                <Activity className="h-5 w-5 text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Sifariş Tapılmadı</h3>
                <p className="text-xs text-foregroundMuted">
                  Məkanınızda hələ heç bir rezervasiya qeydə alınmayıb.
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Müştəri</TableHead>
                  <TableHead>Kort</TableHead>
                  <TableHead>Sifariş Vaxtı</TableHead>
                  <TableHead>Müddət</TableHead>
                  <TableHead>Məbləğ</TableHead>
                  <TableHead className="pr-6 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTransactions.map((booking) => {
                  const localStart = formatDateTime(booking.starts_at);
                  const price = (booking.total_minor / 100).toFixed(2);

                  let badgeVariant: "success" | "warning" | "danger" | "neutral" = "neutral";
                  let statusLabel: string = booking.status;
                  if (booking.status === "paid") {
                    badgeVariant = "success";
                    statusLabel = "Ödənilib";
                  } else if (booking.status === "pending_payment") {
                    badgeVariant = "warning";
                    statusLabel = "Ödəniş Gözləyir";
                  } else if (booking.status === "partially_paid") {
                    badgeVariant = "warning";
                    statusLabel = "Qismən Ödənilib";
                  } else if (booking.status === "cancelled") {
                    badgeVariant = "danger";
                    statusLabel = "Ləğv edilib";
                  } else if (booking.status === "refunded") {
                    badgeVariant = "neutral";
                    statusLabel = "Geri qaytarılıb";
                  } else if (booking.status === "failed") {
                    badgeVariant = "danger";
                    statusLabel = "Uğursuz";
                  }

                  return (
                    <TableRow key={booking.id} className="hover:bg-surfaceElevated/5">
                      <TableCell className="pl-6">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground text-sm">
                            {booking.booker_display_name}
                          </span>
                          <span className="text-[11px] text-foregroundMuted">
                            {booking.booker_email}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold text-accent text-sm">
                          {booking.court_name}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium text-foreground text-sm">
                        {localStart}
                      </TableCell>
                      <TableCell className="text-foregroundMuted text-sm">
                        {booking.duration_minutes} dəqiqə
                      </TableCell>
                      <TableCell className="font-bold text-foreground text-sm">
                        {price} {booking.currency}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Badge variant={badgeVariant} className="text-xs">
                          {statusLabel}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Localized Welcome Card */}
      <Card className="border border-border bg-surface p-6 flex flex-col md:flex-row items-center gap-6">
        <div className="p-4 rounded-2xl bg-accent/10 text-accent">
          <Building className="h-10 w-10" />
        </div>
        <div className="space-y-1 text-center md:text-left flex-1">
          <h3 className="text-lg font-bold text-foreground">Linkfit Tərəfdaş Portalına Xoş Gəlmisiniz!</h3>
          <p className="text-sm text-foregroundMuted">
            Buradan kortlarınızın doluluq qrafiklərini izləyə bilər, yeni saatlıq meydança tariflərini təyin edə bilər və walk-in yerində sifarişləri birbaşa təqvimlə inteqrasiya edərək idarə edə bilərsiniz. Yardıma ehtiyacınız olarsa, sol menyudan Ayarlar və Dəstək bölməsinə keçin.
          </p>
        </div>
      </Card>
    </div>
  );
}
