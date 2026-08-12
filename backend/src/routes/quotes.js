const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { computeTotals } = require('../lib/totals');
const { nextQuoteNumber, nextInvoiceNumber } = require('../lib/numbering');
const { renderQuotePdf } = require('../lib/pdf');
const { sendMail } = require('../lib/mailer');
const { logActivity } = require('../lib/activity');
const { toCsv } = require('../lib/csv');

const router = Router();
router.use(requireAuth);
const view = requirePermission('quotes', 'view');
const manage = requirePermission('quotes', 'manage');

function getQuoteWithItems(id) {
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!quote) return null;
  const items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order').all(id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(quote.client_id);
  return { quote, items, client };
}

function saveItems(quoteId, items) {
  db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(quoteId);
  const insert = db.prepare(
    'INSERT INTO quote_items (quote_id, description, quantity, unit_price, amount, sort_order, product_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const item of items) {
    insert.run(quoteId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order, item.product_id ?? null);
  }
}

const PAGE_SIZE = 20;

router.get('/', view, (req, res) => {
  const { status, q, page: pageParam } = req.query;
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('quotes.status = ?');
    params.push(status);
  }
  if (q) {
    conditions.push('(quotes.number LIKE ? OR clients.name LIKE ? OR quotes.status LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const baseFrom = 'FROM quotes JOIN clients ON clients.id = quotes.client_id';

  if (!pageParam) {
    const rows = db
      .prepare(
        `SELECT quotes.*, clients.name AS client_name ${baseFrom} ${where} ORDER BY quotes.issue_date DESC, quotes.id DESC`,
      )
      .all(...params);
    return res.json({ quotes: rows });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${baseFrom} ${where}`).get(...params);
  const rows = db
    .prepare(
      `SELECT quotes.*, clients.name AS client_name ${baseFrom} ${where}
       ORDER BY quotes.issue_date DESC, quotes.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, offset);
  res.json({ quotes: rows, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

router.get('/export.csv', view, (req, res) => {
  const rows = db
    .prepare(
      `SELECT quotes.*, clients.name AS client_name
       FROM quotes JOIN clients ON clients.id = quotes.client_id
       ORDER BY quotes.issue_date DESC, quotes.id DESC`,
    )
    .all();
  const csv = toCsv(rows, [
    { label: 'Number', key: 'number' },
    { label: 'Client', key: 'client_name' },
    { label: 'Status', key: 'status' },
    { label: 'Issue date', key: 'issue_date' },
    { label: 'Expiry date', key: 'expiry_date' },
    { label: 'Subtotal', key: 'subtotal' },
    { label: 'Discount', key: 'discount_amount' },
    { label: 'Tax', key: 'tax_amount' },
    { label: 'Total', key: 'total' },
  ]);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="quotes.csv"' });
  res.send(csv);
});

router.post('/', manage, (req, res) => {
  const {
    client_id,
    issue_date,
    expiry_date = null,
    notes = '',
    tax_rate = 0,
    discount_type = 'percentage',
    discount_value = 0,
    items,
  } = req.body || {};

  if (!client_id || !issue_date) {
    return res.status(400).json({ error: 'client_id and issue_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });

  let totals;
  try {
    totals = computeTotals(items, tax_rate, discount_type, discount_value);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const number = nextQuoteNumber();
  const publicToken = crypto.randomBytes(16).toString('hex');
  const result = db
    .prepare(
      `INSERT INTO quotes (number, client_id, status, issue_date, expiry_date, notes, discount_type, discount_value,
         subtotal, discount_amount, tax_rate, tax_amount, total, public_token)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      number,
      client_id,
      issue_date,
      expiry_date,
      notes,
      totals.discountType,
      totals.discountValue,
      totals.subtotal,
      totals.discountAmount,
      totals.taxRate,
      totals.taxAmount,
      totals.total,
      publicToken,
    );

  saveItems(result.lastInsertRowid, totals.items);
  logActivity({ userName: req.user.name, action: 'created', entityType: 'quote', entityId: result.lastInsertRowid, entityLabel: number });

  res.status(201).json(getQuoteWithItems(result.lastInsertRowid));
});

router.get('/:id', view, (req, res) => {
  const data = getQuoteWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  res.json(data);
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quote not found' });

  const {
    client_id,
    issue_date,
    expiry_date = null,
    notes = '',
    tax_rate = 0,
    discount_type = 'percentage',
    discount_value = 0,
    status,
    items,
  } = req.body || {};
  if (!client_id || !issue_date) {
    return res.status(400).json({ error: 'client_id and issue_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });

  let totals;
  try {
    totals = computeTotals(items, tax_rate, discount_type, discount_value);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const validStatuses = ['draft', 'sent', 'accepted', 'declined', 'expired'];
  const nextStatus = validStatuses.includes(status) ? status : existing.status;

  db.prepare(
    `UPDATE quotes SET client_id = ?, status = ?, issue_date = ?, expiry_date = ?, notes = ?,
       discount_type = ?, discount_value = ?, subtotal = ?, discount_amount = ?, tax_rate = ?, tax_amount = ?, total = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    client_id,
    nextStatus,
    issue_date,
    expiry_date,
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
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'quote', entityId: Number(req.params.id), entityLabel: existing.number });

  res.json(getQuoteWithItems(req.params.id));
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quote not found' });
  db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'quote', entityId: existing.id, entityLabel: existing.number });
  res.status(204).end();
});

router.get('/:id/pdf', view, async (req, res) => {
  const data = getQuoteWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  const buffer = await renderQuotePdf({ quote: data.quote, client: data.client, items: data.items, settings });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${data.quote.number}.pdf"`,
  });
  res.send(buffer);
});

router.post('/:id/send', manage, async (req, res) => {
  const data = getQuoteWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const publicUrl = `${clientOrigin}/q/${data.quote.public_token}`;

  try {
    const buffer = await renderQuotePdf({ quote: data.quote, client: data.client, items: data.items, settings });
    await sendMail({
      to: data.client.email,
      subject: `Quote ${data.quote.number} from ${settings.business_name || 'us'}`,
      html: `<p>Hi ${data.client.name},</p><p>Please find attached quote ${data.quote.number} for your review.</p><p>You can also view it online and let us know your decision here: <a href="${publicUrl}">${publicUrl}</a></p>`,
      attachments: [{ filename: `${data.quote.number}.pdf`, content: buffer }],
    });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  if (data.quote.status === 'draft') {
    db.prepare(`UPDATE quotes SET status = 'sent', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  }
  logActivity({ userName: req.user.name, action: 'sent', entityType: 'quote', entityId: data.quote.id, entityLabel: data.quote.number });
  res.json(getQuoteWithItems(req.params.id));
});

router.post('/:id/duplicate', manage, (req, res) => {
  const data = getQuoteWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });

  const number = nextQuoteNumber();
  const publicToken = crypto.randomBytes(16).toString('hex');
  const issueDate = new Date().toISOString().slice(0, 10);

  const result = db
    .prepare(
      `INSERT INTO quotes (number, client_id, status, issue_date, expiry_date, notes, discount_type, discount_value,
         subtotal, discount_amount, tax_rate, tax_amount, total, public_token)
       VALUES (?, ?, 'draft', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      number,
      data.quote.client_id,
      issueDate,
      data.quote.notes,
      data.quote.discount_type,
      data.quote.discount_value,
      data.quote.subtotal,
      data.quote.discount_amount,
      data.quote.tax_rate,
      data.quote.tax_amount,
      data.quote.total,
      publicToken,
    );

  const insertItem = db.prepare(
    'INSERT INTO quote_items (quote_id, description, quantity, unit_price, amount, sort_order, product_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const item of data.items) {
    insertItem.run(result.lastInsertRowid, item.description, item.quantity, item.unit_price, item.amount, item.sort_order, item.product_id ?? null);
  }

  logActivity({ userName: req.user.name, action: 'duplicated', entityType: 'quote', entityId: result.lastInsertRowid, entityLabel: `${number} (from ${data.quote.number})` });

  res.status(201).json(getQuoteWithItems(result.lastInsertRowid));
});

// Requires manage on both — this creates a real invoice, not just a quote update.
router.post('/:id/convert-to-invoice', manage, requirePermission('invoices', 'manage'), (req, res) => {
  const data = getQuoteWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  if (data.quote.converted_invoice_id) {
    return res.status(409).json({ error: 'This quote has already been converted to an invoice' });
  }

  const { due_date } = req.body || {};
  if (!due_date) return res.status(400).json({ error: 'due_date is required' });

  const number = nextInvoiceNumber();
  const publicToken = crypto.randomBytes(16).toString('hex');
  const issueDate = new Date().toISOString().slice(0, 10);

  const result = db
    .prepare(
      `INSERT INTO invoices (number, client_id, quote_id, status, issue_date, due_date, notes, discount_type, discount_value,
         subtotal, discount_amount, tax_rate, tax_amount, total, public_token)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      number,
      data.quote.client_id,
      data.quote.id,
      issueDate,
      due_date,
      data.quote.notes,
      data.quote.discount_type,
      data.quote.discount_value,
      data.quote.subtotal,
      data.quote.discount_amount,
      data.quote.tax_rate,
      data.quote.tax_amount,
      data.quote.total,
      publicToken,
    );

  const insertItem = db.prepare(
    'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, product_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const item of data.items) {
    insertItem.run(result.lastInsertRowid, item.description, item.quantity, item.unit_price, item.amount, item.sort_order, item.product_id ?? null);
  }

  db.prepare(`UPDATE quotes SET converted_invoice_id = ?, status = 'accepted', updated_at = datetime('now') WHERE id = ?`).run(
    result.lastInsertRowid,
    req.params.id,
  );

  logActivity({ userName: req.user.name, action: 'converted to invoice', entityType: 'quote', entityId: data.quote.id, entityLabel: data.quote.number });

  res.status(201).json({ invoiceId: result.lastInsertRowid, invoiceNumber: number });
});

module.exports = router;
