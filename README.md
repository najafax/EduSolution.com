# MOD Report

The Manager on Duty (MOD) shift-handover checklist for resort operations —
a standalone app with its own backend, frontend, database, and login
accounts. This branch carries only this app; it has no shared history or
files with the main EduSolution app.

## Apps

- `mod-report-backend/` — Express API + SQLite. See its own README for
  local development and creating your first login.
- `mod-report-frontend/` — React UI. See its own README for local
  development.

## Deploying

`render.yaml` at the repo root defines both services (`mod-report-backend`,
`mod-report-frontend`) for a Render Blueprint deploy. Before deploying:

1. Update the placeholder domains in `render.yaml` (`CLIENT_ORIGIN`,
   `VITE_API_URL`) to whatever subdomains you're actually using.
2. Push this branch, then in Render: New → Blueprint → point it at this
   repo/branch. It'll create both services from `render.yaml`.
3. Once `mod-report-backend` is live, open its shell and run
   `npm run create-user` — the app starts with zero accounts.

## Migrating data from the old, bundled version

If MOD Report previously ran embedded inside the main EduSolution app and
already has real submissions in that app's database, export them there and
import them here — see `mod-report-backend/scripts/import-legacy.js` for
the import side, and the main app's `backend/scripts/export-mod-reports.js`
for the export side (on whichever branch/repo still has that script).

```bash
# On the old app's backend:
npm run export-mod-reports -- mod-reports-export.json

# Here, in mod-report-backend/:
node scripts/import-legacy.js /path/to/mod-reports-export.json
```

Re-running the import is safe — it's keyed on the legacy report id and
skips rows that already exist. The old public submission link's token is
deliberately not carried over; generate a fresh one from this app's own
Settings tab once it's live.
