const { Router } = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { computeTotals } = require('../lib/totals');
const { nextQuoteNumber, nextInvoiceNumber } = require('../lib/numbering');
const { renderQuotePdf } = require('../lib/pdf');
const { sendMail } = require('../lib/mailer');

const router = Router();
router.use(requireAuth);

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
    'INSERT INTO quote_items (quote_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const item of items) {
    insert.run(quoteId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order);
  }
}

router.get('/', (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db
        .prepare(
          `SELECT quotes.*, clients.name AS client_name, clients.company AS client_company
           FROM quotes JOIN clients ON clients.id = quotes.client_id
           WHERE quotes.status = ? ORDER BY quotes.issue_date DESC, quotes.id DESC`,
        )
        .all(status)
    : db
        .prepare(
          `SELECT quotes.*, clients.name AS client_name, clients.company AS client_company
           FROM quotes JOIN clients ON clients.id = quotes.client_id
           ORDER BY quotes.issue_date DESC, quotes.id DESC`,
        )
        .all();
  res.json({ quotes: rows });
});

router.post('/', (req, res) => {
  const { client_id, issue_date, expiry_date = null, notes = '', tax_rate = 0, items } = req.body || {};

  if (!client_id || !issue_date) {
    return res.status(400).json({ error: 'client_id and issue_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });

  let totals;
  try {
    totals = computeTotals(items, tax_rate);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const number = nextQuoteNumber();
  const result = db
    .prepare(
      `INSERT INTO quotes (number, client_id, status, issue_date, expiry_date, notes, tax_rate, subtotal, tax_amount, total)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(number, client_id, issue_date, expiry_date, notes, totals.taxRate, totals.subtotal, totals.taxAmount, totals.total);

  saveItems(result.lastInsertRowid, totals.items);

  res.status(201).json(getQuoteWithItems(result.lastInsertRowid));
});

router.get('/:id', (req, res) => {
  const data = getQuoteWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  res.json(data);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quote not found' });

  const { client_id, issue_date, expiry_date = null, notes = '', tax_rate = 0, status, items } = req.body || {};
  if (!client_id || !issue_date) {
    return res.status(400).json({ error: 'client_id and issue_date are required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });

  let totals;
  try {
    totals = computeTotals(items, tax_rate);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const validStatuses = ['draft', 'sent', 'accepted', 'declined', 'expired'];
  const nextStatus = validStatuses.includes(status) ? status : existing.status;

  db.prepare(
    `UPDATE quotes SET client_id = ?, status = ?, issue_date = ?, expiry_date = ?, notes = ?,
       tax_rate = ?, subtotal = ?, tax_amount = ?, total = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(client_id, nextStatus, issue_date, expiry_date, notes, totals.taxRate, totals.subtotal, totals.taxAmount, totals.total, req.params.id);

  saveItems(req.params.id, totals.items);

  res.json(getQuoteWithItems(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quote not found' });
  db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

router.get('/:id/pdf', async (req, res) => {
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

router.post('/:id/send', async (req, res) => {
  const data = getQuoteWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  try {
    const buffer = await renderQuotePdf({ quote: data.quote, client: data.client, items: data.items, settings });
    await sendMail({
      to: data.client.email,
      subject: `Quote ${data.quote.number} from ${settings.business_name || 'us'}`,
      html: `<p>Hi ${data.client.name},</p><p>Please find attached quote ${data.quote.number} for your review.</p>`,
      attachments: [{ filename: `${data.quote.number}.pdf`, content: buffer }],
    });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  if (data.quote.status === 'draft') {
    db.prepare(`UPDATE quotes SET status = 'sent', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  }
  res.json(getQuoteWithItems(req.params.id));
});

router.post('/:id/convert-to-invoice', (req, res) => {
  const data = getQuoteWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  if (data.quote.converted_invoice_id) {
    return res.status(409).json({ error: 'This quote has already been converted to an invoice' });
  }

  const { due_date } = req.body || {};
  if (!due_date) return res.status(400).json({ error: 'due_date is required' });

  const number = nextInvoiceNumber();
  const issueDate = new Date().toISOString().slice(0, 10);

  const result = db
    .prepare(
      `INSERT INTO invoices (number, client_id, quote_id, status, issue_date, due_date, notes, tax_rate, subtotal, tax_amount, total)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      number,
      data.quote.client_id,
      data.quote.id,
      issueDate,
      due_date,
      data.quote.notes,
      data.quote.tax_rate,
      data.quote.subtotal,
      data.quote.tax_amount,
      data.quote.total,
    );

  const insertItem = db.prepare(
    'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const item of data.items) {
    insertItem.run(result.lastInsertRowid, item.description, item.quantity, item.unit_price, item.amount, item.sort_order);
  }

  db.prepare(`UPDATE quotes SET converted_invoice_id = ?, status = 'accepted', updated_at = datetime('now') WHERE id = ?`).run(
    result.lastInsertRowid,
    req.params.id,
  );

  res.status(201).json({ invoiceId: result.lastInsertRowid, invoiceNumber: number });
});

module.exports = router;
