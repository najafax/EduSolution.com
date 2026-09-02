const { Router } = require('express');
const db = require('../db');
const { renderQuotePdf, renderInvoicePdf } = require('../lib/pdf');
const { logActivity } = require('../lib/activity');
const { notifyStaffOfQuoteAccepted } = require('../lib/quoteAcceptedNotify');
const { SECTIONS, VILLA_ITEMS, sanitizeIssues, sanitizeVillas, sanitizeGuests, validate } = require('../lib/modReportShared');
const { modReportSubmitLimiter } = require('../middleware/rateLimit');

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

// Stamps client_viewed_at the first time a client actually opens the
// document via this token — a no-op on every view after the first (the
// WHERE clause only ever matches while the column is still NULL), so this
// is safe to call unconditionally on every GET without an extra read first.
// `table` is always a literal ('quotes' or 'invoices') from a call site
// below, never request input, so the interpolation here carries no
// injection risk — same as routes/dataReset.js's own table-name-from-a-
// fixed-map pattern.
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
  if (!invoice) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(invoice.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id);
  return { invoice: withComputedInvoice(invoice), items, client };
}

router.get('/quotes/:token', (req, res) => {
  const data = getQuoteByToken(req.params.token);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  markViewed('quotes', data.quote.id);
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

  if (response === 'accepted') {
    const updated = getQuoteByToken(req.params.token).quote;
    notifyStaffOfQuoteAccepted({ quote: updated, client: data.client }).catch((err) =>
      console.error('Failed to notify staff of quote acceptance:', err.message),
    );
  }

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
  markViewed('invoices', data.invoice.id);
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

// MOD report public submission — deliberately the mirror image of the
// quote/invoice routes above: those are read (+respond) links to one
// already-existing document; this is a write-only link to *create* a new
// one, with nothing to read back (a submitter has no reason to browse past
// reports, which is exactly the sensitive data routes/modReports.js's own
// requireSuperAdmin gate exists to protect — see that file's own top note).
// The link identifies the business's checklist form itself, not any one
// report, so it's a single token on mod_report_settings rather than a
// public_token per row the way quotes/invoices work. sections/villaItems
// are the identical shared source of truth routes/modReports.js's own
// authenticated GET /meta serves — not sensitive on their own (just the
// checklist's fixed structure), so no separate stripped-down copy is
// needed here the way publicSettings() strips business_settings above.
function getModReportSettingsByToken(token) {
  const settings = db.prepare('SELECT * FROM mod_report_settings WHERE id = 1').get();
  if (!settings || !settings.submission_token || settings.submission_token !== token) return null;
  return settings;
}

router.get('/mod-reports/:token/meta', (req, res) => {
  const settings = getModReportSettingsByToken(req.params.token);
  if (!settings) return res.status(404).json({ error: 'This submission link is invalid or has been disabled.' });
  res.json({
    sections: SECTIONS,
    villaItems: VILLA_ITEMS,
    businessName: settings.business_name,
    logoImage: settings.logo_image,
  });
});

router.post('/mod-reports/:token', modReportSubmitLimiter, (req, res) => {
  const settings = getModReportSettingsByToken(req.params.token);
  if (!settings) return res.status(404).json({ error: 'This submission link is invalid or has been disabled.' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { mod_name, report_date, weather = '', time_started = '', occupancy_percent, sections = {}, signature = '' } = req.body;
  const villas = sanitizeVillas(req.body.villas);
  const guestInteractions = sanitizeGuests(req.body.guestInteractions);
  const issues = sanitizeIssues(req.body.issues);
  const occupancy = occupancy_percent === '' || occupancy_percent === undefined || occupancy_percent === null ? null : Number(occupancy_percent);

  // No submitted_by_user_id — there's no logged-in staff user behind a
  // public submission. submitted_by_name is the MOD's own name (mod_name
  // itself), same as what the field already means on an authenticated
  // submission, just with no separate account identity to also record.
  const result = db
    .prepare(
      `INSERT INTO mod_reports (mod_name, report_date, weather, time_started, occupancy_percent, sections_json, villas_json, guest_interactions_json, issues_json, signature, submitted_by_user_id, submitted_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      mod_name.trim(),
      report_date,
      weather,
      time_started,
      occupancy,
      JSON.stringify(sections && typeof sections === 'object' ? sections : {}),
      JSON.stringify(villas),
      JSON.stringify(guestInteractions),
      JSON.stringify(issues),
      signature,
      mod_name.trim(),
    );

  logActivity({
    userName: mod_name.trim(),
    action: 'submitted (public link)',
    entityType: 'mod_report',
    entityId: result.lastInsertRowid,
    entityLabel: `MOD checklist — ${mod_name.trim()} (${report_date})`,
  });

  // Minimal response — a public submitter has no further access to this
  // record (no GET route by token exists to read it back), so there's
  // nothing to return beyond confirmation that it saved.
  res.status(201).json({ ok: true });
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
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  res.json({ posts, testimonials, services, team, gallery, settings: settings ? publicSettings(settings) : null });
});

module.exports = router;
