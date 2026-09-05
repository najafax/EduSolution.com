# MOD Report — backend

Standalone API for the Manager on Duty checklist. See `../mod-report-frontend`
for its UI, and the repo root `README.md` for deployment and migration steps.

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

If MOD Report previously ran embedded inside another app and already has
real submissions there, export them from that app first, then import the
resulting JSON file here:

```bash
node scripts/import-legacy.js /path/to/mod-reports-export.json
```

Re-running the import is safe — it's keyed on the legacy report id and
skips rows that already exist.
