"use client";

import * as React from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import type { Venue, Court } from "@/lib/admin-venues";
import type { BookingStatus } from "@/lib/admin-queries";
import { BOOKING_STATUSES, SelectBox } from "./lib";

export interface FilterState {
  q: string;
  status: BookingStatus | "all";
  venueId: string;
  courtId: string;
  from: string;
  to: string;
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

export function BookingFilters({
  value,
  onChange,
  onReset,
  venues,
  courts,
}: {
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
  venues: Venue[];
  courts: Court[];
}): React.JSX.Element {
  const { t } = useI18n();
  const hasFilters =
    value.q !== "" ||
    value.status !== "all" ||
    value.venueId !== "all" ||
    value.courtId !== "all" ||
    value.from !== "" ||
    value.to !== "";

  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4">
      {/* Top row — search + structured filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input
            value={value.q}
            onChange={(event) => onChange({ q: event.target.value })}
            placeholder={t("Müştəri, email, məkan və ya kort üzrə axtar...")}
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

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:w-auto lg:items-center">
          <SelectBox
            value={value.venueId}
            onChange={(v) => onChange({ venueId: v, courtId: "all" })}
            className="lg:w-44"
          >
            <option value="all">{t("Bütün məkanlar")}</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </SelectBox>
          <SelectBox
            value={value.courtId}
            disabled={value.venueId === "all"}
            onChange={(v) => onChange({ courtId: v })}
            className="lg:w-40"
          >
            <option value="all">{t("Bütün kortlar")}</option>
            {courts.map((court) => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </SelectBox>
          <Input
            type="date"
            value={value.from}
            onChange={(event) => onChange({ from: event.target.value })}
            className="h-10 lg:w-40"
            aria-label={t("Başlanğıc tarix")}
          />
          <Input
            type="date"
            value={value.to}
            onChange={(event) => onChange({ to: event.target.value })}
            className="h-10 lg:w-40"
            aria-label={t("Son tarix")}
          />
        </div>
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
        {BOOKING_STATUSES.map((item) => (
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
