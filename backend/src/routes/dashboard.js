const { Router } = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { hasPermission } = require('../lib/permissions');
const financialsRoutes = require('./financials');

const router = Router();
// No blanket requirePermission — every section below is independently
// gated inline via hasPermission(), same pattern routes/search.js already
// uses for a route where different callers can hold different subsets of
// the underlying grants (see that file's own top-of-file note). A staff
// user with only some of the relevant `view` grants still gets a real,
// partial response instead of a 403 for the whole thing.
router.use(requireAuth);

const today = () => new Date().toISOString().slice(0, 10);
// Matches Dashboard.jsx's own YEAR_FROM/YEAR_TO (startOfYearStr()/todayStr())
// — the same "this calendar year so far" range Financials.jsx's own "This
// year" filter tab already sends to GET /financials/summary, so this
// endpoint's financials section is the identical figure that route already
// returns for that exact query, just computed in-process (see
// routes/financials.js's own computeSummary export) instead of over a
// second HTTP round-trip.
const yearFrom = () => `${new Date().getFullYear()}-01-01`;

// GET /api/dashboard/overview — the single combined fetch behind
// Dashboard.jsx, replacing what used to be up to 8 separate requests fired
// in parallel on every page load (financials summary, settings, two
// "needs attention" list fetches, and four per-module analytics calls).
// better-sqlite3 is synchronous, so those 8 requests never actually ran in
// parallel on the backend anyway — each one blocked the single-threaded
// event loop in turn, including 8 redundant requireAuth user re-fetches —
// so collapsing them into one request is a real backend cost reduction,
// not just fewer round-trips.
//
// Every section below is a lightweight, current-year-only computation
// mirroring the semantics of an existing, already-correct route (the
// overdue/expiring-soon definitions in routes/invoices.js's/
// routes/licenses.js's own withComputed()/statusWhere(), and each
// module's own GET /:module/analytics year-over-year loop) rather than a
// re-derivation — a full multi-year history isn't needed here, only this
// year's own row, so this queries directly for just that instead of
// building every module's complete byYear array the way the dedicated
// analytics pages do.
router.get('/overview', (req, res) => {
  try {
    const user = req.user;
    const canFinancials = hasPermission(user, 'financials', 'view');
    const canSettings = hasPermission(user, 'settings', 'view');
    const canInvoices = hasPermission(user, 'invoices', 'view');
    const canLicenses = hasPermission(user, 'licenses', 'view');
    const canQuotes = hasPermission(user, 'quotes', 'view');
    const canExpenses = hasPermission(user, 'expenses', 'view');

    const financials = canFinancials ? financialsRoutes.computeSummary(yearFrom(), today()) : null;

    let settings = null;
    if (canSettings) {
      const row = db.prepare('SELECT currency_symbol, business_name FROM business_settings WHERE id = 1').get();
      settings = row ? { currency_symbol: row.currency_symbol, business_name: row.business_name } : null;
    }

    // Mirrors invoices.js's own withComputed(): is_overdue is
    // status='sent' AND balance_due>0 AND due_date<today. Expressed
    // directly in SQL here (rather than fetching every 'sent' invoice and
    // filtering in JS, the way Dashboard.jsx's own prior per-request fetch
    // did) since only the already-overdue rows are actually needed.
    const overdueInvoices =
      canFinancials && canInvoices
        ? db
            .prepare(
              `SELECT invoices.id, invoices.number, invoices.due_date,
                      ROUND(invoices.total - invoices.amount_paid, 2) AS balance_due,
                      clients.name AS client_name
               FROM invoices JOIN clients ON clients.id = invoices.client_id
               WHERE invoices.status = 'sent' AND invoices.due_date < ? AND (invoices.total - invoices.amount_paid) > 0
               ORDER BY invoices.due_date ASC
               LIMIT 4`,
            )
            .all(today())
        : [];

    // Mirrors licenses.js's own statusWhere('expiring_soon'): status='active'
    // AND expiry_date between today and today+EXPIRY_WARNING_DAYS. Duplicated
    // as a literal here rather than imported — same acceptable-duplication
    // call EXPIRY_WARNING_DAYS already gets between routes/licenses.js and
    // lib/scheduler.js (keep all three in sync).
    const EXPIRY_WARNING_DAYS = 30;
    const warningDate = new Date(Date.now() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const expiringLicenses =
      canFinancials && canLicenses
        ? db
            .prepare(
              `SELECT licenses.id, licenses.name, licenses.expiry_date, clients.name AS client_name
               FROM licenses JOIN clients ON clients.id = licenses.client_id
               WHERE licenses.status = 'active' AND licenses.expiry_date >= ? AND licenses.expiry_date <= ?
               ORDER BY licenses.expiry_date ASC
               LIMIT 4`,
            )
            .all(today(), warningDate)
        : [];

    const thisYear = String(new Date().getFullYear());

    // Mirrors routes/quotes.js's GET /analytics: created (count by
    // issue_date year, all statuses), amountQuoted (sum of total, void
    // excluded), accepted/declined (counts by year of
    // COALESCE(client_responded_at, updated_at)).
    const quotesOverview = canQuotes
      ? {
          created: db.prepare("SELECT COUNT(*) AS c FROM quotes WHERE strftime('%Y', issue_date) = ?").get(thisYear).c,
          amountQuoted:
            db
              .prepare("SELECT COALESCE(SUM(total), 0) AS t FROM quotes WHERE strftime('%Y', issue_date) = ? AND status != 'void'")
              .get(thisYear).t || 0,
          accepted: db
            .prepare(
              "SELECT COUNT(*) AS c FROM quotes WHERE status = 'accepted' AND strftime('%Y', COALESCE(client_responded_at, updated_at)) = ?",
            )
            .get(thisYear).c,
          declined: db
            .prepare(
              "SELECT COUNT(*) AS c FROM quotes WHERE status = 'declined' AND strftime('%Y', COALESCE(client_responded_at, updated_at)) = ?",
            )
            .get(thisYear).c,
        }
      : null;

    // Mirrors routes/invoices.js's GET /analytics: issued (count by
    // issue_date year), amountInvoiced (sum of total, void excluded),
    // paymentsReceived/amountCollected (by payments.paid_at year).
    const invoicesOverview = canInvoices
      ? {
          issued: db.prepare("SELECT COUNT(*) AS c FROM invoices WHERE strftime('%Y', issue_date) = ?").get(thisYear).c,
          amountInvoiced:
            db
              .prepare("SELECT COALESCE(SUM(total), 0) AS t FROM invoices WHERE strftime('%Y', issue_date) = ? AND status != 'void'")
              .get(thisYear).t || 0,
          paymentsReceived: db.prepare("SELECT COUNT(*) AS c FROM payments WHERE strftime('%Y', paid_at) = ?").get(thisYear).c,
          amountCollected: db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE strftime('%Y', paid_at) = ?").get(thisYear).t || 0,
        }
      : null;

    // Mirrors routes/licenses.js's GET /analytics: newLicenses (by
    // start_date year), renewals (by license_renewals.renewed_at year).
    const licensesOverview = canLicenses
      ? {
          newLicenses: db.prepare("SELECT COUNT(*) AS c FROM licenses WHERE strftime('%Y', start_date) = ?").get(thisYear).c,
          renewals: db.prepare("SELECT COUNT(*) AS c FROM license_renewals WHERE strftime('%Y', renewed_at) = ?").get(thisYear).c,
        }
      : null;

    // Mirrors routes/expenses.js's GET /analytics: total/count by
    // expense_date year.
    const expensesOverview = canExpenses
      ? {
          total: db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE strftime('%Y', expense_date) = ?").get(thisYear).t || 0,
          count: db.prepare("SELECT COUNT(*) AS c FROM expenses WHERE strftime('%Y', expense_date) = ?").get(thisYear).c,
        }
      : null;

    res.json({
      financials,
      settings,
      overdueInvoices,
      expiringLicenses,
      yearOverview: {
        quotes: quotesOverview,
        invoices: invoicesOverview,
        licenses: licensesOverview,
        expenses: expensesOverview,
      },
    });
  } catch (err) {
    console.error('GET /api/dashboard/overview failed:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;
