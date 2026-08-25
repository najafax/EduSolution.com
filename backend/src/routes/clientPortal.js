const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireClientAuth } = require('../middleware/clientAuth');
const {
  portalLoginLimiter,
  portalForgotPasswordLimiter,
  portalResetPasswordLimiter,
  portalAcceptInviteLimiter,
} = require('../middleware/rateLimit');
const { sendMail } = require('../lib/mailer');
const { renderQuotePdf, renderInvoicePdf, renderReceiptPdf } = require('../lib/pdf');
const { logActivity } = require('../lib/activity');
const { notifyStaffOfQuoteAccepted } = require('../lib/quoteAcceptedNotify');
const { notifyStaffOfPaymentProof } = require('../lib/paymentProofNotify');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, same window as staff resets
const MIN_PASSWORD_LENGTH = 8;

const router = Router();

function signClientToken(account) {
  return jwt.sign({ id: account.id, clientId: account.client_id, email: account.email, type: 'client' }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

// The single place that shapes what a portal account ever sends to the
// client — never return a raw row (it carries password_hash, tokens, etc).
function publicAccount(account) {
  return {
    id: account.id,
    clientId: account.client_id,
    clientName: account.client_name,
    email: account.email,
  };
}

function getAccountWithClientName(id) {
  return db
    .prepare(
      `SELECT client_portal_accounts.*, clients.name AS client_name
       FROM client_portal_accounts
       JOIN clients ON clients.id = client_portal_accounts.client_id
       WHERE client_portal_accounts.id = ?`,
    )
    .get(id);
}

// There is no signup route here either, same reasoning as routes/auth.js —
// a portal account is only ever created by an admin inviting an existing
// client (routes/clients.js's POST /:id/portal-invite, added alongside the
// portal's own admin-facing UI), never by someone showing up with an email.

router.post('/login', portalLoginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const account = db
    .prepare(
      `SELECT client_portal_accounts.*, clients.name AS client_name
       FROM client_portal_accounts
       JOIN clients ON clients.id = client_portal_accounts.client_id
       WHERE client_portal_accounts.email = ?`,
    )
    .get(String(email).toLowerCase());
  if (!account) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!account.password_hash) {
    return res.status(401).json({ error: 'This account has not been activated yet. Check your email for an invite link.' });
  }

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!account.active) {
    return res.status(401).json({ error: 'This account has been deactivated' });
  }

  res.json({ token: signClientToken(account), account: publicAccount(account) });
});

router.post('/accept-invite', portalAcceptInviteLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'token and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const account = db.prepare('SELECT * FROM client_portal_accounts WHERE invite_token = ?').get(token);
  if (!account || !account.invite_token_expires || new Date(account.invite_token_expires) < new Date()) {
    return res.status(400).json({ error: 'This invite link is invalid or has expired' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(
    `UPDATE client_portal_accounts
     SET password_hash = ?, invite_token = NULL, invite_token_expires = NULL, password_changed_at = datetime('now')
     WHERE id = ?`,
  ).run(passwordHash, account.id);

  res.json({ message: 'Password set. You can now log in.' });
});

router.post('/forgot-password', portalForgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  const account = db.prepare('SELECT * FROM client_portal_accounts WHERE email = ?').get(String(email).toLowerCase());
  // Always respond the same way whether or not the account exists, same
  // reasoning as routes/auth.js's own forgot-password.
  const genericMessage = { message: 'If an account exists for that email, a password reset link has been sent.' };

  if (!account) {
    return res.json(genericMessage);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE client_portal_accounts SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(
    token,
    expires,
    account.id,
  );

  const resetUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/portal/reset-password?token=${token}`;
  try {
    await sendMail({
      to: account.email,
      subject: 'Reset your portal password',
      html: `<p>Hi,</p><p>Click the link below to reset your portal password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    });
  } catch (err) {
    console.error('Failed to send portal password reset email:', err.message);
  }

  res.json(genericMessage);
});

router.post('/reset-password', portalResetPasswordLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'token and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const account = db.prepare('SELECT * FROM client_portal_accounts WHERE reset_token = ?').get(token);
  if (!account || !account.reset_token_expires || new Date(account.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(
    `UPDATE client_portal_accounts
     SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, password_changed_at = datetime('now')
     WHERE id = ?`,
  ).run(passwordHash, account.id);

  res.json({ message: 'Password updated. You can now log in.' });
});

router.get('/me', requireClientAuth, (req, res) => {
  const account = getAccountWithClientName(req.clientAccount.id);
  res.json({ account: publicAccount(account) });
});

// The portal's own self-service password change — mirrors routes/auth.js's
// POST /change-password exactly (verify currentPassword via bcrypt.compare
// first, require MIN_PASSWORD_LENGTH, stamp password_changed_at, issue a
// fresh token). Bumping password_changed_at invalidates every token issued
// before now (see middleware/clientAuth.js's own iat check), including the
// one this request just authenticated with, so a fresh token has to be
// returned or the caller's own session would immediately log itself out.
router.post('/change-password', requireClientAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const valid = await bcrypt.compare(currentPassword, req.clientAccount.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  db.prepare(`UPDATE client_portal_accounts SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?`).run(
    passwordHash,
    req.clientAccount.id,
  );
  res.json({ message: 'Password updated.', token: signClientToken(req.clientAccount) });
});

// --- Phase 3/4: read-only views of the client's own quotes/invoices/
// licenses, plus a quote accept/decline action. Every query below is
// scoped to `req.clientAccount.client_id` — there is no id-only lookup
// anywhere in this section, so a client can never read (or act on)
// another client's data by guessing an id. No pagination/search on any of
// these lists: unlike the staff-side global lists, a single client's own
// document set is inherently small, so the same don't-build-it-until-
// needed call routes/reports.js's own docs make elsewhere.

const today = () => new Date().toISOString().slice(0, 10);

// Mirrors routes/invoices.js's/routes/public.js's own withComputed() —
// same computed balance_due/is_overdue/is_partially_paid fields, kept as
// its own copy here (not imported) for the same reason EXPIRY_WARNING_DAYS
// is duplicated between routes/licenses.js and lib/scheduler.js: this
// router has its own client-scoped row shape, not routes/invoices.js's.
function withComputedInvoice(invoice) {
  const balanceDue = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
  return {
    ...invoice,
    balance_due: balanceDue,
    is_overdue: invoice.status === 'sent' && balanceDue > 0 && invoice.due_date < today(),
    is_partially_paid: invoice.amount_paid > 0 && balanceDue > 0,
  };
}

// Duplicated literal, same as routes/licenses.js's own EXPIRY_WARNING_DAYS
// — keep both in sync.
const EXPIRY_WARNING_DAYS = 14;
function warningDate() {
  return new Date(Date.now() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function withComputedLicense(license) {
  let displayStatus = license.status;
  if (license.status === 'active') {
    if (license.expiry_date < today()) displayStatus = 'expired';
    else if (license.expiry_date <= warningDate()) displayStatus = 'expiring_soon';
  }
  return { ...license, display_status: displayStatus };
}

// Same field-stripping as routes/public.js's own publicSettings() — a
// client account is no more trusted with starting_balance/
// session_timeout_minutes than an anonymous public_token holder is.
function publicSettings(settings) {
  const { session_timeout_minutes, starting_balance, ...rest } = settings;
  return rest;
}

// Same first-view stamping as routes/public.js's own markViewed() — a
// client viewing their own document through the portal is exactly the
// same "did they see it" signal as viewing it via the public_token link,
// so both paths write to the same client_viewed_at column. Kept as its
// own copy here rather than imported, same reasoning as every other
// duplicated helper in this file.
function markViewed(table, id) {
  db.prepare(`UPDATE ${table} SET client_viewed_at = datetime('now') WHERE id = ? AND client_viewed_at IS NULL`).run(id);
}

// Same stripped shape as routes/public.js's own publicSettings() — a
// client account is no more trusted with starting_balance/
// session_timeout_minutes than an anonymous public_token holder is (see
// publicSettings() below). Exists so the portal frontend can render a
// business name/currency symbol on list pages and the dashboard without
// re-fetching a full quote/invoice just to reach its embedded `settings`.
router.get('/settings', requireClientAuth, (req, res) => {
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ settings: publicSettings(settings) });
});

// A synthesized recent-activity feed for the portal dashboard — not a read
// of `activity_log` (that's a staff-wide audit trail with no `client_id`
// column, and exposing it directly would risk leaking other clients' rows
// alongside this one), but a small set of purpose-built queries against the
// same `quotes`/`invoices`/`payments`/`licenses` tables every other route in
// this router already scopes to `client_id`, merged into one chronological
// list of `{ type, label, date, link, amount }` entries (`amount` only set
// for a payment, so the frontend can format it with the currency symbol it
// already has rather than this route needing to know it). Capped at
// ACTIVITY_LIMIT (10, most recent first) — a running list this small
// doesn't need pagination, same "don't build it until needed" call this
// app already makes elsewhere (routes/licenses.js's own renewal history).
const ACTIVITY_LIMIT = 10;

router.get('/activity', requireClientAuth, (req, res) => {
  const clientId = req.clientAccount.client_id;
  const entries = [];

  db.prepare(`SELECT id, number, issue_date FROM quotes WHERE client_id = ? AND ${CLIENT_VISIBLE_QUOTE}`)
    .all(clientId)
    .forEach((q) => entries.push({ type: 'quote_sent', label: `Quote ${q.number} sent to you`, date: q.issue_date, link: `/portal/quotes/${q.id}`, amount: null }));

  db.prepare('SELECT id, number, client_response, client_responded_at FROM quotes WHERE client_id = ? AND client_responded_at IS NOT NULL')
    .all(clientId)
    .forEach((q) =>
      entries.push({
        type: 'quote_response',
        label: `You ${q.client_response} quote ${q.number}`,
        date: q.client_responded_at,
        link: `/portal/quotes/${q.id}`,
        amount: null,
      }),
    );

  db.prepare('SELECT id, number, issue_date FROM invoices WHERE client_id = ?')
    .all(clientId)
    .forEach((i) => entries.push({ type: 'invoice_issued', label: `Invoice ${i.number} issued`, date: i.issue_date, link: `/portal/invoices/${i.id}`, amount: null }));

  db.prepare(
    `SELECT payments.amount, payments.paid_at, invoices.id AS invoice_id, invoices.number
     FROM payments JOIN invoices ON invoices.id = payments.invoice_id
     WHERE invoices.client_id = ?`,
  )
    .all(clientId)
    .forEach((p) =>
      entries.push({
        type: 'payment',
        label: `Payment received for invoice ${p.number}`,
        date: p.paid_at,
        link: `/portal/invoices/${p.invoice_id}`,
        amount: p.amount,
      }),
    );

  db.prepare("SELECT id, name, last_renewed_at FROM licenses WHERE client_id = ? AND last_renewed_at IS NOT NULL")
    .all(clientId)
    .forEach((l) =>
      entries.push({ type: 'license_renewed', label: `License "${l.name}" renewed`, date: l.last_renewed_at, link: `/portal/licenses/${l.id}`, amount: null }),
    );

  entries.sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json({ activity: entries.slice(0, ACTIVITY_LIMIT) });
});

// A `draft` quote is normally invisible here — draft is "staff is still
// preparing this," not "ready for the client to see." That still holds for
// a quote staff is drafting up from scratch on their own initiative. But a
// quote created via POST /quote-requests/:id/link-quote
// (routes/quoteRequests.js) is different: staff only reaches that flow by
// choosing to fulfill a request the client themselves asked for, and
// linking it *is* the "yes, here's your quote" moment as far as the client
// is concerned — waiting for a separate, later "Send" click on top of that
// would just be a confusing extra delay for something the client already
// knows is coming. So the "stay invisible until reviewed" rule is scoped
// to `EXISTS (... quote_requests ...)`: a quote with no linked request
// still needs `status != 'draft'` same as before; a quote that *is* linked
// to a request (quote_requests.quote_id only ever gets set once a staff
// member links it — see routes/quoteRequests.js's POST /:id/link-quote) is
// visible the instant that link happens, draft or not.
const CLIENT_VISIBLE_QUOTE = "(status != 'draft' OR EXISTS (SELECT 1 FROM quote_requests WHERE quote_requests.quote_id = quotes.id))";

router.get('/quotes', requireClientAuth, (req, res) => {
  const quotes = db
    .prepare(`SELECT * FROM quotes WHERE client_id = ? AND ${CLIENT_VISIBLE_QUOTE} ORDER BY issue_date DESC, id DESC`)
    .all(req.clientAccount.client_id);
  res.json({ quotes });
});

function getClientQuote(clientId, id) {
  const quote = db.prepare(`SELECT * FROM quotes WHERE id = ? AND client_id = ? AND ${CLIENT_VISIBLE_QUOTE}`).get(id, clientId);
  if (!quote) return null;
  const items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order').all(quote.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  return { quote, items, client };
}

router.get('/quotes/:id', requireClientAuth, (req, res) => {
  const data = getClientQuote(req.clientAccount.client_id, req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  markViewed('quotes', data.quote.id);
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ ...data, settings: publicSettings(settings) });
});

// Same accept/decline contract as routes/public.js's own
// POST /quotes/:token/respond — only while still draft/sent, stamps the
// same client_response/client_responded_at columns quotes/analytics
// already reads (see routes/quotes.js's GET /analytics). Logged under the
// account's own client name, same "(client)" action suffix the public-link
// version uses, so the two response paths read identically in the
// activity feed regardless of which one a client actually used.
router.post('/quotes/:id/respond', requireClientAuth, (req, res) => {
  const data = getClientQuote(req.clientAccount.client_id, req.params.id);
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
    const updated = getClientQuote(req.clientAccount.client_id, req.params.id).quote;
    notifyStaffOfQuoteAccepted({ quote: updated, client: data.client }).catch((err) =>
      console.error('Failed to notify staff of quote acceptance:', err.message),
    );
  }

  res.json(getClientQuote(req.clientAccount.client_id, req.params.id));
});

router.get('/quotes/:id/pdf', requireClientAuth, async (req, res) => {
  const data = getClientQuote(req.clientAccount.client_id, req.params.id);
  if (!data) return res.status(404).json({ error: 'Quote not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  const buffer = await renderQuotePdf({ quote: data.quote, client: data.client, items: data.items, settings });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${data.quote.number}.pdf"`,
  });
  res.send(buffer);
});

router.get('/invoices', requireClientAuth, (req, res) => {
  const invoices = db
    .prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY issue_date DESC, id DESC')
    .all(req.clientAccount.client_id)
    .map(withComputedInvoice);
  res.json({ invoices });
});

function getClientInvoice(clientId, id) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND client_id = ?').get(id, clientId);
  if (!invoice) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(invoice.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at').all(invoice.id);
  const paymentProofs = db
    .prepare('SELECT id, file_name, file_type, note, status, uploaded_at, review_note FROM payment_proofs WHERE invoice_id = ? ORDER BY uploaded_at DESC')
    .all(invoice.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  return { invoice: withComputedInvoice(invoice), items, payments, paymentProofs, client };
}

router.get('/invoices/:id', requireClientAuth, (req, res) => {
  const data = getClientInvoice(req.clientAccount.client_id, req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  markViewed('invoices', data.invoice.id);
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json({ ...data, settings: publicSettings(settings) });
});

const PAYMENT_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// Applied to the decoded byte size, not the base64 string length (base64
// inflates by ~4/3) — 6MB of real file comfortably covers a phone photo of
// a bank slip or a short scanned PDF, and leaves headroom under
// index.js's 8mb JSON body limit once the rest of the request envelope
// (file_name/file_type/note/JSON overhead) is accounted for.
const PAYMENT_PROOF_MAX_BYTES = 6 * 1024 * 1024;

// A client's own upload of evidence that they paid — see db/index.js's own
// note on payment_proofs for why this is deliberately *not* a payment
// record: this app has no payment-gateway integration, so a proof is just
// that, evidence a staff member reviews against the real bank statement
// before recording the actual payment through the existing
// POST /invoices/:id/payments flow. `file_data` must be a base64 data URI
// whose declared MIME type matches `file_type` and is one of
// PAYMENT_PROOF_TYPES — checked against the actual decoded byte length,
// not trusted from the client, so a spoofed file_type/oversized payload
// can't sneak past validation. Blocked once the invoice has nothing left
// to pay (balance_due <= 0) or is void — there's nothing to prove payment
// of at that point.
router.post('/invoices/:id/payment-proof', requireClientAuth, (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND client_id = ?').get(req.params.id, req.clientAccount.client_id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'void') return res.status(409).json({ error: 'This invoice has been voided' });
  const balanceDue = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
  if (balanceDue <= 0) return res.status(409).json({ error: 'This invoice has already been paid in full' });

  const { file_name: fileName, file_type: fileType, file_data: fileData, note } = req.body || {};
  if (!fileName || !fileType || !fileData) {
    return res.status(400).json({ error: 'A file is required' });
  }
  if (!PAYMENT_PROOF_TYPES.includes(fileType)) {
    return res.status(400).json({ error: 'Only JPEG, PNG, WEBP, or PDF files are accepted' });
  }
  const match = new RegExp(`^data:${fileType.replace('/', '\\/')};base64,([A-Za-z0-9+/]+=*)$`).exec(fileData);
  if (!match) {
    return res.status(400).json({ error: 'The uploaded file could not be read' });
  }
  const byteLength = Buffer.byteLength(match[1], 'base64');
  if (byteLength > PAYMENT_PROOF_MAX_BYTES) {
    return res.status(400).json({ error: 'File is too large — please keep it under 6MB' });
  }

  const result = db
    .prepare('INSERT INTO payment_proofs (invoice_id, file_data, file_name, file_type, note) VALUES (?, ?, ?, ?, ?)')
    .run(invoice.id, fileData, String(fileName).slice(0, 255), fileType, (note || '').trim().slice(0, 1000));

  logActivity({
    userName: req.clientAccount.client_name,
    action: 'uploaded a payment proof for (client)',
    entityType: 'invoice',
    entityId: invoice.id,
    entityLabel: invoice.number,
  });

  // Never awaited — a slow or failed staff notification should never delay
  // or break the client's own upload response, same reasoning
  // notifyStaffOfQuoteAccepted() documents.
  notifyStaffOfPaymentProof({ invoice, client: req.clientAccount, fileName }).catch((err) =>
    console.error('Failed to notify staff of payment proof upload:', err.message),
  );

  const proof = db
    .prepare('SELECT id, file_name, file_type, note, status, uploaded_at, review_note FROM payment_proofs WHERE id = ?')
    .get(result.lastInsertRowid);
  res.status(201).json({ proof });
});

router.get('/invoices/:id/pdf', requireClientAuth, async (req, res) => {
  const data = getClientInvoice(req.clientAccount.client_id, req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

  const buffer = await renderInvoicePdf({ invoice: data.invoice, client: data.client, items: data.items, settings, payments: data.payments });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${data.invoice.number}.pdf"`,
  });
  res.send(buffer);
});

router.get('/invoices/:id/payments/:paymentId/pdf', requireClientAuth, async (req, res) => {
  const data = getClientInvoice(req.clientAccount.client_id, req.params.id);
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

// Same ordering as routes/licenses.js's own GET / (most recently renewed
// first) — enough for a client to see what's active/expiring/expired at a
// glance from the list; GET /licenses/:id below is the per-license detail
// view with renewal history.
router.get('/licenses', requireClientAuth, (req, res) => {
  const licenses = db
    .prepare('SELECT * FROM licenses WHERE client_id = ? ORDER BY last_renewed_at DESC, id DESC')
    .all(req.clientAccount.client_id)
    .map(withComputedLicense);
  res.json({ licenses });
});

// The portal's counterpart to routes/licenses.js's GET /:id/renewals —
// scoped to client_id so a client can't read another client's license by
// guessing an id (same as every other per-record portal route). Returns
// the license itself (computed) plus its full renewal history in one call
// rather than two, since this is a whole page here, not a modal opened on
// demand from a list the way Licenses.jsx's own "History" action is.
router.get('/licenses/:id', requireClientAuth, (req, res) => {
  const license = db.prepare('SELECT * FROM licenses WHERE id = ? AND client_id = ?').get(req.params.id, req.clientAccount.client_id);
  if (!license) return res.status(404).json({ error: 'License not found' });
  const renewals = db
    .prepare('SELECT * FROM license_renewals WHERE license_id = ? ORDER BY renewed_at DESC, id DESC')
    .all(license.id);
  res.json({ license: withComputedLicense(license), renewals });
});

// Unlike GET /api/products (staff), this is *not* the full catalog —
// only products an admin has explicitly opted in via `visible_in_portal`
// (Products.jsx's "Visible in client portal" checkbox) are ever returned
// here, so a client picking items to request a quote for only ever sees
// what staff has decided is appropriate to show them, not every internal
// line item in the catalog. Still no per-client filtering beyond that
// (single-business model). Unlike every other portal route, this
// deliberately includes `unit_price`: a client picking items to request a
// quote for needs to see what things cost to make an informed pick, they
// just can never set or edit that number themselves (see
// POST /quote-requests below, which only ever accepts `product_id` +
// `quantity` from the client and looks up the real price itself).
router.get('/products', requireClientAuth, (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE visible_in_portal = 1 ORDER BY name').all();
  res.json({ products });
});

function getRequestItems(requestId) {
  return db.prepare('SELECT * FROM quote_request_items WHERE quote_request_id = ? ORDER BY id').all(requestId);
}

// A client's ask for a quote (see db/index.js's own note on
// `quote_requests`/`quote_request_items`) — the counterpart to
// routes/quoteRequests.js's staff-side review of the same rows.
// `quote_number`/`quote_status` are joined in so the portal can show "a
// quote is being prepared" (linked but still `draft`) versus "your quote
// is ready" (linked and sent/accepted/etc.) without a second round-trip
// per request.
router.post('/quote-requests', requireClientAuth, (req, res) => {
  const description = (req.body?.description || '').trim();
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

  // Never trust a client-supplied price or product name here — only the
  // id and quantity come from the request body; everything else
  // (description, whether the product even exists) is looked up fresh
  // from the live catalog.
  const items = [];
  for (const raw of rawItems) {
    const productId = Number(raw?.product_id);
    const quantity = Number(raw?.quantity);
    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Each item needs a valid product and a quantity greater than 0' });
    }
    // Scoped to visible_in_portal = 1 too, not just id — a product an
    // admin hasn't opted into the portal shouldn't be requestable by
    // guessing its id, even though the picker itself never shows it.
    const product = db.prepare('SELECT id, name FROM products WHERE id = ? AND visible_in_portal = 1').get(productId);
    if (!product) {
      return res.status(400).json({ error: 'One of the selected products no longer exists' });
    }
    items.push({ product_id: product.id, description: product.name, quantity });
  }

  if (!description && items.length === 0) {
    return res.status(400).json({ error: 'Please add at least one product or describe what you need' });
  }

  const request = db.transaction(() => {
    const result = db
      .prepare('INSERT INTO quote_requests (client_id, description) VALUES (?, ?)')
      .run(req.clientAccount.client_id, description);
    const insertItem = db.prepare(
      'INSERT INTO quote_request_items (quote_request_id, product_id, description, quantity) VALUES (?, ?, ?, ?)',
    );
    for (const item of items) {
      insertItem.run(result.lastInsertRowid, item.product_id, item.description, item.quantity);
    }
    return db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(result.lastInsertRowid);
  })();

  logActivity({
    userName: req.clientAccount.client_name,
    action: 'requested a quote (client)',
    entityType: 'quote_request',
    entityId: request.id,
    entityLabel: req.clientAccount.client_name,
  });
  res.status(201).json({ request: { ...request, items: getRequestItems(request.id) } });
});

router.get('/quote-requests', requireClientAuth, (req, res) => {
  const requests = db
    .prepare(
      `SELECT quote_requests.*, quotes.number AS quote_number, quotes.status AS quote_status
       FROM quote_requests
       LEFT JOIN quotes ON quotes.id = quote_requests.quote_id
       WHERE quote_requests.client_id = ?
       ORDER BY quote_requests.created_at DESC, quote_requests.id DESC`,
    )
    .all(req.clientAccount.client_id);
  const requestIds = requests.map((r) => r.id);
  const allItems = requestIds.length
    ? db
        .prepare(`SELECT * FROM quote_request_items WHERE quote_request_id IN (${requestIds.map(() => '?').join(',')}) ORDER BY id`)
        .all(...requestIds)
    : [];
  res.json({
    requests: requests.map((r) => ({ ...r, items: allItems.filter((i) => i.quote_request_id === r.id) })),
  });
});

module.exports = router;
