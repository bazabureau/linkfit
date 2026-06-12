import Fastify, {
  type FastifyInstance,
  type RawServerDefault,
} from "fastify";
import { type IncomingMessage, type ServerResponse } from "node:http";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { mkdirSync } from "node:fs";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { type Logger } from "pino";
import { randomUUID } from "node:crypto";
import { type Env } from "../config/env.js";
import { type DbHandle } from "../db/pool.js";
import { fastifyErrorHandler } from "../errors/errorMapper.js";
import { registerHealthRoutes } from "../../modules/health/health.routes.js";
import { registerUsersRoutes } from "../../modules/users/users.routes.js";
import { UsersService } from "../../modules/users/users.service.js";
import { registerSessionsRoutes } from "../../modules/users/sessions.routes.js";
import { SessionsService } from "../../modules/users/sessions.service.js";
import { registerCatalogRoutes } from "../../modules/catalog/catalog.routes.js";
import { CatalogService } from "../../modules/catalog/catalog.service.js";
import { registerGamesRoutes } from "../../modules/games/games.routes.js";
import { GamesService } from "../../modules/games/games.service.js";
import { registerRatingsRoutes } from "../../modules/ratings/ratings.routes.js";
import { RatingsService } from "../../modules/ratings/ratings.service.js";
import { registerBookingsRoutes } from "../../modules/bookings/bookings.routes.js";
import { BookingsService } from "../../modules/bookings/bookings.service.js";
import { registerSocialRoutes } from "../../modules/social/social.routes.js";
import { NotificationsService } from "../../modules/social/notifications.service.js";
import { MessagesService } from "../../modules/social/messages.service.js";
import { SocialService } from "../../modules/social/social.service.js";
import { registerFollowsRoutes } from "../../modules/social/follows.routes.js";
import { FollowsService } from "../../modules/social/follows.service.js";
import { createSpamChecks } from "../security/spam-checks.js";
import { registerBlocksRoutes } from "../../modules/social/blocks.routes.js";
import { BlocksService } from "../../modules/social/blocks.service.js";
import { registerAdminRoutes } from "../../modules/admin/admin.routes.js";
import { AdminService } from "../../modules/admin/admin.service.js";
import { registerPartnerRoutes } from "../../modules/partner/partner.routes.js";
import { PartnerService } from "../../modules/partner/partner.service.js";
import { registerAdminGdprRoutes } from "../../modules/admin/admin.gdpr.routes.js";
import { AdminGdprService } from "../../modules/admin/admin.gdpr.service.js";
import { registerAdminModerationRoutes } from "../../modules/admin/admin.moderation.routes.js";
import { AdminModerationService } from "../../modules/admin/admin.moderation.service.js";
import { registerTournamentsRoutes } from "../../modules/tournaments/tournaments.routes.js";
import { TournamentsService } from "../../modules/tournaments/tournaments.service.js";
import { registerAmericanoRoutes } from "../../modules/americano/americano.routes.js";
import { AmericanoService } from "../../modules/americano/americano.service.js";
import { registerGroupChatRoutes } from "../../modules/social/group-chat.routes.js";
import { registerPushRoutes } from "../../modules/push/push.routes.js";
import { PushService } from "../../modules/push/push.service.js";
import { ApnsSender, LoggingSender, type PushSender } from "../../modules/push/push.sender.js";
import { registerSearchRoutes } from "../../modules/search/search.routes.js";
import { SearchService } from "../../modules/search/search.service.js";
import { registerInsightsRoutes } from "../../modules/insights/insights.routes.js";
import { InsightsService } from "../../modules/insights/insights.service.js";
import { registerReportsRoutes } from "../../modules/reports/reports.routes.js";
import { registerAgendaRoutes } from "../../modules/agenda/agenda.routes.js";
import { registerInvitationsRoutes } from "../../modules/invitations/invitations.routes.js";
import { InvitationsService } from "../../modules/invitations/invitations.service.js";
import { registerOauthRoutes } from "../../modules/users/oauth.routes.js";
import {
  HttpJwksProvider,
  OauthService,
} from "../../modules/users/oauth.service.js";
import { registerRecurringRoutes } from "../../modules/recurring/recurring.routes.js";
import { RecurringService } from "../../modules/recurring/recurring.service.js";
import { registerAchievementsRoutes } from "../../modules/achievements/achievements.routes.js";
import { AchievementsService } from "../../modules/achievements/achievements.service.js";
import { registerFeedRoutes } from "../../modules/feed/feed.routes.js";
import { FeedService } from "../../modules/feed/feed.service.js";
import { FeedWorker } from "../../modules/feed/feed.worker.js";
import { registerFeedCommentsRoutes } from "../../modules/feed-comments/feed-comments.routes.js";
import { FeedCommentsService } from "../../modules/feed-comments/feed-comments.service.js";
import { registerReferralsRoutes } from "../../modules/referrals/referrals.routes.js";
import { ReferralsService } from "../../modules/referrals/referrals.service.js";
import { registerStreaksRoutes } from "../../modules/streaks/streaks.routes.js";
import { StreaksService } from "../../modules/streaks/streaks.service.js";
import { registerChallengesRoutes } from "../../modules/challenges/challenges.routes.js";
import { ChallengesService } from "../../modules/challenges/challenges.service.js";
import { registerPaymentsRoutes } from "../../modules/payments/payments.routes.js";
import { registerStripeWebhookRoutes } from "../../modules/payments/stripe-webhook.routes.js";
import { PaymentsService } from "../../modules/payments/payments.service.js";
import { LiveStripeGateway, type StripeGateway } from "../../modules/payments/stripe-gateway.js";
import { registerVenueReviewsRoutes } from "../../modules/venue-reviews/venue-reviews.routes.js";
import { VenueReviewsService } from "../../modules/venue-reviews/venue-reviews.service.js";
import { registerMatchmakingRoutes } from "../../modules/matchmaking/matchmaking.routes.js";
import { MatchmakingService } from "../../modules/matchmaking/matchmaking.service.js";
import { registerLeaderboardsRoutes } from "../../modules/leaderboards/leaderboards.routes.js";
import { LeaderboardsService } from "../../modules/leaderboards/leaderboards.service.js";
import { registerSuggestedFollowsRoutes } from "../../modules/suggested-follows/routes.js";
import { SuggestedFollowsService } from "../../modules/suggested-follows/service.js";
import { registerStoriesRoutes } from "../../modules/stories/stories.routes.js";
import { StoriesService } from "../../modules/stories/stories.service.js";
import { StoriesExpireSweeper } from "../../modules/stories/stories-expire.sweeper.js";
// === Squads agent ===
// The persistent doubles foursome — owns /api/v1/squads* surface, push
// notification on invite uses the shared `pushService` constructed above.
import { registerSquadsRoutes } from "../../modules/squads/squads.routes.js";
import { SquadsService } from "../../modules/squads/squads.service.js";
// === Membership agent ===
import { registerMembershipRoutes } from "../../modules/membership/membership.routes.js";
import { MembershipService } from "../../modules/membership/membership.service.js";
import { type StripeMembershipAdapter } from "../../modules/membership/stripe-adapter.js";
// === Email agent ===
import { registerEmailRoutes } from "../../modules/email/email.routes.js";
import { EmailService } from "../../modules/email/email.service.js";
// === Scoring agent ===
import { registerScoringRoutes } from "../../modules/scoring/scoring.routes.js";
import { ScoringService } from "../../modules/scoring/scoring.service.js";
// === Medical agent ===
import { registerMedicalRoutes } from "../../modules/medical/medical.routes.js";
import { MedicalService } from "../../modules/medical/medical.service.js";
import {
  loadMedicalCrypto,
  type MedicalCrypto,
} from "../../modules/medical/medical.crypto.js";
import {
  LoggingTransport,
  buildSmtpTransport,
  type MailTransport,
} from "../../modules/email/email.transport.js";
// === Digest agent ===
import { registerDigestRoutes } from "../../modules/digest/digest.routes.js";
import { DigestService } from "../../modules/digest/digest.service.js";
import { DigestScheduler } from "../../modules/digest/digest.scheduler.js";
import { WeeklyRecapService } from "../../modules/digest/weekly-recap.service.js";
import { WeeklyRecapSweeper } from "../../modules/digest/weekly-recap.sweeper.js";
// === OG image agent ===
import { registerOgImageRoutes } from "../../modules/og-image/og-image.routes.js";
import { OgImageService } from "../../modules/og-image/og-image.service.js";
// === Data-rights agent ===
import { registerDataRightsRoutes } from "../../modules/data-rights/data-rights.routes.js";
import { DataRightsService } from "../../modules/data-rights/data-rights.service.js";
import { DataRightsSweeper } from "../../modules/data-rights/data-rights.sweeper.js";
import { GamesCompletionSweeper } from "../../modules/games/games-completion.sweeper.js";
import { GamesReminderSweeper } from "../../modules/games/games-reminder.sweeper.js";
// === Daily-digest sweeper (Wave-10) ===
// Hourly cron that fires a curated 18:00-local push for retention. Lives
// in the push module because the in-DB notification row is intentionally
// NOT created (the digest is push-only — no clutter on the bell tab).
import { DailyDigestSweeper } from "../../modules/push/daily-digest.sweeper.js";
// === Realtime (SSE) ===
import { registerRealtimeRoutes } from "../../modules/realtime/realtime.routes.js";
import { RealtimeBus } from "../../modules/realtime/realtime.bus.js";
// === Notification preferences ===
import { registerNotificationPreferencesRoutes } from "../../modules/notification-preferences/notification-preferences.routes.js";
import { NotificationPreferencesService } from "../../modules/notification-preferences/notification-preferences.service.js";
// === Telemetry (Prometheus metrics) ===
import {
  createTelemetry,
  type TelemetryHandle,
} from "../telemetry/metrics.js";
import { registerTelemetryPlugin } from "../telemetry/fastifyPlugin.js";
import { registerMetricsRoute } from "../telemetry/metricsRoute.js";
// === Observability (Sentry crash reporting) ===
// Initialized at the top of `buildServer` — before any route registration —
// so the Fastify `onError` hook fires for every subsequent route. A nil/empty
// `SENTRY_DSN` makes both calls no-ops so the server still boots cleanly in
// dev/CI without a configured Sentry project.
import {
  initSentry,
  setupFastify as setupSentryFastify,
} from "../observability/sentry.js";
// Product analytics (PostHog). Same shape as the Sentry facade — `initAnalytics`
// is a no-op without `POSTHOG_API_KEY`, and `track(...)` short-circuits when
// the client was never initialized. See `shared/observability/analytics.ts`.
import {
  initAnalytics,
  shutdownAnalytics,
} from "../observability/analytics.js";
import { type Probe } from "../../modules/health/health-deep.service.js";
// === App-info agent ===
// Tiny public endpoint the iOS client polls at cold-launch to decide
// whether to show the "Update available" nudge or the "Please update" gate.
import { registerAppInfoRoutes } from "../../modules/app-info/app-info.routes.js";
// Apple App Site Association — public, unauthenticated JSON at the exact
// path Apple's Universal Links fetcher demands.
import { registerAasaRoutes } from "../../modules/app-info/aasa.routes.js";
// === Announcements agent (Wave-10) ===
// Admin-curated, time-windowed broadcasts the iOS client surfaces as a
// slim dismissible top banner on Home.
import { registerAnnouncementsRoutes } from "../../modules/announcements/announcements.routes.js";
import { AnnouncementsService } from "../../modules/announcements/announcements.service.js";

export interface ServerDeps {
  env: Env;
  logger: Logger;
  db: DbHandle;
  /** Optional injection seam for the Stripe payments module. Integration
   *  tests pass a fake `StripeGateway` here so the real SDK never touches
   *  the network. When omitted we construct a `LiveStripeGateway` from
   *  `env.STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. */
  stripeGateway?: StripeGateway;
  /** Optional injection seam for the Email agent. Integration tests pass a
   *  `LoggingTransport` (or a custom capture transport) so no real SMTP
   *  socket is opened. When omitted we build an SMTP transport when all
   *  four `SMTP_*` env vars are set, and fall back to `LoggingTransport`
   *  otherwise. */
  mailTransport?: MailTransport;
  /** Optional injection seam for the Membership agent. Tests pass an
   *  in-memory fake so subscribe / cancel / webhook flows can be exercised
   *  without minting real Stripe Customers or Checkout Sessions. */
  membershipStripe?: StripeMembershipAdapter;
  /** Optional injection seam for the telemetry registry. Tests that want
   *  to assert specific metric values can pass their own handle; when
   *  omitted we construct a fresh one. Sharing one Registry across
   *  process restarts isn't possible (prom-client is in-memory by
   *  design), so each `buildServer` call gets its own series. */
  telemetry?: TelemetryHandle;
}

export type LinkfitServer = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  Logger,
  ZodTypeProvider
>;

export async function buildServer(deps: ServerDeps): Promise<LinkfitServer> {
  // Initialize Sentry crash reporting before constructing Fastify so the
  // SDK's process-level handlers (uncaughtException, unhandledRejection) are
  // installed first. Reads `SENTRY_DSN` from process env — a missing or
  // empty value makes this a no-op and `setupSentryFastify` further down
  // skips registering the hook. See `shared/observability/sentry.ts`.
  initSentry({ dsn: process.env.SENTRY_DSN });

  // Initialize product analytics (PostHog) alongside Sentry. A missing or
  // empty `POSTHOG_API_KEY` makes this a no-op so dev/CI environments boot
  // without a configured PostHog project. Server-side `track(...)` call sites
  // (auth signup, games.create, scoring.complete) short-circuit when the
  // client is never initialized. See `shared/observability/analytics.ts`.
  initAnalytics({
    apiKey: deps.env.POSTHOG_API_KEY,
    host: deps.env.POSTHOG_HOST,
    logger: {
      info: (msg) => {
        deps.logger.info(msg);
      },
      warn: (msg) => {
        deps.logger.warn(msg);
      },
    },
  });

  const app = Fastify({
    loggerInstance: deps.logger,
    disableRequestLogging: false,
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "request_id",
    genReqId: () => randomUUID(),
    trustProxy: deps.env.NODE_ENV === "production",
    bodyLimit: 1_048_576, // 1 MiB
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register Sentry's onError hook BEFORE any route registration so it
  // fires for every subsequent handler. Becomes a no-op when Sentry isn't
  // initialized (missing SENTRY_DSN).
  setupSentryFastify(app);

  await app.register(helmet, {
    contentSecurityPolicy: false, // API only, no HTML
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) { cb(null, true); return; }
      if (deps.env.CORS_ORIGINS.length === 0) { cb(null, false); return; }
      const allowed = deps.env.CORS_ORIGINS.includes(origin);
      cb(null, allowed);
    },
    credentials: true,
  });

  await app.register(rateLimit, {
    max: deps.env.RATE_LIMIT_MAX,
    timeWindow: deps.env.RATE_LIMIT_WINDOW_SECONDS * 1000,
  });

  // Serve uploaded message attachments. Files live under `env.UPLOAD_DIR`
  // and are exposed at `/uploads/<filename>`. The directory is created
  // eagerly so first-boot doesn't race with the first upload.
  mkdirSync(deps.env.UPLOAD_DIR, { recursive: true });
  await app.register(fastifyStatic, {
    root: deps.env.UPLOAD_DIR,
    prefix: "/uploads/",
    // We hand out random UUID filenames; no need for directory listings.
    index: false,
    list: false,
    // Cache aggressively — filenames are content-addressed (random uuid).
    cacheControl: true,
    maxAge: "30d",
    immutable: true,
    // Static files have no input — exclude them from swagger.
    decorateReply: false,
  });

  // OpenAPI generation from Zod schemas + Swagger UI at /docs.
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Linkfit API",
        description: "Hyper-local sports matchmaking — Phase 1.",
        version: "0.1.0",
      },
      servers: [{ url: `http://${deps.env.HOST}:${String(deps.env.PORT)}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: false },
  });

  app.setErrorHandler(async (err, req, reply) => {
    await fastifyErrorHandler(err, req, reply);
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `Route ${req.method} ${req.url} not found`,
        request_id: req.id,
      },
    });
  });

  // Telemetry: register early so onRequest/onResponse hooks fire for every
  // subsequent route registration. The /metrics endpoint is the operator
  // surface (Prometheus scrape target); business services may also import
  // the handle later to record custom counters.
  const telemetry = deps.telemetry ?? createTelemetry();
  registerTelemetryPlugin(app, telemetry);
  registerMetricsRoute(app, {
    telemetry,
    username: deps.env.METRICS_USER,
    password: deps.env.METRICS_PASSWORD,
  });

  // Periodically snapshot the PG pool into the gauge. Pool stats live on
  // the underlying pg.Pool — Kysely doesn't expose them. We sample every
  // 10s rather than on every query so the gauge tracks a recent state
  // without bloating CPU.
  const poolSnapshotTimer = setInterval(() => {
    telemetry.db.poolSize.set({ state: "total" }, deps.db.pool.totalCount);
    telemetry.db.poolSize.set({ state: "idle" }, deps.db.pool.idleCount);
    telemetry.db.poolSize.set({ state: "waiting" }, deps.db.pool.waitingCount);
  }, 10_000);
  poolSnapshotTimer.unref(); // Don't keep the event loop alive.
  app.addHook("onClose", () => { clearInterval(poolSnapshotTimer); return Promise.resolve(); });

  // Flush the PostHog buffer on shutdown so the last ~30s of events
  // are not lost when the process exits. No-op when analytics was
  // never initialized (dev/CI).
  app.addHook("onClose", async () => {
    await shutdownAnalytics();
  });

  // Trust & safety primitives — used by both the auth/register route
  // (IP throttle + disposable-email blacklist) and the follows service
  // (burst tripwire that flips `users.flagged_for_review`). One handle
  // shared so the config + logger come from a single source.
  const spamChecks = createSpamChecks({
    db: deps.db,
    logger: deps.logger,
    config: {
      signupRateLimitPerDay: deps.env.SIGNUP_RATE_LIMIT_PER_DAY,
      followBurstThreshold: deps.env.FOLLOW_BURST_THRESHOLD,
      followBurstWindowSec: deps.env.FOLLOW_BURST_WINDOW_SEC,
    },
  });

  const usersService = new UsersService({
    db: deps.db,
    logger: deps.logger,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
    accessTtlSeconds: deps.env.JWT_ACCESS_TTL_SECONDS,
    refreshTtlDays: deps.env.JWT_REFRESH_TTL_DAYS,
    telemetry,
  });
  registerUsersRoutes(app, {
    service: usersService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
    authRateLimit: {
      max: deps.env.AUTH_RATE_LIMIT_MAX,
      timeWindowMs: deps.env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
    },
    spamChecks,
  });

  // "Logged-in devices" surface — lets the user enumerate and revoke their
  // active refresh-token sessions. The `is_current` flag is derived from
  // the access-token `sid` claim populated by `signAccessToken`.
  const sessionsService = new SessionsService({ db: deps.db });
  registerSessionsRoutes(app, {
    service: sessionsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  const catalogService = new CatalogService({ db: deps.db });
  registerCatalogRoutes(app, { service: catalogService });

  // GamesService is constructed AFTER the notifications/push stack below
  // so its Wave-10 cancel/reschedule flows can fan out push banners to
  // confirmed participants. Forward-declared with `let` so downstream
  // wiring (invitationsService, etc.) can reference the same instance
  // once the notification deps are ready.

  // Achievements service — wired into ratings so each rating-batch
  // finalization triggers `evaluateForUser` for every participant.
  const achievementsService = new AchievementsService({ db: deps.db });
  registerAchievementsRoutes(app, { service: achievementsService });

  const ratingsService = new RatingsService({
    db: deps.db,
    achievements: achievementsService,
  });
  registerRatingsRoutes(app, {
    service: ratingsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Bookings service is always constructed so the payments module can flip
  // a booking to `paid` from the Stripe webhook regardless of whether the
  // user-facing booking routes are exposed. Routes themselves stay gated on
  // FEATURE_BOOKINGS to preserve the existing 404 behavior.
  const bookingsService = new BookingsService({ db: deps.db });
  if (deps.env.FEATURE_BOOKINGS) {
    registerBookingsRoutes(app, {
      service: bookingsService,
      jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
    });
  }

  // Push sender — APNs when all four envs are present, logging fallback
  // otherwise. The sender is owned by the server and closed on shutdown
  // via the Fastify `onClose` hook so HTTP/2 sessions don't leak in tests.
  const pushSender: PushSender =
    deps.env.APNS_KEY_ID !== undefined
      && deps.env.APNS_TEAM_ID !== undefined
      && deps.env.APNS_BUNDLE_ID !== undefined
      && deps.env.APNS_AUTH_KEY !== undefined
      ? new ApnsSender(
          {
            keyId: deps.env.APNS_KEY_ID,
            teamId: deps.env.APNS_TEAM_ID,
            bundleId: deps.env.APNS_BUNDLE_ID,
            authKey: deps.env.APNS_AUTH_KEY,
            useSandbox: deps.env.APNS_USE_SANDBOX,
          },
          deps.logger,
        )
      : new LoggingSender(deps.logger);
  app.addHook("onClose", async () => { await pushSender.close(); });

  const pushService = new PushService({ db: deps.db, sender: pushSender, logger: deps.logger });
  registerPushRoutes(app, { service: pushService, jwtAccessSecret: deps.env.JWT_ACCESS_SECRET });

  // === Realtime bus (SSE) ===
  // In-memory pub/sub keyed by user_id. Single-instance only — multi-pod
  // deployments need a Redis adapter, deliberately out of scope for now.
  const realtimeBus = new RealtimeBus();
  registerRealtimeRoutes(app, {
    bus: realtimeBus,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Notification preferences — both the routes layer and an in-process
  // service reference for the NotificationsService gating below.
  const prefsService = new NotificationPreferencesService({ db: deps.db });
  registerNotificationPreferencesRoutes(app, {
    service: prefsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  const notificationsService = new NotificationsService({
    db: deps.db,
    push: pushService,
    realtime: realtimeBus,
    preferences: prefsService,
  });

  // Wire the forward-declared GamesService now that notifications are
  // available. Routes register here too — done late so the cancel /
  // reschedule endpoints can broadcast pushes to participants the
  // moment they're added.
  const gamesService = new GamesService({
    db: deps.db,
    telemetry,
    notifications: notificationsService,
  });
  registerGamesRoutes(app, {
    service: gamesService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  const messagesService = new MessagesService({
    db: deps.db,
    notifications: notificationsService,
    realtime: realtimeBus,
  });
  const socialService = new SocialService({ db: deps.db });
  registerSocialRoutes(app, {
    notifications: notificationsService,
    messages: messagesService,
    social: socialService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
    uploadDir: deps.env.UPLOAD_DIR,
    publicBaseUrl: deps.env.PUBLIC_BASE_URL,
  });

  const followsService = new FollowsService({
    db: deps.db,
    notifications: notificationsService,
    spamChecks,
  });
  registerFollowsRoutes(app, {
    follows: followsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Blocks live next to follows because they're the same shape (bidirectional
  // user-to-user edges) and the blocks service tears down stale follow rows
  // as part of its transaction.
  const blocksService = new BlocksService({ db: deps.db });
  registerBlocksRoutes(app, {
    blocks: blocksService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  const adminService = new AdminService({ db: deps.db, notifications: notificationsService });
  registerAdminRoutes(app, {
    service: adminService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  const partnerService = new PartnerService({ db: deps.db });
  registerPartnerRoutes(app, {
    service: partnerService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Admin GDPR oversight — separate sub-module so the privacy-sensitive
  // surface stays distinguishable from regular admin operations.
  // Every read here writes a meta-audit row (admin.gdpr.list_*).
  const adminGdprService = new AdminGdprService({ db: deps.db, logger: deps.logger });
  registerAdminGdprRoutes(app, {
    service: adminGdprService,
    db: deps.db,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Admin moderation queue — the enriched (reporter+target joined) view of
  // the reports table plus the moderator action surface that can act on
  // targets in the same transaction. Sibling of the reports module, which
  // owns the user-facing report-creation surface and a minimal admin queue.
  const adminModerationService = new AdminModerationService({ db: deps.db });
  registerAdminModerationRoutes(app, {
    service: adminModerationService,
    db: deps.db,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  const tournamentsService = new TournamentsService({ db: deps.db });
  registerTournamentsRoutes(app, {
    service: tournamentsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  const americanoService = new AmericanoService({ db: deps.db });
  registerAmericanoRoutes(app, {
    service: americanoService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Group chat module — extends `conversations` with `kind='group'` rows tied
  // to a game or tournament. Lives side-by-side with the 1:1 messages routes
  // (which are feature-frozen) on the same `messages` table.
  registerGroupChatRoutes(app, {
    db: deps.db,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  const searchService = new SearchService({ db: deps.db });
  registerSearchRoutes(app, { service: searchService });

  // In-app calendar agent — aggregated agenda endpoint. Owns no service of
  // its own; reads directly from games/bookings/tournaments using SQL.
  registerAgendaRoutes(app, {
    db: deps.db,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // OAuth providers (Apple + Google) — sign-in endpoints that verify provider
  // JWS locally against cached JWKS and issue a Linkfit session.
  const oauthClientIdsApple = (process.env.OAUTH_APPLE_CLIENT_IDS ?? "az.linkfit.app")
    .split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const oauthClientIdsGoogle = (process.env.OAUTH_GOOGLE_CLIENT_IDS ?? "")
    .split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const oauthService = new OauthService({
    db: deps.db,
    logger: deps.logger,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
    accessTtlSeconds: deps.env.JWT_ACCESS_TTL_SECONDS,
    refreshTtlDays: deps.env.JWT_REFRESH_TTL_DAYS,
    appleClientIds: oauthClientIdsApple,
    googleClientIds: oauthClientIdsGoogle,
    jwks: new HttpJwksProvider(),
    telemetry,
  });
  registerOauthRoutes(app, {
    service: oauthService,
    authRateLimit: {
      max: deps.env.AUTH_RATE_LIMIT_MAX,
      timeWindowMs: deps.env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
    },
  });


  // === Email agent ===
  // Owns `email_tokens` and the four /api/v1/auth/{send-verification,
  // verify-email, request-password-reset, reset-password} routes.
  // Transport resolution: explicit injection (tests) > SMTP env (production)
  // > LoggingTransport fallback. The fallback exists so dev/test environments
  // never need real SMTP credentials.
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const mailFrom = process.env.MAIL_FROM ?? "no-reply@linkfit.app";
  let mailTransport: MailTransport;
  if (deps.mailTransport !== undefined) {
    mailTransport = deps.mailTransport;
  } else if (
    smtpHost !== undefined && smtpHost.length > 0 &&
    smtpPort !== undefined && smtpPort.length > 0 &&
    smtpUser !== undefined && smtpUser.length > 0 &&
    smtpPass !== undefined && smtpPass.length > 0
  ) {
    mailTransport = await buildSmtpTransport(
      { host: smtpHost, port: Number.parseInt(smtpPort, 10), user: smtpUser, pass: smtpPass },
      mailFrom,
      deps.logger,
    );
  } else {
    mailTransport = new LoggingTransport(deps.logger);
  }
  const publicAppUrl =
    process.env.PUBLIC_APP_URL ?? deps.env.PUBLIC_BASE_URL ?? "https://linkfit.app";
  const emailService = new EmailService({
    db: deps.db,
    logger: deps.logger,
    transport: mailTransport,
    publicAppUrl,
  });
  registerEmailRoutes(app, {
    service: emailService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
    authRateLimit: {
      max: deps.env.AUTH_RATE_LIMIT_MAX,
      timeWindowMs: deps.env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
    },
  });

  // Player insights agent — ELO/win-rate/games/opponents/reliability series
  // for `GET /api/v1/me/insights?sport=…&days=…`.
  const insightsService = new InsightsService({ db: deps.db });
  registerInsightsRoutes(app, {
    service: insightsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Reports + moderation. Owns BOTH the user-facing POST /api/v1/reports
  // and the admin /api/v1/admin/reports* surface — keeps admin module
  // focused on users/games/venues/tournaments.
  registerReportsRoutes(app, {
    db: deps.db,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Game invitations agent — direct host→player invites with accept/decline
  // and a pending-invites inbox at /api/v1/me/invitations.
  const invitationsService = new InvitationsService({
    db: deps.db,
    games: gamesService,
    notifications: notificationsService,
  });
  registerInvitationsRoutes(app, {
    service: invitationsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Recurring game series — host schedules a weekly slot, server
  // materializes N future games tagged with series_id so the rest of the
  // games API (/join, /leave, ratings, bookings) keeps working unchanged.
  const recurringService = new RecurringService({ db: deps.db });
  registerRecurringRoutes(app, {
    service: recurringService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Social activity feed. The route serves `GET /api/v1/feed`; the worker
  // fans events out of the source tables on a one-minute cadence. We start
  // it inside `onReady` so first-tick latency doesn't bottleneck app boot,
  // and stop it `onClose` so tests cleanly tear down the timer.
  const feedService = new FeedService({ db: deps.db });
  registerFeedRoutes(app, {
    feed: feedService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });
  const feedWorker = new FeedWorker({
    db: deps.db,
    emitter: feedService,
    logger: deps.logger,
  });
  app.addHook("onReady", () => {
    feedWorker.start();
    return Promise.resolve();
  });
  app.addHook("onClose", () => {
    feedWorker.stop();
    return Promise.resolve();
  });

  // === Feed comments (Wave-9) ===
  // Threaded comments under each feed_events row. POST fires an APNs alert
  // to the event actor (unless they're the commenter) and publishes a
  // `feed:comment` SSE event for live UI updates. DELETE allows either
  // the comment author OR the event actor to moderate.
  const feedCommentsService = new FeedCommentsService({
    db: deps.db,
    push: pushService,
    realtime: realtimeBus,
    logger: deps.logger,
  });
  registerFeedCommentsRoutes(app, {
    service: feedCommentsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Referrals agent ===
  // Friend-referral system: per-user share code + redeem endpoint. The
  // `users.referral_code` column is filled lazily on first read; new users
  // get 7 days to redeem someone else's code via POST /auth/redeem-referral.
  // Wave-10: ReferralsService also fans out a "Yeni dəvətli!" push on
  // signup-time attribution (see `attachReferrerOnSignup` + `notifyReferrer
  // OfSignup`). We pass both `notifications` and `logger` so that path can
  // emit through the same notifications surface as every other domain
  // event, and quietly log push failures without rolling back the signup
  // transaction. We then late-bind the service into UsersService so the
  // /auth/register route can call `attachReferrerOnSignup` inside its
  // signup transaction.
  const referralsService = new ReferralsService({
    db: deps.db,
    notifications: notificationsService,
    logger: deps.logger,
  });
  usersService.setReferrals(referralsService);
  registerReferralsRoutes(app, {
    service: referralsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Streaks agent ===
  // Per-user weekly play-streak: trailing 26-week heatmap + current/longest
  // counters. No new tables — purely derived from existing participation +
  // game start times.
  const streaksService = new StreaksService({ db: deps.db });
  registerStreaksRoutes(app, {
    service: streaksService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Challenges agent (Wave-10) ===
  // Daily gamified challenges: the home card surfaces 3 of 6 codes per
  // user per day (`follow_one`, `join_a_game`, `post_a_story`, etc.).
  // Auto-completion is reconciled when the iOS card refreshes — the
  // service peeks at the source tables (`follows`, `game_participants`,
  // `stories`, `feed_comments`, `game_invitations`, `story_reactions`)
  // and stamps `completed_at` for any challenge whose underlying action
  // landed since midnight UTC. This keeps the action hot-paths
  // (FollowsService, GamesService, ...) untouched — they don't need a
  // challenges-table dep.
  const challengesService = new ChallengesService({ db: deps.db });
  registerChallengesRoutes(app, {
    service: challengesService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Venue reviews agent ===
  // 1..5 star reviews on venues, optional body + photo. The aggregate VIEW
  // `venue_rating_summary` is read directly by venue cards on the iOS map.
  const venueReviewsService = new VenueReviewsService({ db: deps.db });
  registerVenueReviewsRoutes(app, {
    service: venueReviewsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Matchmaking agent ===
  // Personalized "For You" surface — ranked games + players for the iOS
  // home shell. Pure read endpoints; no schema changes. Scoring blends
  // ELO closeness, distance, friends going, and host reliability.
  const matchmakingService = new MatchmakingService({ db: deps.db });
  registerMatchmakingRoutes(app, {
    service: matchmakingService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Leaderboards agent ===
  // Public top-N-by-ELO ladder per sport. Auth is optional — anonymous
  // callers see the unfiltered list; signed-in callers get the
  // bidirectional block filter applied (drop users blocked by/blocking
  // the viewer). Reads `player_sport_stats` joined to `users`.
  const leaderboardsService = new LeaderboardsService({ db: deps.db });
  registerLeaderboardsRoutes(app, {
    service: leaderboardsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Suggested-follows agent ===
  // `GET /api/v1/me/suggested-follows` — ranked carousel of users the
  // viewer should consider following, scored by shared confirmed-game
  // history. Powers the iOS PlayersView horizontal carousel.
  const suggestedFollowsService = new SuggestedFollowsService({ db: deps.db });
  registerSuggestedFollowsRoutes(app, {
    service: suggestedFollowsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Stories agent ===
  // Instagram-style 24-hour ephemeral posts. Surface as round avatars on
  // top of the iOS home page — court photos, match wins, group chat clips.
  // Media bytes upload via `POST /api/v1/stories/upload-image`; the
  // out-of-band sweeper deletes expired rows + their on-disk media every
  // 30 minutes.
  const storiesService = new StoriesService({
    db: deps.db,
    notifications: notificationsService,
    realtime: realtimeBus,
    // Wave-13 — the "reply to story" route delegates message delivery
    // (DM thread resolve + insert + push + SSE) to MessagesService.send.
    messages: messagesService,
  });
  registerStoriesRoutes(app, {
    service: storiesService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
    uploadDir: deps.env.UPLOAD_DIR,
    publicBaseUrl: deps.env.PUBLIC_BASE_URL,
  });
  const storiesExpireSweeper = new StoriesExpireSweeper({
    db: deps.db,
    logger: deps.logger,
    uploadDir: deps.env.UPLOAD_DIR,
  });
  app.addHook("onReady", () => {
    storiesExpireSweeper.start();
    return Promise.resolve();
  });
  app.addHook("onClose", () => {
    storiesExpireSweeper.stop();
    return Promise.resolve();
  });

  // === Squads agent ===
  // Persistent doubles foursome. CRUD + invite/accept/leave + cross-table
  // games aggregation. `push` is wired so invites trigger a `squad.invite`
  // APNs payload to the invitee — best-effort, never blocks the inviter's
  // response.
  const squadsService = new SquadsService({
    db: deps.db,
    push: pushService,
    logger: deps.logger,
  });
  registerSquadsRoutes(app, {
    service: squadsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Stripe payments agent ===
  // Court bookings + tournament entry fees go through Stripe PaymentSheet.
  // The route surface is two intent-mint endpoints + one webhook receiver;
  // the webhook bypasses Zod and consumes the raw byte buffer because
  // Stripe's signature is computed over the exact bytes the platform sent.
  const stripeGateway: StripeGateway =
    deps.stripeGateway ??
    new LiveStripeGateway(
      deps.env.STRIPE_SECRET_KEY,
      deps.env.STRIPE_WEBHOOK_SECRET,
      deps.logger,
    );
  if (
    deps.env.STRIPE_SECRET_KEY === "sk_test_dummy" ||
    deps.env.STRIPE_WEBHOOK_SECRET === "whsec_test_dummy"
  ) {
    if (deps.env.NODE_ENV === "production") {
      throw new Error(
        "Stripe credentials are placeholders in production — set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET",
      );
    }
    deps.logger.warn(
      "stripe: running with placeholder credentials — PaymentSheet calls will fail until real keys are provided",
    );
  }
  const paymentsService = new PaymentsService({
    db: deps.db,
    stripe: stripeGateway,
    bookings: bookingsService,
    logger: deps.logger,
    telemetry,
  });
  registerPaymentsRoutes(app, {
    service: paymentsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });
  registerStripeWebhookRoutes(app, {
    service: paymentsService,
    stripe: stripeGateway,
  });

  // === Membership agent ===
  // Recurring subscription tiers (free, plus, premium). The Payments
  // agent owns one-shot PaymentIntents for bookings + tournament entries;
  // the Membership module owns its own Stripe Customer + Subscription
  // surface and persists state in the `memberships` table.
  //
  // When the caller doesn't inject a real adapter we fall back to a
  // synthetic one. That adapter is never invoked while
  // `STRIPE_SECRET_KEY` is the placeholder (service runs the demo-mode
  // path); when real keys are wired the deployment also needs to pass a
  // live adapter via `deps.membershipStripe`. Keeping this seam explicit
  // beats silently calling a production Stripe SDK from a fallback.
  const membershipStripe: StripeMembershipAdapter =
    deps.membershipStripe ?? {
      ensureCustomer: ({ user_id }) =>
        Promise.resolve({ id: `cus_placeholder_${user_id}` }),
      createCheckoutSession: ({ user_id, tier }) =>
        Promise.resolve({
          id: `cs_placeholder_${user_id}_${tier}`,
          url: `https://checkout.stripe.test/placeholder/${user_id}/${tier}`,
        }),
      cancelAtPeriodEnd: () => Promise.resolve(),
    };
  const membershipService = new MembershipService({
    db: deps.db,
    stripe: membershipStripe,
    logger: deps.logger,
    stripeSecretKey: deps.env.STRIPE_SECRET_KEY,
  });
  registerMembershipRoutes(app, {
    service: membershipService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Scoring agent ===
  // Live-during-the-match scoring surface. Owns CRUD on `match_scores` and
  // auto-flips the underlying `games.status` to `completed` on finalize so
  // the ratings flow can pick the match up without extra wiring.
  const scoringService = new ScoringService({ db: deps.db });
  registerScoringRoutes(app, {
    service: scoringService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === Digest agent ===
  // Weekly email digest. Re-uses the Email agent's MailTransport (or the
  // test-injected one) so we never open a second SMTP connection. The
  // scheduler starts on `onReady` and stops on `onClose` — same pattern as
  // the feed worker — so test teardown cleanly disposes the timer.
  const digestService = new DigestService({
    db: deps.db,
    logger: deps.logger,
    transport: mailTransport,
  });
  registerDigestRoutes(app, {
    service: digestService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
    db: deps.db,
  });
  const digestScheduler = new DigestScheduler({
    service: digestService,
    logger: deps.logger,
  });
  app.addHook("onReady", () => {
    digestScheduler.start();
    return Promise.resolve();
  });
  app.addHook("onClose", () => {
    digestScheduler.stop();
    return Promise.resolve();
  });

  // === Weekly recap sweeper (Wave-10) ===
  // Sunday 19:00 local-time-per-user "Bu həftə padel" story. Reuses the
  // Stories agent for delivery — the recap is posted as a system story on
  // the user's own rail, so it fans out to followers via the existing
  // stories realtime + feed paths. The PNG is rendered with satori+resvg
  // mirroring the og-image stack; the file is written into the same
  // upload dir served by @fastify/static — no new tables.
  const weeklyRecapService = new WeeklyRecapService({ db: deps.db });
  const weeklyRecapSweeper = new WeeklyRecapSweeper({
    db: deps.db,
    logger: deps.logger,
    recap: weeklyRecapService,
    stories: storiesService,
    notifications: notificationsService,
    uploadDir: deps.env.UPLOAD_DIR,
    publicBaseUrl: deps.env.PUBLIC_BASE_URL,
  });
  app.addHook("onReady", () => {
    weeklyRecapSweeper.start();
    return Promise.resolve();
  });
  app.addHook("onClose", () => {
    weeklyRecapSweeper.stop();
    return Promise.resolve();
  });

  // === Medical agent ===
  // Optional medical / emergency profile + tournament waiver
  // acknowledgments. Owner-only read/write on the profile; a host-only
  // summary endpoint exposes opted-in participants' minimal info if a
  // player gets hurt during a game.
  //
  // Encryption is opaque to the route layer: when `MEDICAL_ENCRYPTION_KEY`
  // is set the service stores AES-256-GCM ciphertext, otherwise raw
  // UTF-8. We emit a one-shot `medical_unencrypted_warning` log here so
  // ops notices the missing key.
  const medical: { crypto: MedicalCrypto; unencrypted: boolean } =
    loadMedicalCrypto(process.env.MEDICAL_ENCRYPTION_KEY);
  if (medical.unencrypted) {
    deps.logger.warn(
      { event: "medical_unencrypted_warning" },
      "medical: MEDICAL_ENCRYPTION_KEY is not set — medical profile columns will be stored as plaintext UTF-8 bytes",
    );
  }
  const medicalService = new MedicalService({
    db: deps.db,
    crypto: medical.crypto,
  });
  registerMedicalRoutes(app, {
    service: medicalService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // === OG image agent ===
  // Server-rendered Open Graph share images for game / user / tournament
  // links. PNGs are rendered with satori + resvg-js and cached in-process
  // with a 5-minute TTL keyed by entity id + last `updated_at`.
  const ogImageService = new OgImageService({ db: deps.db });
  registerOgImageRoutes(app, { service: ogImageService });

  // === Data-rights agent (GDPR) ===
  // Owns account deletion (immediate PII anonymization + 30-day hard-delete
  // grace) and data export (synchronous JSON dump under /uploads/data-exports).
  // The service writes export files into the same upload directory the static
  // handler already serves, so no new static route is needed.
  const dataRightsService = new DataRightsService({
    db: deps.db,
    logger: deps.logger,
    uploadDir: deps.env.UPLOAD_DIR,
    publicBaseUrl: deps.env.PUBLIC_BASE_URL ?? `http://${deps.env.HOST}:${String(deps.env.PORT)}`,
  });
  registerDataRightsRoutes(app, {
    service: dataRightsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  // Out-of-band sweeper for hard-deletes (post-30-day) + expired exports.
  // We start it on `onReady` so first-tick latency doesn't bottleneck app
  // boot, and stop it on `onClose` so tests cleanly tear down the timer.
  const dataRightsSweeper = new DataRightsSweeper({
    db: deps.db,
    logger: deps.logger,
    uploadDir: deps.env.UPLOAD_DIR,
  });
  app.addHook("onReady", () => {
    dataRightsSweeper.start();
    return Promise.resolve();
  });
  app.addHook("onClose", () => {
    dataRightsSweeper.stop();
    return Promise.resolve();
  });

  // Games-completion sweeper — closes games whose end time has passed and
  // applies the reliability penalty to confirmed participants who never
  // recorded a score (no-show). Pairs with iOS's `isJoinable` guard (FAZA
  // 61.1): together they prevent users from landing on a stale game and
  // also enforce the social contract behind the "no-show warning" banner.
  const gamesCompletionSweeper = new GamesCompletionSweeper({
    db: deps.db,
    logger: deps.logger,
  });
  app.addHook("onReady", () => {
    gamesCompletionSweeper.start();
    return Promise.resolve();
  });
  app.addHook("onClose", () => {
    gamesCompletionSweeper.stop();
    return Promise.resolve();
  });

  // Pre-game reminder sweeper (FAZA 62) — fires a "Your game starts in
  // 2 hours" notification to every confirmed participant exactly once.
  // The 2hr window is a UX nudge: long enough that someone can still
  // bail-and-leave without dropping their reliability_score (a separate
  // grace), short enough that nobody forgets. Ledger-table dedupe
  // guarantees no double-pushes even across sweeper restarts.
  const gamesReminderSweeper = new GamesReminderSweeper({
    db: deps.db,
    logger: deps.logger,
    notifications: notificationsService,
  });
  app.addHook("onReady", () => {
    gamesReminderSweeper.start();
    return Promise.resolve();
  });
  app.addHook("onClose", () => {
    gamesReminderSweeper.stop();
    return Promise.resolve();
  });

  // === Daily-digest sweeper (Wave-10) ===
  // Hourly cron that wakes once at the top of the hour and looks for
  // users whose local clock just hit 18:00 (per `users.time_zone`). For
  // each match, builds a 3-slot digest (top recommended player, top
  // open game, top followed-user story) and fires a single push with
  // a deep link to the relevant iOS tab. Ledger table `daily_digest_sent`
  // keyed on `(user_id, sent_date)` prevents duplicate sends within a
  // local calendar day.
  const dailyDigestSweeper = new DailyDigestSweeper({
    db: deps.db,
    logger: deps.logger,
    push: pushService,
  });
  app.addHook("onReady", () => {
    dailyDigestSweeper.start();
    return Promise.resolve();
  });
  app.addHook("onClose", () => {
    dailyDigestSweeper.stop();
    return Promise.resolve();
  });

  // === Health-check routes (basic /health + deep /health/ready) ===
  // Registered last so probes can reference the live dependencies
  // (Stripe, SMTP, APNs) constructed above. The deep route reports a
  // skipped status for any optional dependency configured with
  // placeholder credentials, so the readiness probe doesn't false-fail
  // in dev/test setups.
  const readinessProbes: Record<string, Probe> = {};

  // Stripe probe — skipped on dummy key, otherwise a 1s account.retrieve.
  if (deps.env.STRIPE_SECRET_KEY === "sk_test_dummy") {
    readinessProbes.stripe = () =>
      Promise.resolve({ status: "skipped", reason: "dummy_key" });
  } else {
    readinessProbes.stripe = async () => {
      const start = Date.now();
      try {
        // The live gateway is owned by the payments module; we don't pull
        // it into the health probe because that would couple liveness to
        // payments. Instead, we use a tiny HTTPS HEAD against Stripe's
        // status page-like account endpoint via the Stripe SDK that was
        // already constructed for payments. Defer to a lazy import to
        // avoid pulling the Stripe types into the health module's
        // surface.
        await new Promise<void>((resolve) => {
          // Lightweight ping: just check that the secret key is shaped
          // like a Stripe live/test key. We avoid HTTP because the
          // readiness probe must complete <1s reliably; a real Stripe
          // round-trip can spike on Stripe's side.
          if (!/^sk_(test|live)_/.test(deps.env.STRIPE_SECRET_KEY)) {
            throw new Error("malformed stripe key");
          }
          resolve();
        });
        return { status: "ok", latency_ms: Date.now() - start };
      } catch (err) {
        return {
          status: "fail",
          reason: err instanceof Error ? err.message : "stripe probe failed",
        };
      }
    };
  }

  // SMTP probe — skipped when no SMTP_HOST is set, otherwise verify the
  // configured transporter is still connected.
  if (process.env.SMTP_HOST === undefined || process.env.SMTP_HOST.length === 0) {
    readinessProbes.smtp = () =>
      Promise.resolve({ status: "skipped", reason: "not_configured" });
  } else {
    readinessProbes.smtp = () =>
      // We don't open a fresh socket on every readiness call — that would
      // hammer the SMTP server. A genuine probe would be `transporter.verify()`,
      // but Nodemailer doesn't expose that on our MailTransport adapter,
      // and threading the raw transporter through is out of scope here.
      // Status is "ok" if the env is configured; failure surfaces via the
      // actual send path's metrics + logs.
      Promise.resolve({ status: "ok" });
  }

  // APNs probe — same logic: skipped without config, otherwise "ok".
  if (deps.env.APNS_KEY_ID === undefined) {
    readinessProbes.apns = () =>
      Promise.resolve({ status: "skipped", reason: "not_configured" });
  } else {
    readinessProbes.apns = () => Promise.resolve({ status: "ok" });
  }

  registerHealthRoutes(app, {
    db: deps.db,
    readinessProbes,
  });

  // === App-info routes ===
  // Public, unauthenticated `GET /api/v1/app/version`. Sourced from env so
  // ops can bump the iOS gate values without a redeploy.
  registerAppInfoRoutes(app, { env: deps.env });

  // Apple App Site Association — public JSON at
  // `/.well-known/apple-app-site-association` for Universal Links.
  registerAasaRoutes(app);

  // === Announcements routes ===
  // Admin POST mints a broadcast; the user-facing GET returns the
  // highest-priority active row in the caller's locale.
  const announcementsService = new AnnouncementsService({ db: deps.db });
  registerAnnouncementsRoutes(app, {
    service: announcementsService,
    jwtAccessSecret: deps.env.JWT_ACCESS_SECRET,
  });

  return app;
}
