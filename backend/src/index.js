require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const clientsRoutes = require('./routes/clients');
const productsRoutes = require('./routes/products');
const settingsRoutes = require('./routes/settings');
const quotesRoutes = require('./routes/quotes');
const invoicesRoutes = require('./routes/invoices');
const financialsRoutes = require('./routes/financials');
const expensesRoutes = require('./routes/expenses');
const recurringRoutes = require('./routes/recurring');
const publicRoutes = require('./routes/public');
const activityRoutes = require('./routes/activity');
const searchRoutes = require('./routes/search');
const importRoutes = require('./routes/import');
const usersRoutes = require('./routes/users');
const { startScheduler } = require('./lib/scheduler');

const app = express();
const PORT = process.env.PORT || 4000;

// Render (and most PaaS) terminate TLS at a proxy, so req.ip is the proxy's
// address unless we trust one hop. The rate limiters in middleware/rateLimit.js
// key on req.ip, so without this they'd bucket every visitor together.
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/financials', financialsRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/recurring-invoices', recurringRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/import', importRoutes);
app.use('/api/users', usersRoutes);

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
