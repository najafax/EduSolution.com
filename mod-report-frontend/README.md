# MOD Report — frontend

The Manager on Duty checklist UI, split out of the main EduSolution app so
it can be deployed independently. Talks to `../mod-report-backend`.

## Local development

```bash
npm install
npm run dev   # http://localhost:5174, proxies /api to localhost:4100
```

Set `VITE_API_URL` (e.g. in a `.env` file) to point at the deployed backend
once this is hosted separately from it — see `vite.config.js`'s dev proxy
for the local default.
