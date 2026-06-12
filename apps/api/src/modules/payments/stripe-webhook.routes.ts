import { z } from "zod";
import { type FastifyRequest } from "fastify";
import { type LinkfitServer } from "../../shared/http/server.js";
import { type PaymentsService } from "./payments.service.js";
import { type StripeGateway } from "./stripe-gateway.js";
import { ValidationError } from "../../shared/errors/AppError.js";

export interface StripeWebhookRouteDeps {
  service: PaymentsService;
  stripe: StripeGateway;
}

const WebhookAck = z.object({
  received: z.boolean(),
  handled: z.boolean(),
});

/**
 * Registers `POST /api/v1/webhooks/stripe`. The route bypasses Zod body
 * validation and consumes the raw byte buffer instead — Stripe's signature
 * scheme is computed over the exact bytes Stripe sent, so any JSON.parse or
 * re-serialization invalidates the HMAC.
 *
 * The custom content-type parser is scoped to this route alone via the
 * route-level `config` flag so the rest of the API keeps Fastify's default
 * JSON parsing.
 */
export function registerStripeWebhookRoutes(
  app: LinkfitServer,
  deps: StripeWebhookRouteDeps,
): void {
  // Fastify ships a default JSON parser. We replace it with one that hands
  // the raw byte buffer to handlers tagged with `config.rawBody: true`
  // (the Stripe webhook) and otherwise behaves identically to the default
  // (`JSON.parse` after a utf-8 decode). `removeContentTypeParser` is
  // required — `addContentTypeParser` throws on duplicate registration.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      const buf = Buffer.isBuffer(body)
        ? body
        : Buffer.from(body);
      if (req.routeOptions.config.rawBody === true) {
        done(null, buf);
        return;
      }
      try {
        const text = buf.toString("utf8");
        const parsed: unknown = text.length === 0 ? undefined : JSON.parse(text);
        done(null, parsed);
      } catch (err) {
        const e = err instanceof Error ? err : new Error("Invalid JSON");
        // Fastify uses `statusCode` on the thrown error to set the response.
        (e as Error & { statusCode?: number }).statusCode = 400;
        done(e, undefined);
      }
    },
  );

  app.post(
    "/api/v1/webhooks/stripe",
    {
      // `rawBody` is the route-level switch the parser keys off of.
      config: { rawBody: true },
      schema: {
        response: { 200: WebhookAck, 400: z.object({ error: z.string() }) },
        tags: ["payments"],
      },
    },
    async (req: FastifyRequest, reply) => {
      const sig = req.headers["stripe-signature"];
      if (typeof sig !== "string" || sig.length === 0) {
        throw new ValidationError("Missing Stripe-Signature header");
      }
      const raw = req.body;
      if (!Buffer.isBuffer(raw)) {
        throw new ValidationError("Webhook body must be a raw buffer");
      }

      let event;
      try {
        event = deps.stripe.constructEvent(raw, sig);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "signature verification failed";
        req.log.warn({ err }, "stripe: webhook signature verification failed");
        return reply.status(400).send({ error: msg });
      }

      const result = await deps.service.handleWebhookEvent(event);
      return reply.status(200).send({ received: true, handled: result.handled });
    },
  );
}

declare module "fastify" {
  interface FastifyContextConfig {
    /** When true, the JSON content-type parser hands the raw buffer to the
     *  handler instead of parsing. Used exclusively by the Stripe webhook
     *  route — see registerStripeWebhookRoutes. */
    rawBody?: boolean;
  }
}
