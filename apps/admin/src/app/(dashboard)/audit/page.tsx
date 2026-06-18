"use client";

import * as React from "react";
import { Activity, Search, SlidersHorizontal, X } from "lucide-react";
import { AuditTable } from "./AuditTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  countActiveAuditFilters,
  resetAuditFilters,
  setAuditFilters,
  type AuditFilters,
} from "@/lib/admin-audit";
import { ENTITY_OPTIONS, toIso } from "./lib";

type DraftFilters = {
  action: string;
  entity: string;
  actor_user_id: string;
  from: string;
  to: string;
};

const EMPTY_DRAFT: DraftFilters = {
  action: "",
  entity: "",
  actor_user_id: "",
  from: "",
  to: "",
};

function draftToFilters(draft: DraftFilters): AuditFilters {
  return {
    action: draft.action.trim() || undefined,
    entity: draft.entity || undefined,
    actor_user_id: draft.actor_user_id.trim() || undefined,
    from: toIso(draft.from),
    to: toIso(draft.to, true),
  };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="space-y-1.5">
      <span className="block text-xs font-semibold   text-foregroundMuted">
        {label}
      </span>
      {children}
    </label>
  );
}

function SelectControl({
  value,
  onChange,
  options,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
} & Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange"
>): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 text-sm text-foreground outline-none transition focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60"
      {...rest}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default function AuditPage(): React.JSX.Element {
  const [draft, setDraft] = React.useState<DraftFilters>(EMPTY_DRAFT);

  // Filters live in a shared store consumed by AuditTable's data hook. Push the
  // applied filters whenever the draft changes, and clear on unmount so the
  // dashboard recent-activity feed (which shares the same hook) is unaffected.
  React.useEffect(() => {
    return () => resetAuditFilters();
  }, []);

  const applied = React.useMemo(() => draftToFilters(draft), [draft]);
  const activeCount = countActiveAuditFilters(applied);

  function update<K extends keyof DraftFilters>(key: K, value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setAuditFilters(draftToFilters(next));
  }

  function clearAll() {
    setDraft(EMPTY_DRAFT);
    resetAuditFilters();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold   text-accent">
            Platform activity
          </p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold  text-foreground">
            <Activity className="h-6 w-6 text-accent" />
            Audit log
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            Chronological history of administrative actions across the platform.
          </p>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Action">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
              <Input
                value={draft.action}
                onChange={(event) => update("action", event.target.value)}
                placeholder="e.g. user.suspend"
                className="border-transparent bg-surfaceElevated pl-9"
                aria-label="Filter by action"
              />
            </div>
          </Field>

          <Field label="Entity">
            <SelectControl
              value={draft.entity}
              onChange={(value) => update("entity", value)}
              options={ENTITY_OPTIONS}
              aria-label="Filter by entity"
            />
          </Field>

          <Field label="Actor ID">
            <Input
              value={draft.actor_user_id}
              onChange={(event) => update("actor_user_id", event.target.value)}
              placeholder="Actor UUID"
              className="border-transparent bg-surfaceElevated font-mono text-xs"
              aria-label="Filter by actor user id"
            />
          </Field>

          <Field label="From">
            <Input
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(event) => update("from", event.target.value)}
              aria-label="Filter from date"
            />
          </Field>

          <Field label="To">
            <Input
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(event) => update("to", event.target.value)}
              aria-label="Filter to date"
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold   text-foregroundMuted">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
          </span>
          {activeCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-[#3f6b00]">
              {activeCount} active
            </span>
          ) : (
            <span className="text-xs text-foregroundMuted">No filters applied</span>
          )}
          {activeCount > 0 ? (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={clearAll}>
              <X className="h-3.5 w-3.5" />
              Reset filters
            </Button>
          ) : null}
        </div>
      </div>

      <AuditTable />
    </div>
  );
}
