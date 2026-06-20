# Linkfit production launch security

This is the production checklist for the launch period where every user has
full access and public subscription/payment controls stay hidden.

## API app key gate

Generate one public client key for official Linkfit web/mobile builds:

```bash
php artisan security:make-api-key
```

Set only the generated SHA-256 value on the API server:

```env
REQUIRE_API_KEY=true
APP_PUBLIC_API_KEYS=
APP_PUBLIC_API_KEY_HASHES=<sha256-from-command>
CORS_ALLOWED_ORIGINS=https://linkfit.az,https://www.linkfit.az,https://admin.linkfit.az,https://owner.linkfit.az
```

Set the generated plain key on every official client build:

```env
NEXT_PUBLIC_LINKFIT_APP_KEY=<lf_public_...>
```

All official clients must send it as:

```http
X-Linkfit-App-Key: <lf_public_...>
```

Do not send the key in a query string. Do not use it as user auth. It only
identifies Linkfit-owned client builds; JWT auth and role checks still protect
user/admin/partner data.

Browser requests with an `Origin` header must come from one of the configured
Linkfit origins. Native/mobile clients usually send no `Origin` header and are
still required to send the public app key.

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

Smoke check with a valid public client key:

```bash
curl -H "X-Linkfit-App-Key: <lf_public_...>" https://api.linkfit.az/api/v1/app/metadata
curl -H "X-Linkfit-App-Key: <lf_public_...>" https://api.linkfit.az/api/v1/mobile/config
curl https://api.linkfit.az/api/v1/app/metadata
curl -H "Origin: https://evil.example" -H "X-Linkfit-App-Key: <lf_public_...>" https://api.linkfit.az/api/v1/app/metadata
```

The first two requests should succeed. The last two requests should be
forbidden when `REQUIRE_API_KEY=true`.
