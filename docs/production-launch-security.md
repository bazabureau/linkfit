# Linkfit production launch security

This is the production checklist for the launch period where every user has
full access and public subscription/payment controls stay hidden.

## API authentication model

Public web and mobile clients must not depend on a static API key for security.
Browser and mobile builds are observable, so any `NEXT_PUBLIC_*`, bundled iOS,
or bundled Android value must be treated as public. Production should leave the
public app-key gate disabled:

```env
REQUIRE_API_KEY=false
APP_PUBLIC_API_KEYS=
APP_PUBLIC_API_KEY_HASHES=
CORS_ALLOWED_ORIGINS=https://linkfit.az,https://www.linkfit.az,https://admin.linkfit.az,https://owner.linkfit.az
```

Mobile, web, admin, owner, and partner clients authenticate users with short
lived Bearer access tokens and refresh through the auth API. Backend role and
resource authorization remains authoritative for private data and mutating
actions. Browser requests with an `Origin` header must come from one of the
configured Linkfit origins. Native/mobile clients usually send no `Origin`
header and pass through that browser-only check.

Public app keys are optional operational metadata, not a security boundary. If
you deliberately enable `REQUIRE_API_KEY=true`, generate a key with
`php artisan security:make-api-key`, store only its SHA-256 hash in
`APP_PUBLIC_API_KEY_HASHES`, never put the key in server logs, and never treat it
as a replacement for JWT auth or authorization checks.

## Layered API protection model

Do not protect the product with a single API key. Production must keep these
layers active together:

- CORS/origin guard: blocks browser use from non-Linkfit origins.
- JWT/session auth: identifies the user for private and mutating actions.
- Role/permission checks: admin, moderator, partner, coach, and player actions
  must authorize on the backend.
- Minimal public payloads: anonymous player/social surfaces expose only public
  directory data, never email, phone, home coordinates, medical data, payment
  data, or admin fields.
- Rate limits: bucket traffic by real IP and JWT/access token. Discovery/search
  and write actions use tighter limits than the global API ceiling. If the
  optional public app-key gate is enabled, app-key fingerprint buckets can be
  layered in too.
- Logs/audit: mutating admin/partner/payment/moderation actions write to
  `audit_log`; rejected optional app keys are logged with request id, IP,
  origin, and fingerprint only.

Recommended production defaults:

```env
API_RATE_LIMIT_PER_MINUTE=600
API_IP_RATE_LIMIT_PER_MINUTE=300
API_APP_KEY_RATE_LIMIT_PER_MINUTE=1200
API_PUBLIC_DISCOVERY_RATE_LIMIT_PER_MINUTE=120
API_PUBLIC_DISCOVERY_IP_RATE_LIMIT_PER_MINUTE=60
API_PUBLIC_DISCOVERY_APP_KEY_RATE_LIMIT_PER_MINUTE=240
API_WRITE_RATE_LIMIT_PER_MINUTE=60
API_WRITE_IP_RATE_LIMIT_PER_MINUTE=40
API_WRITE_APP_KEY_RATE_LIMIT_PER_MINUTE=180
```

## Internal server keys

Use a separate internal key only for server-to-server routes:

```bash
php artisan security:make-api-key --internal
```

Set only the generated SHA-256 value on the API server:

```env
INTERNAL_API_KEYS=
INTERNAL_API_KEY_HASHES=<sha256-from-command>
```

Never ship an internal key in web, mobile, admin, or partner frontends.
Production boot fails if `INTERNAL_API_KEY_HASHES` is empty, so internal
server routes cannot silently deploy without an explicit server-to-server
credential.

## Rotation policy

Public app keys are optional and are not secrets. If the optional gate is
enabled, rotate them when a build surface is abused or retired:

1. Generate a new key with `php artisan security:make-api-key`.
2. Add the new SHA-256 hash to `APP_PUBLIC_API_KEY_HASHES` while keeping the old
   hash active.
3. Deploy the affected client with the new non-secret client key.
4. Remove the old hash after the old build/version is no longer supported.

Internal keys are private credentials. Rotate them like passwords: deploy the
new hash and server secret together, then remove the old hash as soon as all
callers have moved.

## Launch access and subscriptions

During the launch period users must receive full access without seeing payment
or subscription controls:

```env
FREE_TRIAL_DAYS=50
GLOBAL_FULL_ACCESS_UNTIL=2026-08-09T23:59:59Z
MEMBERSHIP_PUBLIC_SUBSCRIPTIONS_ENABLED=false
MEMBERSHIP_PAYMENTS_ENABLED=false
MEMBERSHIP_PAYMENT_PROVIDER=
```

Production boot intentionally fails if public subscriptions are disabled but
the full-access window is missing, expired, or shorter than the 50 day launch
trial.

## Deploy checks

After changing production env:

```bash
php artisan config:clear
php artisan config:cache
php artisan migrate --force
php artisan test --filter='ApiKeyGuardTest|LaunchConfigurationTest|ApiSurfaceTest|MembershipAccessTest|PaymentProviderGuardTest'
```

Smoke check the public, internal, and browser-origin paths:

```bash
curl https://api.linkfit.az/api/v1/app/metadata
curl https://api.linkfit.az/api/v1/mobile/config
curl -H "X-Linkfit-Internal-Key: <lf_internal_...>" https://api.linkfit.az/api/v1/internal/capabilities
curl -H "Origin: https://evil.example" https://api.linkfit.az/api/v1/app/metadata
```

The first three requests should succeed. The last request should be forbidden
because browser origins outside the Linkfit allowlist are rejected.
