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
const dashboardRoutes = require('./routes/dashboard');
const expensesRoutes = require('./routes/expenses');
const capitalContributionsRoutes = require('./routes/capitalContributions');
const ownerDrawsRoutes = require('./routes/ownerDraws');
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
const campaignsRoutes = require('./routes/campaigns');
const websiteRoutes = require('./routes/website');
const shareholdersRoutes = require('./routes/shareholders');
const dealsRoutes = require('./routes/deals');
const supplierCostsRoutes = require('./routes/supplierCosts');
const supplierInvoicesRoutes = require('./routes/supplierInvoices');
const usdAccountRoutes = require('./routes/usdAccount');
const facebookPostsRoutes = require('./routes/facebookPosts');
const errorLogRoutes = require('./routes/errorLog');
const { recordError } = require('./lib/errorLog');
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
// Raised to 8mb once POST /api/portal/invoices/:id/payment-proof (see
// routes/clientPortal.js) needed room for a base64-encoded payment slip —
// a phone photo of a bank transfer receipt routinely runs 2-5MB before
// base64 inflates it by another third, well past the old 2mb ceiling.
// Browser error reports get their own tiny body limit, mounted before the
// big global parser.
app.use('/api/client-errors', express.json({ limit: '32kb' }), errorLogRoutes.intake);
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/quote-requests', quoteRequestsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/financials', financialsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/capital-contributions', capitalContributionsRoutes);
app.use('/api/owner-draws', ownerDrawsRoutes);
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
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/website', websiteRoutes);
app.use('/api/shareholders', shareholdersRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/supplier-costs', supplierCostsRoutes);
app.use('/api/supplier-invoices', supplierInvoicesRoutes);
app.use('/api/usd-account', usdAccountRoutes);
app.use('/api/facebook-posts', facebookPostsRoutes);
app.use('/api/error-log', errorLogRoutes.admin);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'Request too large' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  recordError({
    source: 'server',
    message: err && err.message,
    stack: err && err.stack,
    url: `${req.method} ${req.path}`,
    method: req.method,
    userAgent: req.headers['user-agent'],
    userId: req.user && req.user.id,
    userName: req.user && req.user.name,
  });
  res.status(500).json({ error: 'Internal server error' });
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
  recordError({ source: 'server', message: `uncaughtException: ${err && err.message}`, stack: err && err.stack });
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason);
  recordError({
    source: 'server',
    message: `unhandledRejection: ${reason && reason.message ? reason.message : reason}`,
    stack: reason && reason.stack,
  });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  startScheduler();
});
