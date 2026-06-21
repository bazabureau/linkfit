import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
import { withSentryConfig } from "@sentry/nextjs";

const isProduction = process.env.NODE_ENV === "production";

// Allow the panel to reach the Linkfit API (XHR/fetch) — defaults to prod host.
const apiOrigin = process.env.NEXT_PUBLIC_API_URL || "https://api.linkfit.az";

// Strict CSP as a second line of defense against XSS exfiltration. We must
// allow 'unsafe-inline' for styles (Tailwind/Next inject inline style tags) and
// for scripts (Next's inline bootstrap) — 'unsafe-eval' is added in dev only
// for React Fast Refresh. connect-src is limited to self + the API origin so a
// successful injection cannot phone tokens out to an arbitrary host.
const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
];

// Owner panel must never be embedded — DENY framing, no device permissions.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: cspDirectives.join("; ") },
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
