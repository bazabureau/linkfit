"use client";

import * as React from "react";
import { Info, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  useCreateVenuePartner,
  useDeleteVenuePartner,
  useUpdateVenuePartner,
  useVenuePartners,
  type PartnerAccount,
} from "@/lib/admin-venues";
import { APIError } from "@/lib/api";
import {
  ConfirmDialog,
  DenseTable,
  EmptyPanel,
  IconAction,
  SectionCard,
  TABLE_HEAD_CLASS,
  TableRowsSkeleton,
  rowClass,
} from "./detail-ui";
import { initials } from "./lib";
import {
  PartnerAccountDialog,
  type PartnerAccountSubmit,
} from "./PartnerAccountDialog";

const OWNER_PORTAL = "owner.linkfit.az";

function describeError(err: unknown, fallback: string): string {
  if (err instanceof APIError && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: string }).message;
    if (message) return message;
  }
  return fallback;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("az-AZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function PartnersPanel({ venueId }: { venueId: string }): React.JSX.Element {
  const toast = useToast();
  const partnersQuery = useVenuePartners(venueId);
  const createPartner = useCreateVenuePartner(venueId);
  const updatePartner = useUpdateVenuePartner(venueId);
  const deletePartner = useDeleteVenuePartner(venueId);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PartnerAccount | null>(null);
  const [deleteFor, setDeleteFor] = React.useState<PartnerAccount | null>(null);

  const partners = React.useMemo(
    () => partnersQuery.data ?? [],
    [partnersQuery.data],
  );

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(partner: PartnerAccount): void {
    setEditing(partner);
    setFormOpen(true);
  }

  function handleSubmit(values: PartnerAccountSubmit): void {
    if (editing) {
      updatePartner.mutate(
        {
          userId: editing.id,
          data: {
            display_name: values.display_name,
            staff_title: values.staff_title ?? null,
            ...(values.password ? { password: values.password } : {}),
          },
        },
        {
          onSuccess: () => {
            toast.success("Tərəfdaş hesabı yeniləndi", values.email);
            setFormOpen(false);
            setEditing(null);
          },
          onError: (err) =>
            toast.error(
              "Hesab yenilənmədi",
              describeError(err, "Əməliyyat alınmadı"),
            ),
        },
      );
      return;
    }
    createPartner.mutate(
      {
        email: values.email,
        display_name: values.display_name,
        password: values.password ?? "",
        staff_title: values.staff_title ?? null,
      },
      {
        onSuccess: () => {
          toast.success("Tərəfdaş hesabı yaradıldı", values.email);
          setFormOpen(false);
        },
        onError: (err) => {
          const conflict =
            err instanceof APIError &&
            (err.status === 409 ||
              err.code === "email_conflict" ||
              err.code === "email_taken");
          if (conflict) {
            toast.error(
              "Bu e-poçt artıq istifadə olunur",
              "Başqa e-poçt ünvanı seçin.",
            );
          } else {
            toast.error("Hesab yaradılmadı", describeError(err, "Əməliyyat alınmadı"));
          }
        },
      },
    );
  }

  function handleDelete(): void {
    if (!deleteFor) return;
    const target = deleteFor;
    setDeleteFor(null);
    deletePartner.mutate(target.id, {
      onSuccess: () => toast.success("Tərəfdaş hesabı silindi", target.email),
      onError: (err) =>
        toast.error("Hesab silinmədi", describeError(err, "Əməliyyat alınmadı")),
    });
  }

  return (
    <SectionCard
      title="Tərəfdaş hesabları"
      description="Bu məkanı owner portalında idarə edə bilən giriş hesabları."
      bodyClassName="p-0"
      action={
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4" />
          Hesab yarat
        </Button>
      }
    >
      {/* Owner-portal note */}
      <div className="flex items-start gap-2.5 border-b border-border bg-surfaceElevated/50 px-5 py-3 text-xs text-foregroundMuted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          Yaradılan hesab{" "}
          <span className="font-semibold text-foreground">{OWNER_PORTAL}</span>{" "}
          owner portalına daxil olur və yalnız bu məkanın rezervasiyalarını,
          kortlarını və qaydalarını idarə edir.
        </p>
      </div>

      {partnersQuery.isLoading ? (
        <TableRowsSkeleton />
      ) : partnersQuery.isError ? (
        <EmptyPanel
          icon={Users}
          title="Hesablar yüklənmədi"
          text="Şəbəkəni və admin sessiyasını yoxlayıb yenidən cəhd edin."
        />
      ) : partners.length === 0 ? (
        <EmptyPanel
          icon={Users}
          title="Tərəfdaş hesabı yoxdur"
          text="Məkan sahibinə owner portalına giriş vermək üçün hesab yaradın."
          action={
            <Button onClick={openCreate} size="sm" className="mt-1">
              <Plus className="h-4 w-4" />
              Hesab yarat
            </Button>
          }
        />
      ) : (
        <DenseTable minWidth={720}>
          <thead>
            <tr>
              <th className={`${TABLE_HEAD_CLASS} rounded-tl-2xl`}>Hesab</th>
              <th className={TABLE_HEAD_CLASS}>Vəzifə</th>
              <th className={TABLE_HEAD_CLASS}>Yaradılıb</th>
              <th className={`${TABLE_HEAD_CLASS} rounded-tr-2xl text-right`}>
                Əməliyyat
              </th>
            </tr>
          </thead>
          <tbody>
            {partners.map((partner, index) => (
              <tr key={partner.id} className={rowClass(index)}>
                <td className="px-4 py-3 align-middle">
                  <div className="flex min-w-[220px] items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-accent">
                      {initials(partner.display_name || partner.email)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">
                        {partner.display_name || "Adsız"}
                      </div>
                      <div className="truncate text-xs text-foregroundMuted">
                        {partner.email}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 align-middle">
                  {partner.staff_title ? (
                    <span className="inline-flex items-center rounded-full bg-surfaceElevated px-2.5 py-1 text-xs font-medium text-foregroundMuted ring-1 ring-inset ring-border">
                      {partner.staff_title}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-middle">
                  <span className="text-sm tabular-nums text-foregroundMuted">
                    {formatDate(partner.created_at)}
                  </span>
                </td>
                <td className="px-4 py-3 align-middle">
                  <div className="flex items-center justify-end gap-1.5">
                    <IconAction title="Redaktə et" onClick={() => openEdit(partner)}>
                      <Pencil className="h-4 w-4" />
                    </IconAction>
                    <IconAction title="Sil" danger onClick={() => setDeleteFor(partner)}>
                      <Trash2 className="h-4 w-4" />
                    </IconAction>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      )}

      <PartnerAccountDialog
        open={formOpen}
        initial={editing}
        submitting={createPartner.isPending || updatePartner.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={deleteFor !== null}
        title="Tərəfdaş hesabı silinsin?"
        description={
          deleteFor
            ? `${deleteFor.email} hesabı silinəcək və owner portalına girişi dayandırılacaq.`
            : ""
        }
        confirmLabel="Sil"
        danger
        busy={deletePartner.isPending}
        onOpenChange={(open) => !open && setDeleteFor(null)}
        onConfirm={handleDelete}
      />
    </SectionCard>
  );
}
