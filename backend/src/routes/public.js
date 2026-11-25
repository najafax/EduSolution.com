const { Router } = require('express');
const { todayStr } = require('../lib/businessDate');
const db = require('../db');
const { CLIENT_ITEM_COLUMNS } = require('../lib/costSnapshot');
const { renderQuotePdf, renderInvoicePdf } = require('../lib/pdf');
const { publicRespondLimiter, enquiryLimiter } = require('../middleware/rateLimit');
const { EMAIL_RE } = require('../lib/emails');
const { INTERESTS, turnstileEnabled, verifyTurnstile, notifyEnquiry } = require('../lib/enquiry');
const { clientForClient, invoiceForClient, quoteForClient } = require('../lib/clientView');
const { notifyStaffOfQuoteAccepted } = require('../lib/quoteAcceptedNotify');

const router = Router();

const today = () => todayStr();

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
  const { session_timeout_minutes, starting_balance, starting_balance_date, ...rest } = settings;
  return rest;
}

// Stamps client_viewed_at the first time a client actually opens the
// document via this token — a no-op on every view after the first (the
// WHERE clause only ever matches while the column is still NULL), so this
// is safe to call unconditionally on every GET without an extra read first.
// `table` is always a literal ('quotes' or 'invoices') from a call site
// below, never request input, so the interpolation here carries no
// injection risk — same as routes/dataReset.js's own table-name-from-a-
// fixed-map pattern.
const clientQuoteView = (d) => ({ ...d, quote: quoteForClient(d.quote), client: clientForClient(d.client) });
const clientInvoiceView = (d) => ({ ...d, invoice: invoiceForClient(d.invoice), client: clientForClient(d.client) });

function markViewed(table, id) {
  db.prepare(`UPDATE ${table} SET client_viewed_at = datetime('now') WHERE id = ? AND client_viewed_at IS NULL`).run(id);
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
  // A draft has not been issued to the client yet.
  if (!invoice || invoice.status === 'draft') return null;
  const items = db.prepare(`SELECT ${CLIENT_ITEM_COLUMNS} FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order`).all(invoice.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id);
  return { invoice: withComputedInvoice(invoice), items, client };
}

router.get('/quotes/:token', (req, res) => {
  const data = getQuoteByToken(req.params.token);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  markViewed('quotes', data.quote.id);
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ ...clientQuoteView(data), settings: publicSettings(settings) });
});

router.post('/quotes/:token/respond', publicRespondLimiter, (req, res) => {
  const data = getQuoteByToken(req.params.token);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  if (!['draft', 'sent'].includes(data.quote.status)) {
    return res.status(409).json({ error: `This quote has already been ${data.quote.status}` });
  }

  if (data.quote.expiry_date && data.quote.expiry_date < todayStr()) {
    return res.status(409).json({ error: 'This quote has expired. Please contact us for an updated quote.' });
  }

  const { response } = req.body || {};
  if (!['accepted', 'declined'].includes(response)) {
    return res.status(400).json({ error: 'response must be "accepted" or "declined"' });
  }

  db.prepare(
    `UPDATE quotes SET status = ?, client_response = ?, client_responded_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(response, response, data.quote.id);


  if (response === 'accepted') {
    const updated = getQuoteByToken(req.params.token).quote;
    notifyStaffOfQuoteAccepted({ quote: updated, client: data.client }).catch((err) =>
      console.error('Failed to notify staff of quote acceptance:', err.message),
    );
  }

  res.json(clientQuoteView(getQuoteByToken(req.params.token)));
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
  markViewed('invoices', data.invoice.id);
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ ...clientInvoiceView(data), settings: publicSettings(settings) });
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

// The public marketing site's one combined content fetch — same "one
// request instead of several separate ones" reasoning routes/dashboard.js's
// GET /overview already established, just for an unauthenticated visitor
// instead of a logged-in one. Only ever returns published/visible rows —
// a draft post or a hidden gallery image staff are still working on is
// never reachable through this route, the same "only the opted-in subset is
// ever public" rule products.visible_in_portal already enforces for the
// client portal's own catalog. No pagination on any of these lists (see
// routes/website.js's own top-of-file note — a marketing site's content is
// inherently small) and no rate limiting (a plain, cheap SELECT with no
// side effects, the same trust level every other public-token GET in this
// app already runs at with zero rate limiting).
router.get('/site', (req, res) => {
  const posts = db
    .prepare("SELECT id, title, body, category, published_at FROM website_posts WHERE status = 'published' ORDER BY published_at DESC, id DESC")
    .all();
  const testimonials = db
    .prepare(
      "SELECT id, quote, author_name, author_role, category FROM website_testimonials WHERE status = 'published' ORDER BY display_order ASC, id DESC",
    )
    .all();
  const services = db
    .prepare('SELECT id, title, description, icon FROM website_services WHERE visible = 1 ORDER BY display_order ASC, id ASC')
    .all();
  const team = db
    .prepare('SELECT id, name, role, photo FROM website_team_members WHERE visible = 1 ORDER BY display_order ASC, id ASC')
    .all();
  const gallery = db
    .prepare('SELECT id, image, caption FROM website_gallery WHERE visible = 1 ORDER BY display_order ASC, id ASC')
    .all();
  const videos = db
    .prepare('SELECT id, title, description, video_url, category FROM website_videos WHERE visible = 1 ORDER BY display_order ASC, id ASC')
    .all();
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  res.json({
    posts,
    testimonials,
    services,
    team,
    gallery,
    videos,
    settings: settings ? publicSettings(settings) : null,
    turnstileSiteKey: turnstileEnabled() ? process.env.TURNSTILE_SITE_KEY : '',
  });
});

// Website enquiry form (walkthrough request). Unauthenticated write, so:
// per-IP limiter, hidden honeypot field, minimum fill time, at most 3 per
// address per day, and an optional Turnstile challenge. A bot that trips the
// honeypot or the timer gets the same "ok" answer a person would, so it
// learns nothing about why it was dropped.
router.post('/enquiries', enquiryLimiter, async (req, res) => {
  const b = req.body || {};
  const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

  if (text(b.website, 200)) return res.json({ ok: true });
  const filledFor = Date.now() - Number(b.t);
  if (!Number.isFinite(filledFor) || filledFor < 3000) return res.json({ ok: true });

  const name = text(b.name, 120);
  const email = text(b.email, 200).toLowerCase();
  const organisation = text(b.organisation, 160);
  const phone = text(b.phone, 40);
  const message = text(b.message, 2000);
  const interest = Object.prototype.hasOwnProperty.call(INTERESTS, b.interest) ? b.interest : 'unsure';

  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  if (!(await verifyTurnstile(b.turnstileToken, req.ip))) {
    return res.status(400).json({ error: 'Spam check failed. Please reload the page and try again.' });
  }

  const recent = db
    .prepare("SELECT COUNT(*) AS n FROM website_enquiries WHERE email = ? AND created_at > datetime('now', '-1 day')")
    .get(email).n;
  if (recent >= 3) {
    return res.status(429).json({ error: 'We already have your requests. We will be in touch shortly.' });
  }

  const info = db
    .prepare('INSERT INTO website_enquiries (name, organisation, email, phone, interest, message) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, organisation, email, phone, interest, message);
  res.json({ ok: true });
  const enquiry = db.prepare('SELECT * FROM website_enquiries WHERE id = ?').get(info.lastInsertRowid);
  notifyEnquiry(enquiry).catch((err) => console.error('enquiry notify failed', err.message));
});

module.exports = router;
