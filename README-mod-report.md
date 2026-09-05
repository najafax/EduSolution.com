# MOD Report split-out

The Manager on Duty (MOD) checklist used to live inside this app
(`backend`/`frontend`), gated to the `super_admin` role. It's been split
out into its own standalone app, in its own repository:
**[najafax/mod-report](https://github.com/najafax/mod-report)** — its own
backend, frontend, database, and login accounts, with no dependency on
this app at runtime.

## Why

MOD Report is a resort operations checklist, unrelated to the billing/CRM
data this app manages — splitting it into its own repo means it can be
deployed, scaled, and given accounts entirely independently.

## What changed here

- **Removed**: `backend/src/routes/modReports.js`,
  `backend/src/lib/modReportPdf.js`, `backend/src/lib/modReportShared.js`,
  `frontend/src/pages/business/MODReport.jsx`,
  `frontend/src/pages/PublicMODReport.jsx`, the `/mod-reports` and
  `/mod/:token` routes, the Navbar/Sidebar nav entry, the
  `requireSuperAdmin` middleware (only used by this feature), and the
  `mod_reports`/`mod_report_settings` table definitions in
  `backend/src/db/index.js` (existing deployments keep their historical
  data in these tables untouched on disk — nothing drops them).
- **`backend/scripts/export-mod-reports.js`** stays here — it's the export
  half of migrating this app's historical MOD report data into the new
  repo (see that repo's own `mod-report-backend/scripts/import-legacy.js`
  for the import half).

## Migrating existing MOD report data to the new repo

If this app's deployment already has MOD reports in it:

```bash
# 1. Export from this app's database
cd backend && npm run export-mod-reports -- mod-reports-export.json

# 2. Copy mod-reports-export.json over to a checkout of najafax/mod-report,
#    then from that repo's mod-report-backend/:
node scripts/import-legacy.js /path/to/mod-reports-export.json

# 3. Create a login for the new app (it has no accounts of its own yet)
npm run create-user

# 4. Once live, generate a fresh public submission link from the new app's
#    Settings tab — the old link's token is intentionally not carried over.
```

## Deploying the new app

See [najafax/mod-report](https://github.com/najafax/mod-report)'s own
README — it has its own `render.yaml` and deploys as two Render services
independent of this repo's.
