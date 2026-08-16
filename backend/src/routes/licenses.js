const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { sendMail, textToHtml } = require('../lib/mailer');
const { licenseRemindEmail } = require('../lib/emailTemplates');
const { logActivity } = require('../lib/activity');
const { logEmail } = require('../lib/emailLog');
const { toCsv } = require('../lib/csv');

const router = Router();
router.use(requireAuth);
const view = requirePermission('licenses', 'view');
const manage = requirePermission('licenses', 'manage');

const BILLING_CYCLES = ['monthly', 'yearly'];
const today = () => new Date().toISOString().slice(0, 10);

// How many days out a still-active license starts counting as "expiring
// soon" — both for the `display_status` badge below and for which licenses
// lib/scheduler.js's runLicenseExpiryAlerts() treats as candidates to email.
// Duplicated as a literal over there (with a cross-reference comment) rather
// than imported, same acceptable-duplication call as EXPENSE_CATEGORIES
// between routes/expenses.js and routes/import.js — keep both in sync.
const EXPIRY_WARNING_DAYS = 14;

function warningDate() {
  return new Date(Date.now() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// `status` only ever stores 'active' | 'cancelled' — everything else
// (expiring soon, already expired) is derived from `expiry_date` at read
// time against today's date, the same "don't store what you can compute"
// approach invoices.js's withComputed() takes for is_overdue/is_partially_paid.
// A cancelled license always reads as 'cancelled' regardless of its dates.
function withComputed(license) {
  let displayStatus = license.status;
  if (license.status === 'active') {
    if (license.expiry_date < today()) displayStatus = 'expired';
    else if (license.expiry_date <= warningDate()) displayStatus = 'expiring_soon';
  }
  return { ...license, display_status: displayStatus };
}

function advanceExpiry(dateStr, cycle) {
  const d = new Date(`${dateStr}T00:00:00`);
  const originalDay = d.getDate();
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly, the default
  // setMonth/setFullYear roll into the next month when the anchor day
  // doesn't exist in the target month (e.g. Jan 31 -> Mar 3) — clamp back
  // to the target month's last day instead, same fix lib/scheduler.js's
  // own advanceDate() applies for recurring invoices.
  if (d.getDate() !== originalDay) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

const PAGE_SIZE = 20;

// Buckets the frontend's StatusFilterChips pick from — 'active' here means
// "active and not expiring/expired", the narrowest of the four, so the
// chips partition the list rather than overlap.
function statusWhere(status) {
  if (status === 'cancelled') return { clause: "licenses.status = 'cancelled'", params: [] };
  if (status === 'expired') return { clause: "licenses.status = 'active' AND licenses.expiry_date < ?", params: [today()] };
  if (status === 'expiring_soon') {
    return {
      clause: 'licenses.status = ? AND licenses.expiry_date >= ? AND licenses.expiry_date <= ?',
      params: ['active', today(), warningDate()],
    };
  }
  if (status === 'active') return { clause: 'licenses.status = ? AND licenses.expiry_date > ?', params: ['active', warningDate()] };
  return null;
}

router.get('/', view, (req, res) => {
  const { q, status, page: pageParam } = req.query;
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(licenses.name LIKE ? OR clients.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const statusFilter = status ? statusWhere(status) : null;
  if (statusFilter) {
    conditions.push(statusFilter.clause);
    params.push(...statusFilter.params);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const baseFrom = 'FROM licenses JOIN clients ON clients.id = licenses.client_id';

  if (!pageParam) {
    const rows = db
      .prepare(`SELECT licenses.*, clients.name AS client_name ${baseFrom} ${where} ORDER BY licenses.expiry_date ASC, licenses.id DESC`)
      .all(...params);
    return res.json({ licenses: rows.map(withComputed) });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${baseFrom} ${where}`).get(...params);
  const rows = db
    .prepare(`SELECT licenses.*, clients.name AS client_name ${baseFrom} ${where} ORDER BY licenses.expiry_date ASC, licenses.id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  res.json({
    licenses: rows.map(withComputed),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

// Independent of pagination/search — the summary strip at the top of
// Licenses.jsx (active / expiring soon / expired counts) needs the true
// totals across every license, not just the current page or filter.
router.get('/summary', view, (req, res) => {
  const rows = db.prepare('SELECT status, expiry_date FROM licenses').all();
  const summary = { active: 0, expiring_soon: 0, expired: 0, cancelled: 0, total: rows.length };
  for (const row of rows) {
    const { display_status } = withComputed(row);
    summary[display_status] += 1;
  }
  res.json(summary);
});

router.get('/export.csv', view, (req, res) => {
  const rows = db
    .prepare(
      `SELECT licenses.*, clients.name AS client_name
       FROM licenses JOIN clients ON clients.id = licenses.client_id
       ORDER BY licenses.expiry_date ASC, licenses.id DESC`,
    )
    .all()
    .map(withComputed);
  const csv = toCsv(rows, [
    { label: 'Client', key: 'client_name' },
    { label: 'License', key: 'name' },
    { label: 'Status', key: 'display_status' },
    { label: 'Billing cycle', key: 'billing_cycle' },
    { label: 'Amount', key: 'amount' },
    { label: 'Start date', key: 'start_date' },
    { label: 'Expiry date', key: 'expiry_date' },
    { label: 'URL', key: 'url' },
    { label: 'Last renewed', key: 'last_renewed_at' },
  ]);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="licenses.csv"' });
  res.send(csv);
});

function validate(body) {
  const { client_id, name, billing_cycle = 'yearly', amount, start_date, expiry_date } = body || {};
  if (!client_id || !name || !start_date || !expiry_date) {
    return 'client_id, name, start_date and expiry_date are required';
  }
  if (!BILLING_CYCLES.includes(billing_cycle)) {
    return `billing_cycle must be one of: ${BILLING_CYCLES.join(', ')}`;
  }
  const amountNum = Number(amount ?? 0);
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    return 'amount must be a non-negative number';
  }
  if (expiry_date < start_date) {
    return 'expiry_date cannot be before start_date';
  }
  return null;
}

router.post('/', manage, (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { client_id, name, billing_cycle = 'yearly', amount = 0, start_date, expiry_date, url = '', notes = '' } = req.body;
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });

  const result = db
    .prepare(
      `INSERT INTO licenses (client_id, name, billing_cycle, amount, start_date, expiry_date, url, notes, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(client_id, name.trim(), billing_cycle, Number(amount), start_date, expiry_date, url.trim(), notes, req.user.name);

  const license = withComputed(db.prepare('SELECT * FROM licenses WHERE id = ?').get(result.lastInsertRowid));
  logActivity({ userName: req.user.name, action: 'created', entityType: 'license', entityId: license.id, entityLabel: `${license.name} (${client.name})` });
  res.status(201).json({ license });
});

router.get('/:id', view, (req, res) => {
  const row = db
    .prepare('SELECT licenses.*, clients.name AS client_name, clients.email AS client_email FROM licenses JOIN clients ON clients.id = licenses.client_id WHERE licenses.id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'License not found' });
  res.json({ license: withComputed(row) });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'License not found' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { client_id, name, billing_cycle = 'yearly', amount = 0, start_date, expiry_date, url = '', notes = '', status } = req.body;
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id' });
  const nextStatus = ['active', 'cancelled'].includes(status) ? status : existing.status;

  db.prepare(
    `UPDATE licenses SET client_id = ?, name = ?, status = ?, billing_cycle = ?, amount = ?, start_date = ?, expiry_date = ?, url = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(client_id, name.trim(), nextStatus, billing_cycle, Number(amount), start_date, expiry_date, url.trim(), notes, req.params.id);

  const license = withComputed(db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id));
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'license', entityId: license.id, entityLabel: `${license.name} (${client.name})` });
  res.json({ license });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'License not found' });

  db.prepare('DELETE FROM licenses WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'license', entityId: existing.id, entityLabel: existing.name });
  res.status(204).end();
});

// The core "once they've paid, renew it" action: extends expiry_date by one
// billing cycle from whichever is later, the current expiry_date or today —
// renewing early keeps the remaining time instead of losing it, renewing a
// lapsed license doesn't backdate a short window from the old expiry. Only
// allowed while status is 'active' (a cancelled license needs an explicit
// edit back to active first — renew is for "still active, just needs
// paying," not for un-cancelling).
router.post('/:id/renew', manage, (req, res) => {
  const existing = db.prepare('SELECT licenses.*, clients.name AS client_name FROM licenses JOIN clients ON clients.id = licenses.client_id WHERE licenses.id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'License not found' });
  if (existing.status === 'cancelled') {
    return res.status(409).json({ error: 'This license is cancelled and cannot be renewed' });
  }

  const base = existing.expiry_date > today() ? existing.expiry_date : today();
  const nextExpiry = advanceExpiry(base, existing.billing_cycle);

  db.transaction(() => {
    db.prepare(
      `UPDATE licenses SET expiry_date = ?, last_renewed_at = datetime('now'), last_reminder_sent_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(nextExpiry, req.params.id);
    db.prepare(
      `INSERT INTO license_renewals (license_id, previous_expiry_date, new_expiry_date, renewed_by_name) VALUES (?, ?, ?, ?)`,
    ).run(req.params.id, existing.expiry_date, nextExpiry, req.user.name);
  })();

  const license = withComputed(db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id));
  logActivity({ userName: req.user.name, action: 'renewed', entityType: 'license', entityId: license.id, entityLabel: `${existing.name} (${existing.client_name}) → ${nextExpiry}` });
  res.json({ license });
});

// Renewal history log — every POST /:id/renew above writes one row here, so
// this is a straight read of that log for one license, newest first. Kept
// as its own row-level table (not folded into activity_log, which already
// gets a one-line "renewed" entry per renewal too) since this needs to be
// filterable/renderable per-license without parsing activity_log's free-text
// entityLabel, and needs the exact previous/new expiry pair, not just a
// human-readable summary string.
router.get('/:id/renewals', view, (req, res) => {
  const license = db.prepare('SELECT id FROM licenses WHERE id = ?').get(req.params.id);
  if (!license) return res.status(404).json({ error: 'License not found' });
  const renewals = db
    .prepare('SELECT * FROM license_renewals WHERE license_id = ? ORDER BY renewed_at DESC, id DESC')
    .all(req.params.id);
  res.json({ renewals });
});

router.get('/:id/remind-preview', manage, (req, res) => {
  const row = db.prepare('SELECT licenses.*, clients.name AS client_name, clients.email AS client_email FROM licenses JOIN clients ON clients.id = licenses.client_id WHERE licenses.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'License not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const client = { name: row.client_name, email: row.client_email };
  res.json(licenseRemindEmail({ license: row, client, settings }));
});

router.post('/:id/remind', manage, async (req, res) => {
  const row = db.prepare('SELECT licenses.*, clients.name AS client_name, clients.email AS client_email FROM licenses JOIN clients ON clients.id = licenses.client_id WHERE licenses.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'License not found' });
  if (row.status === 'cancelled') {
    return res.status(409).json({ error: 'This license is cancelled' });
  }
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const client = { name: row.client_name, email: row.client_email };
  const defaults = licenseRemindEmail({ license: row, client, settings });
  const subject = (req.body?.subject || '').trim() || defaults.subject;
  const message = (req.body?.message || '').trim() || defaults.message;

  try {
    await sendMail({ to: client.email, subject, html: textToHtml(message) });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  db.prepare(`UPDATE licenses SET last_reminder_sent_at = datetime('now') WHERE id = ?`).run(req.params.id);
  logActivity({ userName: req.user.name, action: 'sent renewal reminder for', entityType: 'license', entityId: row.id, entityLabel: `${row.name} (${client.name})` });
  logEmail({ type: 'license_remind', to: client.email, subject, sentByName: req.user.name, entityType: 'license', entityId: row.id, entityLabel: row.name });
  res.json({ license: withComputed(db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id)) });
});

module.exports = router;
