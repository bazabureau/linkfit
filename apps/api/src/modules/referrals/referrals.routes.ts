import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  MyReferralResponse,
  MyReferralsResponse,
  RedeemReferralRequest,
  RedeemReferralResponse,
  ShareReferralQuery,
  ShareReferralResponse,
} from "./referrals.schema.js";
import { type ReferralsService } from "./referrals.service.js";

export interface ReferralsRouteDeps {
  service: ReferralsService;
  jwtAccessSecret: string;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export function registerReferralsRoutes(
  app: LinkfitServer,
  deps: ReferralsRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // POST /api/v1/auth/redeem-referral — the current user (referee) submits
  // a code they got from a friend. Validates a 7-day window, distinct
  // parties, and rejects duplicate redemptions.
  app.post(
    "/api/v1/auth/redeem-referral",
    {
      preHandler: authenticate,
      schema: {
        body: RedeemReferralRequest,
        response: {
          200: RedeemReferralResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["referrals"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const out = await deps.service.redeem(userId, req.body.code);
      return reply.status(200).send(out);
    },
  );

  // GET /api/v1/me/referrals — current user's code + list of referees.
  app.get(
    "/api/v1/me/referrals",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: MyReferralsResponse,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["referrals"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const out = await deps.service.dashboardFor(userId);
      return reply.status(200).send(out);
    },
  );

  // GET /api/v1/me/referral — Wave-10 compact dashboard (singular). Returns
  // just the caller's code, lifetime referral count, and the canonical
  // `linkfit.az/r/<code>` share URL. The plural `/me/referrals` above stays
  // the source of truth for the friend list; this thinner endpoint powers
  // the "Dostunu dəvət et" card on the Settings sub-screen.
  app.get(
    "/api/v1/me/referral",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: MyReferralResponse,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["referrals"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const out = await deps.service.summaryFor(userId);
      return reply.status(200).send(out);
    },
  );

  // GET /api/v1/me/referrals/share — copy-paste-ready share payload (code +
  // URL + localised invite text) for the iOS system share sheet / SMS /
  // iMessage. `?locale=en|az|ru` picks which `share_text` the server
  // surfaces in the top-level field; all three variants are always
  // included so the client can switch language without another call.
  app.get(
    "/api/v1/me/referrals/share",
    {
      preHandler: authenticate,
      schema: {
        querystring: ShareReferralQuery,
        response: {
          200: ShareReferralResponse,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["referrals"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const locale = req.query.locale ?? "en";
      const out = await deps.service.shareFor(userId, locale);
      return reply.status(200).send(out);
    },
  );
}
