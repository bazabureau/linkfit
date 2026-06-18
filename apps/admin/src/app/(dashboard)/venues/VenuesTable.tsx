"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Building2,
  Eye,
  Handshake,
  MapPin,
  Pencil,
  Trash2,
} from "lucide-react";
import { type Venue } from "@/lib/admin-venues";
import { formatDate } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import {
  venueStatus,
  venueStatusDotClass,
  venueStatusLabel,
  venueStatusPillClass,
} from "./lib";

interface VenuesTableProps {
  venues: Venue[];
  isLoading: boolean;
  onEdit: (venue: Venue) => void;
  onDelete: (venue: Venue) => void;
}

const COL_COUNT = 7;

function QuickAction({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: (event: React.MouseEvent) => void;
  children: React.ReactNode;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
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

function RowSkeleton(): React.JSX.Element {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: COL_COUNT }).map((_, index) => (
        <td key={index} className="px-4 py-3.5">
          <div
            className="h-4 animate-pulse rounded bg-surfaceElevated"
            style={{ width: index === 0 ? 40 : `${50 + ((index * 13) % 45)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

export function VenuesTable({
  venues,
  isLoading,
  onEdit,
  onDelete,
}: VenuesTableProps): React.JSX.Element {
  const { t } = useI18n();
  const router = useRouter();

  const headClass =
    "sticky top-0 z-10 h-11 bg-surfaceElevated px-4 text-left align-middle text-[11px] font-semibold   text-foregroundMuted";

  return (
    <div className="w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[920px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={`${headClass} rounded-tl-2xl`}>{t("Venue")}</th>
            <th className={headClass}>{t("Address")}</th>
            <th className={headClass}>{t("Status")}</th>
            <th className={headClass}>{t("Courts")}</th>
            <th className={headClass}>{t("Partner")}</th>
            <th className={headClass}>{t("Created")}</th>
            <th className={`${headClass} rounded-tr-2xl text-right`}>{t("Actions")}</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            venues.map((venue, index) => {
              const courtsCount = venue.courts_count ?? 0;
              const status = venueStatus(venue);

              return (
                <tr
                  key={venue.id}
                  onClick={() => router.push(`/venues/${venue.id}`)}
                  className={`group cursor-pointer border-b border-border transition-colors ${
                    index % 2 === 1
                      ? "bg-surfaceElevated/40 hover:bg-surfaceElevated"
                      : "bg-surface hover:bg-surfaceElevated/70"
                  }`}
                >
                  {/* Venue (photo + name) */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-[220px] items-center gap-3">
                      {venue.photo_url ? (
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-surfaceElevated">
                          <Image
                            src={venue.photo_url}
                            alt={venue.name}
                            fill
                            sizes="40px"
                            unoptimized
                            className="object-cover"
                          />
                        </div>
                      ) : (
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-ink text-accent">
                          <Building2 className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground group-hover:text-accent">
                          {venue.name}
                        </div>
                        {venue.phone ? (
                          <div className="truncate text-xs text-foregroundMuted">{venue.phone}</div>
                        ) : (
                          <div className="text-[10px] font-semibold   text-muted">
                            {venue.id.slice(0, 8)}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Address */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-[200px] max-w-[280px] items-start gap-1.5 text-foregroundMuted">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{venue.address}</span>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 align-middle">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${venueStatusPillClass(status)}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${venueStatusDotClass(status)}`} />
                      {t(venueStatusLabel(status))}
                    </span>
                  </td>

                  {/* Courts */}
                  <td className="px-4 py-3 align-middle">
                    {courtsCount === 0 ? (
                      <span className="text-xs text-foregroundMuted">—</span>
                    ) : (
                      <span className="font-display text-sm font-bold tabular-nums text-foreground">
                        {courtsCount}
                      </span>
                    )}
                  </td>

                  {/* Partner */}
                  <td className="px-4 py-3 align-middle">
                    {venue.is_partner ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-[#3f6b00]">
                        <Handshake className="h-3 w-3" />
                        {t("Partner")}
                      </span>
                    ) : (
                      <span className="text-xs text-foregroundMuted">—</span>
                    )}
                  </td>

                  {/* Created */}
                  <td className="px-4 py-3 align-middle text-foregroundMuted">
                    {formatDate(venue.created_at)}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      <QuickAction
                        title={t("Open")}
                        onClick={() => router.push(`/venues/${venue.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                      </QuickAction>
                      <QuickAction title={t("Edit")} onClick={() => onEdit(venue)}>
                        <Pencil className="h-4 w-4" />
                      </QuickAction>
                      <QuickAction title={t("Delete")} danger onClick={() => onDelete(venue)}>
                        <Trash2 className="h-4 w-4" />
                      </QuickAction>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
