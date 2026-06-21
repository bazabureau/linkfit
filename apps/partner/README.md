# Linkfit Partner Dashboard

Venue and club operations dashboard for Linkfit partners. It manages venue settings, courts, bookings, waitlist, blocked slots, reviews, tournaments, revenue, staff, and account details.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- React Query
- React Hook Form + Zod
- Recharts, Sonner, Lucide

The partner dashboard talks to the Laravel API in `apps/api-laravel` over `/api/v1/partner/*`.

## Local Development

Run the API:

```bash
cd ../api-laravel
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8788
```

Run partner:

```bash
cd ../partner
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 NEXT_PUBLIC_API_PREFIX=/api/v1 npm run dev
```

Open <http://localhost:3200/login>.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```
