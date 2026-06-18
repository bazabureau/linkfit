"use client";

import * as React from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import type { ReportStatus } from "@/lib/admin-reports";

export type StatusFilter = ReportStatus | "all";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "Gözləyir" },
  { value: "reviewed", label: "Baxılıb" },
  { value: "dismissed", label: "Rədd edilib" },
  { value: "all", label: "Hamısı" },
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

export function ReportFilters({
  status,
  q,
  onStatusChange,
  onQueryChange,
  onReset,
}: {
  status: StatusFilter;
  q: string;
  onStatusChange: (status: StatusFilter) => void;
  onQueryChange: (q: string) => void;
  onReset: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const hasFilters = q !== "" || status !== "pending";

  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input
            value={q}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("Səbəb, hədəf və ya ID üzrə axtar...")}
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
        {hasFilters ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onReset}>
            <X className="h-3.5 w-3.5" />
            {t("Filterləri sıfırla")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
