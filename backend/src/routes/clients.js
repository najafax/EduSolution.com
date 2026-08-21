const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { logEmail } = require('../lib/emailLog');
const { toCsv } = require('../lib/csv');
const { toXlsxBuffer } = require('../lib/xlsx');
const { sendMail, textToHtml } = require('../lib/mailer');
const { portalInviteEmail } = require('../lib/emailTemplates');

const router = Router();
router.use(requireAuth);
const view = requirePermission('clients', 'view');
const manage = requirePermission('clients', 'manage');

const PAGE_SIZE = 20;

// A first-time portal-setup link is more forgiving than the 1-hour
// self-serve reset window in routes/clientPortal.js — a client may not
// check their email the moment it arrives, and there's no security reason
// to rush them (unlike a reset link, which stands in for "prove you still
// control this inbox right now").
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// clients.portal_status is derived, not stored — the same don't-store-
// what-you-can-compute approach invoices.js's withComputed() takes.
function portalStatusOf(account) {
  if (!account) return 'none';
  if (!account.active) return 'deactivated';
  if (!account.password_hash) return 'invited';
  return 'active';
}

// Validates a client is eligible for a fresh portal invite without writing
// anything — shared by the read-only preview route and ensurePortalInvite()
// below so the two can never disagree on whether an invite is allowed.
// Returns the client's existing (unactivated) client_portal_accounts row,
// if any.
function assertInviteEligible(client) {
  if (!client.email) {
    const err = new Error('This client has no email address on file — add one before inviting them to the portal');
    err.status = 400;
    throw err;
  }
  const account = db.prepare('SELECT * FROM client_portal_accounts WHERE client_id = ?').get(client.id);
  if (account && account.password_hash) {
    const err = new Error('This client already has an active portal account');
    err.status = 409;
    throw err;
  }
  return account;
}

// Creates (or, for a still-unactivated invite, refreshes) the client's
// client_portal_accounts row with a fresh invite token — called by
// POST /:id/portal-invite only; the GET preview route never persists
// anything, matching every other *-preview route in this app.
function ensurePortalInvite(client) {
  const account = assertInviteEligible(client);

  const emailTaken = db
    .prepare('SELECT 1 FROM client_portal_accounts WHERE email = ? AND client_id != ?')
    .get(client.email, client.id);
  if (emailTaken) {
    const err = new Error('A portal account already uses this email address');
    err.status = 409;
    throw err;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();

  if (account) {
    // Resending an invite also re-syncs the login email to the client's
    // current one, in case it changed since the first invite went unused.
    db.prepare('UPDATE client_portal_accounts SET email = ?, invite_token = ?, invite_token_expires = ? WHERE id = ?').run(
      client.email,
      token,
      expires,
      account.id,
    );
    return db.prepare('SELECT * FROM client_portal_accounts WHERE id = ?').get(account.id);
  }

  const result = db
    .prepare('INSERT INTO client_portal_accounts (client_id, email, invite_token, invite_token_expires) VALUES (?, ?, ?, ?)')
    .run(client.id, client.email, token, expires);
  return db.prepare('SELECT * FROM client_portal_accounts WHERE id = ?').get(result.lastInsertRowid);
}

// portal_status is computed via a LEFT JOIN here (rather than a second
// query per row) so Clients.jsx's row action can show Invite/Resend/
// Active with no extra round-trip — cheap at this app's single-business
// scale, same reasoning invoices.js's own computed fields accept a join.
const PORTAL_STATUS_CASE = `CASE
    WHEN portal.id IS NULL THEN 'none'
    WHEN portal.active = 0 THEN 'deactivated'
    WHEN portal.password_hash IS NULL THEN 'invited'
    ELSE 'active'
  END AS portal_status`;
const PORTAL_STATUS_JOIN = 'LEFT JOIN client_portal_accounts portal ON portal.client_id = clients.id';

router.get('/', view, (req, res) => {
  const { q, page: pageParam } = req.query;
  const where = q ? 'WHERE clients.name LIKE ? OR clients.email LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  const listQuery = `SELECT clients.*, ${PORTAL_STATUS_CASE} FROM clients ${PORTAL_STATUS_JOIN}`;

  if (!pageParam) {
    const clients = db.prepare(`${listQuery} ${where} ORDER BY clients.name`).all(...params);
    return res.json({ clients });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM clients ${where}`).get(...params);
  const clients = db
    .prepare(`${listQuery} ${where} ORDER BY clients.name LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  res.json({ clients, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

// Shared by both export routes below so the CSV and XLSX downloads can
// never drift apart — one row query, one column list, two serializers.
function loadClientExport() {
  return {
    rows: db.prepare('SELECT * FROM clients ORDER BY name').all(),
    columns: [
      { label: 'Name', key: 'name' },
      { label: 'Email', key: 'email' },
      { label: 'Phone', key: 'phone' },
      { label: 'Address', key: 'address' },
      { label: 'Notes', key: 'notes' },
    ],
  };
}

router.get('/export.csv', view, (req, res) => {
  const { rows, columns } = loadClientExport();
  const csv = toCsv(rows, columns);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="clients.csv"' });
  res.send(csv);
});

router.get('/export.xlsx', view, async (req, res) => {
  const { rows, columns } = loadClientExport();
  const buffer = await toXlsxBuffer(rows, columns, 'Clients');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="clients.xlsx"',
  });
  res.send(buffer);
});

router.post('/', manage, (req, res) => {
  const { name, email, phone = '', address = '', notes = '' } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  const result = db
    .prepare('INSERT INTO clients (name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), email.trim(), phone, address, notes);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'created', entityType: 'client', entityId: client.id, entityLabel: client.name });
  res.status(201).json({ client });
});

router.get('/:id', view, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const account = db.prepare('SELECT * FROM client_portal_accounts WHERE client_id = ?').get(client.id);
  res.json({ client: { ...client, portal_status: portalStatusOf(account) } });
});

// Follows the same "preview and send call the same template function"
// contract as every other email action in this app (see CLAUDE.md's "Email
// preview before sending") — but unlike those, there's no pre-existing
// token to preview against on a client's first invite, so this route is
// read-only: it validates eligibility and, only if an unactivated invite
// already exists, reuses that invite's real token; otherwise it shows a
// placeholder so the admin can review subject/message wording before
// POST /:id/portal-invite actually generates and emails the real link.
router.get('/:id/portal-invite-preview', manage, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  let account;
  try {
    account = assertInviteEligible(client);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const previewToken = account?.invite_token || 'preview-token';
  const portalUrl = `${clientOrigin}/portal/accept-invite?token=${previewToken}`;
  res.json(portalInviteEmail({ client, settings, portalUrl }));
});

router.post('/:id/portal-invite', manage, async (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  let account;
  try {
    account = ensurePortalInvite(client);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const portalUrl = `${clientOrigin}/portal/accept-invite?token=${account.invite_token}`;
  const defaults = portalInviteEmail({ client, settings, portalUrl });
  const subject = (req.body?.subject || '').trim() || defaults.subject;
  const message = (req.body?.message || '').trim() || defaults.message;

  try {
    await sendMail({ to: account.email, subject, html: textToHtml(message) });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  logActivity({ userName: req.user.name, action: 'invited to portal', entityType: 'client', entityId: client.id, entityLabel: client.name });
  logEmail({ type: 'portal_invite', to: account.email, subject, sentByName: req.user.name, entityType: 'client', entityId: client.id, entityLabel: client.name });
  res.json({ message: 'Invite sent.', portal_status: portalStatusOf(account) });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const { name, email, phone = '', address = '', notes = '' } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  db.prepare(
    `UPDATE clients SET name = ?, email = ?, phone = ?, address = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name.trim(), email.trim(), phone, address, notes, req.params.id);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'client', entityId: client.id, entityLabel: client.name });
  res.json({ client });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  // Every one of these four tables has a NOT NULL REFERENCES clients(id)
  // (see db/index.js) with foreign_keys=ON enforced — deleting a client
  // that still has any of them would otherwise fail with an uncaught
  // SQLITE_CONSTRAINT_FOREIGNKEY error (a raw 500) instead of this same
  // friendly 409 the quotes/invoices case already had.
  const hasQuotes = db.prepare('SELECT 1 FROM quotes WHERE client_id = ? LIMIT 1').get(req.params.id);
  const hasInvoices = db.prepare('SELECT 1 FROM invoices WHERE client_id = ? LIMIT 1').get(req.params.id);
  const hasRecurring = db.prepare('SELECT 1 FROM recurring_invoices WHERE client_id = ? LIMIT 1').get(req.params.id);
  const hasLicenses = db.prepare('SELECT 1 FROM licenses WHERE client_id = ? LIMIT 1').get(req.params.id);
  if (hasQuotes || hasInvoices || hasRecurring || hasLicenses) {
    return res.status(409).json({ error: 'This client has quotes, invoices, recurring invoices, or licenses and cannot be deleted' });
  }

  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'client', entityId: existing.id, entityLabel: existing.name });
  res.status(204).end();
});

module.exports = router;
