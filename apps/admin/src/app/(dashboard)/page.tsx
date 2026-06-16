"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  MapPin,
  RefreshCw,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminStats } from "@/lib/admin-overview";
import { useI18n } from "@/lib/i18n";

const numberFmt = new Intl.NumberFormat("en-US");

type Kpi = {
  label: string;
  value: number | undefined;
  icon: typeof Users;
  hint?: string;
};

export default function AdminOverviewPage() {
  const { data, isLoading, isError, refetch, isFetching } = useAdminStats();
  const { t } = useI18n();

  const kpis: Kpi[] = [
    {
      label: "Total users",
      value: data?.users_total,
      icon: Users,
      hint: "All registered accounts",
    },
    {
      label: "New this week",
      value: data?.users_new_7d,
      icon: UserPlus,
      hint: "Sign-ups in the last 7 days",
    },
    {
      label: "Games this week",
      value: data?.games_this_week,
      icon: CalendarDays,
      hint: "Scheduled in the last 7 days",
    },
    {
      label: "Games completed",
      value: data?.games_completed_total,
      icon: CheckCircle2,
      hint: "All-time finished games",
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("Overview")}
          </h1>
          <p className="text-sm text-foregroundMuted">
            {t("High-level activity across LinkFit.")}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="w-full sm:w-auto"
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          />
          {t("Refresh")}
        </Button>
      </header>

      {isError ? (
        <Card className="border-danger/40 bg-danger/10">
          <CardContent className="flex items-center justify-between gap-4 py-5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-danger" />
              <div>
                <p className="font-medium text-foreground">
                  {t("Failed to load admin stats")}
                </p>
                <p className="text-sm text-foregroundMuted">
                  {t("Check your connection and try again.")}
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              {t("Retry")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiTile key={k.label} kpi={{ ...k, label: t(k.label), hint: k.hint ? t(k.hint) : undefined }} loading={isLoading} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-accent" />
              {t("Top venues")}
            </CardTitle>
            <CardDescription>
              {t("Venues hosting the most games right now.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton />
            ) : data && data.top_venues.length > 0 ? (
              <div className="space-y-4">
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.top_venues.slice(0, 6)}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.06)"
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "#9CA6B8", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                      />
                      <YAxis
                        tick={{ fill: "#9CA6B8", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(34,197,94,0.08)" }}
                        contentStyle={{
                          background: "#141A22",
                          border: "1px solid #262F3D",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "#E6EAF2",
                        }}
                      />
                      <Bar
                        dataKey="game_count"
                        fill="#22C55E"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Venue")}</TableHead>
                      <TableHead className="text-right">{t("Games")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.top_venues.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-foregroundMuted" />
                            <span className="text-foreground">{v.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-foreground">
                          {numberFmt.format(v.game_count)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-foregroundMuted">
                {t("No venue activity yet.")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {t("Pending reports")}
            </CardTitle>
            <CardDescription>
              {t("Moderation queue awaiting review.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              {isLoading ? (
                <div className="h-12 w-24 animate-pulse rounded-md bg-surfaceElevated" />
              ) : (
                <div className="text-5xl font-semibold text-warning">
                  {numberFmt.format(data?.pending_reports ?? 0)}
                </div>
              )}
              <p className="mt-1 text-xs text-foregroundMuted">
                {data?.pending_reports
                  ? t("Awaiting moderator action")
                  : t("All clear")}
              </p>
            </div>
            <Button asChild size="sm" className="gap-2">
              <Link href="/reports">
                {t("Review queue")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function KpiTile({ kpi, loading }: { kpi: Kpi; loading: boolean }) {
  const Icon = kpi.icon;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-foregroundMuted">
            {kpi.label}
          </span>
          <span className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Icon className="h-4 w-4" />
          </span>
        </div>
        {loading ? (
          <div className="h-9 w-24 animate-pulse rounded-md bg-surfaceElevated" />
        ) : (
          <div className="text-3xl font-semibold tabular-nums text-foreground">
            {numberFmt.format(kpi.value ?? 0)}
          </div>
        )}
        {kpi.hint ? (
          <p className="text-xs text-foregroundMuted">{kpi.hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-48 w-full animate-pulse rounded-md bg-surfaceElevated/60" />
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-8 w-full animate-pulse rounded-md bg-surfaceElevated/40"
          />
        ))}
      </div>
    </div>
  );
}
