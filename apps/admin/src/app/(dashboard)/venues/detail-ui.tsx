"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

// ─── Shared confirm dialog ──────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-foregroundMuted">{description}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Geri
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Gözləyin..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Empty / skeleton states ────────────────────────────────────────────────

export function EmptyPanel({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
        <Icon className="h-7 w-7 text-accent" />
      </div>
      <div>
        <h3 className="font-display text-base font-bold text-foreground">{title}</h3>
        <p className="mt-1 max-w-sm text-sm text-foregroundMuted">{text}</p>
      </div>
      {action}
    </div>
  );
}

export function TableRowsSkeleton({ rows = 4 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-xl bg-surfaceElevated" />
      ))}
    </div>
  );
}

// ─── Table shell (dense, sticky head, hover rows) ───────────────────────────

export const TABLE_HEAD_CLASS =
  "sticky top-0 z-10 h-11 bg-surfaceElevated px-4 text-left align-middle text-[11px] font-semibold   text-foregroundMuted";

export function DenseTable({
  minWidth = 720,
  children,
}: {
  minWidth?: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="w-full overflow-x-auto overscroll-x-contain">
      <table
        className="w-full border-separate border-spacing-0 text-sm"
        style={{ minWidth }}
      >
        {children}
      </table>
    </div>
  );
}

export function rowClass(index: number): string {
  return `group border-b border-border transition-colors ${
    index % 2 === 1
      ? "bg-surfaceElevated/40 hover:bg-surfaceElevated"
      : "bg-surface hover:bg-surfaceElevated/70"
  }`;
}

export function IconAction({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition ${
        danger
          ? "border-danger/20 text-danger/80 hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          : "border-border text-foregroundMuted hover:border-borderStrong hover:bg-surfaceElevated hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Section card (header + body) ───────────────────────────────────────────

export function SectionCard({
  title,
  description,
  action,
  bodyClassName,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-sm font-bold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-foregroundMuted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
