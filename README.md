# Linkfit

Hyper-local sports matchmaking marketplace for players, venues, and operators. The current backend is Laravel/PostgreSQL; the old Node/Fastify API has been removed.

## Repo Layout

```text
linkfit/
├── apps/
│   ├── api-laravel/ # Laravel API, JWT auth, bookings, games, social, admin/partner APIs
│   ├── web/         # Public/player Next.js app
│   ├── admin/       # Internal admin dashboard
│   └── partner/     # Venue/club partner dashboard
├── docker-compose.yml
├── docker-compose.prod.yml
└── .github/workflows/ci.yml
```

## Local Setup

```bash
# 1. Postgres for local dev
docker compose up -d postgres

# 2. Laravel API
cd apps/api-laravel
cp .env.example .env
composer install
php artisan key:generate
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8788

# Health check
curl -s http://127.0.0.1:8788/health
```

## Web Apps

```bash
cd apps/web
npm install
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8788/api/v1 npm run dev

cd ../admin
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 NEXT_PUBLIC_API_PREFIX=/api/v1 npm run dev

cd ../partner
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 NEXT_PUBLIC_API_PREFIX=/api/v1 npm run dev
```

## Verification

```bash
cd apps/api-laravel
php artisan test

cd ../web
npm run lint
npm run build
```

## Production Compose Skeleton

```bash
cp .env.production.example .env.production
# Fill every blank secret/value in .env.production.
# Put TLS files at infra/certs/fullchain.pem and infra/certs/privkey.pem.

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production exec api php artisan migrate --force
```

The live production notes are in [apps/api-laravel/MIGRATION.md](apps/api-laravel/MIGRATION.md).
