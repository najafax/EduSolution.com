require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const clientsRoutes = require('./routes/clients');
const productsRoutes = require('./routes/products');
const settingsRoutes = require('./routes/settings');
const quotesRoutes = require('./routes/quotes');
const quoteRequestsRoutes = require('./routes/quoteRequests');
const invoicesRoutes = require('./routes/invoices');
const financialsRoutes = require('./routes/financials');
const expensesRoutes = require('./routes/expenses');
const capitalContributionsRoutes = require('./routes/capitalContributions');
const recurringRoutes = require('./routes/recurring');
const licensesRoutes = require('./routes/licenses');
const publicRoutes = require('./routes/public');
const clientPortalRoutes = require('./routes/clientPortal');
const activityRoutes = require('./routes/activity');
const searchRoutes = require('./routes/search');
const importRoutes = require('./routes/import');
const usersRoutes = require('./routes/users');
const dataResetRoutes = require('./routes/dataReset');
const reportsRoutes = require('./routes/reports');
const emailCenterRoutes = require('./routes/emailCenter');
const { startScheduler } = require('./lib/scheduler');

const app = express();
const PORT = process.env.PORT || 4000;

// Render (and most PaaS) terminate TLS at a proxy, so req.ip is the proxy's
// address unless we trust one hop. The rate limiters in middleware/rateLimit.js
// key on req.ip, so without this they'd bucket every visitor together.
app.set('trust proxy', 1);

// Gzips every response above compression's default 1kb threshold (JSON list
// payloads, PDF downloads, etc.) — the frontend's own static assets already
// get this from Render's CDN, but this Node API service doesn't compress
// its own responses unless told to.
app.use(compression());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
// Default 100kb is too small for PUT /api/settings once it carries the
// signature/stamp images (see routes/settings.js) — 2mb comfortably covers
// two base64-encoded 400KB images plus the rest of the settings payload.
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/quote-requests', quoteRequestsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/financials', financialsRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/capital-contributions', capitalContributionsRoutes);
app.use('/api/recurring-invoices', recurringRoutes);
app.use('/api/licenses', licensesRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/portal', clientPortalRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/import', importRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/data-reset', dataResetRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/email-center', emailCenterRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  startScheduler();
});
