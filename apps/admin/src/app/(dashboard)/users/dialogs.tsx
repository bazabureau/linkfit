"use client";

import * as React from "react";
import { Ban, Crown, Medal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import type { User } from "@/lib/admin-queries";
import { Avatar, Field } from "./lib";

function UserChip({ user }: { user: User }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surfaceElevated px-3 py-2.5">
      <Avatar name={user.display_name} vip={user.is_vip} size="sm" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">
          {user.display_name || t("Adsız istifadəçi")}
        </div>
        <div className="truncate text-xs text-foregroundMuted">{user.email}</div>
      </div>
    </div>
  );
}

// ─── Soft-delete confirm ──────────────────────────────────────────────────────

export function DeleteDialog({
  user,
  onOpenChange,
  onConfirm,
}: {
  user: User | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-danger/10 text-danger">
            <Trash2 className="h-5 w-5" />
          </div>
          <DialogTitle>{t("İstifadəçini sil?")}</DialogTitle>
          <DialogDescription>
            {t("Hesab soft-delete olunacaq. Sonradan bərpa edilə bilər.")}
          </DialogDescription>
        </DialogHeader>
        {user ? <UserChip user={user} /> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Ləğv et")}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            <Trash2 className="h-4 w-4" />
            {t("Sil")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Suspend (reason required) ────────────────────────────────────────────────

export function SuspendDialog({
  user,
  reason,
  onReasonChange,
  onOpenChange,
  onConfirm,
}: {
  user: User | null;
  reason: string;
  onReasonChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-danger/10 text-danger">
            <Ban className="h-5 w-5" />
          </div>
          <DialogTitle>{t("İstifadəçini blokla")}</DialogTitle>
          <DialogDescription>
            {t("Blok səbəbi audit log-da saxlanacaq və admin komandası üçün görünəcək.")}
          </DialogDescription>
        </DialogHeader>
        {user ? <UserChip user={user} /> : null}
        <Field label={t("Səbəb")}>
          <Textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={5}
            placeholder={t("Məsələn: qayda pozuntusu, spam, ödəniş problemi...")}
          />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Ləğv et")}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            <Ban className="h-4 w-4" />
            {t("Blokla")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── VIP badge ────────────────────────────────────────────────────────────────

export function VipDialog({
  user,
  label,
  expiresAt,
  onLabelChange,
  onExpiresAtChange,
  onOpenChange,
  onConfirm,
}: {
  user: User | null;
  label: string;
  expiresAt: string;
  onLabelChange: (value: string) => void;
  onExpiresAtChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-warning/12 text-warning">
            <Medal className="h-5 w-5" />
          </div>
          <DialogTitle>{t("VIP badge ver")}</DialogTitle>
          <DialogDescription>
            {t("Badge istifadəçi profilində və admin listində görünəcək.")}
          </DialogDescription>
        </DialogHeader>
        {user ? <UserChip user={user} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Badge adı")}>
            <Input
              value={label}
              maxLength={40}
              onChange={(event) => onLabelChange(event.target.value)}
              placeholder="VIP"
            />
          </Field>
          <Field label={t("Bitmə tarixi")} hint={t("Boş = müddətsiz")}>
            <Input
              type="date"
              value={expiresAt}
              onChange={(event) => onExpiresAtChange(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Ləğv et")}
          </Button>
          <Button onClick={onConfirm}>
            <Medal className="h-4 w-4" />
            {t("Yadda saxla")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MembershipDialog({
  user,
  tier,
  months,
  onTierChange,
  onMonthsChange,
  onOpenChange,
  onConfirm,
}: {
  user: User | null;
  tier: "free" | "premium";
  months: string;
  onTierChange: (value: "free" | "premium") => void;
  onMonthsChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const isPaid = tier !== "free";
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-accent/12 text-accent">
            <Crown className="h-5 w-5" />
          </div>
          <DialogTitle>{t("Üzvlük (Premium)")}</DialogTitle>
          <DialogDescription>
            {t("İstifadəçinin abunə səviyyəsini təyin et. Premium = limitsiz + qabaqcıl statistika.")}
          </DialogDescription>
        </DialogHeader>
        {user ? <UserChip user={user} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Səviyyə")}>
            <select
              value={tier}
              onChange={(event) => onTierChange(event.target.value as "free" | "premium")}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none"
            >
              <option value="free">{t("Free")}</option>
              <option value="premium">Premium</option>
            </select>
          </Field>
          {isPaid ? (
            <Field label={t("Müddət (ay)")}>
              <Input type="number" min={1} max={36} value={months} onChange={(event) => onMonthsChange(event.target.value)} />
            </Field>
          ) : (
            <div />
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Ləğv et")}
          </Button>
          <Button onClick={onConfirm}>
            <Crown className="h-4 w-4" />
            {t("Yadda saxla")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
