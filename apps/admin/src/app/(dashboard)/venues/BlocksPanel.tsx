"use client";

import * as React from "react";
import { Plus, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/date-format";
import {
  useCourtBlocks,
  useCreateCourtBlock,
  useDeleteCourtBlock,
  type Court,
  type CourtBlock,
} from "@/lib/admin-venues";
import {
  courtStatus,
  courtStatusDotClass,
  courtStatusLabel,
  courtStatusPillClass,
  Field,
  sportEmoji,
} from "./lib";
import { EmptyPanel, SectionCard, TableRowsSkeleton } from "./detail-ui";

function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: string }).message;
    if (message) return message;
  }
  return fallback;
}

function BlockRow({
  block,
  busy,
  onDelete,
}: {
  block: CourtBlock;
  busy: boolean;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surfaceElevated/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-warning/12 text-warning">
            <Wrench className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">
            {formatDateTime(block.starts_at)} → {formatDateTime(block.ends_at)}
          </span>
        </div>
        <div className="mt-1 pl-9 text-sm text-foregroundMuted">{block.reason || "Maintenance"}</div>
      </div>
      <Button variant="outline" size="sm" onClick={onDelete} disabled={busy} className="text-danger">
        <Trash2 className="h-4 w-4" />
        Sil
      </Button>
    </div>
  );
}

export function BlocksPanel({
  courts,
  selectedCourt,
  selectedCourtId,
  onSelectCourt,
}: {
  courts: Court[];
  selectedCourt: Court | undefined;
  selectedCourtId: string | undefined;
  onSelectCourt: (id: string) => void;
}): React.JSX.Element {
  const [startsAt, setStartsAt] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [reason, setReason] = React.useState("Maintenance");
  const [force, setForce] = React.useState(false);
  const toast = useToast();
  const blocksQuery = useCourtBlocks(selectedCourtId);
  const createBlock = useCreateCourtBlock(selectedCourtId ?? "");
  const deleteBlock = useDeleteCourtBlock(selectedCourtId ?? "");

  async function submitBlock(): Promise<void> {
    if (!selectedCourtId) return;
    if (!startsAt || !endsAt) {
      toast.error("Başlama və bitmə vaxtı lazımdır");
      return;
    }
    try {
      await createBlock.mutateAsync({
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        reason: reason.trim() || null,
        force,
      });
      setStartsAt("");
      setEndsAt("");
      setReason("Maintenance");
      setForce(false);
      toast.success("Maintenance bloku əlavə edildi");
    } catch (err) {
      toast.error("Blok əlavə edilmədi", describeError(err, "Vaxt aralığında booking ola bilər"));
    }
  }

  if (courts.length === 0) {
    return (
      <SectionCard title="Maintenance" bodyClassName="">
        <EmptyPanel
          icon={Wrench}
          title="Maintenance üçün court yoxdur"
          text="Əvvəlcə court əlavə edin."
        />
      </SectionCard>
    );
  }

  const blocks = blocksQuery.data ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      {/* Court selector */}
      <SectionCard title="Court seç" bodyClassName="space-y-2 p-3">
        {courts.map((court) => {
          const status = courtStatus(court);
          const active = selectedCourt?.id === court.id;
          return (
            <button
              key={court.id}
              type="button"
              onClick={() => onSelectCourt(court.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-3 text-left transition ${
                active
                  ? "border-accent/50 bg-accent/10"
                  : "border-border bg-surfaceElevated/50 hover:border-borderStrong"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="text-lg" aria-hidden>
                  {sportEmoji(court.sport_slug)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{court.name}</span>
                  <span className="block text-xs text-foregroundMuted">{court.sport_slug}</span>
                </span>
              </span>
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${courtStatusPillClass(status)}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${courtStatusDotClass(status)}`} />
                {courtStatusLabel(status)}
              </span>
            </button>
          );
        })}
      </SectionCard>

      {/* Block editor + list */}
      <SectionCard
        title={`${selectedCourt?.name ?? "Court"} maintenance`}
        description="Vaxt aralığını bloklayaraq həmin müddətdə booking-i dayandırın."
        bodyClassName="space-y-5 p-5"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Başlama">
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </Field>
          <Field label="Bitmə">
            <Input
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </Field>
          <Field label="Səbəb">
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
              className="h-4 w-4 rounded border-borderStrong accent-[var(--color-accent,#B7F233)]"
            />
            Booking varsa da force et
          </label>
        </div>
        <Button onClick={submitBlock} disabled={createBlock.isPending || !selectedCourtId}>
          <Plus className="h-4 w-4" />
          Blok əlavə et
        </Button>

        <div className="border-t border-border pt-4">
          {blocksQuery.isLoading ? (
            <TableRowsSkeleton rows={2} />
          ) : blocks.length === 0 ? (
            <p className="text-sm text-foregroundMuted">
              Bu court üçün maintenance bloku yoxdur.
            </p>
          ) : (
            <div className="space-y-2">
              {blocks.map((block) => (
                <BlockRow
                  key={block.id}
                  block={block}
                  busy={deleteBlock.isPending}
                  onDelete={async () => {
                    try {
                      await deleteBlock.mutateAsync(block.id);
                      toast.success("Blok silindi");
                    } catch (err) {
                      toast.error("Blok silinmədi", describeError(err, "Əməliyyat alınmadı"));
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
