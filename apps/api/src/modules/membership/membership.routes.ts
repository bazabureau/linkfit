import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  CancelResponse,
  MembershipState,
  StripeWebhookEvent,
  SubscribeBody,
  SubscribeResponse,
} from "./membership.schema.js";
import { type MembershipService } from "./membership.service.js";

export interface MembershipRouteDeps {
  service: MembershipService;
  jwtAccessSecret: string;
  allowUnsignedWebhooks: boolean;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

const WebhookAck = z.object({
  received: z.boolean(),
  handled: z.boolean(),
});

/** Response envelope for POST /me/membership/portal — Stripe-hosted
 *  Customer Portal URL the iOS app opens in Safari. Defined here rather
 *  than in `membership.schema.ts` because the route is the only consumer
 *  and the shape is dead simple. */
const PortalResponse = z.object({
  url: z.string().url(),
});

export function registerMembershipRoutes(
  app: LinkfitServer,
  deps: MembershipRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // GET /api/v1/me/membership — current tier + period + benefits.
  app.get(
    "/api/v1/me/membership",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: MembershipState,
          401: ErrorEnvelope,
        },
        tags: ["membership"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const payload = await deps.service.getState(userId);
      return reply.status(200).send(payload);
    },
  );

  // POST /api/v1/membership/subscribe — { tier: plus|premium }.
  app.post(
    "/api/v1/membership/subscribe",
    {
      preHandler: authenticate,
      schema: {
        body: SubscribeBody,
        response: {
          200: SubscribeResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["membership"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const payload = await deps.service.subscribe(userId, req.body.tier);
      return reply.status(200).send(payload);
    },
  );

  // POST /api/v1/me/membership/portal — mint a Stripe Customer Portal
  // session and hand the URL back to iOS. iOS opens the URL in Safari
  // so members can update their payment method, view invoices, and
  // cancel/resume on Stripe-hosted UI (keeps us out of PCI scope).
  //
  // 422 is returned when the caller has no Stripe Customer on file —
  // i.e. they never subscribed. The iOS client surfaces that as a
  // toast pointing the user at the Upgrade flow.
  app.post(
    "/api/v1/me/membership/portal",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: PortalResponse,
          401: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["membership"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const payload = await deps.service.createPortalSession(userId);
      return reply.status(200).send(payload);
    },
  );

  // POST /api/v1/membership/cancel — flags cancel_at_period_end=true.
  app.post(
    "/api/v1/membership/cancel",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: CancelResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["membership"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const payload = await deps.service.cancel(userId);
      return reply.status(200).send(payload);
    },
  );

  // ⚠️ CRITICAL SECURITY: the legacy subscription webhook routes below
  // accept raw JSON without Stripe signature verification. An audit
  // discovered that an unauthenticated attacker could POST a forged
  // `customer.subscription.created` event with any `linkfit_user_id`
  // and grant themselves a Premium tier — confirmed by reading the
  // service code, which trusts the event's metadata directly.
  //
  // Mitigation chosen: refuse to register these routes in production.
  // The canonical signed webhook lives at `/api/v1/webhooks/stripe`
  // (`payments/stripe-webhook.routes.ts`) and uses `constructEvent`
  // with the shared secret — Stripe should be configured to send ALL
  // event types (including `customer.subscription.*`) there.
  //
  // Dev/test still need the unsigned shim so the existing test suite
  // and local Stripe-CLI replays work; server wiring keeps the routes
  // alive only outside production.
  if (deps.allowUnsignedWebhooks) {
    app.post(
      "/api/v1/webhooks/stripe/subscription",
      {
        schema: {
          body: StripeWebhookEvent,
          response: { 200: WebhookAck },
          tags: ["membership"],
        },
      },
      async (req, reply) => {
        const result = await deps.service.handleWebhookEvent(req.body);
        return reply.status(200).send({ received: true, handled: result.handled });
      },
    );

    app.post(
      "/api/v1/membership-webhook",
      {
        schema: {
          body: StripeWebhookEvent,
          response: { 200: WebhookAck },
          tags: ["membership"],
        },
      },
      async (req, reply) => {
        const result = await deps.service.handleWebhookEvent(req.body);
        return reply.status(200).send({ received: true, handled: result.handled });
      },
    );
  }
}
