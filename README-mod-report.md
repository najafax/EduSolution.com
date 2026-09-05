# MOD Report split-out

The Manager on Duty (MOD) checklist used to live inside the main EduSolution
app (`backend`/`frontend`), gated to the `super_admin` role. It's now its
own standalone deployment — `mod-report-backend` + `mod-report-frontend` —
with its own database, its own login accounts, and no dependency on the
main app at runtime. This mirrors how the two apps in this repo were
already deployed as separate Render services (see `render.yaml`).

## Why

MOD Report is a resort operations checklist, unrelated to the billing/CRM
data the main app manages — splitting it out means it can be deployed,
scaled, and given accounts independently of the main business app.

## What changed

- **Removed from the main app**: `backend/src/routes/modReports.js`,
  `backend/src/lib/modReportPdf.js`, `backend/src/lib/modReportShared.js`,
  `frontend/src/pages/business/MODReport.jsx`,
  `frontend/src/pages/PublicMODReport.jsx`, the `/mod-reports` and
  `/mod/:token` routes, the Navbar/Sidebar nav entry, the
  `requireSuperAdmin` middleware (only used by this feature), and the
  `mod_reports`/`mod_report_settings` table definitions in
  `backend/src/db/index.js` (existing deployments keep their historical
  data in these tables untouched — nothing drops them).
- **Added**: `mod-report-backend/` and `mod-report-frontend/`, a
  self-contained copy of the same feature with its own auth (any logged-in
  account has full access — no permission tiers), its own SQLite database,
  and the same PDF export / public-submission-link functionality as before.
  See each app's own README for local development.
- **`render.yaml`**: two new services, `mod-report-backend` and
  `mod-report-frontend`, alongside the existing `edusolution-backend`/
  `edusolution-frontend` pair.

## Migrating existing MOD report data

If the main app's deployment already has MOD reports in it:

```bash
# 1. Export from the main app's database
cd backend && npm run export-mod-reports -- mod-reports-export.json

# 2. Import into the new app's database
cd ../mod-report-backend && node scripts/import-legacy.js ../backend/mod-reports-export.json

# 3. Create a login for the new app (it has no accounts of its own yet)
npm run create-user

# 4. Once live, generate a fresh public submission link from the new app's
#    Settings tab — the old link's token is intentionally not carried over.
```

## Deploying

1. Update the placeholder domains in `render.yaml`'s `mod-report-backend`/
   `mod-report-frontend` services (`CLIENT_ORIGIN`, `VITE_API_URL`) once
   real subdomains are chosen.
2. Push to trigger Render's autoDeploy, or connect the services manually if
   not using Render's Blueprint sync.
3. Run the migration steps above against the new backend's disk.
