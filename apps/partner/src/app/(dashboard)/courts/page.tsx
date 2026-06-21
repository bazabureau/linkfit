"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  LayoutGrid,
  Coins,
  Wallet,
  Trophy,
  MessageSquare,
  Hourglass,
  ArrowUpRight,
  AlertCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
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
  useCreatePartnerCourt,
  useUpdatePartnerCourt,
  useDeletePartnerCourt,
  useSportsOptions,
  deriveVenueAggregates,
  type Court,
} from "@/lib/partner-queries";
import { formatDate } from "@/lib/date-format";

const SPORT_LABEL: Record<string, string> = {
  padel: "Padel",
  tennis: "Tennis",
};

function moneyFromMinor(minor: number): string {
  return (minor / 100).toLocaleString("az-AZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── KPI strip card ───────────────────────────────────────────────────────────
function Kpi({
  label,
  value,
  unit,
  icon: Icon,
  tone = "accent",
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: LucideIcon;
  tone?: "accent" | "info" | "emerald";
}): React.JSX.Element {
  const toneMap = {
    accent: "bg-accent/10 text-accent ring-accent/20",
    info: "bg-info/10 text-info ring-info/20",
    emerald: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  } as const;
  return (
    <Card className="relative overflow-hidden p-5 shadow-card">
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-accent/[0.06] to-transparent blur-2xl" />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold text-foregroundMuted">
          {label}
        </p>
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ${toneMap[tone]}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-[1.7rem] font-bold leading-none  text-foreground tabular-nums">
          {value}
        </span>
        {unit ? (
          <span className="text-xs font-medium text-foregroundMuted">{unit}</span>
        ) : null}
      </div>
    </Card>
  );
}

function RowSkeleton(): React.JSX.Element {
  const widths = ["w-32", "w-16", "w-20", "w-24", "w-20"];
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

const QUICK_LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/revenue", label: "Gəlir Hesabatı", icon: Wallet },
  { href: "/tournaments", label: "Turnirlər", icon: Trophy },
  { href: "/reviews", label: "Rəylər", icon: MessageSquare },
  { href: "/waitlist", label: "Gözləmə Siyahısı", icon: Hourglass },
];

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
  const { data: courtsData, isLoading, isError, refetch, isFetching } =
    usePartnerCourts();
  const courts = useMemo(() => courtsData ?? [], [courtsData]);
  const { data: allSports = [] } = useSportsOptions();
  // The partner courts endpoint only returns/accepts padel & tennis courts,
  // so restrict the selectable sports to match (otherwise a created court
  // would silently disappear from the list).
  const sports = useMemo(
    () => allSports.filter((s) => s.slug === "padel" || s.slug === "tennis"),
    [allSports],
  );

  const createMut = useCreatePartnerCourt();
  const updateMut = useUpdatePartnerCourt();
  const deleteMut = useDeletePartnerCourt();

  const stats = useMemo(() => {
    const total = courts.length;
    const sportsSet = new Set(courts.map((c) => c.sport_slug));
    const avgPriceMinor =
      total > 0
        ? courts.reduce((sum, c) => sum + c.hourly_price_minor, 0) / total
        : 0;
    // Venue aggregates that mirror the catalog `from_price_minor` field.
    const agg = deriveVenueAggregates(courts);
    return {
      total,
      sportsCount: sportsSet.size,
      avgPrice: moneyFromMinor(avgPriceMinor),
      fromPrice:
        agg.from_price_minor != null ? moneyFromMinor(agg.from_price_minor) : "—",
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

  const showEmpty = !isLoading && !isError && courts.length === 0;
  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-7">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
              <Building2 className="h-[18px] w-[18px]" />
            </span>
            <h1 className="font-display text-[1.6rem] font-bold text-foreground">
              Kortlarım
            </h1>
          </div>
          <p className="max-w-xl text-sm text-foregroundMuted">
            Məkanınızın kortlarını, onların növlərini və saatlıq icarə
            qiymətlərini idarə edin.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" />
          Kort Əlavə Et
        </Button>
      </header>

      {/* ── Quick links (modules not in the global sidebar) ── */}
      <div className="flex flex-wrap gap-2">
        {QUICK_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="group inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foregroundMuted transition-colors hover:border-borderStrong hover:bg-surfaceElevated hover:text-foreground"
            >
              <Icon className="h-3.5 w-3.5 text-accent" />
              {link.label}
              <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
            </Link>
          );
        })}
      </div>

      {/* ── KPI strip ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Cəmi Kortlar" value={stats.total} icon={LayoutGrid} tone="accent" />
        <Kpi
          label="İdman Növləri"
          value={stats.sportsCount}
          icon={Building2}
          tone="info"
        />
        <Kpi
          label="Başlanğıc Qiymət"
          value={stats.fromPrice}
          unit="AZN / saat"
          icon={Coins}
          tone="accent"
        />
        <Kpi
          label="Ortalama Qiymət"
          value={stats.avgPrice}
          unit="AZN / saat"
          icon={Coins}
          tone="emerald"
        />
      </div>

      {/* ── Courts table ── */}
      <Card className="overflow-hidden p-0 shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Kort Siyahısı</h2>
            {!isLoading && courts.length > 0 ? (
              <Badge variant="neutral" className="tabular-nums">
                {courts.length}
              </Badge>
            ) : null}
          </div>
        </div>

        {isError ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10 ring-1 ring-danger/15">
              <AlertCircle className="h-7 w-7 text-danger" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-base font-bold text-foreground">
                Kortlar yüklənmədi
              </h3>
              <p className="mx-auto max-w-sm text-sm text-foregroundMuted">
                Kort siyahısını almaq mümkün olmadı. Yenidən cəhd edin.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              <RotateCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Yenidən cəhd et
            </Button>
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/15">
              <Building2 className="h-7 w-7 text-accent" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-base font-bold text-foreground">
                Hələ kort yoxdur
              </h3>
              <p className="mx-auto max-w-sm text-sm text-foregroundMuted">
                Məkanınız üçün hələ heç bir kort əlavə etməmisiniz. Rezervasiya
                qəbul etmək üçün ilk kortunuzu yaradın.
              </p>
            </div>
            <Button onClick={openNew} className="gap-2">
              <Plus className="h-4 w-4" />
              İlk Kortu Yarat
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Kort Adı</TableHead>
                <TableHead>İdman Növü</TableHead>
                <TableHead className="text-right">Saatlıq Qiymət</TableHead>
                <TableHead>Yaradılma Tarixi</TableHead>
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
                courts.map((court) => (
                  <TableRow key={court.id} className="group">
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surfaceElevated text-[13px] font-bold text-accent ring-1 ring-border">
                          {court.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="font-semibold text-foreground">
                          {court.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={court.sport_slug === "padel" ? "success" : "info"}
                        className="font-semibold "
                      >
                        {SPORT_LABEL[court.sport_slug] ?? court.sport_slug}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-display text-sm font-bold text-foreground tabular-nums">
                        {moneyFromMinor(court.hourly_price_minor)}
                      </span>
                      <span className="ml-1 text-xs text-foregroundMuted">
                        {court.currency}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-foregroundMuted tabular-nums">
                      {formatDate(court.created_at)}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <div className="flex justify-end gap-1.5 opacity-70 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(court)}
                          className="h-8 w-8 text-foregroundMuted hover:text-foreground"
                          aria-label="Redaktə et"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setConfirmDelete(court)}
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

      {/* ── Add / Edit dialog ── */}
      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingCourt ? "Kortu Redaktə Et" : "Yeni Kort Əlavə Et"}
        description={
          editingCourt
            ? "Kortun adını, növünü və qiymətini yeniləyin."
            : "Məkanınıza yeni kort əlavə edin və saatlıq qiymət təyin edin."
        }
      >
        <form onSubmit={handleSave} className="space-y-4 pt-2">
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
              className="flex h-10 w-full cursor-pointer rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
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
            <Label htmlFor="court-price">Saatlıq Qiymət</Label>
            <div className="relative">
              <Input
                id="court-price"
                type="number"
                step="0.01"
                min="0"
                value={hourlyPrice}
                onChange={(e) => setHourlyPrice(e.target.value)}
                placeholder="Məs. 15.00, 20.00"
                className="pr-14"
                required
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-foregroundMuted">
                AZN
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
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

      {/* ── Delete confirmation ── */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => (open ? null : setConfirmDelete(null))}
        title="Kortun Silinməsi"
      >
        <div className="space-y-5 pt-2">
          <div className="flex gap-3 rounded-xl border border-danger/25 bg-danger/[0.06] p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
              <Trash2 className="h-[18px] w-[18px]" />
            </span>
            <p className="text-sm leading-relaxed text-foregroundMuted">
              <span className="font-semibold text-foreground">
                &quot;{confirmDelete?.name}&quot;
              </span>{" "}
              kortunu silməyə əminsiniz? Bu əməliyyat geri qaytarıla bilməz və
              kortun gələcək rezervasiya imkanlarını ləğv edəcək.
            </p>
          </div>
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
