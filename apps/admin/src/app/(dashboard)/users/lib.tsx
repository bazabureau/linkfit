"use client";

import * as React from "react";
import { Label } from "@/components/ui/input";
import type { AdminRole, AdminUsersParams } from "@/lib/admin-queries";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 20;

export type RoleFilter = NonNullable<AdminUsersParams["role"]>;
export type StatusFilter = NonNullable<AdminUsersParams["status"]>;
export type VerificationFilter = NonNullable<AdminUsersParams["verification"]>;
export type VipFilter = NonNullable<AdminUsersParams["vip"]>;
/** Roles an admin may assign from the UI (partner/owner is system-managed). */
export type MutableAdminRole = Exclude<AdminRole, "partner">;

export const ROLE_FILTERS: Array<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "Hamısı" },
  { value: "user", label: "İstifadəçi" },
  { value: "partner", label: "Owner" },
  { value: "staff", label: "Admin staff" },
  { value: "admin", label: "Admin" },
  { value: "moderator", label: "Moderator" },
];

export const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Bütün statuslar" },
  { value: "active", label: "Aktiv" },
  { value: "suspended", label: "Bloklanıb" },
  { value: "deleted", label: "Silinib" },
];

export const VERIFICATION_FILTERS: Array<{
  value: VerificationFilter;
  label: string;
}> = [
  { value: "all", label: "Email: hamısı" },
  { value: "verified", label: "Təsdiqli" },
  { value: "unverified", label: "Təsdiqsiz" },
];

export const VIP_FILTERS: Array<{ value: VipFilter; label: string }> = [
  { value: "all", label: "VIP: hamısı" },
  { value: "vip", label: "VIP" },
  { value: "standard", label: "Standart" },
];

// ─── Role presentation ────────────────────────────────────────────────────────

type RoleTone = "warning" | "info" | "accent" | "neutral";

const ROLE_META: Record<
  "admin" | "moderator" | "partner" | "user",
  { label: string; tone: RoleTone }
> = {
  admin: { label: "Admin", tone: "warning" },
  moderator: { label: "Moderator", tone: "info" },
  partner: { label: "Owner", tone: "accent" },
  user: { label: "İstifadəçi", tone: "neutral" },
};

export function roleMeta(role: AdminRole): { label: string; tone: RoleTone } {
  if (role === "admin") return ROLE_META.admin;
  if (role === "moderator") return ROLE_META.moderator;
  if (role === "partner") return ROLE_META.partner;
  return ROLE_META.user;
}

export function rolePillClass(role: AdminRole): string {
  const { tone } = roleMeta(role);
  if (tone === "warning") return "bg-warning/12 text-warning ring-1 ring-inset ring-warning/30";
  if (tone === "info") return "bg-info/10 text-info ring-1 ring-inset ring-info/25";
  if (tone === "accent")
    return "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40";
  return "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border";
}

// ─── Account status presentation ──────────────────────────────────────────────

export type AccountState = "deleted" | "suspended" | "active";

export function accountState(user: {
  deleted_at: string | null;
  suspended_at: string | null;
}): AccountState {
  if (user.deleted_at) return "deleted";
  if (user.suspended_at) return "suspended";
  return "active";
}

const STATE_META: Record<
  AccountState,
  { label: string; pill: string; dot: string }
> = {
  active: {
    label: "Aktiv",
    pill: "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40",
    dot: "bg-accent",
  },
  suspended: {
    label: "Bloklanıb",
    pill: "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25",
    dot: "bg-danger",
  },
  deleted: {
    label: "Silinib",
    pill: "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border",
    dot: "bg-muted",
  },
};

export function stateMeta(state: AccountState) {
  return STATE_META[state];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase() || "?";
}

export function toDateInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

// ─── Shared primitives ────────────────────────────────────────────────────────

export function SelectBox({
  value,
  onChange,
  children,
  disabled,
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
} & Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange" | "children"
>): React.JSX.Element {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 text-sm text-foreground outline-none transition focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}): React.JSX.Element {
  return (
    <Label className="space-y-2">
      <span className="block text-xs font-semibold   text-foregroundMuted">
        {label}
      </span>
      {children}
      {hint ? <span className="block text-xs text-foregroundMuted">{hint}</span> : null}
    </Label>
  );
}

/** Avatar with a VIP-tinted ring. */
export function Avatar({
  name,
  vip,
  size = "md",
}: {
  name: string | null | undefined;
  vip: boolean;
  size?: "sm" | "md" | "lg";
}): React.JSX.Element {
  const dims =
    size === "lg" ? "h-12 w-12 text-base" : size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-sm";
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold ${dims} ${
        vip
          ? "bg-warning/12 text-warning ring-1 ring-inset ring-warning/40"
          : "bg-ink text-accent"
      }`}
    >
      {initials(name)}
    </span>
  );
}
