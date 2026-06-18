"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Download,
  AlertCircle,
  RefreshCw,
  Wallet,
  CalendarRange,
  CreditCard,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, API_BASE_URL } from "@/lib/api";
import { ACCESS_TOKEN_COOKIE, getCookie } from "@/lib/cookies";
import { formatDate, formatTime } from "@/lib/date-format";
import { RevenueChart } from "./RevenueChart";

interface RevenueRow {
  id: string;
  starts_at: string;
  duration_minutes: number;
  total_minor: number;
  currency: string;
  status: string;
  payment_method: string | null;
  court_name: string;
}

interface RevenueResponse {
  items: RevenueRow[];
  paid_total_minor: number;
  unpaid_total_minor: number;
}

const STATUS_LABEL: Record<string, string> = {
  paid: "Ödənilib",
  pending_payment: "Ödəniş Gözləyir",
  partially_paid: "Qismən Ödənilib",
  cancelled: "Ləğv edilib",
  refunded: "Geri qaytarılıb",
  failed: "Uğursuz",
};

const METHOD_LABEL: Record<string, string> = {
  manual: "Nağd / Manual",
  card: "Kart",
  cash: "Nağd",
  online: "Onlayn",
};

function statusBadge(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "pending_payment" || status === "partially_paid")
    return "warning";
  if (status === "cancelled" || status === "failed") return "danger";
  return "neutral";
}

function money(minor: number, currency = "AZN"): string {
  return `${(minor / 100).toLocaleString("az-AZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

// ── KPI strip card ───────────────────────────────────────────────────────────
function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: "emerald" | "amber" | "accent" | "info";
}): React.JSX.Element {
  const toneMap = {
    emerald: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
    amber: "bg-warning/10 text-warning ring-warning/20",
    accent: "bg-accent/10 text-accent ring-accent/20",
    info: "bg-info/10 text-info ring-info/20",
  } as const;
  return (
    <Card className="relative overflow-hidden p-5 shadow-card">
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-accent/[0.05] to-transparent blur-2xl" />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold text-foregroundMuted">
          {label}
        </p>
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ${toneMap[tone]}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-3 font-display text-[1.7rem] font-bold leading-none  text-foreground tabular-nums">
        {value}
      </p>
    </Card>
  );
}

function RowSkeleton(): React.JSX.Element {
  const widths = ["w-28", "w-20", "w-14", "w-16", "w-20", "w-20"];
  return (
    <TableRow className="hover:bg-transparent">
      {widths.map((w, i) => (
        <TableCell
          key={i}
          className={i === widths.length - 1 ? "pr-5 text-right" : i === 0 ? "pl-5" : ""}
        >
          <div
            className={`h-4 ${w} animate-pulse rounded bg-surfaceElevated ${
              i === widths.length - 1 ? "ml-auto" : ""
            }`}
          />
        </TableCell>
      ))}
    </TableRow>
  );
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const QUICK_RANGES: { label: string; days: number }[] = [
  { label: "7 gün", days: 6 },
  { label: "30 gün", days: 29 },
  { label: "90 gün", days: 89 },
];

export default function RevenuePage(): React.JSX.Element {
  const toast = useToast();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(todayStr());
  const [downloading, setDownloading] = useState(false);

  const params = useMemo(() => {
    const usp = new URLSearchParams();
    if (from) usp.set("from", new Date(from + "T00:00:00").toISOString());
    if (to) usp.set("to", new Date(to + "T23:59:59").toISOString());
    const s = usp.toString();
    return s ? `?${s}` : "";
  }, [from, to]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["partner", "revenue", from, to],
    queryFn: () => api.get<RevenueResponse>(`/api/v1/partner/revenue${params}`),
    staleTime: 30_000,
  });

  const rows = useMemo(() => data?.items ?? [], [data]);
  const currency = rows[0]?.currency ?? "AZN";

  const stats = useMemo(() => {
    const paid = data?.paid_total_minor ?? 0;
    const unpaid = data?.unpaid_total_minor ?? 0;
    const paidCount = rows.filter((r) => r.status === "paid").length;
    return { paid, unpaid, paidCount, total: rows.length };
  }, [data, rows]);

  // Group paid revenue by payment method for a quick breakdown.
  const byMethod = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== "paid") continue;
      const key = r.payment_method ?? "manual";
      map.set(key, (map.get(key) ?? 0) + r.total_minor);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const methodTotal = useMemo(
    () => byMethod.reduce((s, [, v]) => s + v, 0),
    [byMethod],
  );

  const applyRange = (days: number): void => {
    const start = new Date();
    start.setDate(start.getDate() - days);
    setFrom(start.toISOString().slice(0, 10));
    setTo(todayStr());
  };

  const handleExportCsv = async (): Promise<void> => {
    setDownloading(true);
    try {
      const usp = new URLSearchParams();
      if (from) usp.set("from", new Date(from + "T00:00:00").toISOString());
      if (to) usp.set("to", new Date(to + "T23:59:59").toISOString());
      usp.set("format", "csv");
      const token = getCookie(ACCESS_TOKEN_COOKIE);
      const res = await fetch(
        `${API_BASE_URL}/api/v1/partner/revenue?${usp.toString()}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      if (!res.ok) throw new Error("İxrac alınmadı");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `linkfit-revenue-${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("İxrac hazırdır", "Gəlir hesabatı CSV faylı yükləndi.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("İxrac xətası", message || "Faylı yükləmək mümkün olmadı.");
    } finally {
      setDownloading(false);
    }
  };

  const showEmpty = !isLoading && !isError && rows.length === 0;

  return (
    <div className="space-y-7">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
              <Wallet className="h-[18px] w-[18px]" />
            </span>
            <h1 className="font-display text-[1.6rem] font-bold text-foreground">
              Gəlir Hesabatı
            </h1>
          </div>
          <p className="max-w-xl text-sm text-foregroundMuted">
            Seçilmiş tarix aralığında məkanınızın ödənilmiş və gözləyən
            gəlirlərini izləyin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            Yenilə
          </Button>
          <Button
            size="sm"
            onClick={handleExportCsv}
            disabled={downloading || rows.length === 0}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "Yüklənir..." : "CSV İxrac"}
          </Button>
        </div>
      </header>

      {/* ── Date-range toolbar ── */}
      <Card className="flex flex-col gap-4 p-4 shadow-card sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="rev-from"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-foregroundMuted"
            >
              <CalendarRange className="h-3.5 w-3.5" /> Başlanğıc
            </label>
            <Input
              id="rev-from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[11.5rem]"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="rev-to"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-foregroundMuted"
            >
              <CalendarRange className="h-3.5 w-3.5" /> Son
            </label>
            <Input
              id="rev-to"
              type="date"
              value={to}
              min={from}
              max={todayStr()}
              onChange={(e) => setTo(e.target.value)}
              className="w-[11.5rem]"
            />
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surfaceElevated p-1">
          {QUICK_RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => applyRange(r.days)}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-foregroundMuted transition-colors hover:bg-background hover:text-foreground"
            >
              {r.label}
            </button>
          ))}
        </div>
      </Card>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Ödənilmiş Gəlir"
          value={money(stats.paid, currency)}
          icon={TrendingUp}
          tone="emerald"
        />
        <Kpi
          label="Gözləyən Gəlir"
          value={money(stats.unpaid, currency)}
          icon={TrendingDown}
          tone="amber"
        />
        <Kpi
          label="Ödənilən Sifariş"
          value={stats.paidCount}
          icon={ReceiptText}
          tone="accent"
        />
        <Kpi
          label="Cəmi Sifariş"
          value={stats.total}
          icon={CalendarRange}
          tone="info"
        />
      </div>

      {/* ── Chart + payment-method breakdown ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 shadow-card lg:col-span-2">
          {isLoading ? (
            <div className="h-56 animate-pulse rounded-lg bg-surfaceElevated/60" />
          ) : (
            <RevenueChart rows={rows} currency={currency} />
          )}
        </Card>

        <Card className="p-5 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">
              Ödəniş Üsulları
            </h3>
          </div>
          {byMethod.length === 0 ? (
            <p className="py-8 text-center text-sm text-foregroundMuted">
              Ödənilmiş sifariş yoxdur.
            </p>
          ) : (
            <div className="space-y-3.5">
              {byMethod.map(([method, minor]) => {
                const pct =
                  methodTotal > 0 ? (minor / methodTotal) * 100 : 0;
                return (
                  <div key={method} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-foreground">
                        {METHOD_LABEL[method] ?? method}
                      </span>
                      <span className="font-display text-xs font-bold tabular-nums text-foreground">
                        {money(minor, currency)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surfaceElevated">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent"
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-[11px] font-medium tabular-nums text-foregroundMuted">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Revenue table ── */}
      <Card className="overflow-hidden p-0 shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Əməliyyatlar
            </h2>
            {!isLoading && !isError && rows.length > 0 ? (
              <Badge variant="neutral" className="tabular-nums">
                {rows.length}
              </Badge>
            ) : null}
          </div>
        </div>

        {isError ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10 ring-1 ring-danger/15">
              <AlertCircle className="h-7 w-7 text-danger" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-base font-bold text-foreground">
                Məlumat yüklənmədi
              </h3>
              <p className="text-sm text-foregroundMuted">
                Gəlir hesabatını yükləmək mümkün olmadı. Yenidən cəhd edin.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Yenidən cəhd et
            </Button>
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/15">
              <ReceiptText className="h-7 w-7 text-accent" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-base font-bold text-foreground">
                Bu aralıqda gəlir yoxdur
              </h3>
              <p className="text-sm text-foregroundMuted">
                Seçilmiş tarix aralığında heç bir sifariş tapılmadı.
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Tarix / Vaxt</TableHead>
                <TableHead>Kort</TableHead>
                <TableHead>Müddət</TableHead>
                <TableHead>Ödəniş üsulu</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">Məbləğ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-5">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground tabular-nums">
                          {formatDate(r.starts_at)}
                        </span>
                        <span className="text-xs text-foregroundMuted tabular-nums">
                          {formatTime(r.starts_at)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-accent">
                      {r.court_name}
                    </TableCell>
                    <TableCell className="text-foregroundMuted tabular-nums">
                      {r.duration_minutes} dəq
                    </TableCell>
                    <TableCell>
                      {r.payment_method ? (
                        <span className="text-xs font-medium text-foregroundMuted">
                          {METHOD_LABEL[r.payment_method] ?? r.payment_method}
                        </span>
                      ) : (
                        <span className="text-foregroundMuted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadge(r.status)}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <span className="font-display text-sm font-bold text-foreground tabular-nums">
                        {(r.total_minor / 100).toLocaleString("az-AZ", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      <span className="ml-1 text-xs text-foregroundMuted">
                        {r.currency}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
