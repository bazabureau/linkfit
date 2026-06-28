"use client";

import * as React from "react";
import { Search, SlidersHorizontal, Timer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import {
  REPORT_REASONS,
  REPORT_TARGET_KINDS,
  type ReportReason,
  type ReportStatus,
  type ReportTargetKind,
} from "@/lib/admin-reports";
import { REPORT_REASON_AZ, TARGET_LABEL_AZ } from "./lib";

export type StatusFilter = ReportStatus | "all";
export type ReasonFilter = ReportReason | "all";
export type TargetFilter = ReportTargetKind | "all";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "Gözləyir" },
  { value: "reviewed", label: "Baxılıb" },
  { value: "dismissed", label: "Rədd edilib" },
  { value: "all", label: "Hamısı" },
];

const REASON_OPTIONS: Array<{ value: ReasonFilter; label: string }> = [
  { value: "all", label: "Bütün səbəblər" },
  ...REPORT_REASONS.map((value) => ({
    value,
    label: REPORT_REASON_AZ[value] ?? value,
  })),
];

const TARGET_OPTIONS: Array<{ value: TargetFilter; label: string }> = [
  { value: "all", label: "Bütün hədəflər" },
  ...REPORT_TARGET_KINDS.map((value) => ({
    value,
    label: TARGET_LABEL_AZ[value] ?? value,
  })),
];

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center rounded-full border px-3.5 text-xs font-semibold transition ${
        active
          ? "border-ink bg-ink text-white shadow-sm"
          : "border-border bg-surface text-foregroundMuted hover:border-borderStrong hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-full border border-border bg-surface px-3 text-xs font-semibold text-foreground transition hover:border-borderStrong focus:outline-none focus:ring-2 focus:ring-accent/40"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {t(option.label)}
        </option>
      ))}
    </select>
  );
}

export function ReportFilters({
  status,
  reason,
  targetKind,
  q,
  overdueOnly,
  onStatusChange,
  onReasonChange,
  onTargetKindChange,
  onQueryChange,
  onOverdueChange,
  onReset,
}: {
  status: StatusFilter;
  reason: ReasonFilter;
  targetKind: TargetFilter;
  q: string;
  overdueOnly: boolean;
  onStatusChange: (status: StatusFilter) => void;
  onReasonChange: (reason: ReasonFilter) => void;
  onTargetKindChange: (targetKind: TargetFilter) => void;
  onQueryChange: (q: string) => void;
  onOverdueChange: (overdueOnly: boolean) => void;
  onReset: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const hasFilters =
    q !== "" ||
    status !== "pending" ||
    reason !== "all" ||
    targetKind !== "all" ||
    overdueOnly;

  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input
            value={q}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("Şikayətçi və ya qeyd üzrə axtar...")}
            className="h-10 border-transparent bg-surfaceElevated pl-9 pr-9"
          />
          {q ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-foregroundMuted transition hover:bg-border/60 hover:text-foreground"
              aria-label={t("Təmizlə")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="mr-1 hidden items-center gap-1.5 text-xs font-semibold   text-foregroundMuted sm:inline-flex">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t("Status")}
        </span>
        {STATUS_OPTIONS.map((item) => (
          <FilterChip
            key={item.value}
            active={status === item.value}
            onClick={() => onStatusChange(item.value)}
          >
            {t(item.label)}
          </FilterChip>
        ))}
        <span className="mx-0.5 hidden h-5 w-px bg-border sm:inline-block" />
        <FilterChip
          active={overdueOnly}
          onClick={() => onOverdueChange(!overdueOnly)}
        >
          <Timer className="mr-1 h-3.5 w-3.5" />
          {t("Gecikənlər (24s+)")}
        </FilterChip>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterSelect
            label={t("Səbəb")}
            value={reason}
            options={REASON_OPTIONS}
            onChange={(value) => onReasonChange(value as ReasonFilter)}
          />
          <FilterSelect
            label={t("Hədəf")}
            value={targetKind}
            options={TARGET_OPTIONS}
            onChange={(value) => onTargetKindChange(value as TargetFilter)}
          />
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={onReset}>
              <X className="h-3.5 w-3.5" />
              {t("Filterləri sıfırla")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
