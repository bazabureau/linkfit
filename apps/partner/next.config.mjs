import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
import { withSentryConfig } from "@sentry/nextjs";

const isProduction = process.env.NODE_ENV === "production";

// Owner panel must never be embedded — DENY framing, no device permissions.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
];

const buildConfig = (phase) => {
  const isBuild = phase === PHASE_PRODUCTION_BUILD;
  return {
    basePath: "/owner",
    assetPrefix: "/owner",
    reactStrictMode: true,
    turbopack: {
      root: process.cwd(),
    },
    env: {
      IS_BUILD_PHASE: isBuild ? "true" : "false",
    },
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
  };
};

// Wrap with Sentry only when a DSN is configured, leaving the default build
// path unchanged until Sentry is activated.
const useSentry = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

export default useSentry
  ? withSentryConfig(buildConfig, { silent: !process.env.CI, telemetry: false })
  : buildConfig;
