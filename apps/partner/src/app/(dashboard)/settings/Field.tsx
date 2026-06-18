"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/cn";

interface FieldProps {
  id: string;
  label: string;
  /** Helper text shown under the label to guide the partner. */
  hint?: string;
  /** Marks the field with a small lime "vacib" (required) marker. */
  required?: boolean;
  /** Right-aligned content next to the label (e.g. a character counter). */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Labelled form field with optional helper hint, required marker and a meta
 * slot (used for char counters). Keeps spacing/typography consistent so the
 * form is comfortable to scan and edit.
 */
export function Field({
  id,
  label,
  hint,
  required,
  meta,
  children,
  className,
}: FieldProps): React.JSX.Element {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="flex items-center gap-1.5">
          {label}
          {required ? (
            <span className="rounded bg-accent/15 px-1.5 py-px text-[10px] font-semibold text-accent">
              vacib
            </span>
          ) : null}
        </Label>
        {meta ? <span className="shrink-0">{meta}</span> : null}
      </div>
      {children}
      {hint ? (
        <p className="text-xs leading-relaxed text-foregroundMuted">{hint}</p>
      ) : null}
    </div>
  );
}
