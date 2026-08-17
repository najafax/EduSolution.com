const { Router } = require('express');
const db = require('../db');
const { renderQuotePdf, renderInvoicePdf } = require('../lib/pdf');
const { logActivity } = require('../lib/activity');

const router = Router();

const today = () => new Date().toISOString().slice(0, 10);

function withComputedInvoice(invoice) {
  const balanceDue = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
  return {
    ...invoice,
    balance_due: balanceDue,
    is_overdue: invoice.status === 'sent' && balanceDue > 0 && invoice.due_date < today(),
    is_partially_paid: invoice.amount_paid > 0 && balanceDue > 0,
  };
}

// Strips internal-only config that no client-facing document (the PDF or
// this JSON view) ever actually renders — starting_balance is an internal
// financial figure and session_timeout_minutes is a security policy value,
// neither belongs in a response any client holding a public quote/invoice
// link can read. Every other field here (business_name, address, tax_id,
// bank_details, logo/signature/stamp images, etc.) is fine as-is: it's the
// same data this same token can already pull via the PDF route.
function publicSettings(settings) {
  const { session_timeout_minutes, starting_balance, ...rest } = settings;
  return rest;
}

function getQuoteByToken(token) {
  const quote = db.prepare('SELECT * FROM quotes WHERE public_token = ?').get(token);
  if (!quote) return null;
  const items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order').all(quote.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(quote.client_id);
  return { quote, items, client };
}

function getInvoiceByToken(token) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE public_token = ?').get(token);
  if (!invoice) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(invoice.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id);
  return { invoice: withComputedInvoice(invoice), items, client };
}

router.get('/quotes/:token', (req, res) => {
  const data = getQuoteByToken(req.params.token);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ ...data, settings: publicSettings(settings) });
});

router.post('/quotes/:token/respond', (req, res) => {
  const data = getQuoteByToken(req.params.token);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  if (!['draft', 'sent'].includes(data.quote.status)) {
    return res.status(409).json({ error: `This quote has already been ${data.quote.status}` });
  }

  const { response } = req.body || {};
  if (!['accepted', 'declined'].includes(response)) {
    return res.status(400).json({ error: 'response must be "accepted" or "declined"' });
  }

  db.prepare(
    `UPDATE quotes SET status = ?, client_response = ?, client_responded_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(response, response, data.quote.id);

  logActivity({
    userName: data.client.name,
    action: `${response} (client)`,
    entityType: 'quote',
    entityId: data.quote.id,
    entityLabel: data.quote.number,
  });

  res.json(getQuoteByToken(req.params.token));
});

router.get('/quotes/:token/pdf', async (req, res) => {
  const data = getQuoteByToken(req.params.token);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  const buffer = await renderQuotePdf({ quote: data.quote, client: data.client, items: data.items, settings });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${data.quote.number}.pdf"`,
  });
  res.send(buffer);
});

router.get('/invoices/:token', (req, res) => {
  const data = getInvoiceByToken(req.params.token);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ ...data, settings: publicSettings(settings) });
});

router.get('/invoices/:token/pdf', async (req, res) => {
  const data = getInvoiceByToken(req.params.token);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  // Fetched separately from getInvoiceByToken (rather than added to what it
  // returns) so this stays PDF-only — the public JSON view's response shape
  // is unaffected.
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at').all(data.invoice.id);

  const buffer = await renderInvoicePdf({ invoice: data.invoice, client: data.client, items: data.items, settings, payments });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${data.invoice.number}.pdf"`,
  });
  res.send(buffer);
});

module.exports = router;
