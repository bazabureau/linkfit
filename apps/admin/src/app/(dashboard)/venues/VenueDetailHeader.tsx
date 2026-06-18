"use client";

import * as React from "react";
import Image from "next/image";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ImageIcon,
  MapPin,
  Phone,
  Wrench,
} from "lucide-react";
import type { Venue } from "@/lib/admin-venues";
import {
  SelectBox,
  VENUE_STATUSES,
  venueStatus,
  venueStatusDotClass,
  venueStatusLabel,
  venueStatusPillClass,
} from "./lib";

function Metric({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "accent" | "warning" | "info";
}): React.JSX.Element {
  const ring =
    tone === "accent"
      ? "bg-accent/15 text-[#3f6b00]"
      : tone === "warning"
        ? "bg-warning/12 text-warning"
        : tone === "info"
          ? "bg-info/10 text-info"
          : "bg-surfaceElevated text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold   text-foregroundMuted">
          {label}
        </span>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${ring}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 font-display text-[1.7rem] font-bold leading-none tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

export function VenueDetailHeader({
  venue,
  courtsTotal,
  upcomingBookings,
  courtSummary,
  onStatusChange,
  onEdit,
  busy,
}: {
  venue: Venue;
  courtsTotal: number;
  upcomingBookings: number;
  courtSummary: { active: number; inactive: number; maintenance: number };
  onStatusChange: (status: NonNullable<Venue["status"]>) => void;
  onEdit: () => void;
  busy: boolean;
}): React.JSX.Element {
  const status = venueStatus(venue);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="grid gap-0 lg:grid-cols-[300px_1fr]">
          {/* Hero image */}
          <div className="relative min-h-[200px] bg-surfaceElevated lg:min-h-full">
            {venue.photo_url ? (
              <Image
                src={venue.photo_url}
                alt={venue.name}
                fill
                sizes="300px"
                unoptimized
                className="object-cover"
              />
            ) : (
              <div className="grid h-full min-h-[200px] place-items-center text-foregroundMuted">
                <ImageIcon className="h-10 w-10" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-5 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-[1.6rem] font-bold  text-foreground">
                    {venue.name}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${venueStatusPillClass(status)}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${venueStatusDotClass(status)}`} />
                    {venueStatusLabel(status)}
                  </span>
                  {venue.is_partner ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-[#3f6b00]">
                      Partner
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 flex items-center gap-2 text-sm text-foregroundMuted">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span className="break-words">{venue.address}</span>
                </p>
                {venue.phone ? (
                  <p className="mt-1 flex items-center gap-2 text-sm text-foregroundMuted">
                    <Phone className="h-4 w-4 shrink-0" />
                    {venue.phone}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SelectBox
                  value={status}
                  disabled={busy}
                  onChange={(value) => onStatusChange(value as NonNullable<Venue["status"]>)}
                  aria-label="Status"
                  className="w-40"
                >
                  {VENUE_STATUSES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </SelectBox>
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-foreground transition hover:bg-surfaceElevated"
                >
                  Redaktə et
                </button>
              </div>
            </div>

            {venue.description ? (
              <p className="max-w-4xl whitespace-pre-line text-sm leading-6 text-foregroundMuted">
                {venue.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Kort" value={courtsTotal} icon={Building2} tone="neutral" />
        <Metric label="Aktiv" value={courtSummary.active} icon={CheckCircle2} tone="accent" />
        <Metric label="Maintenance" value={courtSummary.maintenance} icon={Wrench} tone="warning" />
        <Metric label="Gələcək booking" value={upcomingBookings} icon={CalendarClock} tone="info" />
      </div>
    </div>
  );
}
