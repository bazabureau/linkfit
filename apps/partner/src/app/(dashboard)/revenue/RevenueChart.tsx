"use client";

import { useMemo, useState } from "react";
import { formatShortDate } from "@/lib/date-format";

export interface ChartRow {
  starts_at: string;
  total_minor: number;
  status: string;
}

interface DayBucket {
  key: string;
  label: string;
  paidMinor: number;
}

function fmtAxis(minor: number): string {
  const v = minor / 100;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return Math.round(v).toString();
}

function fmtMoney(minor: number, currency: string): string {
  return `${(minor / 100).toLocaleString("az-AZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

/**
 * On-brand lime bar chart of daily PAID revenue across the selected range.
 * Pure-SVG, no external chart deps — keeps the partner bundle lean.
 */
export function RevenueChart({
  rows,
  currency,
}: {
  rows: ChartRow[];
  currency: string;
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);

  const buckets = useMemo<DayBucket[]>(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== "paid") continue;
      const d = new Date(r.starts_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + r.total_minor);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, paidMinor]) => ({
        key,
        label: formatShortDate(key),
        paidMinor,
      }));
  }, [rows]);

  const max = useMemo(
    () => buckets.reduce((m, b) => Math.max(m, b.paidMinor), 0),
    [buckets],
  );
  const totalPaid = useMemo(
    () => buckets.reduce((s, b) => s + b.paidMinor, 0),
    [buckets],
  );

  if (buckets.length === 0 || max === 0) {
    return (
      <div className="flex h-44 flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium text-foreground">
          Qrafik üçün ödəniş yoxdur
        </p>
        <p className="text-xs text-foregroundMuted">
          Seçilmiş aralıqda ödənilmiş sifariş tapılmadı.
        </p>
      </div>
    );
  }

  // Gridlines at 0 / 50 / 100 % of max.
  const gridSteps = [1, 0.5, 0];
  const active = hover != null ? buckets[hover] : null;

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold text-foregroundMuted">
            Günlük Ödənilmiş Gəlir
          </p>
          <p className="mt-1 font-display text-lg font-bold text-foreground tabular-nums">
            {fmtMoney(totalPaid, currency)}
          </p>
        </div>
        {active ? (
          <div className="rounded-lg border border-border bg-surfaceElevated px-3 py-1.5 text-right">
            <p className="text-[11px] text-foregroundMuted tabular-nums">
              {active.label}
            </p>
            <p className="font-display text-sm font-bold text-accent tabular-nums">
              {fmtMoney(active.paidMinor, currency)}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-foregroundMuted">
            {buckets.length} gün
          </p>
        )}
      </div>

      <div className="relative flex gap-3">
        {/* Y axis labels */}
        <div className="flex w-9 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] font-medium text-foregroundMuted tabular-nums">
          {gridSteps.map((s) => (
            <span key={s}>{fmtAxis(max * s)}</span>
          ))}
        </div>

        {/* Plot area */}
        <div className="relative flex-1">
          {/* Gridlines */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {gridSteps.map((s) => (
              <div
                key={s}
                className="h-px w-full bg-border/60"
                style={{ opacity: s === 0 ? 1 : 0.5 }}
              />
            ))}
          </div>

          {/* Bars */}
          <div className="relative flex h-44 items-end gap-[3px]">
            {buckets.map((b, i) => {
              const h = max > 0 ? (b.paidMinor / max) * 100 : 0;
              const isActive = hover === i;
              const barLabel = `${b.label}: ${fmtMoney(b.paidMinor, currency)}`;
              return (
                <div
                  key={b.key}
                  role="img"
                  aria-label={barLabel}
                  title={barLabel}
                  className="group relative flex h-full flex-1 cursor-pointer items-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div
                    className="w-full rounded-t-[3px] transition-all duration-150"
                    style={{
                      height: `${Math.max(h, 1.5)}%`,
                      background: isActive
                        ? "linear-gradient(180deg, #C5F235 0%, #9bc41f 100%)"
                        : "linear-gradient(180deg, rgba(197,242,53,0.85) 0%, rgba(197,242,53,0.35) 100%)",
                      boxShadow: isActive
                        ? "0 0 0 1px rgba(197,242,53,0.5), 0 -2px 12px rgba(197,242,53,0.25)"
                        : "none",
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* X axis — show a sparse set of labels to avoid clutter */}
          <div className="mt-2 flex gap-[3px] text-[10px] text-foregroundMuted">
            {buckets.map((b, i) => {
              const every = Math.ceil(buckets.length / 7);
              const show = i % every === 0 || i === buckets.length - 1;
              return (
                <div key={b.key} className="flex-1 text-center tabular-nums">
                  {show ? b.label : ""}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
