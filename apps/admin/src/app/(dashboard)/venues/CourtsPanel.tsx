"use client";

import * as React from "react";
import Image from "next/image";
import { Building2, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Court } from "@/lib/admin-venues";
import {
  courtStatus,
  courtStatusDotClass,
  courtStatusLabel,
  courtStatusPillClass,
  money,
  sportEmoji,
} from "./lib";
import {
  DenseTable,
  EmptyPanel,
  IconAction,
  SectionCard,
  TABLE_HEAD_CLASS,
  TableRowsSkeleton,
  rowClass,
} from "./detail-ui";

export function CourtsPanel({
  courts,
  loading,
  sportsReady,
  onAdd,
  onEdit,
  onDelete,
  onManageBlocks,
}: {
  courts: Court[];
  loading: boolean;
  sportsReady: boolean;
  onAdd: () => void;
  onEdit: (court: Court) => void;
  onDelete: (court: Court) => void;
  onManageBlocks: (court: Court) => void;
}): React.JSX.Element {
  return (
    <SectionCard
      title="Kort idarəsi"
      description="Kort əlavə et, qiymət/status dəyiş, şəkil və maintenance idarə et."
      bodyClassName="p-0"
      action={
        <Button onClick={onAdd} disabled={!sportsReady} size="sm">
          <Plus className="h-4 w-4" />
          Kort əlavə et
        </Button>
      }
    >
      {loading ? (
        <TableRowsSkeleton />
      ) : courts.length === 0 ? (
        <EmptyPanel
          icon={Building2}
          title="Kort yoxdur"
          text="Booking qəbul etmək üçün ən azı bir padel və ya tenis kortu əlavə edin."
          action={
            <Button onClick={onAdd} disabled={!sportsReady} size="sm" className="mt-1">
              <Plus className="h-4 w-4" />
              Kort əlavə et
            </Button>
          }
        />
      ) : (
        <DenseTable minWidth={760}>
          <thead>
            <tr>
              <th className={`${TABLE_HEAD_CLASS} rounded-tl-2xl`}>Kort</th>
              <th className={TABLE_HEAD_CLASS}>İdman</th>
              <th className={TABLE_HEAD_CLASS}>Status</th>
              <th className={`${TABLE_HEAD_CLASS} text-right`}>Saatlıq qiymət</th>
              <th className={`${TABLE_HEAD_CLASS} rounded-tr-2xl text-right`}>Əməliyyat</th>
            </tr>
          </thead>
          <tbody>
            {courts.map((court, index) => {
              const status = courtStatus(court);
              return (
                <tr key={court.id} className={rowClass(index)}>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-[200px] items-center gap-3">
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-border bg-surfaceElevated">
                        {court.photo_url ? (
                          <Image
                            src={court.photo_url}
                            alt={court.name}
                            fill
                            sizes="44px"
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-lg" aria-hidden>
                            {sportEmoji(court.sport_slug)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">{court.name}</div>
                        <div className="truncate text-[10px] font-medium   text-muted">
                          {court.id.slice(0, 8)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-surfaceElevated px-2.5 py-1 text-xs font-medium text-foregroundMuted ring-1 ring-inset ring-border">
                      <span aria-hidden>{sportEmoji(court.sport_slug)}</span>
                      {court.sport_name ?? court.sport_slug}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${courtStatusPillClass(status)}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${courtStatusDotClass(status)}`} />
                      {courtStatusLabel(status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <span className="font-display text-sm font-bold tabular-nums text-foreground">
                      {money(court.hourly_price_minor, court.currency)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      <IconAction title="Redaktə et" onClick={() => onEdit(court)}>
                        <Pencil className="h-4 w-4" />
                      </IconAction>
                      <IconAction title="Maintenance" onClick={() => onManageBlocks(court)}>
                        <Wrench className="h-4 w-4" />
                      </IconAction>
                      <IconAction title="Sil" danger onClick={() => onDelete(court)}>
                        <Trash2 className="h-4 w-4" />
                      </IconAction>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DenseTable>
      )}
    </SectionCard>
  );
}
