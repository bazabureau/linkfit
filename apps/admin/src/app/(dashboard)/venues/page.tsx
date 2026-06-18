"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  useCreateVenue,
  useDeleteVenue,
  useUpdateVenue,
  venuesKeys,
  type Venue,
  type VenuePayload,
} from "@/lib/admin-venues";
import { useI18n } from "@/lib/i18n";
import { VenueForm } from "./VenueForm";
import { VenuesTable } from "./VenuesTable";
import { VenueStats, type VenueCounts } from "./VenueStats";
import {
  VenueFilters,
  type PartnerFilter,
  type StatusFilter,
  type VenueFilterState,
} from "./VenueFilters";
import { venueStatus } from "./lib";

interface ErrorWithStatus {
  status?: number;
  message?: string;
}

interface AdminVenuesResponse {
  items?: Venue[];
  results?: Venue[];
  total?: number;
  count?: number;
}

const INITIAL_FILTERS: VenueFilterState = {
  q: "",
  status: "all",
  partner: "all",
};

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const e = err as ErrorWithStatus;
    if (e.status === 409) {
      return "Cannot complete this action — the venue is referenced by existing records (courts, bookings, or tournaments).";
    }
    if (e.message) return e.message;
  }
  return fallback;
}

function matchesPartner(filter: PartnerFilter, venue: Venue): boolean {
  if (filter === "partner") return venue.is_partner;
  if (filter === "non_partner") return !venue.is_partner;
  return true;
}

function matchesStatus(filter: StatusFilter, venue: Venue): boolean {
  return filter === "all" || venueStatus(venue) === filter;
}

export default function VenuesPage(): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [filters, setFilters] = React.useState<VenueFilterState>(INITIAL_FILTERS);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Venue | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<Venue | null>(null);

  // The admin venues endpoint returns *every* venue regardless of publish
  // status (draft/pending/published/suspended) plus aggregate counts and
  // timestamps — unlike the public `/venues` endpoint which hides anything
  // that is not published. Admins need the full inventory.
  const venuesQueryKey = venuesKeys.list({ limit: 200 });
  const {
    data: venues = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: venuesQueryKey,
    queryFn: async () => {
      const res = await api.get<AdminVenuesResponse>("/api/v1/admin/venues?limit=200&offset=0");
      return res.items ?? res.results ?? [];
    },
  });

  const createMut = useCreateVenue();
  const updateMut = useUpdateVenue();
  const deleteMut = useDeleteVenue();

  const filtered = React.useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return venues.filter((v) => {
      if (q && !v.name.toLowerCase().includes(q) && !v.address.toLowerCase().includes(q)) {
        return false;
      }
      return matchesStatus(filters.status, v) && matchesPartner(filters.partner, v);
    });
  }, [venues, filters]);

  const counts = React.useMemo<VenueCounts>(() => {
    const acc: VenueCounts = {
      total: 0,
      draft: 0,
      pending: 0,
      published: 0,
      suspended: 0,
      partners: 0,
    };
    for (const v of venues) {
      acc.total += 1;
      const status = venueStatus(v);
      if (status === "draft") acc.draft += 1;
      else if (status === "pending") acc.pending += 1;
      else if (status === "published") acc.published += 1;
      else if (status === "suspended") acc.suspended += 1;
      if (v.is_partner) acc.partners += 1;
    }
    return acc;
  }, [venues]);

  function updateFilters(patch: Partial<VenueFilterState>): void {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(venue: Venue): void {
    setEditing(venue);
    setFormOpen(true);
  }

  function closeForm(): void {
    setFormOpen(false);
    setEditing(null);
  }

  async function handleSubmit(payload: VenuePayload): Promise<void> {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload });
        toast.success(t("Venue updated"), payload.name);
      } else {
        await createMut.mutateAsync(payload);
        toast.success(t("Venue created"), payload.name);
      }
      // Make sure the freshly created/edited venue (any status) shows up.
      await queryClient.invalidateQueries({ queryKey: venuesQueryKey });
      closeForm();
    } catch (err) {
      toast.error(t("Save failed"), getErrorMessage(err, "Could not save venue"));
    }
  }

  async function handleDelete(): Promise<void> {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteMut.mutateAsync(target.id);
      await queryClient.invalidateQueries({ queryKey: venuesQueryKey });
      toast.success(t("Venue deleted"), target.name);
    } catch (err) {
      toast.error(t("Delete failed"), getErrorMessage(err, "Could not delete venue"));
    }
  }

  const submitting = createMut.isPending || updateMut.isPending;
  const showEmpty = !isLoading && !isError && venues.length === 0;
  const statsLoading = isLoading && venues.length === 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold   text-accent">
            {t("Venues")}
          </p>
          <h1 className="mt-2 font-display text-[1.6rem] font-bold  text-foreground">
            {t("Venue inventory")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Manage partner venues, locations, courts and hero imagery.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Refresh")}
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />
            {t("New venue")}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      {!isError ? <VenueStats counts={counts} loading={statsLoading} /> : null}

      {/* Filters */}
      {!showEmpty && !isError ? (
        <VenueFilters
          value={filters}
          onChange={updateFilters}
          onReset={() => setFilters(INITIAL_FILTERS)}
        />
      ) : null}

      {/* Table card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        {isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : showEmpty ? (
          <EmptyState onCreate={openNew} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <div>
                <h2 className="font-display text-sm font-bold text-foreground">
                  {t("Venue list")}
                </h2>
                <p className="text-xs text-foregroundMuted">
                  {isLoading
                    ? t("Loading…")
                    : `${filtered.length} / ${venues.length} ${t("shown")}`}
                </p>
              </div>
              {isFetching && !isLoading ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  {t("Refreshing")}
                </span>
              ) : null}
            </div>

            {!isLoading && filtered.length === 0 ? (
              <NoMatchState onReset={() => setFilters(INITIAL_FILTERS)} />
            ) : (
              <VenuesTable
                venues={filtered}
                isLoading={isLoading}
                onEdit={openEdit}
                onDelete={(v) => setConfirmDelete(v)}
              />
            )}
          </>
        )}
      </div>

      {/* Create / edit modal */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}
        title={editing ? t("Edit venue") : t("New venue")}
        description={
          editing
            ? t("Update venue details, photo or partner status.")
            : t("Create a venue. You can add courts after saving.")
        }
        contentClassName="max-w-2xl"
      >
        <VenueForm
          initial={editing}
          submitting={submitting}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => (open ? null : setConfirmDelete(null))}
        title={t("Delete venue")}
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted">
            {t("Are you sure you want to delete")}{" "}
            <span className="font-semibold text-foreground">{confirmDelete?.name}</span>?{" "}
            {t("This action cannot be undone, and the venue must not have any future bookings.")}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(null)}
              disabled={deleteMut.isPending}
            >
              {t("Cancel")}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? t("Deleting...") : t("Delete")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10">
        <Building2 className="h-7 w-7 text-danger" />
      </div>
      <div>
        <h3 className="font-display text-base font-bold text-foreground">
          {t("Could not load venues")}
        </h3>
        <p className="mt-1 max-w-xs text-sm text-foregroundMuted">
          {t("Check your connection and admin session, then try again.")}
        </p>
      </div>
      <Button variant="secondary" onClick={onRetry} className="mt-1">
        <RefreshCw className="h-4 w-4" />
        {t("Retry")}
      </Button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
        <Building2 className="h-7 w-7 text-accent" />
      </div>
      <div>
        <h3 className="font-display text-base font-bold text-foreground">{t("No venues yet")}</h3>
        <p className="mt-1 max-w-sm text-sm text-foregroundMuted">
          {t("Add your first venue to start listing courts and accepting bookings.")}
        </p>
      </div>
      <Button onClick={onCreate} className="mt-1">
        <Plus className="h-4 w-4" />
        {t("Add your first venue")}
      </Button>
    </div>
  );
}

function NoMatchState({ onReset }: { onReset: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
        <Building2 className="h-7 w-7 text-accent" />
      </div>
      <div>
        <h3 className="font-display text-base font-bold text-foreground">
          {t("No venues match the current filters.")}
        </h3>
        <p className="mt-1 max-w-xs text-sm text-foregroundMuted">
          {t("Try adjusting your search or filters.")}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onReset} className="mt-1">
        {t("Reset")}
      </Button>
    </div>
  );
}
