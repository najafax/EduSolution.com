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

// Clients, quotes, and invoices all cascade to their line items (and
// invoices to payments) via ON DELETE CASCADE once foreign_keys is back on
// — see db/index.js — so clearing just these ten tables is enough to leave
// no orphaned rows. users, user_permissions, and business_settings are
// never touched: login and branding must survive a reset. products is
// opt-in (includeProducts) since a catalog is often worth keeping across a
// data reset, unlike everything else here.
const CORE_TABLES = [
  'quote_items',
  'quotes',
  'invoice_items',
  'payments',
  'invoices',
  'recurring_invoice_items',
  'recurring_invoices',
  'expenses',
  'clients',
  'activity_log',
];

router.post('/', (req, res) => {
  const { confirm, includeProducts = false } = req.body || {};
  if (confirm !== CONFIRM_PHRASE) {
    return res.status(400).json({ error: `Type "${CONFIRM_PHRASE}" to confirm` });
  }

  const tables = includeProducts ? [...CORE_TABLES, 'products'] : CORE_TABLES;

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
