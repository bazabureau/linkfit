"use client";

import * as React from "react";
import { Loader2, Pencil, Plus, RefreshCw, Tag, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useCreatePromoCode,
  useDeletePromoCode,
  usePromoCodes,
  useUpdatePromoCode,
  type PromoCode,
  type PromoDiscountType,
  type PromoPayload,
  type PromoStatus,
} from "@/lib/admin-promos";

const selectCls =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none";

function statusVariant(status: PromoStatus): "success" | "neutral" | "danger" {
  if (status === "active") return "success";
  if (status === "archived") return "danger";
  return "neutral";
}

function discountLabel(promo: PromoCode): string {
  if (promo.discount_type === "percent") return `${promo.discount_value}%`;
  return `${(promo.discount_value / 100).toFixed(0)} ${promo.currency === "AZN" || !promo.currency ? "₼" : promo.currency}`;
}

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("az-AZ", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

export default function PromosPage(): React.JSX.Element {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<PromoStatus | undefined>(undefined);
  const [dialog, setDialog] = React.useState<{ open: boolean; promo?: PromoCode }>({ open: false });
  const { data, isLoading, isError, refetch } = usePromoCodes({ q: q || undefined, status });
  const del = useDeletePromoCode();
  const toast = useToast();
  const promos = data?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("İdarəetmə")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <Tag className="h-6 w-6 text-accent" />
            {t("Promo codes")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">{t("Discount codes redeemable at checkout.")}</p>
        </div>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4" />
          {t("New promo code")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-xs" />
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={status ?? ""}
          onChange={(e) => setStatus((e.target.value || undefined) as PromoStatus | undefined)}
        >
          <option value="">{t("All statuses")}</option>
          {(["active", "inactive", "archived"] as PromoStatus[]).map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Code")}</TableHead>
              <TableHead>{t("Discount")}</TableHead>
              <TableHead>{t("Redemptions")}</TableHead>
              <TableHead>{t("Window")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="text-sm text-danger">{t("Yenidən yoxlayın")}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => void refetch()}>
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : promos.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("No promo codes")}</TableCell></TableRow>
            ) : (
              promos.map((promo) => (
                <TableRow key={promo.id}>
                  <TableCell>
                    <p className="font-mono font-semibold text-foreground">{promo.code}</p>
                    {promo.title && <p className="text-xs text-foregroundMuted">{promo.title}</p>}
                  </TableCell>
                  <TableCell className="font-semibold text-foreground">{discountLabel(promo)}</TableCell>
                  <TableCell className="text-foregroundMuted">
                    {promo.redemptions_count}
                    {promo.max_redemptions != null ? ` / ${promo.max_redemptions}` : ""}
                  </TableCell>
                  <TableCell className="text-foregroundMuted">{dt(promo.starts_at)} – {dt(promo.ends_at)}</TableCell>
                  <TableCell><Badge variant={statusVariant(promo.status)}>{t(promo.status)}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="sm" aria-label={t("Redaktə et")} onClick={() => setDialog({ open: true, promo })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {promo.status !== "archived" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Arxivləşdir")}
                          onClick={() =>
                            del.mutate(promo.id, {
                              onSuccess: () => toast.success(t("Promo code archived")),
                              onError: () => toast.error(t("Alınmadı")),
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {dialog.open && <PromoDialog promo={dialog.promo} onClose={() => setDialog({ open: false })} />}
    </div>
  );
}

function PromoDialog({ promo, onClose }: { promo?: PromoCode; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const create = useCreatePromoCode();
  const update = useUpdatePromoCode();
  const editing = Boolean(promo);
  const pending = create.isPending || update.isPending;

  const [form, setForm] = React.useState({
    code: promo?.code ?? "",
    title: promo?.title ?? "",
    description: promo?.description ?? "",
    discount_type: (promo?.discount_type ?? "percent") as PromoDiscountType,
    // For percent: raw percent. For fixed: major currency units.
    discount_value:
      promo == null
        ? ""
        : promo.discount_type === "percent"
          ? String(promo.discount_value)
          : String(promo.discount_value / 100),
    min_amount: promo?.min_amount_minor ? String(promo.min_amount_minor / 100) : "",
    max_redemptions: promo?.max_redemptions != null ? String(promo.max_redemptions) : "",
    per_user_limit: String(promo?.per_user_limit ?? 1),
    starts_at: promo?.starts_at ? promo.starts_at.slice(0, 10) : "",
    ends_at: promo?.ends_at ? promo.ends_at.slice(0, 10) : "",
    status: (promo?.status ?? "active") as PromoStatus,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    const code = form.code.trim();
    if (code.length < 2) {
      toast.error(t("Code is required"));
      return;
    }
    const rawValue = Number(form.discount_value);
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      toast.error(t("Enter a valid discount value"));
      return;
    }
    if (form.discount_type === "percent" && rawValue > 100) {
      toast.error(t("Percent discount cannot exceed 100"));
      return;
    }
    const discount_value =
      form.discount_type === "percent" ? Math.round(rawValue) : Math.round(rawValue * 100);

    const payload: PromoPayload = {
      code,
      title: form.title.trim() || null,
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value,
      min_amount_minor: form.min_amount ? Math.round(Number(form.min_amount) * 100) : 0,
      max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
      per_user_limit: Number(form.per_user_limit) || 1,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
      status: form.status,
    };

    const opts = {
      onSuccess: () => {
        toast.success(editing ? t("Promo code updated") : t("Promo code created"));
        onClose();
      },
      onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
    };
    if (editing && promo) update.mutate({ id: promo.id, data: payload }, opts);
    else create.mutate(payload, opts);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit promo code") : t("New promo code")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3.5 overflow-y-auto pr-1">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Code")}</span>
            <Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="SUMMER25" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Title")}</span>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Discount type")}</span>
              <select className={selectCls} value={form.discount_type} onChange={(e) => set("discount_type", e.target.value as PromoDiscountType)}>
                <option value="percent">{t("Percent")}</option>
                <option value="fixed">{t("Fixed amount")}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">
                {form.discount_type === "percent" ? t("Discount (%)") : t("Discount (₼)")}
              </span>
              <Input type="number" min={0} value={form.discount_value} onChange={(e) => set("discount_value", e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Min amount (₼)")}</span>
              <Input type="number" min={0} value={form.min_amount} onChange={(e) => set("min_amount", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Max redemptions")}</span>
              <Input type="number" min={1} value={form.max_redemptions} onChange={(e) => set("max_redemptions", e.target.value)} placeholder={t("Unlimited")} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Per user")}</span>
              <Input type="number" min={1} value={form.per_user_limit} onChange={(e) => set("per_user_limit", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Starts")}</span>
              <Input type="date" value={form.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Ends")}</span>
              <Input type="date" value={form.ends_at} onChange={(e) => set("ends_at", e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Status")}</span>
            <select className={selectCls} value={form.status} onChange={(e) => set("status", e.target.value as PromoStatus)}>
              <option value="active">{t("active")}</option>
              <option value="inactive">{t("inactive")}</option>
              <option value="archived">{t("archived")}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Description")}</span>
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>{t("Ləğv")}</Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? t("Yadda saxla") : t("Yarat")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
