require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const modReportsRoutes = require('./routes/modReports');
const publicRoutes = require('./routes/public');

const app = express();
const PORT = process.env.PORT || 4100;

// Render (and most PaaS) terminate TLS at a proxy, so req.ip is the proxy's
// address unless we trust one hop — the rate limiters in
// middleware/rateLimit.js key on req.ip.
app.set('trust proxy', 1);

app.use(compression());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5174' }));
// A submission can carry several compressed issue photos as base64 data
// URIs (see lib/modReportShared.js's sanitizeIssues) — 8mb mirrors the main
// EduSolution app's own body-size cap for the same reason.
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/mod-reports', modReportsRoutes);
app.use('/api/public', publicRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`MOD report API listening on http://localhost:${PORT}`);
});
