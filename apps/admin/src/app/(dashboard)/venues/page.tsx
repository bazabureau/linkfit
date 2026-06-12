"use client";

import { useMemo, useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  useCreateVenue,
  useDeleteVenue,
  useUpdateVenue,
  useVenues,
  type Venue,
  type VenuePayload,
} from "@/lib/admin-venues";
import { VenueForm } from "./VenueForm";
import { VenuesTable } from "./VenuesTable";

interface ErrorWithStatus {
  status?: number;
  message?: string;
}

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

export default function VenuesPage(): React.JSX.Element {
  const toast = useToast();
  const { data: venues = [], isLoading } = useVenues({ limit: 100 });

  const createMut = useCreateVenue();
  const updateMut = useUpdateVenue();
  const deleteMut = useDeleteVenue();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Venue | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Venue | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter(
      (v) =>
        v.name.toLowerCase().includes(q) || v.address.toLowerCase().includes(q),
    );
  }, [venues, query]);

  const openNew = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (venue: Venue): void => {
    setEditing(venue);
    setFormOpen(true);
  };

  const closeForm = (): void => {
    setFormOpen(false);
    setEditing(null);
  };

  const handleSubmit = async (payload: VenuePayload): Promise<void> => {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload });
        toast.success("Venue updated", payload.name);
      } else {
        await createMut.mutateAsync(payload);
        toast.success("Venue created", payload.name);
      }
      closeForm();
    } catch (err) {
      toast.error("Save failed", getErrorMessage(err, "Could not save venue"));
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteMut.mutateAsync(target.id);
      toast.success("Venue deleted", target.name);
    } catch (err) {
      toast.error("Delete failed", getErrorMessage(err, "Could not delete venue"));
    }
  };

  const submitting = createMut.isPending || updateMut.isPending;
  const showEmpty = !isLoading && venues.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Venues
          </h1>
          <p className="text-sm text-foregroundMuted">
            Manage partner venues, locations, courts and hero imagery.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" />
          New venue
        </Button>
      </div>

      {!showEmpty && (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or address…"
            className="pl-9"
          />
        </div>
      )}

      <Card>
        {showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10">
              <Building2 className="h-6 w-6 text-accent" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                No venues yet
              </h3>
              <p className="text-sm text-foregroundMuted">
                Add your first venue to start listing courts and accepting bookings.
              </p>
            </div>
            <Button onClick={openNew} className="mt-2">
              <Plus className="h-4 w-4" />
              Add your first venue
            </Button>
          </div>
        ) : !isLoading && filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-foregroundMuted">
            No venues match {JSON.stringify(query)}.
          </div>
        ) : (
          <VenuesTable
            venues={filtered}
            isLoading={isLoading}
            onEdit={openEdit}
            onDelete={(v) => setConfirmDelete(v)}
          />
        )}
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}
        title={editing ? "Edit venue" : "New venue"}
        description={
          editing
            ? "Update venue details, photo or partner status."
            : "Create a venue. You can add courts after saving."
        }
      >
        <VenueForm
          initial={editing}
          submitting={submitting}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      </Dialog>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => (open ? null : setConfirmDelete(null))}
        title="Delete venue"
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">
              {confirmDelete?.name}
            </span>
            ? This action cannot be undone, and the venue must not have any
            future bookings.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(null)}
              disabled={deleteMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
