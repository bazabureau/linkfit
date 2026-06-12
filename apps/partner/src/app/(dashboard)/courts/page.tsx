"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  Plus,
  Edit2,
  Trash2,
  Activity,
  DollarSign,
  Gamepad,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import {  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  usePartnerCourts,
  useCreatePartnerCourt,
  useUpdatePartnerCourt,
  useDeletePartnerCourt,
  useSportsOptions,
  type Court,
} from "@/lib/partner-queries";

function RowSkeleton(): React.JSX.Element {
  return (
    <TableRow>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-surfaceElevated" />
        </TableCell>
      ))}
    </TableRow>
  );
}

export default function CourtsPage(): React.JSX.Element {
  const toast = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [editingCourt, setEditingCourt] = useState<Court | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Court | null>(null);

  // Form Fields
  const [name, setName] = useState("");
  const [sportId, setSportId] = useState("");
  const [hourlyPrice, setHourlyPrice] = useState("");

  // Queries & Mutations
  const { data: courts = [], isLoading } = usePartnerCourts();
  const { data: sports = [] } = useSportsOptions();

  const createMut = useCreatePartnerCourt();
  const updateMut = useUpdatePartnerCourt();
  const deleteMut = useDeletePartnerCourt();

  const stats = useMemo(() => {
    const total = courts.length;
    const sportsSet = new Set(courts.map((c) => c.sport_slug));
    const avgPriceMinor = total > 0 ? courts.reduce((sum, c) => sum + c.hourly_price_minor, 0) / total : 0;
    return {
      total,
      sportsCount: sportsSet.size,
      avgPrice: (avgPriceMinor / 100).toFixed(2),
    };
  }, [courts]);

  const openNew = (): void => {
    setEditingCourt(null);
    setName("");
    setSportId(sports[0]?.id ?? "");
    setHourlyPrice("");
    setFormOpen(true);
  };

  const openEdit = (court: Court): void => {
    setEditingCourt(court);
    setName(court.name);
    setSportId(court.sport_id);
    setHourlyPrice((court.hourly_price_minor / 100).toString());
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || !sportId || !hourlyPrice) {
      toast.error("Form xətası", "Zəhmət olmasa bütün sahələri doldurun.");
      return;
    }

    const priceMinor = Math.round(parseFloat(hourlyPrice) * 100);
    if (isNaN(priceMinor) || priceMinor < 0) {
      toast.error("Format xətası", "Zəhmət olmasa düzgün qiymət daxil edin.");
      return;
    }

    try {
      if (editingCourt) {
        await updateMut.mutateAsync({
          id: editingCourt.id,
          data: {
            name,
            sport_id: sportId,
            hourly_price_minor: priceMinor,
          },
        });
        toast.success("Kort yeniləndi", `"${name}" uğurla yeniləndi.`);
      } else {
        await createMut.mutateAsync({
          name,
          sport_id: sportId,
          hourly_price_minor: priceMinor,
          currency: "AZN",
        });
        toast.success("Kort yaradıldı", `"${name}" uğurla əlavə edildi.`);
      }
      setFormOpen(false);
    } catch (err: unknown) {
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
      toast.success("Kort silindi", `"${target.name}" uğurla silindi.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Silinmədi", message || "Kortu silmək mümkün olmadı.");
    }
  };

  const showEmpty = !isLoading && courts.length === 0;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Kortlarım
          </h1>
          <p className="text-sm text-foregroundMuted">
            Məkanınızın kortlarını, onların növlərini və saatlıq icarə qiymətlərini idarə edin.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Kort Əlavə Et
        </Button>
      </header>

      {/* KPI Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-6 flex items-center gap-4 border border-border bg-surface">
          <div className="p-3 rounded-xl bg-accent/10 text-accent">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-foregroundMuted uppercase tracking-wider font-semibold">Cəmi Kortlar</p>
            <h3 className="text-xl font-bold text-foreground mt-0.5">{stats.total}</h3>
          </div>
        </Card>

        <Card className="p-6 flex items-center gap-4 border border-border bg-surface">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500">
            <Gamepad className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-foregroundMuted uppercase tracking-wider font-semibold">İdman Növləri</p>
            <h3 className="text-xl font-bold text-foreground mt-0.5">{stats.sportsCount}</h3>
          </div>
        </Card>

        <Card className="p-6 flex items-center gap-4 border border-border bg-surface">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
            <DollarSign className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-foregroundMuted uppercase tracking-wider font-semibold">Ortalama Qiymət</p>
            <h3 className="text-xl font-bold text-foreground mt-0.5">{stats.avgPrice} AZN/saat</h3>
          </div>
        </Card>
      </div>

      {/* Courts Table */}
      <Card className="border border-border bg-surface overflow-hidden">
        {showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10">
              <Activity className="h-6 w-6 text-accent" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Kort Tapılmadı</h3>
              <p className="text-sm text-foregroundMuted">
                Məkanınız üçün hələ heç bir kort əlavə etməmisiniz. Yeni kort yaradaraq başlayın!
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kort Adı</TableHead>
                <TableHead>İdman Növü</TableHead>
                <TableHead>Saatlıq Qiymət</TableHead>
                <TableHead>Yaradılma Tarixi</TableHead>
                <TableHead className="text-right">Əməliyyatlar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              )}
              {!isLoading &&
                courts.map((court) => (
                  <TableRow key={court.id}>
                    <TableCell className="font-semibold text-foreground">
                      {court.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral" className="uppercase tracking-wide font-mono">
                        {court.sport_slug}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-semibold text-foreground">
                      {(court.hourly_price_minor / 100).toFixed(2)} {court.currency}
                    </TableCell>
                    <TableCell className="text-foregroundMuted text-sm">
                      {new Date(court.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEdit(court)}
                          className="p-2"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setConfirmDelete(court)}
                          className="p-2 text-rose-500 hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Add / Edit Form Dialog */}
      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingCourt ? "Kortu Redaktə Et" : "Yeni Kort Əlavə Et"}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="court-name">Kortun Adı</Label>
            <Input
              id="court-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Məs. Kort 1 (Qapalı), Premium Kort"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="court-sport">İdman Növü</Label>
            <select
              id="court-sport"
              value={sportId}
              onChange={(e) => setSportId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              required
            >
              <option value="">İdman növünü seçin...</option>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.slug})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="court-price">Saatlıq Qiymət (AZN)</Label>
            <Input
              id="court-price"
              type="number"
              step="0.01"
              min="0"
              value={hourlyPrice}
              onChange={(e) => setHourlyPrice(e.target.value)}
              placeholder="Məs. 15.00, 20.00"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFormOpen(false)}
            >
              Ləğv et
            </Button>
            <Button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
            >
              {(createMut.isPending || updateMut.isPending) ? "Gözləyin..." : "Yadda Saxla"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => (open ? null : setConfirmDelete(null))}
        title="Kortun Silinməsi"
      >
        <div className="space-y-4">
          <p className="text-sm text-foregroundMuted">
            <span className="font-semibold text-foreground">&quot;{confirmDelete?.name}&quot;</span> kortunu silməyə əminsiniz? Bu əməliyyat geri qaytarıla bilməz və kortun gələcək rezervasiya imkanlarını ləğv edəcək.
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
