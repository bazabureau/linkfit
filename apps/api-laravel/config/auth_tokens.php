<?php

return [
    // Keep this HS256 secret stable so access tokens remain valid across
    // backend deployments. Set JWT_ACCESS_SECRET in .env.
    'access_secret' => env('JWT_ACCESS_SECRET', ''),
    'access_ttl_seconds' => (int) env('JWT_ACCESS_TTL_SECONDS', 900),
    'refresh_ttl_days' => (int) env('JWT_REFRESH_TTL_DAYS', 30),
    // Convenience: refresh TTL expressed in seconds for Set-Cookie Max-Age.
    'refresh_ttl_seconds' => ((int) env('JWT_REFRESH_TTL_DAYS', 30)) * 86400,

    // ── Auth cookie attributes (web clients) ────────────────────────────
    // Web (admin/partner/web) clients carry the access/refresh tokens in
    // httpOnly cookies (lf_access / lf_refresh) instead of JS-readable storage.
    // The mobile app is unaffected — it keeps using the Bearer header + body.
    //
    // cookie_domain: the parent domain the cookies are scoped to so they are
    //   sent to api.linkfit.az from every *.linkfit.az frontend (".linkfit.az"
    //   in prod). Null (default) omits the Domain attribute — correct for local
    //   dev and the test suite (host-only cookie).
    // cookie_secure: emit the Secure flag (HTTPS-only). Defaults to true in
    //   production and false elsewhere; override with AUTH_COOKIE_SECURE.
    'cookie_domain' => env('AUTH_COOKIE_DOMAIN') ?: null,
    'cookie_secure' => filter_var(
        env('AUTH_COOKIE_SECURE', (string) (env('APP_ENV') === 'production')),
        FILTER_VALIDATE_BOOLEAN
    ),

    // argon2id params — MUST match the existing hashes so old users verify
    // and new hashes are consistent (memory_cost in KiB).
    'argon' => [
        'memory_cost' => 65536,
        'time_cost' => 3,
        'threads' => 4,
    ],
];
