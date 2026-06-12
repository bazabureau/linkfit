"use client";

import Image from "next/image";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { Building2, ExternalLink, Pencil, Trash2 } from "lucide-react";
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
import { api } from "@/lib/api";
import { venuesKeys, type Venue, type VenueDetail } from "@/lib/admin-venues";

interface VenuesTableProps {
  venues: Venue[];
  isLoading: boolean;
  onEdit: (venue: Venue) => void;
  onDelete: (venue: Venue) => void;
}

function RowSkeleton(): React.JSX.Element {
  return (
    <TableRow>
      {Array.from({ length: 7 }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-surfaceElevated" />
        </TableCell>
      ))}
    </TableRow>
  );
}

export function VenuesTable({
  venues,
  isLoading,
  onEdit,
  onDelete,
}: VenuesTableProps): React.JSX.Element {
  // Fetch detail (courts) for each venue to compute sport counts per venue.
  const detailQueries = useQueries({
    queries: venues.map((v) => ({
      queryKey: venuesKeys.detail(v.id),
      enabled: Boolean(v.id),
      staleTime: 1000 * 60 * 5,
      queryFn: async () => api.get<VenueDetail>(`/api/v1/venues/${v.id}`),
    })),
  });

  const courtsByVenue = new Map<string, VenueDetail["courts"]>();
  venues.forEach((v, idx) => {
    const data = detailQueries[idx]?.data;
    if (data?.courts) {
      courtsByVenue.set(v.id, data.courts);
    }
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Photo</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Address</TableHead>
          <TableHead>Partner</TableHead>
          <TableHead>Courts</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}
        {!isLoading &&
          venues.map((venue) => {
            const courts = courtsByVenue.get(venue.id) ?? [];
            const sportCounts = courts.reduce<Record<string, number>>((acc, c) => {
              const key = c.sport_slug || c.sport_id;
              acc[key] = (acc[key] ?? 0) + 1;
              return acc;
            }, {});
            const sportList = Object.entries(sportCounts);

            return (
              <TableRow key={venue.id}>
                <TableCell>
                  {venue.photo_url ? (
                    <div className="relative h-10 w-10 overflow-hidden rounded-md border border-border bg-surfaceElevated">
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
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-surfaceElevated text-foregroundMuted">
                      <Building2 className="h-4 w-4" />
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/venues/${venue.id}`}
                    className="font-medium text-foreground hover:text-accent inline-flex items-center gap-1"
                  >
                    {venue.name}
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </Link>
                </TableCell>
                <TableCell className="max-w-[260px] truncate text-foregroundMuted">
                  {venue.address}
                </TableCell>
                <TableCell>
                  {venue.is_partner ? (
                    <Badge variant="success">Partner</Badge>
                  ) : (
                    <Badge variant="neutral">No</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {courts.length === 0 ? (
                    <span className="text-xs text-foregroundMuted">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="info">{courts.length} total</Badge>
                      {sportList.map(([slug, count]) => (
                        <Badge key={slug} variant="neutral">
                          {slug} ({count})
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-foregroundMuted">
                  {venue.created_at
                    ? new Date(venue.created_at).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onEdit(venue)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => onDelete(venue)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
      </TableBody>
    </Table>
  );
}

