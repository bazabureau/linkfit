"use client";

import * as React from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import {
  ROLE_FILTERS,
  STATUS_FILTERS,
  VERIFICATION_FILTERS,
  VIP_FILTERS,
  type RoleFilter,
  type StatusFilter,
  type VerificationFilter,
  type VipFilter,
} from "./lib";

export interface UserFilterState {
  q: string;
  role: RoleFilter;
  status: StatusFilter;
  verification: VerificationFilter;
  vip: VipFilter;
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

function ChipRow<T extends string>({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 hidden min-w-[88px] items-center gap-1.5 text-xs font-semibold   text-foregroundMuted sm:inline-flex">
        {icon}
        {t(label)}
      </span>
      {options.map((option) => (
        <FilterChip
          key={option.value}
          active={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {t(option.label)}
        </FilterChip>
      ))}
    </div>
  );
}

export function UserFilters({
  value,
  searchInput,
  onSearchInput,
  onChange,
  onReset,
  refreshing,
}: {
  value: UserFilterState;
  searchInput: string;
  onSearchInput: (value: string) => void;
  onChange: (patch: Partial<UserFilterState>) => void;
  onReset: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const hasFilters =
    value.q !== "" ||
    value.role !== "all" ||
    value.status !== "all" ||
    value.verification !== "all" ||
    value.vip !== "all";

  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4">
      {/* Search row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => onSearchInput(event.target.value)}
            placeholder={t("Ad və ya e-poçt ilə axtar")}
            aria-label={t("İstifadəçi axtarışı")}
            className="h-10 border-transparent bg-surfaceElevated pl-9 pr-9"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => onSearchInput("")}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-foregroundMuted transition hover:bg-border/60 hover:text-foreground"
              aria-label={t("Təmizlə")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {refreshing ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">
              {t("Yenilənir")}
            </span>
          ) : null}
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={onReset}>
              <X className="h-3.5 w-3.5" />
              {t("Filterləri sıfırla")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Filter chip rows */}
      <div className="mt-3 space-y-2.5 border-t border-border pt-3">
        <ChipRow
          icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          label="Rol"
          options={ROLE_FILTERS}
          value={value.role}
          onChange={(role) => onChange({ role })}
        />
        <ChipRow
          icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          label="Status"
          options={STATUS_FILTERS}
          value={value.status}
          onChange={(status) => onChange({ status })}
        />
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
          <ChipRow
            icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
            label="Email"
            options={VERIFICATION_FILTERS}
            value={value.verification}
            onChange={(verification) => onChange({ verification })}
          />
          <ChipRow
            icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
            label="Badge"
            options={VIP_FILTERS}
            value={value.vip}
            onChange={(vip) => onChange({ vip })}
          />
        </div>
      </div>
    </div>
  );
}
