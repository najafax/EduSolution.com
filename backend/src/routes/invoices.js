const { Router } = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { computeTotals } = require('../lib/totals');
const { nextInvoiceNumber, nextReceiptNumber } = require('../lib/numbering');
const { renderInvoicePdf, renderReceiptPdf } = require('../lib/pdf');
const { sendMail } = require('../lib/mailer');

const router = Router();
router.use(requireAuth);

const today = () => new Date().toISOString().slice(0, 10);

function withComputed(invoice) {
  const balanceDue = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
  return {
    ...invoice,
    balance_due: balanceDue,
    is_overdue: invoice.status === 'sent' && balanceDue > 0 && invoice.due_date < today(),
    is_partially_paid: invoice.amount_paid > 0 && balanceDue > 0,
  };
}

function getInvoiceWithItems(id) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!invoice) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at').all(id);
  return { invoice: withComputed(invoice), items, client, payments };
}

function saveItems(invoiceId, items) {
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
  const insert = db.prepare(
    'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const item of items) {
    insert.run(invoiceId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order);
  }
}

router.get('/', (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db
        .prepare(
          `SELECT invoices.*, clients.name AS client_name, clients.company AS client_company
           FROM invoices JOIN clients ON clients.id = invoices.client_id
           WHERE invoices.status = ? ORDER BY invoices.issue_date DESC, invoices.id DESC`,
        )
        .all(status)
    : db
        .prepare(
          `SELECT invoices.*, clients.name AS client_name, clients.company AS client_company
           FROM invoices JOIN clients ON clients.id = invoices.client_id
           ORDER BY invoices.issue_date DESC, invoices.id DESC`,
        )
        .all();
  res.json({ invoices: rows.map(withComputed) });
});

router.post('/', (req, res) => {
  const { client_id, issue_date, due_date, notes = '', tax_rate = 0, items } = req.body || {};

  if (!client_id || !issue_date || !due_date) {
    return res.status(400).json({ error: 'client_id, issue_date and due_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });

  let totals;
  try {
    totals = computeTotals(items, tax_rate);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const number = nextInvoiceNumber();
  const result = db
    .prepare(
      `INSERT INTO invoices (number, client_id, status, issue_date, due_date, notes, tax_rate, subtotal, tax_amount, total)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(number, client_id, issue_date, due_date, notes, totals.taxRate, totals.subtotal, totals.taxAmount, totals.total);

  saveItems(result.lastInsertRowid, totals.items);

  res.status(201).json(getInvoiceWithItems(result.lastInsertRowid));
});

router.get('/:id', (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  res.json(data);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const { client_id, issue_date, due_date, notes = '', tax_rate = 0, status, items } = req.body || {};
  if (!client_id || !issue_date || !due_date) {
    return res.status(400).json({ error: 'client_id, issue_date and due_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });

  let totals;
  try {
    totals = computeTotals(items, tax_rate);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (totals.total < existing.amount_paid) {
    return res.status(409).json({ error: 'New total cannot be less than the amount already paid on this invoice' });
  }

  const validStatuses = ['draft', 'sent', 'void'];
  const nextStatus = validStatuses.includes(status) ? status : existing.status;

  db.prepare(
    `UPDATE invoices SET client_id = ?, status = ?, issue_date = ?, due_date = ?, notes = ?,
       tax_rate = ?, subtotal = ?, tax_amount = ?, total = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(client_id, nextStatus, issue_date, due_date, notes, totals.taxRate, totals.subtotal, totals.taxAmount, totals.total, req.params.id);

  saveItems(req.params.id, totals.items);

  res.json(getInvoiceWithItems(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const hasPayments = db.prepare('SELECT 1 FROM payments WHERE invoice_id = ? LIMIT 1').get(req.params.id);
  if (hasPayments) {
    return res.status(409).json({ error: 'This invoice has recorded payments and cannot be deleted' });
  }

  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

router.get('/:id/pdf', async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  const buffer = await renderInvoicePdf({ invoice: data.invoice, client: data.client, items: data.items, settings });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${data.invoice.number}.pdf"`,
  });
  res.send(buffer);
});

router.post('/:id/send', async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  try {
    const buffer = await renderInvoicePdf({ invoice: data.invoice, client: data.client, items: data.items, settings });
    await sendMail({
      to: data.client.email,
      subject: `Invoice ${data.invoice.number} from ${settings.business_name || 'us'}`,
      html: `<p>Hi ${data.client.name},</p><p>Please find attached invoice ${data.invoice.number}, due ${data.invoice.due_date}.</p>`,
      attachments: [{ filename: `${data.invoice.number}.pdf`, content: buffer }],
    });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  if (data.invoice.status === 'draft') {
    db.prepare(`UPDATE invoices SET status = 'sent', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  }
  res.json(getInvoiceWithItems(req.params.id));
});

router.post('/:id/remind', async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  if (data.invoice.balance_due <= 0) {
    return res.status(409).json({ error: 'This invoice is already fully paid' });
  }
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  try {
    const buffer = await renderInvoicePdf({ invoice: data.invoice, client: data.client, items: data.items, settings });
    await sendMail({
      to: data.client.email,
      subject: `Payment reminder: invoice ${data.invoice.number}`,
      html: `<p>Hi ${data.client.name},</p><p>This is a reminder that invoice ${data.invoice.number} for ${settings.currency_symbol}${data.invoice.balance_due.toFixed(2)} was due on ${data.invoice.due_date}. Please find it attached.</p>`,
      attachments: [{ filename: `${data.invoice.number}.pdf`, content: buffer }],
    });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  db.prepare(`UPDATE invoices SET last_reminder_sent_at = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json(getInvoiceWithItems(req.params.id));
});

router.post('/:id/payments', (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });

  const { amount, method = 'bank_transfer', reference = '', notes = '', paid_at } = req.body || {};
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (amountNum > data.invoice.balance_due) {
    return res.status(400).json({ error: `amount cannot exceed the balance due (${data.invoice.balance_due})` });
  }
  const validMethods = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];
  if (!validMethods.includes(method)) {
    return res.status(400).json({ error: `method must be one of: ${validMethods.join(', ')}` });
  }

  const receiptNumber = nextReceiptNumber();
  const paidAt = paid_at || today();

  const result = db
    .prepare(
      'INSERT INTO payments (receipt_number, invoice_id, amount, method, reference, notes, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(receiptNumber, req.params.id, amountNum, method, reference, notes, paidAt);

  const newAmountPaid = Math.round((data.invoice.amount_paid + amountNum) * 100) / 100;
  const newStatus = newAmountPaid >= data.invoice.total ? 'paid' : data.invoice.status;

  db.prepare(`UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    newAmountPaid,
    newStatus,
    req.params.id,
  );

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ payment, invoice: getInvoiceWithItems(req.params.id).invoice });
});

router.get('/:id/payments/:paymentId/pdf', async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const payment = db
    .prepare('SELECT * FROM payments WHERE id = ? AND invoice_id = ?')
    .get(req.params.paymentId, req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const buffer = await renderReceiptPdf({ payment, invoice: data.invoice, client: data.client, settings });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${payment.receipt_number}.pdf"`,
  });
  res.send(buffer);
});

router.post('/:id/payments/:paymentId/send-receipt', async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const payment = db
    .prepare('SELECT * FROM payments WHERE id = ? AND invoice_id = ?')
    .get(req.params.paymentId, req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  try {
    const buffer = await renderReceiptPdf({ payment, invoice: data.invoice, client: data.client, settings });
    await sendMail({
      to: data.client.email,
      subject: `Receipt ${payment.receipt_number} from ${settings.business_name || 'us'}`,
      html: `<p>Hi ${data.client.name},</p><p>Thanks for your payment. Please find your receipt attached.</p>`,
      attachments: [{ filename: `${payment.receipt_number}.pdf`, content: buffer }],
    });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  res.status(204).end();
});

module.exports = router;
