const { Router } = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

const today = () => new Date().toISOString().slice(0, 10);

router.get('/summary', (req, res) => {
  const invoices = db.prepare("SELECT * FROM invoices WHERE status != 'void'").all();

  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + inv.amount_paid, 0);
  const totalOutstanding = Math.round((totalInvoiced - totalPaid) * 100) / 100;

  const overdue = invoices.filter(
    (inv) => inv.status === 'sent' && inv.amount_paid < inv.total && inv.due_date < today(),
  );
  const overdueAmount = Math.round(
    overdue.reduce((sum, inv) => sum + (inv.total - inv.amount_paid), 0) * 100,
  ) / 100;

  const quoteCounts = db
    .prepare('SELECT status, COUNT(*) AS c FROM quotes GROUP BY status')
    .all()
    .reduce((acc, row) => ({ ...acc, [row.status]: row.c }), {});

  const recentPayments = db
    .prepare(
      `SELECT payments.*, invoices.number AS invoice_number, clients.name AS client_name
       FROM payments
       JOIN invoices ON invoices.id = payments.invoice_id
       JOIN clients ON clients.id = invoices.client_id
       ORDER BY payments.paid_at DESC, payments.id DESC
       LIMIT 10`,
    )
    .all();

  res.json({
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalOutstanding,
    overdueCount: overdue.length,
    overdueAmount,
    invoiceCount: invoices.length,
    quoteCounts,
    recentPayments,
  });
});

module.exports = router;
