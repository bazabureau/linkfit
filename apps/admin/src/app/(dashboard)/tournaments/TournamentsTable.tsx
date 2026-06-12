"use client";

import Link from "next/link";
import { Pencil, Trash2, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TOURNAMENT_STATUS_LABEL,
  formatDateRange,
  formatMoney,
  type Tournament,
  type TournamentStatus,
} from "@/lib/admin-tournaments";

interface TournamentsTableProps {
  tournaments: Tournament[];
  isLoading: boolean;
  onDelete: (t: Tournament) => void;
}

type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "neutral";

function statusVariant(status: TournamentStatus): BadgeVariant {
  switch (status) {
    case "registration_open":
      return "success";
    case "in_progress":
      return "info";
    case "registration_closed":
      return "warning";
    case "completed":
      return "neutral";
    case "cancelled":
      return "error";
    case "announced":
    default:
      return "default";
  }
}

export function TournamentsTable({
  tournaments,
  isLoading,
  onDelete,
}: TournamentsTableProps): React.JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Sport</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Entries</TableHead>
          <TableHead>Entry fee</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-sm text-foregroundMuted">
              Loading tournaments…
            </TableCell>
          </TableRow>
        )}
        {!isLoading && tournaments.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-sm text-foregroundMuted">
              No tournaments match the current filters.
            </TableCell>
          </TableRow>
        )}
        {!isLoading &&
          tournaments.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium text-foreground">
                <Link
                  href={`/tournaments/${t.id}`}
                  className="hover:text-accent transition-colors"
                >
                  {t.name}
                </Link>
                {t.venue_name ? (
                  <div className="text-xs text-foregroundMuted">{t.venue_name}</div>
                ) : null}
              </TableCell>
              <TableCell className="text-foregroundMuted">
                {t.sport_name ?? t.sport_slug ?? "—"}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(t.status)}>
                  {TOURNAMENT_STATUS_LABEL[t.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-foregroundMuted whitespace-nowrap">
                {formatDateRange(t.starts_at, t.ends_at)}
              </TableCell>
              <TableCell className="text-foregroundMuted tabular-nums">
                {t.entries_count ?? 0} / {t.max_squads}
              </TableCell>
              <TableCell className="text-foregroundMuted tabular-nums">
                {formatMoney(t.entry_fee_minor, t.currency)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/tournaments/${t.id}`}>
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </Link>
                  </Button>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/tournaments/${t.id}/edit`}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Link>
                  </Button>
                  {t.status !== "cancelled" && t.status !== "completed" && (
                    <Button variant="danger" size="sm" onClick={() => onDelete(t)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
