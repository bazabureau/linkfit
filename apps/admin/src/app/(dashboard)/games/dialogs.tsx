"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { formatDateTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import { sportIcon, type AdminGame } from "@/lib/admin-games";
import { Field, sportLabel } from "./lib";

// ─── Cancel ───────────────────────────────────────────────────────────────────

export function CancelGameDialog({
  game,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  game: AdminGame | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason?: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Oyunu ləğv et?")}
      description={t("Bütün təsdiqli iştirakçılar bildiriş alacaq. İstəsəniz səbəb qeyd edin.")}
      contentClassName="max-w-lg"
    >
      <div className="space-y-4">
        {game ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surfaceElevated px-3 py-2.5 text-sm">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-lg">
              {sportIcon(game.sport_slug)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold text-foreground">
                {game.host_display_name} · {t(sportLabel(game.sport_slug))}
              </div>
              <div className="truncate text-xs text-foregroundMuted">
                {formatDateTime(game.starts_at)}
              </div>
            </div>
          </div>
        ) : null}
        <Field label={t("Səbəb")} hint={t("Məsələn: məkan texniki səbəbə görə bağlıdır")}>
          <Textarea
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("Səbəb qeyd et")}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Geri")}
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => onConfirm(reason.trim() || undefined)}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Ləğv et")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function DeleteGameDialog({
  game,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  game: AdminGame | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Oyunu sil?")}
      description={t("Oyun default siyahılardan gizlənəcək, audit və database qeydi saxlanacaq.")}
      contentClassName="max-w-lg"
    >
      <div className="space-y-4">
        {game ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surfaceElevated px-3 py-2.5 text-sm">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-lg">
              {sportIcon(game.sport_slug)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold text-foreground">
                {game.host_display_name} · {t(sportLabel(game.sport_slug))}
              </div>
              <div className="truncate text-xs text-foregroundMuted">
                {formatDateTime(game.starts_at)}
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Geri")}
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Sil")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
