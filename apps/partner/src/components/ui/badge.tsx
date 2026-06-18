import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-surfaceElevated text-foreground",
        success: "border-accent/40 bg-accent/10 text-accent",
        // Solid lime emphasis chip — dark ink for readability on the lime fill.
        accent: "border-transparent bg-accent text-accent-ink font-semibold",
        warning: "border-warning/30 bg-warning/10 text-warning",
        danger: "border-danger/30 bg-danger/10 text-danger",
        // Alias used by feature pages — semantically same as `danger`.
        error: "border-danger/30 bg-danger/10 text-danger",
        info: "border-info/30 bg-info/10 text-info",
        neutral: "border-border bg-transparent text-foregroundMuted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({
  className,
  variant,
  ...props
}: BadgeProps): React.JSX.Element {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
