"use client";

import * as React from "react";
import { Ban, CalendarClock, Coins } from "lucide-react";
import { formatDate, formatTime } from "@/lib/date-format";
import type { Booking } from "@/lib/admin-queries";
import {
  bookerEmail,
  bookerName,
  bookingStatusDotClass,
  bookingStatusLabel,
  bookingStatusPillClass,
  formatDuration,
  initials,
  isBookingClosed,
  money,
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

export function VenueBookingsPanel({
  bookings,
  loading,
  onCancel,
  onMarkPaid,
}: {
  bookings: Booking[];
  loading: boolean;
  onCancel: (booking: Booking) => void;
  onMarkPaid: (booking: Booking) => void;
}): React.JSX.Element {
  return (
    <SectionCard
      title="Rezervasiyalar"
      description="Bu məkana aid son 100 rezervasiya."
      bodyClassName="p-0"
    >
      {loading ? (
        <TableRowsSkeleton />
      ) : bookings.length === 0 ? (
        <EmptyPanel
          icon={CalendarClock}
          title="Rezervasiya yoxdur"
          text="Bu məkan üçün booking tapılmadı."
        />
      ) : (
        <DenseTable minWidth={820}>
          <thead>
            <tr>
              <th className={`${TABLE_HEAD_CLASS} rounded-tl-2xl`}>Müştəri</th>
              <th className={TABLE_HEAD_CLASS}>Kort</th>
              <th className={TABLE_HEAD_CLASS}>Vaxt</th>
              <th className={`${TABLE_HEAD_CLASS} text-right`}>Qiymət</th>
              <th className={TABLE_HEAD_CLASS}>Status</th>
              <th className={`${TABLE_HEAD_CLASS} rounded-tr-2xl text-right`}>Əməliyyat</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking, index) => {
              const canMarkPaid = ["pending_payment", "partially_paid"].includes(booking.status);
              const canCancel = !isBookingClosed(booking.status);
              return (
                <tr key={booking.id} className={rowClass(index)}>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-[190px] items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-accent">
                        {initials(bookerName(booking))}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">
                          {bookerName(booking)}
                        </div>
                        <div className="truncate text-xs text-foregroundMuted">
                          {bookerEmail(booking)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle font-medium text-foreground">
                    {booking.court_name}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="min-w-[120px]">
                      <div className="font-medium text-foreground">
                        {formatDate(booking.starts_at)}
                      </div>
                      <div className="text-xs text-foregroundMuted">
                        {formatTime(booking.starts_at)} · {formatDuration(booking.duration_minutes)}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <span className="font-display text-sm font-bold tabular-nums text-foreground">
                      {money(booking.total_minor, booking.currency)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${bookingStatusPillClass(booking.status)}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${bookingStatusDotClass(booking.status)}`}
                      />
                      {bookingStatusLabel(booking.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      {canMarkPaid ? (
                        <IconAction title="Ödənildi et" onClick={() => onMarkPaid(booking)}>
                          <Coins className="h-4 w-4" />
                        </IconAction>
                      ) : null}
                      {canCancel ? (
                        <IconAction title="Ləğv et" danger onClick={() => onCancel(booking)}>
                          <Ban className="h-4 w-4" />
                        </IconAction>
                      ) : null}
                      {!canMarkPaid && !canCancel ? (
                        <span className="text-xs text-foregroundMuted">—</span>
                      ) : null}
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
