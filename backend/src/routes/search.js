const { Router } = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { hasPermission } = require('../lib/permissions');

const router = Router();
router.use(requireAuth);

const RESULT_LIMIT = 8;

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const empty = { clients: [], quotes: [], invoices: [], expenses: [] };
  if (!q) return res.json(empty);

  const like = `%${q}%`;

  // A staff member without view access to a module gets an empty group for
  // it, not a 403 for the whole search — so someone who can only see
  // clients still gets client results instead of the request failing
  // outright because they can't also see expenses.
  const clients = hasPermission(req.user, 'clients', 'view')
    ? db
        .prepare(
          `SELECT id, name, email FROM clients
           WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?
           ORDER BY name LIMIT ?`,
        )
        .all(like, like, like, RESULT_LIMIT)
    : [];

  const quotes = hasPermission(req.user, 'quotes', 'view')
    ? db
        .prepare(
          `SELECT quotes.id, quotes.number, quotes.status, quotes.total, clients.name AS client_name
           FROM quotes JOIN clients ON clients.id = quotes.client_id
           WHERE quotes.number LIKE ? OR quotes.notes LIKE ? OR clients.name LIKE ?
           ORDER BY quotes.issue_date DESC LIMIT ?`,
        )
        .all(like, like, like, RESULT_LIMIT)
    : [];

  const invoices = hasPermission(req.user, 'invoices', 'view')
    ? db
        .prepare(
          `SELECT invoices.id, invoices.number, invoices.status, invoices.total, clients.name AS client_name
           FROM invoices JOIN clients ON clients.id = invoices.client_id
           WHERE invoices.number LIKE ? OR invoices.notes LIKE ? OR clients.name LIKE ?
           ORDER BY invoices.issue_date DESC LIMIT ?`,
        )
        .all(like, like, like, RESULT_LIMIT)
    : [];

  const expenses = hasPermission(req.user, 'expenses', 'view')
    ? db
        .prepare(
          `SELECT id, category, description, amount, expense_date FROM expenses
           WHERE description LIKE ? OR category LIKE ? OR notes LIKE ?
           ORDER BY expense_date DESC LIMIT ?`,
        )
        .all(like, like, like, RESULT_LIMIT)
    : [];

  res.json({ clients, quotes, invoices, expenses });
});

module.exports = router;
