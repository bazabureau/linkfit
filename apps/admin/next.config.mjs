import { withSentryConfig } from "@sentry/nextjs";

// Admin panel must never be embedded — DENY framing, no device permissions.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/admin",
  assetPrefix: "/admin",
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Wrap with Sentry only when a DSN is configured, leaving the default build
// path unchanged until Sentry is activated.
const config =
  process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN
    ? withSentryConfig(nextConfig, { silent: !process.env.CI, telemetry: false })
    : nextConfig;

export default config;
