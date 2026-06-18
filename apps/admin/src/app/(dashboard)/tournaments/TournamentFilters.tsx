"use client";

import * as React from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import type { Sport, TournamentStatus } from "@/lib/admin-tournaments";
import { SelectBox, TOURNAMENT_STATUS_FILTERS } from "./lib";

export interface FilterState {
  q: string;
  status: TournamentStatus | "all";
  sport: string; // sport slug or "all"
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

export function TournamentFilters({
  value,
  onChange,
  onReset,
  sports,
}: {
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
  sports: Sport[];
}): React.JSX.Element {
  const { t } = useI18n();
  const hasFilters = value.q !== "" || value.status !== "all" || value.sport !== "all";

  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4">
      {/* Top row — search + sport */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input
            value={value.q}
            onChange={(event) => onChange({ q: event.target.value })}
            placeholder={t("Ad və ya təsvir üzrə axtar...")}
            className="h-10 border-transparent bg-surfaceElevated pl-9 pr-9"
          />
          {value.q ? (
            <button
              type="button"
              onClick={() => onChange({ q: "" })}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-foregroundMuted transition hover:bg-border/60 hover:text-foreground"
              aria-label={t("Təmizlə")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <SelectBox
          value={value.sport}
          onChange={(v) => onChange({ sport: v })}
          className="lg:w-52"
        >
          <option value="all">{t("Bütün idman növləri")}</option>
          {sports.map((sport) => (
            <option key={sport.id} value={sport.slug}>
              {sport.name}
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
          {t("Hamısı")}
        </FilterChip>
        {TOURNAMENT_STATUS_FILTERS.map((item) => (
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
            {t("Filterləri sıfırla")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
