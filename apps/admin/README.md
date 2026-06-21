# Linkfit Admin Panel

Internal admin console for Linkfit operations and trust-and-safety. It manages users, games, venues, bookings, tournaments, reports, promos, staff, support, moderation, and audit activity.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- React Query
- React Hook Form + Zod
- Recharts, Sonner, Lucide

The admin panel talks to the Laravel API in `apps/api-laravel` over `/api/v1/admin/*`.

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

Run admin:

```bash
cd ../admin
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 NEXT_PUBLIC_API_PREFIX=/api/v1 npm run dev
```

Open <http://localhost:3100/login>.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```
