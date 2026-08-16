const { Router } = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');

const router = Router();
// Deliberately requireAdmin rather than requirePermission — this bulk-
// deletes business data, and unlike every other module in this app, no
// staff grant should ever unlock it. See middleware/auth.js.
router.use(requireAuth);
router.use(requireAdmin);

const CONFIRM_PHRASE = 'DELETE';

// What each pickable category actually clears. "clients" always pulls in
// quotes/invoices/recurring invoices/licenses (and their items/payments)
// too, even if the caller only ticked "clients" — those rows NOT
// NULL-reference client_id (see db/index.js), so leaving them behind would
// orphan them (invisible to every list page's INNER JOIN against clients,
// but still sitting in the database forever). Every other category is safe
// to clear on its own. users, user_permissions, and business_settings are
// never touched by any category: login and branding must survive a reset.
const CATEGORIES = {
  clients: ['quote_items', 'quotes', 'invoice_items', 'payments', 'invoices', 'recurring_invoice_items', 'recurring_invoices', 'licenses', 'clients'],
  quotes: ['quote_items', 'quotes'],
  invoices: ['invoice_items', 'payments', 'invoices'],
  recurring: ['recurring_invoice_items', 'recurring_invoices'],
  licenses: ['licenses'],
  expenses: ['expenses'],
  products: ['products'],
  activity: ['activity_log'],
};

// Delete order matters for readability/consistency even though foreign_keys
// is off for the transaction below (children before the parents they'd
// otherwise reference).
const TABLE_ORDER = [
  'quote_items',
  'quotes',
  'invoice_items',
  'payments',
  'invoices',
  'recurring_invoice_items',
  'recurring_invoices',
  'licenses',
  'expenses',
  'clients',
  'products',
  'activity_log',
];

router.post('/', (req, res) => {
  const { confirm, categories } = req.body || {};
  if (confirm !== CONFIRM_PHRASE) {
    return res.status(400).json({ error: `Type "${CONFIRM_PHRASE}" to confirm` });
  }

  const selected = Array.isArray(categories) ? categories.filter((c) => CATEGORIES[c]) : [];
  if (selected.length === 0) {
    return res.status(400).json({ error: 'Select at least one type of data to delete' });
  }

  const tablesToClear = new Set();
  for (const key of selected) {
    for (const table of CATEGORIES[key]) tablesToClear.add(table);
  }
  const tables = TABLE_ORDER.filter((t) => tablesToClear.has(t));

  const before = {};
  for (const t of tables) {
    before[t] = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
  }

  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const t of tables) {
      db.prepare(`DELETE FROM ${t}`).run();
      db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(t);
    }
    // Clean up nullable, unenforced cross-references (invoices.quote_id,
    // quotes.converted_invoice_id, invoices.recurring_invoice_id — none of
    // these carry a REFERENCES constraint, see db/index.js) left dangling
    // when one side of a soft link is cleared without the other, so a
    // surviving row never points at an id that no longer exists.
    if (tablesToClear.has('quotes') && !tablesToClear.has('invoices')) {
      db.prepare('UPDATE invoices SET quote_id = NULL WHERE quote_id IS NOT NULL').run();
    }
    if (tablesToClear.has('invoices') && !tablesToClear.has('quotes')) {
      db.prepare('UPDATE quotes SET converted_invoice_id = NULL WHERE converted_invoice_id IS NOT NULL').run();
    }
    if (tablesToClear.has('recurring_invoices') && !tablesToClear.has('invoices')) {
      db.prepare('UPDATE invoices SET recurring_invoice_id = NULL WHERE recurring_invoice_id IS NOT NULL').run();
    }
  })();
  db.pragma('foreign_keys = ON');

  const clearedSummary = Object.entries(before)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => `${count} ${table.replace(/_/g, ' ')}`)
    .join(', ');

  // Logged after the clear (not before) so this entry survives even when
  // activity_log itself was one of the tables just wiped — it becomes the
  // first fresh entry, documenting the reset for anyone auditing later.
  logActivity({
    userName: req.user.name,
    action: 'reset',
    entityType: 'business data',
    entityId: null,
    entityLabel: clearedSummary || 'nothing — every table was already empty',
  });

  res.json({ cleared: before });
});

module.exports = router;
