"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SectionCardProps {
  /** 1-based section number rendered in the display font. */
  step: number;
  /** Lucide icon component for the section. */
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** Optional element rendered on the right of the header (e.g. a status pill). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Consistent section shell used across the settings page. Gives every block a
 * numbered, well-spaced header with helper text plus a comfortable padded body.
 */
export function SectionCard({
  step,
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
}: SectionCardProps): React.JSX.Element {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      <header className="flex items-start gap-4 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-xs font-semibold text-foregroundMuted tabular-nums">
              {String(step).padStart(2, "0")}
            </span>
            <h2 className="font-display text-base font-semibold text-foreground">
              {title}
            </h2>
          </div>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-foregroundMuted">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}
