# Linkfit Admin Panel

Internal admin console for Linkfit. Used by operations and trust-and-safety to manage users, games, venues, tournaments, view reports, and audit activity.

## Architecture

- **Next.js 15** (App Router, React Server Components where useful)
- **TypeScript** strict mode
- **Tailwind CSS** + a small shadcn-style component layer in `src/components/ui`
- **React Query** (`@tanstack/react-query`) for server state, caching, and optimistic updates
- **React Hook Form** + **Zod** for forms and validation
- **Recharts** for dashboard charts
- **Sonner** for toasts, **Lucide** for icons
- Auth: cookie-stored access token issued by the Linkfit API; admin-only routes are gated server-side by an `admin_role` claim

The admin panel talks to the Linkfit Node/Fastify API at `apps/api` over `/api/v1/admin/*`. It is a separate Next.js app from the public web/iOS surface and runs on port `3100` in dev.

```
apps/
  api/         Fastify + Postgres, exposes /api/v1/admin/*
  admin/       this app — Next.js 15
  ios/         native client (unrelated)
```

## Layout

```
src/
  app/
    (auth)/login       sign-in page (public)
    (dashboard)/       authenticated shell with sidebar
      page.tsx         / — overview
      users/           user moderation
      games/           game catalog
      venues/          venue directory
      tournaments/     tournament management
      reports/         user reports queue
      audit/           append-only audit log
    api/               Next.js route handlers (proxy / BFF helpers)
  components/ui/       shadcn-style primitives
  lib/admin-queries.ts React Query hooks for /admin/* endpoints
scripts/
  smoke.sh             end-to-end API smoke test
e2e/
  login.spec.ts        Playwright login happy-path
```

## Local development

### 1. Install dependencies

From the repo root (recommended, so workspaces resolve):

```bash
npm install
```

Or scoped just to this package:

```bash
cd apps/admin && npm install
```

### 2. Environment

Create `apps/admin/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_API_PREFIX=/api/v1
```

`NEXT_PUBLIC_API_URL` must point at the running Linkfit API. In production this is the public API origin (e.g. `https://api.linkfit.app`).

### 3. Run the API

In a separate terminal:

```bash
cd apps/api
npm run migrate:up
npm run dev          # listens on :3000
```

### 4. Run the admin panel

```bash
cd apps/admin
npm run dev          # listens on :3100
```

Open <http://localhost:3100/login>.

### 5. Login

Use the seeded admin (see `apps/api` seed script) or register one and promote it to admin in the DB:

```sql
UPDATE users SET admin_role = 'super_admin' WHERE email = 'you@linkfit.app';
```

Default seeded credentials (dev only):

- Email: `admin@linkfit.app`
- Password: `AdminPass123!`

After login you're redirected to `/` (the dashboard overview).

## Feature pages

| Route          | Purpose                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| `/`            | Dashboard overview — KPIs, recent signups, live tournament counts             |
| `/users`       | Search, suspend, promote, demote, and view detail for any Linkfit user        |
| `/games`       | Manage the supported game catalog (rules, skill ranges, icons)                |
| `/venues`      | Approve, edit, geocode, and feature physical/virtual venues                   |
| `/tournaments` | Create, schedule, cancel, and audit tournaments and brackets                  |
| `/reports`     | Triage user reports (spam, harassment, cheating) and apply moderation actions |
| `/audit`       | Read-only append-only audit log of every privileged admin action             |

## Auth notes

- The API issues an **access token** (short-lived JWT) and a **refresh token** on `POST /api/v1/auth/login`.
- The admin shell stores the access token in an `httpOnly` cookie set by a Next.js route handler so the browser never sees raw JWT.
- Each `/admin/*` request includes `Authorization: Bearer <accessToken>`. The server enforces `admin_role IN ('admin', 'super_admin')` on every handler.
- A 401 from the API triggers a client-side redirect to `/login`. A 403 (logged in but not an admin) shows a "Not authorized" page — it does **not** log the user out.
- Refresh: when an access token is within 60 s of expiry, the BFF route handler silently calls `/api/v1/auth/refresh` and rewrites the cookie.

## Build and deploy

```bash
npm run build        # produces .next/
npm run start        # production server, port 3100
```

### Vercel

The app is Vercel-friendly out of the box:

1. Import `apps/admin` as the Vercel project root.
2. Set environment variables in the Vercel dashboard:
   - `NEXT_PUBLIC_API_URL` — e.g. `https://api.linkfit.app`
   - `NEXT_PUBLIC_API_PREFIX` — `/api/v1`
3. Build command: `npm run build`. Output: `.next` (default).
4. Restrict access via Vercel team SSO or a Vercel password (the panel is for internal use only).

### Self-hosted

`npm run build && npm run start` behind any Node-friendly reverse proxy (nginx, Caddy). The process is stateless — scale horizontally.

## Smoke test

`scripts/smoke.sh` is a `curl`-only health check that exercises every admin endpoint end-to-end. It registers/logs in as an admin, then hits each `/admin/*` route once and prints a per-endpoint pass/fail summary.

```bash
# default: hits http://localhost:3000 with the seeded admin
./scripts/smoke.sh

# custom API + credentials
API_URL=https://api.linkfit.app \
ADMIN_EMAIL=you@linkfit.app \
ADMIN_PASSWORD='hunter2!' \
  ./scripts/smoke.sh
```

Exit codes: `0` = all green, `1` = at least one endpoint failed, `2` = could not log in. Skip the registration step with `REGISTER_IF_MISSING=0` in environments where you don't want to create users.

## End-to-end tests

Playwright is configured in `playwright.config.ts`. Specs live in `e2e/`.

```bash
npx playwright install        # one-time, downloads browsers
npx playwright test           # runs against the dev server started by the config
```

The current happy-path test logs in and asserts the dashboard renders. Extend per feature page as functionality lands.
