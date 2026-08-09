# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

EduSolution.com is a two-package web app: a React SPA (`frontend/`) and a
Node/Express API (`backend/`) with a SQLite database, connected by a
JWT-based auth flow (signup/login/dashboard). There is no root package.json
— each package is installed and run independently.

Beyond auth, the backend/frontend implement a small business-management
module — clients, quotes, invoices, payments/receipts, and a financials
summary — shared across every logged-in user (single-business model, not
multi-tenant). See "Business module" below.

## Commands

### Backend (`backend/`)

```bash
cd backend
npm install
cp .env.example .env      # first time only; edit JWT_SECRET for anything beyond local dev
npm run dev                # nodemon, auto-restart, http://localhost:4000
npm start                  # plain node, no auto-restart
```

No test suite or linter is configured yet.

### Frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev                # Vite dev server, http://localhost:5173
npm run build               # production build to frontend/dist
npm run preview             # serve the production build locally
npm run lint                 # oxlint
```

No test suite is configured yet.

### Running the full app locally

Both dev servers must be running simultaneously (separate terminals/processes):
backend on `:4000`, frontend on `:5173`. The Vite dev server proxies
`/api/*` to `http://localhost:4000` (see `frontend/vite.config.js`), so the
frontend always calls its own origin's `/api/...` — never hardcode the
backend port in frontend code.

## Architecture

### Backend (`backend/src/`)

- `index.js` — Express app entry point: CORS (restricted to `CLIENT_ORIGIN`
  from env), JSON body parsing, mounts routes under `/api`, 404 + error
  handlers.
- `db/index.js` — opens `backend/data.sqlite3` via `better-sqlite3` (a
  synchronous SQLite driver — no async/await needed for queries) and runs
  `CREATE TABLE IF NOT EXISTS` on startup. This is the only place schema is
  defined; there is no migration tool, so schema changes are made by editing
  the `CREATE TABLE` statement directly (fine pre-launch; revisit once there's
  production data).
- `middleware/auth.js` — `requireAuth` verifies the `Authorization: Bearer
  <jwt>` header and attaches the decoded payload to `req.user`. Any new
  protected route should use this middleware rather than re-implementing
  token checks.
- `routes/auth.js` — `POST /api/auth/signup`, `POST /api/auth/login`,
  `GET /api/auth/me`. Passwords are hashed with bcryptjs before storage;
  JWTs are signed with `JWT_SECRET` from env and expire after 7 days.
  `publicUser()` is the single place that shapes what user data is ever
  sent to the client — extend it rather than returning raw DB rows elsewhere.

Environment variables (see `backend/.env.example` for the full list with
comments): `PORT`, `JWT_SECRET`, `CLIENT_ORIGIN`, and `SMTP_HOST`/`PORT`/
`USER`/`PASS`/`FROM`/`SECURE` for outgoing email. `backend/data.sqlite3`
and `.env` are gitignored — they're local/per-environment state, not source.

### Business module (`backend/src/`)

All routes below are mounted under `/api` and protected by `requireAuth` —
data is shared across every logged-in user, there's no per-user ownership
column anywhere in this module.

- `routes/clients.js`, `routes/settings.js` — plain CRUD for `clients`, and
  GET/PUT for the single-row `business_settings` table (business name,
  address, tax ID, currency symbol, bank details — this is what prints on
  every PDF's header/footer).
- `routes/quotes.js`, `routes/invoices.js` — CRUD plus PDF download
  (`GET /:id/pdf`), email send (`POST /:id/send`), and (invoices only)
  `POST /:id/remind` and `POST /:id/payments`. `quotes.js` also has
  `POST /:id/convert-to-invoice`, which copies the quote's line items into
  a new invoice and stamps `quotes.converted_invoice_id`.
- `routes/financials.js` — `GET /summary`: totals invoiced/paid/outstanding,
  overdue count/amount, client count, quote/invoice counts by status, a
  6-month invoiced-vs-paid trend (`monthlyTrend`, oldest month first), and
  the 10 most recent payments. Same endpoint backs both `Dashboard` and
  `Financials` pages. Computed from `invoices`/`payments`/`clients` on every
  request, nothing is cached or denormalized beyond `invoices.amount_paid`.
- `lib/totals.js` — `computeTotals(items, taxRate)` validates a raw
  line-items payload and computes subtotal/tax/total. Shared by quotes and
  invoices; this is the only place that math happens — don't recompute
  totals in route handlers or on the frontend.
- `lib/numbering.js` — sequential per-year document numbers
  (`Q-2026-0001`, `INV-2026-0001`, `R-2026-0001` for quotes/invoices/
  receipts). Relies on `better-sqlite3` being synchronous (no `await`
  between the count and the insert that consumes it) to avoid a race — if
  any of this code becomes async, this numbering scheme needs a real lock.
- `lib/pdf.js` — renders quote/invoice/receipt PDFs with `pdfkit` (pure JS,
  no headless browser). One shared header/items-table/totals layout, reused
  by `renderQuotePdf`/`renderInvoicePdf`/`renderReceiptPdf`.
- `lib/mailer.js` — `sendMail()` wraps `nodemailer` with SMTP settings from
  env (`SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM`/`SECURE`). If `SMTP_HOST`
  isn't set, it throws `EMAIL_NOT_CONFIGURED` rather than crashing — routes
  catch this and return `503` with a message telling the caller which env
  vars to set. Everything else (PDF download, payments, financials) works
  with no SMTP configured at all.

Status/derived-field conventions worth knowing before touching this code:
- Quote `status`: `draft | sent | accepted | declined | expired`, all
  set explicitly (by `PUT`, `/send`, or `/convert-to-invoice`).
- Invoice `status`: only `draft | sent | void | paid` are ever stored —
  `paid` is set automatically the moment `amount_paid >= total` inside the
  `POST /:id/payments` handler. "Overdue" and "partially paid" are **not**
  stored; `invoices.js`'s `withComputed()` derives `is_overdue` and
  `is_partially_paid` from `status`/`due_date`/`amount_paid` on every read,
  so there's no cron job or background process keeping status in sync.
- Deletes are guarded at the DB level in the route handlers, not via FK
  constraints: a client with any quotes/invoices can't be deleted, and an
  invoice with any recorded payments can't be deleted.

### Frontend (`frontend/src/`)

- `context/AuthContext.jsx` — the single source of truth for auth state.
  Holds the JWT (persisted in `localStorage`) and the current user, fetched
  via `GET /api/auth/me` on load to validate the stored token. Exposes
  `login(token, user)` / `logout()`. Any component that needs to know if
  someone is signed in should read `useAuth()`, not touch `localStorage`
  directly.
- `components/ProtectedRoute.jsx` — wraps route elements that require auth;
  redirects to `/login` when there's no valid token. Wrap new authenticated
  pages with this rather than checking auth state ad hoc.
- `lib/api.js` — the only module that calls the backend. All requests go
  through `request()`, which prefixes `/api`, attaches the bearer token when
  passed, and normalizes error responses to `throw new Error(data.error)`.
  Add new endpoints here rather than calling `fetch` directly from
  components. PDF endpoints don't go through `request()` (they return
  binary, not JSON) — `openPdf()` fetches with the auth header, turns the
  response into a blob URL, and `window.open()`s it; a plain `<a href>`
  can't attach the Authorization header, which is why this exists.
- `pages/` — one component per route (`Landing`, `Login`, `Signup`,
  `Dashboard`), wired up in `App.jsx` via `react-router-dom`.
- `pages/business/` — the client/quote/invoice/payment/settings/financials
  pages (see "Business module" below). `components/LineItemsEditor.jsx` and
  `components/StatusBadge.jsx` are shared between the quote and invoice
  form/detail pages — extend those rather than duplicating item-row or
  status-color logic per page.
- `pages/Dashboard.jsx` charts (`components/RevenueTrendChart.jsx`,
  `components/StatusBreakdownChart.jsx`) are hand-rolled SVG/CSS, no
  charting library. Status colors there are pinned to match
  `StatusBadge`/`lib/pdf.js` (draft=slate, sent=indigo, paid=emerald,
  void=red) rather than a generic categorical palette — status is state,
  not series identity, so don't reassign those colors when adding a chart.
- Styling is Tailwind CSS v4 via the `@tailwindcss/vite` plugin (see
  `vite.config.js` and `src/index.css`) — no `tailwind.config.js`/PostCSS
  setup exists or is needed for v4's Vite integration. Utility classes are
  used directly in JSX; there's no separate component-style layer.

### Responsive / PWA

The app is a responsive installable PWA (installable on iOS/Android home
screens), configured via `vite-plugin-pwa` in `vite.config.js`:

- The manifest (name, icons, `theme_color`, `display: standalone`) is
  generated from the `manifest` option at build time — don't hand-edit a
  `manifest.webmanifest` file, it doesn't exist in source, only in `dist/`.
- Icon source files live in `frontend/public/` (`favicon.svg`,
  `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`,
  `apple-touch-icon.png`). The two `.svg` files are the design source; the
  PNGs were rasterized from them (there's no build step that regenerates
  PNGs from the SVGs — if the design changes, re-rasterize by hand and
  replace the PNGs).
- iOS Safari doesn't read the manifest for install metadata, so
  `index.html` carries iOS-specific tags directly (`apple-touch-icon` link,
  `apple-mobile-web-app-capable`, etc.) — keep these in sync with the
  manifest's icons/name if either changes.
- All form inputs use `text-base` (16px), not `text-sm` — iOS Safari
  auto-zooms the page on focus for inputs under 16px, so this isn't just a
  style choice.
- Touch targets (`Navbar` links/buttons, form inputs/buttons) use
  `min-h-11` (44px) to meet Apple's minimum tap-target guidance.
- `npm run build` also emits a generated service worker (`sw.js`) that
  precaches the built assets; `workbox.navigateFallbackDenylist` excludes
  `/api/*` so navigation fallback never intercepts API routes. There is no
  offline-data story beyond asset precaching — API calls always hit the
  network.

### Auth flow end-to-end

1. `Signup`/`Login` pages submit to `api.signup`/`api.login`.
2. On success, the returned `{ token, user }` is passed to
   `AuthContext.login()`, which persists the token and updates state.
3. `ProtectedRoute` (used for `/dashboard`) checks `AuthContext` and
   redirects unauthenticated visitors to `/login`.
4. Every subsequent authenticated request (e.g. the `/auth/me` check on
   page load) sends the token as `Authorization: Bearer <token>`, verified
   server-side by `requireAuth`.
