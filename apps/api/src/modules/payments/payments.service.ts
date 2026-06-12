import type Stripe from "stripe";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { type BookingsService } from "../bookings/bookings.service.js";
import { type StripeGateway } from "./stripe-gateway.js";
import { type TelemetryHandle } from "../../shared/telemetry/metrics.js";

/**
 * Azerbaijan-first fallback for the rare row that somehow has an empty
 * currency. `tournaments.currency` and `bookings.currency` both default to
 * `'AZN'` at the schema level — this helper exists so a hand-crafted row
 * (data migration, manual SQL edit) doesn't reach Stripe with an empty
 * string and 400 the user mid-checkout.
 */
const DEFAULT_CURRENCY = "AZN";
function resolveCurrency(raw: string | null | undefined): string {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_CURRENCY;
}

export interface PaymentsServiceDeps {
  db: DbHandle;
  stripe: StripeGateway;
  bookings: BookingsService;
  logger: Logger;
  /** Optional telemetry. When set, `createBookingIntent` and
   *  `createTournamentEntryIntent` increment `linkfit_payment_intents_total`. */
  telemetry?: TelemetryHandle | undefined;
}

export interface PaymentSheetResponse {
  payment_intent_id: string;
  client_secret: string;
  ephemeral_key: string;
  customer_id: string;
  publishable_key_hint: string | null;
}

/** Booking variant of the PaymentSheet response — bundles the amount and
 *  currency back to iOS so the app can render the Pay button label without
 *  a second round-trip to `/bookings/:id`. */
export interface BookingIntentResponse extends PaymentSheetResponse {
  booking_id: string;
  amount_minor: number;
  currency: string;
}

/** Snapshot used by the booking-payment status endpoint. Maps the internal
 *  `BookingStatus` enum into the three states iOS cares about. */
export interface BookingPaymentStatus {
  status: "pending" | "succeeded" | "failed";
  paid_at?: string;
}

export interface CreateTournamentIntentRequest {
  squad_name: string;
  player_ids: string[];
}

/**
 * Owns the Stripe PaymentIntent lifecycle from both directions:
 *
 *   - The iOS app calls `createBookingIntent` / `createTournamentEntryIntent`
 *     to mint a PaymentSheet token bundle.
 *   - Stripe POSTs to our webhook handler, which lands in `handleWebhookEvent`
 *     and either marks the booking paid or materializes the tournament entry.
 *
 * The webhook side is idempotent on the Stripe event id (we log every
 * processed event to `stripe_webhook_events`) AND on the PaymentIntent id
 * for entry creation (the unique constraint on `tournament_entry_payments`).
 */
export class PaymentsService {
  constructor(private readonly deps: PaymentsServiceDeps) {}

  // ─── Booking intents ────────────────────────────────────────────────

  async createBookingIntent(
    bookingId: string,
    userId: string,
  ): Promise<BookingIntentResponse> {
    // Hydrate the booking through the service so the access-check logic
    // (NotFoundError + ForbiddenError) stays in one place. `get` returns
    // the full detail with `total_minor` + `currency` already validated.
    const booking = await this.deps.bookings.get(bookingId, userId);
    if (booking.status === "paid") {
      throw new ConflictError("Booking is already paid");
    }
    if (booking.status === "cancelled" || booking.status === "refunded") {
      throw new ConflictError("Booking is not payable in its current state");
    }
    if (booking.total_minor <= 0) {
      throw new ValidationError("Booking has zero amount due");
    }

    const customer = await this.ensureCustomer(userId);
    let intent;
    try {
      intent = await this.deps.stripe.createPaymentIntent({
        customer_id: customer.id,
        amount_minor: booking.total_minor,
        currency: resolveCurrency(booking.currency),
        metadata: {
          linkfit_kind: "booking",
          linkfit_booking_id: booking.id,
          linkfit_user_id: userId,
        },
        // Idempotent on the booking id — retried clicks reuse the same intent.
        idempotency_key: `booking:${booking.id}`,
      });
      this.deps.telemetry?.business.paymentIntents.inc({ kind: "booking", result: "ok" });
    } catch (err) {
      this.deps.telemetry?.business.paymentIntents.inc({ kind: "booking", result: "fail" });
      throw err;
    }

    // Stash the PaymentIntent id on the booking so reconciliation jobs can
    // tie our row back to Stripe without scanning the webhook log.
    await this.deps.db.db
      .updateTable("bookings")
      .set({ external_ref: intent.payment_intent_id })
      .where("id", "=", booking.id)
      .execute();

    const ephemeral = await this.deps.stripe.createEphemeralKey(customer.id);
    return {
      payment_intent_id: intent.payment_intent_id,
      client_secret: intent.client_secret,
      ephemeral_key: ephemeral.secret,
      customer_id: customer.id,
      publishable_key_hint: null,
      booking_id: booking.id,
      amount_minor: booking.total_minor,
      currency: resolveCurrency(booking.currency),
    };
  }

  // ─── Booking payment status (iOS polls this) ────────────────────────

  /** Returns a normalized status snapshot for the booking. iOS calls this
   *  after PaymentSheet finishes to confirm the webhook has landed and the
   *  booking is `paid`. Caller must own the booking — `bookings.get`
   *  enforces the 403. */
  async getBookingPaymentStatus(
    bookingId: string,
    userId: string,
  ): Promise<BookingPaymentStatus> {
    const booking = await this.deps.bookings.get(bookingId, userId);
    // Map the rich BookingStatus enum to the tri-state iOS needs:
    //   paid                    → succeeded (with paid_at)
    //   failed                  → failed
    //   anything else still in flight (pending_payment, partially_paid,
    //   cancelled, refunded) → pending. iOS treats "pending" as
    //   "not yet confirmed"; final/cancelled states aren't surfaced here
    //   because the booking detail endpoint already covers them.
    if (booking.status === "paid") {
      return booking.paid_at
        ? { status: "succeeded", paid_at: booking.paid_at }
        : { status: "succeeded" };
    }
    if (booking.status === "failed") {
      return { status: "failed" };
    }
    return { status: "pending" };
  }

  // ─── Tournament entry intents ───────────────────────────────────────

  async createTournamentEntryIntent(
    tournamentId: string,
    captainUserId: string,
    body: CreateTournamentIntentRequest,
  ): Promise<PaymentSheetResponse> {
    const tournament = await this.deps.db.db
      .selectFrom("tournaments")
      .selectAll()
      .where("id", "=", tournamentId)
      .executeTakeFirst();
    if (!tournament) throw new NotFoundError("Tournament not found");
    if (tournament.entry_fee_minor <= 0) {
      throw new ValidationError("Tournament has no entry fee — register directly");
    }
    if (tournament.status === "completed" || tournament.status === "cancelled") {
      throw new ConflictError("Tournament is not accepting payments");
    }
    if (
      tournament.status === "registration_closed" ||
      tournament.status === "in_progress"
    ) {
      throw new ConflictError("Registration is closed");
    }

    // Dedupe + strip captain from invitees just like TournamentsService.register
    // so the eventual entry insert lines up with that contract.
    const dedupedPlayers = Array.from(new Set(body.player_ids)).filter(
      (id) => id !== captainUserId,
    );
    if (dedupedPlayers.length + 1 > tournament.squad_size) {
      throw new ValidationError(
        `Squad too large: max ${String(tournament.squad_size)} players including captain`,
      );
    }
    const trimmedSquadName = body.squad_name.trim();
    if (trimmedSquadName.length < 2) {
      throw new ValidationError("Squad name must be at least 2 characters");
    }

    const customer = await this.ensureCustomer(captainUserId);
    let intent;
    try {
      intent = await this.deps.stripe.createPaymentIntent({
        customer_id: customer.id,
        amount_minor: tournament.entry_fee_minor,
        currency: resolveCurrency(tournament.currency),
        metadata: {
          linkfit_kind: "tournament_entry",
          linkfit_tournament_id: tournamentId,
          linkfit_captain_user_id: captainUserId,
        },
        // Idempotency keyed on (tournament, captain) so a captain who taps
        // Pay twice on the same squad config gets the same intent back.
        idempotency_key: `tournament:${tournamentId}:captain:${captainUserId}`,
      });
      this.deps.telemetry?.business.paymentIntents.inc({ kind: "tournament", result: "ok" });
    } catch (err) {
      this.deps.telemetry?.business.paymentIntents.inc({ kind: "tournament", result: "fail" });
      throw err;
    }

    // Persist the pending payment so the webhook can recreate the entry row
    // when Stripe confirms the charge.
    await this.deps.db.db
      .insertInto("tournament_entry_payments")
      .values({
        tournament_id: tournamentId,
        captain_user_id: captainUserId,
        payment_intent_id: intent.payment_intent_id,
        amount_minor: tournament.entry_fee_minor,
        currency: tournament.currency,
        squad_name: trimmedSquadName,
        player_ids: dedupedPlayers,
      })
      .onConflict((oc) => oc.column("payment_intent_id").doNothing())
      .execute();

    const ephemeral = await this.deps.stripe.createEphemeralKey(customer.id);
    return {
      payment_intent_id: intent.payment_intent_id,
      client_secret: intent.client_secret,
      ephemeral_key: ephemeral.secret,
      customer_id: customer.id,
      publishable_key_hint: null,
    };
  }

  // ─── Webhook dispatch ───────────────────────────────────────────────

  async handleWebhookEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
    // De-dupe on event id. Stripe redelivers events that didn't 2xx, and
    // also sometimes redelivers events that did — guard the side effects.
    const replay = await this.deps.db.db
      .selectFrom("stripe_webhook_events")
      .select("id")
      .where("id", "=", event.id)
      .executeTakeFirst();
    if (replay) {
      this.deps.logger.debug({ event_id: event.id }, "stripe: duplicate webhook event ignored");
      return { handled: false };
    }

    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object;
        await this.onPaymentSucceeded(intent);
        break;
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        await this.onPaymentFailed(intent);
        break;
      }
      default:
        this.deps.logger.debug({ event_type: event.type }, "stripe: event type ignored");
        break;
    }

    // Stamp the event as processed AFTER side-effects. If the SQL insert
    // races (parallel webhook delivery), the UNIQUE on `id` will throw — we
    // swallow it and move on since the duplicate event was already handled.
    try {
      await this.deps.db.db
        .insertInto("stripe_webhook_events")
        .values({ id: event.id, type: event.type })
        .execute();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "23505") throw err;
    }
    return { handled: true };
  }

  // ─── Internals ───────────────────────────────────────────────────────

  private async ensureCustomer(userId: string): Promise<{ id: string }> {
    const existing = await this.deps.db.db
      .selectFrom("stripe_customers")
      .select(["stripe_customer_id"])
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (existing) return { id: existing.stripe_customer_id };

    const user = await this.deps.db.db
      .selectFrom("users")
      .select(["id", "email"])
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!user) throw new ForbiddenError("User not found");

    const customer = await this.deps.stripe.ensureCustomer({
      email: user.email,
      user_id: user.id,
    });
    await this.deps.db.db
      .insertInto("stripe_customers")
      .values({ user_id: userId, stripe_customer_id: customer.id })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .execute();
    return customer;
  }

  private async onPaymentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const kind = intent.metadata.linkfit_kind;
    if (kind === "booking") {
      const bookingId = intent.metadata.linkfit_booking_id;
      const userId = intent.metadata.linkfit_user_id;
      if (typeof bookingId !== "string" || typeof userId !== "string") {
        this.deps.logger.warn(
          { intent_id: intent.id },
          "stripe: booking intent missing metadata",
        );
        return;
      }
      // BookingsService.markPaid is owned by the bookings module — we go
      // through it so the splits + paid_at + status transition stays in
      // exactly one place.
      await this.deps.bookings.markPaid(bookingId, userId);
      this.deps.logger.info({ booking_id: bookingId }, "stripe: booking marked paid");
      return;
    }
    if (kind === "tournament_entry") {
      await this.materializeTournamentEntry(intent);
      return;
    }
    this.deps.logger.debug(
      { intent_id: intent.id, kind: kind ?? "(none)" },
      "stripe: succeeded intent without recognized kind",
    );
  }

  private async onPaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const kind = intent.metadata.linkfit_kind;
    if (kind === "booking") {
      const bookingId = intent.metadata.linkfit_booking_id;
      if (typeof bookingId !== "string") return;
      // Best-effort: flip to `failed` if still pending. We don't enforce the
      // status guard here — the SET WHERE filter is enough.
      await this.deps.db.db
        .updateTable("bookings")
        .set({ status: "failed" })
        .where("id", "=", bookingId)
        .where("status", "=", "pending_payment")
        .execute();
      this.deps.logger.warn({ booking_id: bookingId }, "stripe: booking marked failed");
      return;
    }
    if (kind === "tournament_entry") {
      await this.deps.db.db
        .updateTable("tournament_entry_payments")
        .set({ status: "failed" })
        .where("payment_intent_id", "=", intent.id)
        .where("status", "=", "pending")
        .execute();
      this.deps.logger.warn(
        { intent_id: intent.id },
        "stripe: tournament entry payment marked failed",
      );
    }
  }

  private async materializeTournamentEntry(intent: Stripe.PaymentIntent): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const pending = await tx
        .selectFrom("tournament_entry_payments")
        .selectAll()
        .where("payment_intent_id", "=", intent.id)
        .executeTakeFirst();
      if (!pending) {
        this.deps.logger.warn(
          { intent_id: intent.id },
          "stripe: tournament entry payment not found — cannot materialize",
        );
        return;
      }
      if (pending.status === "succeeded" && pending.entry_id) {
        // Already materialized — webhook redelivery.
        return;
      }

      // Try to insert the entry. Existing UNIQUE on (tournament_id,
      // captain_user_id) means a captain who already registered manually
      // can't be double-booked — we surface that by flipping the pending
      // payment to `succeeded` without creating a new entry.
      let entryId: string | null = null;
      try {
        const inserted = await tx
          .insertInto("tournament_entries")
          .values({
            tournament_id: pending.tournament_id,
            captain_user_id: pending.captain_user_id,
            squad_name: pending.squad_name,
            player_ids: pending.player_ids,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        entryId = inserted.id;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code !== "23505") throw err;
        // Lookup the existing entry so we can stamp the payment row.
        const existing = await tx
          .selectFrom("tournament_entries")
          .select("id")
          .where("tournament_id", "=", pending.tournament_id)
          .where("captain_user_id", "=", pending.captain_user_id)
          .executeTakeFirst();
        entryId = existing?.id ?? null;
      }

      await tx
        .updateTable("tournament_entry_payments")
        .set({
          status: "succeeded",
          entry_id: entryId,
          succeeded_at: new Date(),
        })
        .where("payment_intent_id", "=", intent.id)
        .execute();
      this.deps.logger.info(
        { intent_id: intent.id, entry_id: entryId },
        "stripe: tournament entry materialized",
      );
    });
  }
}
