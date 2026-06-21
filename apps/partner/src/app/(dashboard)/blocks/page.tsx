"use client";

import { useMemo, useState } from "react";
import {
  Wrench,
  Plus,
  Pencil,
  Trash2,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  usePartnerCourts,
  usePartnerBlocks,
  useCreatePartnerBlock,
  useUpdatePartnerBlock,
  useDeletePartnerBlock,
  type CourtBlock,
} from "@/lib/partner-queries";
import { formatDateTime } from "@/lib/date-format";
import { APIError } from "@/lib/api";

// Convert an ISO timestamp to the value expected by <input type="datetime-local">.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function RowSkeleton(): React.JSX.Element {
  const widths = ["w-28", "w-36", "w-36", "w-40", "w-16"];
  return (
    <TableRow className="hover:bg-transparent">
      {widths.map((w, i) => (
        <TableCell key={i} className={i === widths.length - 1 ? "text-right" : ""}>
          <div
            className={`h-4 ${w} animate-pulse rounded bg-surfaceElevated ${
              i === widths.length - 1 ? "ml-auto" : ""
            }`}
          />
        </TableCell>
      ))}
    </TableRow>
  );
}

export default function BlocksPage(): React.JSX.Element {
  const toast = useToast();

  const { data: courtsData } = usePartnerCourts();
  const courts = useMemo(() => courtsData ?? [], [courtsData]);
  const { data: blocksData, isLoading } = usePartnerBlocks();
  const blocks = useMemo(() => blocksData ?? [], [blocksData]);

  const createMut = useCreatePartnerBlock();
  const updateMut = useUpdatePartnerBlock();
  const deleteMut = useDeletePartnerBlock();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CourtBlock | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CourtBlock | null>(null);

  // Form fields
  const [courtId, setCourtId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);

  const courtName = (id: string): string =>
    courts.find((c) => c.id === id)?.name ?? "—";

  const openNew = (): void => {
    setEditing(null);
    setCourtId(courts[0]?.id ?? "");
    setStartsAt("");
    setEndsAt("");
    setReason("");
    setForce(false);
    setFormOpen(true);
  };

  const openEdit = (block: CourtBlock): void => {
    setEditing(block);
    setCourtId(block.court_id);
    setStartsAt(toLocalInput(block.starts_at));
    setEndsAt(toLocalInput(block.ends_at));
    setReason(block.reason ?? "");
    setForce(false);
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!courtId || !startsAt || !endsAt) {
      toast.error("Form xətası", "Kort, başlama və bitmə vaxtı məcburidir.");
      return;
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      toast.error("Form xətası", "Bitmə vaxtı başlama vaxtından sonra olmalıdır.");
      return;
    }
    try {
      if (editing) {
        await updateMut.mutateAsync({
          id: editing.id,
          data: {
            starts_at: fromLocalInput(startsAt),
            ends_at: fromLocalInput(endsAt),
            reason: reason.trim() || null,
            force,
          },
        });
        toast.success("Blok yeniləndi", "Texniki xidmət bloku yeniləndi.");
      } else {
        await createMut.mutateAsync({
          court_id: courtId,
          starts_at: fromLocalInput(startsAt),
          ends_at: fromLocalInput(endsAt),
          reason: reason.trim() || null,
          force,
        });
        toast.success("Blok yaradıldı", "Kort seçilmiş aralıqda bloklandı.");
      }
      setFormOpen(false);
    } catch (err: unknown) {
      // 409 = there are existing bookings in the window; prompt to force.
      if (err instanceof APIError && err.status === 409) {
        toast.error(
          "Toqquşma var",
          "Bu aralıqda rezervasiyalar var. Yenə də bloklamaq üçün \"Məcburi blokla\" seçimini işarələyin.",
        );
        setForce(true);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat baş tutmadı", message || "Xəta baş verdi.");
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteMut.mutateAsync(target.id);
      toast.success("Blok silindi", "Kort yenidən rezervasiyaya açıqdır.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Silinmədi", message || "Bloku silmək mümkün olmadı.");
    }
  };

  const showEmpty = !isLoading && blocks.length === 0;
  const saving = createMut.isPending || updateMut.isPending;
  const noCourts = courts.length === 0;

  return (
    <div className="space-y-7">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
              <Wrench className="h-[18px] w-[18px]" />
            </span>
            <h1 className="font-display text-[1.6rem] font-bold text-foreground">
              Kort Bloklamaları
            </h1>
          </div>
          <p className="max-w-xl text-sm text-foregroundMuted">
            Texniki xidmət və ya bağlanma üçün kortları müəyyən vaxt aralığında
            bloklayın. Bloklanmış aralıqda oyunçular rezervasiya edə bilməz.
          </p>
        </div>
        <Button
          onClick={openNew}
          disabled={noCourts}
          className="gap-2 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Yeni Blok
        </Button>
      </header>

      {noCourts ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center shadow-card">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-warning/10 text-warning">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h3 className="font-semibold text-foreground">Kort tapılmadı</h3>
          <p className="max-w-sm text-sm text-foregroundMuted">
            Blok yaratmaq üçün öncə &quot;Kortlarım&quot; bölməsindən kort əlavə
            edin.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Aktiv və Keçmiş Bloklar
              </h2>
              {!isLoading && blocks.length > 0 ? (
                <Badge variant="neutral" className="tabular-nums">
                  {blocks.length}
                </Badge>
              ) : null}
            </div>
          </div>

          {showEmpty ? (
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/15">
                <Wrench className="h-7 w-7 text-accent" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-base font-bold text-foreground">
                  Heç bir blok yoxdur
                </h3>
                <p className="mx-auto max-w-sm text-sm text-foregroundMuted">
                  Texniki xidmət üçün kort bloklamaq istəsəniz yeni blok yaradın.
                </p>
              </div>
              <Button onClick={openNew} className="gap-2">
                <Plus className="h-4 w-4" />
                İlk Bloku Yarat
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Kort</TableHead>
                  <TableHead>Başlama</TableHead>
                  <TableHead>Bitmə</TableHead>
                  <TableHead>Səbəb</TableHead>
                  <TableHead className="pr-5 text-right">Əməliyyatlar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <>
                    <RowSkeleton />
                    <RowSkeleton />
                    <RowSkeleton />
                  </>
                ) : (
                  blocks.map((block) => (
                    <TableRow key={block.id} className="group">
                      <TableCell className="pl-5 font-semibold text-accent">
                        {block.court_name ?? courtName(block.court_id)}
                      </TableCell>
                      <TableCell className="text-sm text-foreground tabular-nums">
                        {formatDateTime(block.starts_at)}
                      </TableCell>
                      <TableCell className="text-sm text-foreground tabular-nums">
                        {formatDateTime(block.ends_at)}
                      </TableCell>
                      <TableCell className="text-sm text-foregroundMuted">
                        {block.reason ?? "—"}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <div className="flex justify-end gap-1.5 opacity-70 transition-opacity group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(block)}
                            className="h-8 w-8 text-foregroundMuted hover:text-foreground"
                            aria-label="Redaktə et"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setConfirmDelete(block)}
                            className="h-8 w-8 text-foregroundMuted hover:bg-danger/10 hover:text-danger"
                            aria-label="Sil"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* Add / Edit dialog */}
      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? "Bloku Redaktə Et" : "Yeni Kort Bloku"}
        description={
          editing
            ? "Bloklanmış kortu və vaxt aralığını yeniləyin."
            : "Texniki xidmət üçün kortu seçilmiş aralıqda bloklayın."
        }
      >
        <form onSubmit={handleSave} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="block-court">Kort</Label>
            <select
              id="block-court"
              value={courtId}
              onChange={(e) => setCourtId(e.target.value)}
              disabled={Boolean(editing)}
              className="flex h-10 w-full cursor-pointer rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60"
              required
            >
              <option value="">Kort seçin...</option>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="block-start">Başlama vaxtı</Label>
              <Input
                id="block-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block-end">Bitmə vaxtı</Label>
              <Input
                id="block-end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="block-reason">Səbəb (istəyə bağlı)</Label>
            <Input
              id="block-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Məs. Səth təmiri, işıqlandırma quraşdırılması"
              maxLength={160}
            />
          </div>

          <label className="flex cursor-pointer select-none items-center gap-3 rounded-xl border border-border bg-surfaceElevated/50 p-3">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span className="text-sm font-medium text-foreground">
              Məcburi blokla
              <span className="block text-[10px] font-normal text-foregroundMuted/80">
                Bu aralıqda mövcud rezervasiyalar olsa belə bloku tətbiq et.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-2 rounded-lg bg-info/[0.06] px-3 py-2 text-[11px] text-info">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            Bloklanmış aralıqda yeni rezervasiyalar qəbul edilməyəcək.
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFormOpen(false)}
            >
              Ləğv et
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? "Gözləyin..." : "Yadda Saxla"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => (open ? null : setConfirmDelete(null))}
        title="Blokun Silinməsi"
      >
        <div className="space-y-5 pt-2">
          <p className="text-sm leading-relaxed text-foregroundMuted">
            <span className="font-semibold text-foreground">
              {confirmDelete
                ? confirmDelete.court_name ?? courtName(confirmDelete.court_id)
                : ""}
            </span>{" "}
            kortu üçün olan bu bloku silməyə əminsiniz? Kort yenidən rezervasiyaya
            açılacaq.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(null)}
              disabled={deleteMut.isPending}
            >
              Ləğv et
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Silinir..." : "Bəli, silinsin"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
