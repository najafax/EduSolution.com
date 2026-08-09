# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

EduSolution.com is a two-package web app: a React SPA (`frontend/`) and a
Node/Express API (`backend/`) with a SQLite database, connected by a
JWT-based auth flow (signup/login/dashboard). There is no root package.json
— each package is installed and run independently.

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

Environment variables (see `backend/.env.example`): `PORT`, `JWT_SECRET`,
`CLIENT_ORIGIN`. `backend/data.sqlite3` and `.env` are gitignored — they're
local/per-environment state, not source.

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
  components.
- `pages/` — one component per route (`Landing`, `Login`, `Signup`,
  `Dashboard`), wired up in `App.jsx` via `react-router-dom`.
- Styling is Tailwind CSS v4 via the `@tailwindcss/vite` plugin (see
  `vite.config.js` and `src/index.css`) — no `tailwind.config.js`/PostCSS
  setup exists or is needed for v4's Vite integration. Utility classes are
  used directly in JSX; there's no separate component-style layer.

### Auth flow end-to-end

1. `Signup`/`Login` pages submit to `api.signup`/`api.login`.
2. On success, the returned `{ token, user }` is passed to
   `AuthContext.login()`, which persists the token and updates state.
3. `ProtectedRoute` (used for `/dashboard`) checks `AuthContext` and
   redirects unauthenticated visitors to `/login`.
4. Every subsequent authenticated request (e.g. the `/auth/me` check on
   page load) sends the token as `Authorization: Bearer <token>`, verified
   server-side by `requireAuth`.
