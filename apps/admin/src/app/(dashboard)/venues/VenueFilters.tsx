"use client";

import * as React from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { SelectBox, VENUE_STATUSES, type VenueStatus } from "./lib";

export type StatusFilter = "all" | VenueStatus;
export type PartnerFilter = "all" | "partner" | "non_partner";

export interface VenueFilterState {
  q: string;
  status: StatusFilter;
  partner: PartnerFilter;
}

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

const PARTNER_OPTIONS: Array<{ value: PartnerFilter; label: string }> = [
  { value: "all", label: "All venues" },
  { value: "partner", label: "Partners" },
  { value: "non_partner", label: "Non-partners" },
];

export function VenueFilters({
  value,
  onChange,
  onReset,
}: {
  value: VenueFilterState;
  onChange: (patch: Partial<VenueFilterState>) => void;
  onReset: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const hasFilters = value.q !== "" || value.status !== "all" || value.partner !== "all";

  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4">
      {/* Top row — search + partner select */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input
            value={value.q}
            onChange={(event) => onChange({ q: event.target.value })}
            placeholder={t("Search by name or address…")}
            className="h-10 border-transparent bg-surfaceElevated pl-9 pr-9"
          />
          {value.q ? (
            <button
              type="button"
              onClick={() => onChange({ q: "" })}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-foregroundMuted transition hover:bg-border/60 hover:text-foreground"
              aria-label={t("Reset")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <SelectBox
          value={value.partner}
          onChange={(v) => onChange({ partner: v as PartnerFilter })}
          aria-label={t("Partners")}
          className="lg:w-44"
        >
          {PARTNER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </SelectBox>
      </div>

      {/* Bottom row — status pills */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="mr-1 hidden items-center gap-1.5 text-xs font-semibold   text-foregroundMuted sm:inline-flex">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t("Status")}
        </span>
        <FilterChip active={value.status === "all"} onClick={() => onChange({ status: "all" })}>
          {t("All statuses")}
        </FilterChip>
        {VENUE_STATUSES.map((item) => (
          <FilterChip
            key={item.value}
            active={value.status === item.value}
            onClick={() => onChange({ status: item.value })}
          >
            {t(item.label)}
          </FilterChip>
        ))}
        {hasFilters ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onReset}>
            <X className="h-3.5 w-3.5" />
            {t("Reset")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
