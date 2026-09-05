# MOD Report — backend

Standalone API for the Manager on Duty checklist, split out of the main
EduSolution app so it can be deployed and scaled independently. See
`../mod-report-frontend` for its UI, and the repo root `README-mod-report.md`
for the full split-out story and migration steps.

## Local development

```bash
cp .env.example .env   # then edit JWT_SECRET at least
npm install
npm run dev             # listens on PORT (default 4100)
```

Create your first login:

```bash
npm run create-user
```

## One-time data migration from the main app

If the main EduSolution app already has MOD reports in it, export them
there first (`cd ../backend && npm run export-mod-reports`), then import
the resulting JSON file here:

```bash
node scripts/import-legacy.js /path/to/mod-reports-export.json
```

Re-running the import is safe — it's keyed on the legacy report id and
skips rows that already exist.
