# Design Doc: Payments Integration (Pay-at-Venue → Online)

Status: Draft for review
Author: Platform / Backend
Last updated: 2026-06-21
Scope: `apps/api-laravel` (Laravel 13, LIVE on `api.linkfit.az` @ `142.93.166.170`), `apps/{web,admin,partner}`, Flutter app `Desktop/LINKFITAPP`.

---

## 1. Current state (grounded in code)

LinkFit collects **no money online today**. Everything is "reserve now, pay at the venue", reconciled manually by partners/admins.

**Booking lifecycle is already money-aware but cash-settled:**
- `bookings` carries `subtotal_minor`, `discount_minor`, `total_minor`, `currency`, `status`, `payment_method`, `external_ref`, `paid_at`, `payment_note`, plus refund columns `refund_status` / `refund_amount_minor` / `refund_note` / `refunded_at` (`database/migrations/2026_06_14_000006_booking_cancellation_refunds.php`, `..._000007_promo_codes.php`).
- `BookingsController::store` writes new bookings as `status = 'pending_payment'`, `payment_method = 'onsite'` (BookingsController.php:280-282). Valid statuses: `pending_payment, partially_paid, paid, cancelled, refunded, failed` (BookingsController.php:514).
- Settlement is **manual**: `BookingsController::markPaid` (BookingsController.php:720) and `PartnerOpsController::markPaid` (PartnerOpsController.php:593) flip status to `paid` and set `payment_method` to `cash|bank_transfer|manual|onsite`. There is **no card capture**.
- Refunds are **manual/advisory only**: `PartnerOpsController::refundBooking` (PartnerOpsController.php:562) just sets `refund_status` (`pending_manual_review|approved|processed|rejected|not_required`) and notifies the user — no money moves.

**A payment *scaffold* already exists and is intentionally inert (the right shape to build on):**
- `PaymentsController` exposes `payments/booking/{id}/intent`, `.../status`, `payments/tournament/{id}/entry-intent`, plus read-only `payments/history` & `payments/summary` (routes/api.php:203-207).
- The actual money path is gated behind two config flags and throws structured 501s today:
  - `paymentSurfaceAvailable()` = `public_subscriptions_enabled && payments_enabled` (PaymentsController.php:323).
  - `paymentSheet()` throws `PAYMENT_PROVIDER_NOT_CONFIGURED` (501) when `membership.payment_provider` is empty, else `PAYMENT_ADAPTER_NOT_IMPLEMENTED` (501) (PaymentsController.php:253-289). **This is the single seam where an adapter plugs in.**
- `MembershipController::subscribe` mirrors this: returns `202 free_launch` when `payments_enabled=false`, else `501 PAYMENT_PROVIDER_NOT_CONFIGURED` / `PAYMENT_ADAPTER_NOT_IMPLEMENTED` (MembershipController.php:56-90).
- `MembershipService::paymentState()` already publishes a client-facing envelope: `{enabled, provider, provider_configured, checkout_available:false, status: free_launch|provider_missing|adapter_pending, ...}` (MembershipService.php:274). The mobile + web clients can already render off this — they just always see `checkout_available:false`.
- Config keys exist: `membership.payments_enabled`, `membership.payment_provider`, `membership.public_subscriptions_enabled`, `premium_price_minor`, `currency` (default `AZN`) (config/membership.php).
- `tournament_entry_payments` table already records intents with `payment_intent_id`, `amount_minor`, `status (pending)`, `succeeded_at` (written by `PaymentsController::tournamentIntent`, PaymentsController.php:160).

**Infra already in place** (no new services needed): Laravel Horizon + Redis queues, Reverb (WebSocket), Sentry, php-fpm behind nginx, Cloudflare-only ingress (ufw allows 80/443 from CF ranges only). Currency is **AZN**; there is **no Stripe/Cashier SDK in `composer.json`** — only `STRIPE_PUBLISHABLE_KEY` placeholder in `config/services.php`.

**Known gaps already on the backlog that payments must not ignore:**
- Promo **over-redemption race**: `PromoCodesController` counts redemptions then inserts without a lock (PromoCodesController.php:240-249); `booking_promo_redemptions` has `unique(booking_id)` but **not** a `max_redemptions` guard. Online payment will increase concurrency → must fix before charging.
- No webhook route exists anywhere (`grep webhook|callback routes/*` → empty).

---

## 2. Target state

Online prepayment for three flows, additive to (not replacing) pay-at-venue:
1. **Court bookings** — card prepay at booking time; pay-at-venue remains a selectable method.
2. **Tournament entry fees** — prepay required to confirm a squad entry.
3. **Premium membership** — recurring subscription (later phase; needs provider recurring support).

Non-negotiables:
- **Single provider abstraction** so AZ-local providers and a card processor are swappable behind one interface (the existing `paymentSheet()` seam).
- **Server is the source of truth.** Booking becomes `paid` **only** via a verified provider webhook, never from a client "success" callback.
- **Idempotent** intent creation and webhook handling (reuse the user-scoped idempotency pattern just shipped in `BookingsController`).
- **Money never created in the client**; amounts always recomputed server-side from `total_minor`.

---

## 3. Key decisions

### D1. Provider: AZ-local PSP first, gateway-abstracted
Currency is AZN and the user base is Azerbaijan, so **Stripe is not viable for live local card acceptance**. Target an Azerbaijani PSP — **Payriff** or **Epoint** (both do AZN card + 3-DS, hosted page + server-to-server webhook). Decision is a **config + one adapter class**, not a code rewrite, because of D2.

> Action item for the lead: confirm merchant onboarding (Payriff vs Epoint) — this is the only true external blocker. Everything below is provider-agnostic.

### D2. One `PaymentGateway` interface; adapters per provider
Introduce `App\Services\Payments\PaymentGateway` (interface) with `createIntent(PaymentContext): IntentResult`, `verifyWebhook(Request): WebhookEvent`, `refund(RefundRequest): RefundResult`. Concrete `PayriffGateway` / `EpointGateway` / (test) `FakeGateway`. Bind the active one from `config('membership.payment_provider')` in a service provider. **`PaymentsController::paymentSheet()` calls the gateway instead of throwing the 501** — that is the entire wiring change on the read/intent side.

### D3. New `payments` ledger table (don't overload `bookings`)
Bookings already hold the *settled* state; we add an append-only intent/transaction ledger so multiple attempts, partial captures, and refunds are auditable:
`payments(id, kind[booking|tournament|membership], target_id, user_id, provider, provider_intent_id unique, provider_session_url, amount_minor, currency, status[created|pending|requires_action|succeeded|failed|refunded|partially_refunded], idempotency_key, raw_event jsonb, created_at, updated_at, succeeded_at, failed_at)`. `bookings.external_ref` keeps pointing at the active intent id (already wired: `bookingIntent` sets `external_ref`, PaymentsController.php:81). `tournament_entry_payments` is the existing analogue and can be folded in or left as-is and double-written.

### D4. Webhook is the only state-transition authority
Add `POST /api/v1/payments/webhook/{provider}` — **public route, NO `X-Linkfit-App-Key` gate, NO auth**, but signature-verified inside the controller via `gateway->verifyWebhook()`. It must be added to the API-key middleware exclusion list (the gate currently 403s un-keyed requests). On `succeeded`: in a DB transaction, mark `payments.succeeded`, flip `bookings.status='paid'` + `paid_at` (idempotent — re-deliver is a no-op if already paid), confirm tournament entry, or extend membership. Broadcast a Reverb event so the client updates without polling (poller via `payments/booking/{id}/status` stays as fallback — it already exists, PaymentsController.php:97).

### D5. Refunds become real, behind the gateway
`PartnerOpsController::refundBooking` keeps its manual states but, when provider is configured and the booking was card-paid, calls `gateway->refund()` and records a negative `payments` row + sets `refund_status='processed'` on webhook confirmation. Manual/cash bookings keep today's advisory behavior. **No behavior change for existing cash bookings** — gate on `payment_method`.

### D6. Roll out behind flags, dark → canary → on
The flag machinery already exists. Sequence: deploy adapter with `payments_enabled=false` (no user impact) → enable for **tournament entries only** (lowest volume, clearest "must prepay") → bookings → membership. `paymentState.status` already communicates `provider_missing` vs `adapter_pending` vs live to clients.

### D7. PCI scope = SAQ-A (hosted page / provider SDK)
Use the provider's **hosted checkout page or drop-in SDK**; card PANs never touch our servers. We store only `provider_intent_id` + status. This keeps us in the lowest PCI tier and is the only sane option on a single php-fpm droplet.

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| **Webhook spoofing** → fake "paid". | Mandatory signature verification in `verifyWebhook`; reject unsigned; route excluded from app-key gate but IP-allowlist provider ranges at nginx if the PSP publishes them. |
| **Double-charge / replay** on intent create. | Reuse shipped user-scoped idempotency: `payments.idempotency_key` unique per (user, target); return existing pending intent instead of creating a second. |
| **Webhook ↔ client race / lost webhook** → booking stuck `pending_payment` though card cleared. | Webhook is authoritative; add a reconcile cron (`console.php`) that polls provider for `pending` payments older than N min and a Horizon retry; never trust client callback. |
| **Promo over-redemption** under higher concurrency (PromoCodesController.php:240). | Fix *before* go-live: `SELECT … FOR UPDATE` on `promo_codes` row + atomic redemption-count check inside the booking/payment transaction. (Already a pending backlog item.) |
| **Money math drift** (client sends amount). | Always recompute `amount_minor` from `bookings.total_minor` server-side (already done — PaymentsController.php:82); client amount is display-only. |
| **php artisan serve fragility on old box** is gone (now php-fpm + opcache), **but** opcache `validate_timestamps=0` means deploys need `systemctl reload php8.4-fpm`. | Document in runbook; webhook endpoint must boot-test (`php artisan route:list`) before reload. |
| **Refund of a no-show / partial** ambiguity. | Keep refund amounts admin-driven (`refund_amount_minor` already exists); gateway refund capped at captured amount; partial-refund → `partially_refunded`. |
| **Currency**: provider settles AZN only; tournament/booking already store `currency`. | Assert `currency === config('membership.currency')` before intent; reject mismatches. |
| **Subscription dunning / failed renewals** (membership phase). | Defer membership to phase 3; needs provider recurring-token support + grace handling. Don't block booking/tournament prepay on it. |

---

## 5. Step-by-step plan

**Phase 0 — Provider decision & merchant onboarding (external, blocking)**
- Lead confirms Payriff vs Epoint; obtain test + prod merchant credentials; document callback URL `https://api.linkfit.az/api/v1/payments/webhook/{provider}` with the PSP.

**Phase 1 — Abstraction & ledger (no user impact, `payments_enabled=false`)**
1. Migration: create `payments` ledger table (D3). Migration: add `max_redemptions` lock fix to promo flow.
2. `App\Services\Payments\PaymentGateway` interface + `FakeGateway` (deterministic, for tests) + provider adapter skeleton. Bind from config in a service provider.
3. Replace the two 501 throws in `PaymentsController::paymentSheet()` (PaymentsController.php:253-289) with `gateway->createIntent()`, writing a `payments` row. Keep throwing when no provider bound (graceful for clients reading `paymentState`).
4. Contract tests against `FakeGateway`: intent create, idempotent re-create, amount recompute, currency assertion. (Mirror the existing contract-test suites the mobile/backend already ship.)

**Phase 2 — Webhook & settlement**
5. Add `POST payments/webhook/{provider}` route; exclude from `X-Linkfit-App-Key` gate and from CSRF/auth; verify signature inside.
6. Webhook handler: transactional, idempotent state transition → mark `payments`, flip `bookings`/tournament entry/membership; broadcast Reverb event. Add reconcile cron + Horizon job for stuck `pending`.
7. Wire real `gateway->refund()` into `PartnerOpsController::refundBooking` for card-paid bookings only (D5).
8. Tests: webhook replay = no-op, bad signature = 400, lost webhook → reconcile job recovers.

**Phase 3 — Client surfaces**
9. Flutter: on `paymentState.checkout_available=true`, render "Pay now (card)" alongside "Pay at venue"; open provider hosted page / SDK from `createIntent` response; poll `payments/booking/{id}/status` (+ listen on Reverb) until `succeeded`. Booking detail already models status pills (`booking_status_pill.dart`).
10. Web/partner/admin: surface `payments/history` + real refund actions in `apps/partner` (owner app) and `apps/admin`.

**Phase 4 — Rollout**
11. Deploy Phase 1+2 with flags off → set `payment_provider`, `payments_enabled=true` for **tournaments only** in a canary → monitor Sentry + reconcile cron → expand to bookings → membership (recurring) last.
12. Pre-go-live checklist: promo race fixed, webhook signature verified in staging with PSP test events, refund tested end-to-end, idempotency proven, Sentry alerts on `payments.failed` spikes.

**Explicit non-goals for v1:** wallet/stored balance, split-payment-per-player collection (table `payment_splits` is referenced but unused — defer), Apple Pay/Google Pay native sheets (use provider's), multi-currency.

---

### One-line summary of the wiring
Everything routes through one seam: `PaymentsController::paymentSheet()` (today throws 501) → call `PaymentGateway::createIntent()`; and one new authority: a signature-verified `payments/webhook/{provider}` endpoint that is the *only* thing allowed to mark a booking `paid`. Flags (`payments_enabled`, `payment_provider`) already exist and already drive the client via `paymentState()`.
