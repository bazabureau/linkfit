# Linkfit Laravel API

This is the Linkfit Laravel API backend.

## Local run

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8788
```

Health:

```bash
curl http://127.0.0.1:8788/health
```

## Verification

```bash
./vendor/bin/pint --dirty
composer test
php artisan route:list --path=api/v1
```

The API keeps the old `/api/v1/...` wire contract: snake_case JSON,
JWT auth, rotating refresh tokens, and the same error envelope.
