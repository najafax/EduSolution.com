const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { computeTotals } = require('../lib/totals');
const { nextInvoiceNumber, nextReceiptNumber } = require('../lib/numbering');
const { renderInvoicePdf, renderReceiptPdf } = require('../lib/pdf');
const { sendMail, textToHtml } = require('../lib/mailer');
const { invoiceSendEmail, invoiceRemindEmail, receiptSendEmail } = require('../lib/emailTemplates');
const { logActivity } = require('../lib/activity');
const { logEmail } = require('../lib/emailLog');
const { toCsv } = require('../lib/csv');
const { renewLicense } = require('../lib/licenseRenewal');

const router = Router();
router.use(requireAuth);
const view = requirePermission('invoices', 'view');
const manage = requirePermission('invoices', 'manage');

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
    'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, product_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const item of items) {
    insert.run(invoiceId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order, item.product_id ?? null);
  }
}

const PAGE_SIZE = 20;

router.get('/', view, (req, res) => {
  const { status, q, page: pageParam } = req.query;
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('invoices.status = ?');
    params.push(status);
  }
  if (q) {
    conditions.push('(invoices.number LIKE ? OR clients.name LIKE ? OR invoices.status LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const baseFrom = 'FROM invoices JOIN clients ON clients.id = invoices.client_id';

  if (!pageParam) {
    const rows = db
      .prepare(
        `SELECT invoices.*, clients.name AS client_name ${baseFrom} ${where} ORDER BY invoices.issue_date DESC, invoices.id DESC`,
      )
      .all(...params);
    return res.json({ invoices: rows.map(withComputed) });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${baseFrom} ${where}`).get(...params);
  const rows = db
    .prepare(
      `SELECT invoices.*, clients.name AS client_name ${baseFrom} ${where}
       ORDER BY invoices.issue_date DESC, invoices.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, offset);
  res.json({
    invoices: rows.map(withComputed),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

router.get('/export.csv', view, (req, res) => {
  const rows = db
    .prepare(
      `SELECT invoices.*, clients.name AS client_name
       FROM invoices JOIN clients ON clients.id = invoices.client_id
       ORDER BY invoices.issue_date DESC, invoices.id DESC`,
    )
    .all()
    .map(withComputed);
  const csv = toCsv(rows, [
    { label: 'Number', key: 'number' },
    { label: 'Client', key: 'client_name' },
    { label: 'Status', key: 'status' },
    { label: 'Issue date', key: 'issue_date' },
    { label: 'Due date', key: 'due_date' },
    { label: 'Subtotal', key: 'subtotal' },
    { label: 'Discount', key: 'discount_amount' },
    { label: 'Tax', key: 'tax_amount' },
    { label: 'Total', key: 'total' },
    { label: 'Amount paid', key: 'amount_paid' },
    { label: 'Balance due', key: 'balance_due' },
  ]);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="invoices.csv"' });
  res.send(csv);
});

router.post('/', manage, (req, res) => {
  const {
    client_id,
    issue_date,
    due_date,
    notes = '',
    tax_rate = 0,
    discount_type = 'percentage',
    discount_value = 0,
    items,
  } = req.body || {};

  if (!client_id || !issue_date || !due_date) {
    return res.status(400).json({ error: 'client_id, issue_date and due_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });

  let totals;
  try {
    totals = computeTotals(items, tax_rate, discount_type, discount_value);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const number = nextInvoiceNumber();
  const publicToken = crypto.randomBytes(16).toString('hex');
  const result = db
    .prepare(
      `INSERT INTO invoices (number, client_id, status, issue_date, due_date, notes, discount_type, discount_value,
         subtotal, discount_amount, tax_rate, tax_amount, total, public_token, created_by_name)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      number,
      client_id,
      issue_date,
      due_date,
      notes,
      totals.discountType,
      totals.discountValue,
      totals.subtotal,
      totals.discountAmount,
      totals.taxRate,
      totals.taxAmount,
      totals.total,
      publicToken,
      req.user.name,
    );

  saveItems(result.lastInsertRowid, totals.items);
  logActivity({ userName: req.user.name, action: 'created', entityType: 'invoice', entityId: result.lastInsertRowid, entityLabel: number });

  res.status(201).json(getInvoiceWithItems(result.lastInsertRowid));
});

router.get('/:id', view, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  res.json(data);
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.status === 'sent' || existing.status === 'paid') {
    return res.status(409).json({ error: 'This invoice has already been sent or paid and can no longer be edited' });
  }

  const {
    client_id,
    issue_date,
    due_date,
    notes = '',
    tax_rate = 0,
    discount_type = 'percentage',
    discount_value = 0,
    status,
    items,
  } = req.body || {};
  if (!client_id || !issue_date || !due_date) {
    return res.status(400).json({ error: 'client_id, issue_date and due_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });

  let totals;
  try {
    totals = computeTotals(items, tax_rate, discount_type, discount_value);
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
       discount_type = ?, discount_value = ?, subtotal = ?, discount_amount = ?, tax_rate = ?, tax_amount = ?, total = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    client_id,
    nextStatus,
    issue_date,
    due_date,
    notes,
    totals.discountType,
    totals.discountValue,
    totals.subtotal,
    totals.discountAmount,
    totals.taxRate,
    totals.taxAmount,
    totals.total,
    req.params.id,
  );

  saveItems(req.params.id, totals.items);
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'invoice', entityId: Number(req.params.id), entityLabel: existing.number });

  res.json(getInvoiceWithItems(req.params.id));
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const hasPayments = db.prepare('SELECT 1 FROM payments WHERE invoice_id = ? LIMIT 1').get(req.params.id);
  if (hasPayments) {
    return res.status(409).json({ error: 'This invoice has recorded payments and cannot be deleted' });
  }

  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'invoice', entityId: existing.id, entityLabel: existing.number });
  res.status(204).end();
});

// Cancels an invoice without deleting it — a void invoice is excluded from
// financial totals/reports (see routes/financials.js, routes/reports.js)
// but the record itself stays, unlike DELETE above. Deliberately its own
// action route rather than a status value on PUT /:id: that route already
// 409s once status is 'sent'/'paid' (a delivered/settled document can't be
// edited), but voiding is exactly the escape hatch a sent invoice needs —
// it has to work precisely where PUT refuses to. Only blocked when the
// invoice is already void, already paid (voiding paid money needs a real
// refund process, not a status flip), or has any recorded payments at all
// (mirrors the DELETE guard above — a partially-paid invoice can't just
// have its payments silently orphaned by voiding it).
router.post('/:id/void', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.status === 'void') {
    return res.status(409).json({ error: 'This invoice is already void' });
  }
  if (existing.status === 'paid') {
    return res.status(409).json({ error: 'This invoice has already been paid and cannot be voided' });
  }
  if (existing.amount_paid > 0) {
    return res.status(409).json({ error: 'This invoice has recorded payments and cannot be voided' });
  }

  db.prepare(`UPDATE invoices SET status = 'void', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  logActivity({ userName: req.user.name, action: 'voided', entityType: 'invoice', entityId: existing.id, entityLabel: existing.number });
  res.json(getInvoiceWithItems(req.params.id));
});

router.get('/:id/pdf', view, async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  const buffer = await renderInvoicePdf({ invoice: data.invoice, client: data.client, items: data.items, settings, payments: data.payments });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${data.invoice.number}.pdf"`,
  });
  res.send(buffer);
});

// See routes/quotes.js's /:id/send-preview for why this exists: the exact
// same emailTemplates.js function backs both this preview and the actual
// send's fallback-when-not-overridden defaults below.
router.get('/:id/send-preview', manage, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const publicUrl = `${clientOrigin}/i/${data.invoice.public_token}`;
  res.json(invoiceSendEmail({ invoice: data.invoice, client: data.client, settings, publicUrl }));
});

router.post('/:id/send', manage, async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  if (data.invoice.status === 'void') {
    return res.status(409).json({ error: 'This invoice has been voided and cannot be sent' });
  }
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const publicUrl = `${clientOrigin}/i/${data.invoice.public_token}`;
  const defaults = invoiceSendEmail({ invoice: data.invoice, client: data.client, settings, publicUrl });
  const subject = (req.body?.subject || '').trim() || defaults.subject;
  const message = (req.body?.message || '').trim() || defaults.message;

  try {
    const buffer = await renderInvoicePdf({ invoice: data.invoice, client: data.client, items: data.items, settings, payments: data.payments });
    await sendMail({
      to: data.client.email,
      subject,
      html: textToHtml(message),
      attachments: [{ filename: `${data.invoice.number}.pdf`, content: buffer }],
    });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  if (data.invoice.status === 'draft') {
    db.prepare(`UPDATE invoices SET status = 'sent', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  }
  logActivity({ userName: req.user.name, action: 'sent', entityType: 'invoice', entityId: data.invoice.id, entityLabel: data.invoice.number });
  logEmail({ type: 'invoice_send', to: data.client.email, subject, sentByName: req.user.name, entityType: 'invoice', entityId: data.invoice.id, entityLabel: data.invoice.number });
  res.json(getInvoiceWithItems(req.params.id));
});

router.get('/:id/remind-preview', manage, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json(invoiceRemindEmail({ invoice: data.invoice, client: data.client, settings }));
});

router.post('/:id/remind', manage, async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  if (data.invoice.status === 'void') {
    return res.status(409).json({ error: 'This invoice has been voided' });
  }
  if (data.invoice.balance_due <= 0) {
    return res.status(409).json({ error: 'This invoice is already fully paid' });
  }
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const defaults = invoiceRemindEmail({ invoice: data.invoice, client: data.client, settings });
  const subject = (req.body?.subject || '').trim() || defaults.subject;
  const message = (req.body?.message || '').trim() || defaults.message;

  try {
    const buffer = await renderInvoicePdf({ invoice: data.invoice, client: data.client, items: data.items, settings, payments: data.payments });
    await sendMail({
      to: data.client.email,
      subject,
      html: textToHtml(message),
      attachments: [{ filename: `${data.invoice.number}.pdf`, content: buffer }],
    });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  db.prepare(`UPDATE invoices SET last_reminder_sent_at = datetime('now') WHERE id = ?`).run(req.params.id);
  logActivity({ userName: req.user.name, action: 'sent reminder for', entityType: 'invoice', entityId: data.invoice.id, entityLabel: data.invoice.number });
  logEmail({ type: 'invoice_remind', to: data.client.email, subject, sentByName: req.user.name, entityType: 'invoice', entityId: data.invoice.id, entityLabel: data.invoice.number });
  res.json(getInvoiceWithItems(req.params.id));
});

router.post('/:id/duplicate', manage, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });

  const number = nextInvoiceNumber();
  const publicToken = crypto.randomBytes(16).toString('hex');
  const issueDate = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const result = db
    .prepare(
      `INSERT INTO invoices (number, client_id, status, issue_date, due_date, notes, discount_type, discount_value,
         subtotal, discount_amount, tax_rate, tax_amount, total, public_token, created_by_name)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      number,
      data.invoice.client_id,
      issueDate,
      dueDate,
      data.invoice.notes,
      data.invoice.discount_type,
      data.invoice.discount_value,
      data.invoice.subtotal,
      data.invoice.discount_amount,
      data.invoice.tax_rate,
      data.invoice.tax_amount,
      data.invoice.total,
      publicToken,
      req.user.name,
    );

  const insertItem = db.prepare(
    'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, product_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const item of data.items) {
    insertItem.run(result.lastInsertRowid, item.description, item.quantity, item.unit_price, item.amount, item.sort_order, item.product_id ?? null);
  }

  logActivity({ userName: req.user.name, action: 'duplicated', entityType: 'invoice', entityId: result.lastInsertRowid, entityLabel: `${number} (from ${data.invoice.number})` });

  res.status(201).json(getInvoiceWithItems(result.lastInsertRowid));
});

router.post('/:id/payments', manage, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  if (data.invoice.status === 'void' || data.invoice.status === 'draft') {
    return res.status(400).json({ error: `cannot record a payment against a ${data.invoice.status} invoice` });
  }

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
  logActivity({ userName: req.user.name, action: 'recorded payment for', entityType: 'invoice', entityId: Number(req.params.id), entityLabel: `${data.invoice.number} (${receiptNumber})` });

  // Auto-renew any of this client's active licenses that this invoice was
  // actually billing for — matched by a line item description naming the
  // license exactly (trimmed, case-insensitive), not just "client has an
  // invoice," so an unrelated invoice for the same client never touches a
  // license it didn't bill. Only fires the moment the invoice is fully
  // paid (newStatus === 'paid'), not on a partial payment — mirrors the
  // "once they've paid, renew it" framing the manual Renew button already
  // uses. Reuses the exact same renewLicense() the manual Renew button and
  // routes/licenses.js's POST /:id/renew call, so an auto-renewal writes
  // the same license_renewals row and resets last_reminder_sent_at
  // identically to a human clicking "Renew".
  const autoRenewedLicenses = [];
  if (newStatus === 'paid') {
    const descriptions = new Set(data.items.map((item) => (item.description || '').trim().toLowerCase()).filter(Boolean));
    if (descriptions.size > 0) {
      const clientLicenses = db.prepare("SELECT * FROM licenses WHERE client_id = ? AND status = 'active'").all(data.invoice.client_id);
      for (const license of clientLicenses) {
        if (!descriptions.has(license.name.trim().toLowerCase())) continue;
        const nextExpiry = renewLicense(license, req.user.name);
        logActivity({
          userName: req.user.name,
          action: 'auto-renewed via invoice payment for',
          entityType: 'license',
          entityId: license.id,
          entityLabel: `${license.name} (${data.client.name}) → ${nextExpiry}`,
        });
        autoRenewedLicenses.push({ id: license.id, name: license.name, expiry_date: nextExpiry });
      }
    }
  }

  res.status(201).json({ payment, invoice: getInvoiceWithItems(req.params.id).invoice, autoRenewedLicenses });
});

router.get('/:id/payments/:paymentId/pdf', view, async (req, res) => {
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

router.get('/:id/payments/:paymentId/receipt-preview', manage, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const payment = db
    .prepare('SELECT * FROM payments WHERE id = ? AND invoice_id = ?')
    .get(req.params.paymentId, req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json(receiptSendEmail({ payment, client: data.client, settings }));
});

router.post('/:id/payments/:paymentId/send-receipt', manage, async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const payment = db
    .prepare('SELECT * FROM payments WHERE id = ? AND invoice_id = ?')
    .get(req.params.paymentId, req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const defaults = receiptSendEmail({ payment, client: data.client, settings });
  const subject = (req.body?.subject || '').trim() || defaults.subject;
  const message = (req.body?.message || '').trim() || defaults.message;

  try {
    const buffer = await renderReceiptPdf({ payment, invoice: data.invoice, client: data.client, settings });
    await sendMail({
      to: data.client.email,
      subject,
      html: textToHtml(message),
      attachments: [{ filename: `${payment.receipt_number}.pdf`, content: buffer }],
    });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  logEmail({ type: 'receipt_send', to: data.client.email, subject, sentByName: req.user.name, entityType: 'invoice', entityId: data.invoice.id, entityLabel: payment.receipt_number });
  res.status(204).end();
});

module.exports = router;
