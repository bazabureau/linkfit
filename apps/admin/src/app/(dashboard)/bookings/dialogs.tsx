"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import {
  useCreateBooking,
  useQuoteBooking,
  useUpdateBooking,
  type Booking,
  type BookingStatus,
  type CreateBookingPayload,
} from "@/lib/admin-queries";
import { useVenueCourts, type Court } from "@/lib/admin-venues";
import {
  BOOKING_STATUSES,
  Field,
  PAYMENT_METHODS,
  REFUND_STATUSES,
  SelectBox,
  customerName,
  dateTimeLocalToIso,
  money,
  toDateTimeLocal,
} from "./lib";

// ─── Edit ─────────────────────────────────────────────────────────────────────

export function BookingEditDialog({
  booking,
  open,
  onOpenChange,
  onDone,
}: {
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();
  const updateBooking = useUpdateBooking();
  const [startsAt, setStartsAt] = React.useState("");
  const [duration, setDuration] = React.useState(90);
  const [status, setStatus] = React.useState<BookingStatus>("pending_payment");
  const [paymentMethod, setPaymentMethod] = React.useState("manual");
  const [customerNameValue, setCustomerNameValue] = React.useState("");
  const [customerEmailValue, setCustomerEmailValue] = React.useState("");
  const [paymentNote, setPaymentNote] = React.useState("");
  const [internalNote, setInternalNote] = React.useState("");

  React.useEffect(() => {
    if (!booking) return;
    setStartsAt(toDateTimeLocal(booking.starts_at));
    setDuration(booking.duration_minutes);
    setStatus(booking.status);
    setPaymentMethod(booking.payment_method ?? "manual");
    setCustomerNameValue(booking.customer_name ?? "");
    setCustomerEmailValue(booking.customer_email ?? "");
    setPaymentNote(booking.payment_note ?? "");
    setInternalNote(booking.internal_note ?? "");
  }, [booking]);

  async function submit() {
    if (!booking || !startsAt) return;
    try {
      await updateBooking.mutateAsync({
        id: booking.id,
        data: {
          starts_at: dateTimeLocalToIso(startsAt),
          duration_minutes: duration,
          status,
          payment_method: paymentMethod as Booking["payment_method"],
          customer_name: customerNameValue || null,
          customer_email: customerEmailValue || null,
          payment_note: paymentNote || null,
          internal_note: internalNote || null,
        },
      });
      toast.success(t("Rezervasiya yeniləndi"));
      onDone();
    } catch (error) {
      toast.error(
        t("Yeniləmə alınmadı"),
        error instanceof Error ? error.message : t("Yenidən yoxlayın"),
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Rezervasiyanı redaktə et")}
      contentClassName="max-w-2xl"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Başlama vaxtı")}>
          <Input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </Field>
        <Field label={t("Müddət")} hint={t("Dəqiqə")}>
          <Input
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
        <Field label={t("Status")}>
          <SelectBox value={status} onChange={(value) => setStatus(value as BookingStatus)}>
            {BOOKING_STATUSES.map((item) => (
              <option key={item.value} value={item.value}>
                {t(item.label)}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Ödəniş metodu")}>
          <SelectBox value={paymentMethod} onChange={setPaymentMethod}>
            {PAYMENT_METHODS.map((item) => (
              <option key={item.value} value={item.value}>
                {t(item.label)}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Müştəri adı")}>
          <Input
            value={customerNameValue}
            onChange={(event) => setCustomerNameValue(event.target.value)}
          />
        </Field>
        <Field label={t("Müştəri email")}>
          <Input
            type="email"
            value={customerEmailValue}
            onChange={(event) => setCustomerEmailValue(event.target.value)}
          />
        </Field>
        <Field label={t("Ödəniş qeydi")}>
          <Textarea
            value={paymentNote}
            onChange={(event) => setPaymentNote(event.target.value)}
          />
        </Field>
        <Field label={t("Daxili qeyd")}>
          <Textarea
            value={internalNote}
            onChange={(event) => setInternalNote(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t("Bağla")}
        </Button>
        <Button onClick={() => void submit()} disabled={updateBooking.isPending}>
          {updateBooking.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("Yadda saxla")}
        </Button>
      </div>
    </Dialog>
  );
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export function CancelBookingDialog({
  booking,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  booking: Booking | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    reason?: string | null;
    refund_status?: Booking["refund_status"];
    refund_amount_minor?: number | null;
    refund_note?: string | null;
  }) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [reason, setReason] = React.useState("");
  const [refundStatus, setRefundStatus] =
    React.useState<NonNullable<Booking["refund_status"]>>("not_required");
  const [refundAmount, setRefundAmount] = React.useState("");
  const [refundNote, setRefundNote] = React.useState("");

  React.useEffect(() => {
    setReason("");
    setRefundStatus("not_required");
    setRefundAmount("");
    setRefundNote("");
  }, [booking]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Rezervasiyanı ləğv et")}
      contentClassName="max-w-xl"
    >
      <div className="space-y-4">
        {booking ? (
          <div className="rounded-xl border border-border bg-surfaceElevated px-3 py-2.5 text-sm text-foregroundMuted">
            <span className="font-semibold text-foreground">{customerName(booking)}</span> ·{" "}
            {booking.venue_name} · {formatDateTime(booking.starts_at)}
          </div>
        ) : null}
        <Field label={t("Ləğv səbəbi")}>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("Səbəb qeyd et")}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Refund status")}>
            <SelectBox
              value={refundStatus}
              onChange={(value) =>
                setRefundStatus(value as NonNullable<Booking["refund_status"]>)
              }
            >
              {REFUND_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {t(item.label)}
                </option>
              ))}
            </SelectBox>
          </Field>
          <Field label={t("Refund məbləği")}>
            <Input
              value={refundAmount}
              onChange={(event) => setRefundAmount(event.target.value)}
              placeholder="0.00"
            />
          </Field>
        </div>
        <Field label={t("Refund qeydi")}>
          <Textarea value={refundNote} onChange={(event) => setRefundNote(event.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Bağla")}
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              onSubmit({
                reason: reason || null,
                refund_status: refundStatus,
                refund_amount_minor: refundAmount
                  ? Math.round(Number(refundAmount) * 100)
                  : null,
                refund_note: refundNote || null,
              })
            }
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Ləğv et")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Refund ───────────────────────────────────────────────────────────────────

export function RefundBookingDialog({
  booking,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  booking: Booking | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    refund_status?: Booking["refund_status"];
    refund_amount_minor?: number | null;
    refund_note?: string | null;
  }) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] =
    React.useState<NonNullable<Booking["refund_status"]>>("processed");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    setStatus(booking?.refund_status ?? "processed");
    setAmount(
      booking ? String((booking.refund_amount_minor ?? booking.total_minor) / 100) : "",
    );
    setNote(booking?.refund_note ?? "");
  }, [booking]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Refund idarəsi")}
      contentClassName="max-w-xl"
    >
      <div className="space-y-4">
        {booking ? (
          <div className="rounded-xl border border-border bg-surfaceElevated px-3 py-2.5 text-sm text-foregroundMuted">
            <span className="font-semibold text-foreground">{customerName(booking)}</span> ·{" "}
            {money(booking.total_minor, booking.currency)}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Refund status")}>
            <SelectBox
              value={status}
              onChange={(value) => setStatus(value as NonNullable<Booking["refund_status"]>)}
            >
              {REFUND_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {t(item.label)}
                </option>
              ))}
            </SelectBox>
          </Field>
          <Field label={t("Məbləğ")}>
            <Input value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
        </div>
        <Field label={t("Qeyd")}>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Bağla")}
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSubmit({
                refund_status: status,
                refund_amount_minor: amount ? Math.round(Number(amount) * 100) : null,
                refund_note: note || null,
              })
            }
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Yadda saxla")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function CreateBookingDialog({
  open,
  venues,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  venues: Array<{ id: string; name: string }>;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const { t } = useI18n();
  const [venueId, setVenueId] = React.useState("");
  const [courtId, setCourtId] = React.useState("");
  const [startsAt, setStartsAt] = React.useState("");
  const [duration, setDuration] = React.useState(90);
  const [status, setStatus] =
    React.useState<CreateBookingPayload["status"]>("pending_payment");
  const [customerNameValue, setCustomerNameValue] = React.useState("");
  const [customerEmailValue, setCustomerEmailValue] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState("manual");
  const [paymentNote, setPaymentNote] = React.useState("");
  const { data: courts = [] } = useVenueCourts(venueId || undefined);
  const createBooking = useCreateBooking();
  const quoteBooking = useQuoteBooking();

  React.useEffect(() => {
    if (!open) return;
    setVenueId("");
    setCourtId("");
    setStartsAt("");
    setDuration(90);
    setStatus("pending_payment");
    setCustomerNameValue("");
    setCustomerEmailValue("");
    setPaymentMethod("manual");
    setPaymentNote("");
    quoteBooking.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function quote() {
    if (!courtId || !startsAt) return;
    try {
      await quoteBooking.mutateAsync({
        court_id: courtId,
        starts_at: dateTimeLocalToIso(startsAt),
        duration_minutes: duration,
      });
      toast.success(t("Slot mövcuddur"));
    } catch (error) {
      toast.error(
        t("Slot yoxlanmadı"),
        error instanceof Error ? error.message : t("Yenidən yoxlayın"),
      );
    }
  }

  async function submit() {
    if (!courtId || !startsAt) {
      toast.error(t("Kort və vaxt seçilməlidir"));
      return;
    }
    try {
      await createBooking.mutateAsync({
        court_id: courtId,
        starts_at: dateTimeLocalToIso(startsAt),
        duration_minutes: duration,
        status,
        customer_name: customerNameValue || null,
        customer_email: customerEmailValue || null,
        payment_method: paymentMethod as Booking["payment_method"],
        payment_note: paymentNote || null,
      });
      toast.success(t("Manual booking yaradıldı"));
      onDone();
    } catch (error) {
      toast.error(
        t("Booking yaradılmadı"),
        error instanceof Error ? error.message : t("Yenidən yoxlayın"),
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Manual booking yarat")}
      contentClassName="max-w-2xl"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Məkan")}>
          <SelectBox
            value={venueId}
            onChange={(value) => {
              setVenueId(value);
              setCourtId("");
            }}
          >
            <option value="">{t("Məkan seç")}</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Kort")}>
          <SelectBox value={courtId} disabled={!venueId} onChange={setCourtId}>
            <option value="">{t("Kort seç")}</option>
            {(courts as Court[]).map((court) => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Başlama vaxtı")}>
          <Input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </Field>
        <Field label={t("Müddət")} hint={t("Dəqiqə")}>
          <Input
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
        <Field label={t("Status")}>
          <SelectBox
            value={status ?? "pending_payment"}
            onChange={(value) => setStatus(value as CreateBookingPayload["status"])}
          >
            <option value="pending_payment">{t("Ödəniş gözləyir")}</option>
            <option value="paid">{t("Ödənib")}</option>
          </SelectBox>
        </Field>
        <Field label={t("Ödəniş metodu")}>
          <SelectBox value={paymentMethod} onChange={setPaymentMethod}>
            {PAYMENT_METHODS.map((item) => (
              <option key={item.value} value={item.value}>
                {t(item.label)}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label={t("Müştəri adı")}>
          <Input
            value={customerNameValue}
            onChange={(event) => setCustomerNameValue(event.target.value)}
          />
        </Field>
        <Field label={t("Müştəri email")}>
          <Input
            type="email"
            value={customerEmailValue}
            onChange={(event) => setCustomerEmailValue(event.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("Ödəniş qeydi")}>
            <Textarea
              value={paymentNote}
              onChange={(event) => setPaymentNote(event.target.value)}
            />
          </Field>
        </div>
      </div>

      {quoteBooking.data ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-3 text-sm font-medium text-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#3f6b00]" />
          <span>
            {t("Slot açıqdır")} ·{" "}
            <span className="font-display font-bold tabular-nums">
              {money(quoteBooking.data.total_minor, quoteBooking.data.currency)}
            </span>{" "}
            · {t("bitiş")} {formatTime(quoteBooking.data.ends_at)}
          </span>
        </div>
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t("Bağla")}
        </Button>
        <Button variant="outline" onClick={() => void quote()} disabled={quoteBooking.isPending}>
          {quoteBooking.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {t("Yoxla")}
        </Button>
        <Button onClick={() => void submit()} disabled={createBooking.isPending}>
          {createBooking.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("Yarat")}
        </Button>
      </div>
    </Dialog>
  );
}
