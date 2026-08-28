const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { sendMail, textToHtml } = require('../lib/mailer');
const { licenseRemindEmail } = require('../lib/emailTemplates');
const { renderLicenseRenewalEmail } = require('../lib/licenseRenewalEmail');
const { logActivity } = require('../lib/activity');
const { logEmail } = require('../lib/emailLog');
const { toCsv } = require('../lib/csv');
const { toXlsxBuffer } = require('../lib/xlsx');
const { renewLicense, advanceExpiry } = require('../lib/licenseRenewal');

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
const EXPIRY_WARNING_DAYS = 30;

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

  // Most recently renewed license first — SQLite sorts NULL last_renewed_at
  // (never renewed) after every real timestamp in DESC order by default, so
  // a license that's never been renewed naturally falls to the bottom
  // rather than needing a separate CASE to push it there.
  const orderBy = 'ORDER BY licenses.last_renewed_at DESC, licenses.id DESC';

  if (!pageParam) {
    const rows = db
      .prepare(`SELECT licenses.*, clients.name AS client_name ${baseFrom} ${where} ${orderBy}`)
      .all(...params);
    return res.json({ licenses: rows.map(withComputed) });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${baseFrom} ${where}`).get(...params);
  const rows = db
    .prepare(`SELECT licenses.*, clients.name AS client_name ${baseFrom} ${where} ${orderBy} LIMIT ? OFFSET ?`)
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

// Shared by both export routes below so the CSV and XLSX downloads can
// never drift apart — one row query, one column list, two serializers.
// Every label here (once lib/csv.js's parseCsv() lowercases and
// underscores it on reimport) is also this row's import column name —
// 'Client email'/'Client name'/'Name' specifically so a downloaded
// export reimports correctly instead of the "Client"/"License" labels
// this used to carry, which matched neither `client_email`/`client_name`
// nor `name` on the way back in. `client_email` is included (not just
// `client_name`) so a re-import prefers the same unambiguous match by
// email `resolveClient()` already prefers everywhere else; both are
// still useful in the downloaded file for a human reading it, not just
// for reimport. `Notes` was previously missing from this export
// entirely — a license's notes never round-tripped even by accident.
function loadLicenseExport() {
  return {
    rows: db
      .prepare(
        `SELECT licenses.*, clients.name AS client_name, clients.email AS client_email
         FROM licenses JOIN clients ON clients.id = licenses.client_id
         ORDER BY licenses.expiry_date ASC, licenses.id DESC`,
      )
      .all()
      .map(withComputed),
    columns: [
      { label: 'Client email', key: 'client_email' },
      { label: 'Client name', key: 'client_name' },
      { label: 'Name', key: 'name' },
      { label: 'Status', key: 'display_status' },
      { label: 'Billing cycle', key: 'billing_cycle' },
      { label: 'Amount', key: 'amount' },
      { label: 'Start date', key: 'start_date' },
      { label: 'Expiry date', key: 'expiry_date' },
      { label: 'URL', key: 'url' },
      { label: 'Notes', key: 'notes' },
      { label: 'Last renewed', key: 'last_renewed_at' },
    ],
  };
}

router.get('/export.csv', view, (req, res) => {
  const { rows, columns } = loadLicenseExport();
  const csv = toCsv(rows, columns);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="licenses.csv"' });
  res.send(csv);
});

router.get('/export.xlsx', view, async (req, res) => {
  const { rows, columns } = loadLicenseExport();
  const buffer = await toXlsxBuffer(rows, columns, 'Licenses');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="licenses.xlsx"',
  });
  res.send(buffer);
});

// Historical, year-over-year view — distinct from GET /summary's current-
// snapshot counts (active/expiring/expired/cancelled as of right now).
// Registered before GET /:id so "analytics" isn't swallowed as a license id,
// same reason GET /summary and GET /export.csv are also declared above it.
//
// billingCycleChanges/cancelled/reactivated per year come from activity_log
// entries PUT /:id above started writing (action = 'changed billing cycle' |
// 'cancelled' | 'reactivated') the moment this feature shipped — a license
// edited before that only left the older generic 'updated' entry behind,
// which isn't distinguishable from an edit that didn't touch either field,
// so those three counts are 0 for any year entirely before this change and
// only become accurate going forward from here.
//
// revenueEstimate is deliberately not exact history: license_renewals only
// records previous/new expiry dates, not what was actually charged at the
// time (no per-renewal amount column, no link back to a specific invoice/
// payment), so a past year's estimate uses each license's CURRENT `amount`
// as a stand-in for "what it would be worth at today's pricing," the same
// kind of clearly-labeled proxy routes/financials.js's own `bankBalance`
// already is for a different figure — not a claim about what was actually
// billed that year.
router.get('/analytics', view, (req, res) => {
  try {
    const licenses = db.prepare('SELECT id, client_id, billing_cycle, amount, start_date FROM licenses').all();
    const renewals = db.prepare('SELECT license_id, renewed_at FROM license_renewals').all();
    const billingChanges = db
      .prepare("SELECT created_at FROM activity_log WHERE entity_type = 'license' AND action = 'changed billing cycle'")
      .all();
    const cancellations = db.prepare("SELECT created_at FROM activity_log WHERE entity_type = 'license' AND action = 'cancelled'").all();
    const reactivations = db.prepare("SELECT created_at FROM activity_log WHERE entity_type = 'license' AND action = 'reactivated'").all();

    const amountByLicenseId = new Map(licenses.map((l) => [l.id, l.amount]));
    const currentYear = new Date().getFullYear();
    // See routes/expenses.js's own GET /analytics for why this can't be a
    // bare `dateStr.slice(0, 4)` — a blank/malformed date would otherwise
    // either throw or silently compute as year 0 and blow the loop below out
    // to ~2000 iterations. yearOf() returns null for anything that isn't a
    // plausible year, and such a row is simply left out of the yearly
    // breakdown.
    const yearOf = (dateStr) => {
      if (typeof dateStr !== 'string' || dateStr.length < 4) return null;
      const y = Number(dateStr.slice(0, 4));
      return Number.isInteger(y) && y >= 1990 && y <= currentYear + 1 ? y : null;
    };

    const validYears = [
      ...licenses.map((l) => l.start_date),
      ...renewals.map((r) => r.renewed_at),
      ...billingChanges.map((r) => r.created_at),
      ...cancellations.map((r) => r.created_at),
      ...reactivations.map((r) => r.created_at),
    ]
      .map(yearOf)
      .filter((y) => y !== null);
    const minYear = validYears.length ? Math.min(currentYear, ...validYears) : currentYear;

    const byYear = [];
    for (let year = currentYear; year >= minYear; year--) {
      const newLicensesThisYear = licenses.filter((l) => yearOf(l.start_date) === year);
      const renewalsThisYear = renewals.filter((r) => yearOf(r.renewed_at) === year);
      const revenueEstimate =
        Math.round(
          (newLicensesThisYear.reduce((sum, l) => sum + l.amount, 0) +
            renewalsThisYear.reduce((sum, r) => sum + (amountByLicenseId.get(r.license_id) || 0), 0)) *
            100,
        ) / 100;

      byYear.push({
        year,
        newLicenses: newLicensesThisYear.length,
        renewals: renewalsThisYear.length,
        cancelled: cancellations.filter((r) => yearOf(r.created_at) === year).length,
        reactivated: reactivations.filter((r) => yearOf(r.created_at) === year).length,
        billingCycleChanges: billingChanges.filter((r) => yearOf(r.created_at) === year).length,
        revenueEstimate,
      });
    }

    const byBillingCycle = { monthly: 0, yearly: 0 };
    for (const l of licenses) byBillingCycle[l.billing_cycle] = (byBillingCycle[l.billing_cycle] || 0) + 1;

    const topClients = db
      .prepare(
        `SELECT clients.id, clients.name, COUNT(*) AS license_count, COALESCE(SUM(licenses.amount), 0) AS total_amount
         FROM licenses JOIN clients ON clients.id = licenses.client_id
         GROUP BY clients.id
         ORDER BY license_count DESC, total_amount DESC
         LIMIT 5`,
      )
      .all();

    res.json({
      byYear,
      byBillingCycle,
      topClients,
      totals: {
        totalLicenses: licenses.length,
        totalRenewals: renewals.length,
        totalBillingCycleChanges: billingChanges.length,
        totalCancelled: cancellations.length,
        totalReactivated: reactivations.length,
      },
    });
  } catch (err) {
    console.error('GET /api/licenses/analytics failed:', err);
    res.status(500).json({ error: 'Failed to load license analytics' });
  }
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
  const startDateChanged = start_date !== existing.start_date;
  const expiryChanged = expiry_date !== existing.expiry_date;

  // What actually gets written to licenses.expiry_date — starts out as
  // whatever was submitted, but the startDateChanged branch below can
  // override it with the recalculated chain's own final value instead (see
  // that branch's own comment for when and why).
  let finalExpiryDate = expiry_date;
  let historyRowsRecalculated = 0;

  db.transaction(() => {
    // Editing start_date and/or expiry_date here is a direct correction —
    // not a real renewal — but lib/licenseRenewal.js's renewLicense() is
    // the only other writer of license_renewals, and it always keeps the
    // chain internally consistent: each row's new_expiry_date equals the
    // next row's previous_expiry_date, and the license's live expiry_date
    // always equals the newest row's new_expiry_date. A correction has to
    // preserve that or the "Renewal history" modal (and the next real
    // Renew, which always advances from license.expiry_date) keep
    // showing/using the wrong dates.
    if (startDateChanged) {
      // A corrected start_date means every renewal that followed it should
      // have landed on a different date too — recomputed exactly the way a
      // real Renew always computes the next one (advanceExpiry(), one
      // billing cycle at a time — see lib/licenseRenewal.js), starting from
      // the corrected start_date's own first-cycle expiry and walking
      // forward through the same number of renewals that already happened.
      // E.g. moving start_date back exactly one year walks every renewal
      // back exactly one year too, each still landing on the same
      // day-of-month throughout — a fixed day-count shift instead would
      // land a day off whenever a leap year falls between two dates being
      // compared, which is exactly the kind of subtly-wrong date this
      // exists to avoid. This resets the chain to clean, cycle-consistent
      // dates rather than trying to preserve whatever the old (now known
      // to be wrong) gaps were.
      const renewals = db
        .prepare('SELECT id, previous_expiry_date, new_expiry_date FROM license_renewals WHERE license_id = ? ORDER BY renewed_at ASC, id ASC')
        .all(req.params.id);
      let cursor = advanceExpiry(start_date, billing_cycle);
      renewals.forEach((r, i) => {
        const isNewest = i === renewals.length - 1;
        const previous = cursor;
        const next = advanceExpiry(previous, billing_cycle);
        // The newest row's own new_expiry_date defers to an explicitly
        // submitted expiry_date over the recalculated value, when the two
        // disagree — an admin who typed a specific "as of right now"
        // expiry is a more authoritative signal for that one value than
        // the cycle math; every other date in the chain (including this
        // same row's own previous_expiry_date) has no equivalent explicit
        // signal, so it's still purely recalculated.
        const stored = isNewest && expiryChanged ? expiry_date : next;
        db.prepare('UPDATE license_renewals SET previous_expiry_date = ?, new_expiry_date = ? WHERE id = ?').run(previous, stored, r.id);
        cursor = next;
        if (isNewest) finalExpiryDate = stored;
      });
      historyRowsRecalculated = renewals.length;
      // No renewal history yet — there's no chain to recompute, so this is
      // a plain field correction same as always: whatever was submitted.
      if (renewals.length === 0) finalExpiryDate = expiry_date;
    } else if (expiryChanged) {
      // start_date is unchanged, so nothing implies the earlier history is
      // wrong — only the single most recent row (which the live
      // expiry_date is supposed to mirror) gets corrected; a license with
      // no renewals yet has no row to correct, so this just affects zero
      // rows.
      db.prepare(
        `UPDATE license_renewals SET new_expiry_date = ?
         WHERE id = (SELECT id FROM license_renewals WHERE license_id = ? ORDER BY renewed_at DESC, id DESC LIMIT 1)`,
      ).run(expiry_date, req.params.id);
    }

    db.prepare(
      `UPDATE licenses SET client_id = ?, name = ?, status = ?, billing_cycle = ?, amount = ?, start_date = ?, expiry_date = ?, url = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(client_id, name.trim(), nextStatus, billing_cycle, Number(amount), start_date, finalExpiryDate, url.trim(), notes, req.params.id);
  })();

  const license = withComputed(db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id));
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'license', entityId: license.id, entityLabel: `${license.name} (${client.name})` });

  // Distinct, structured entries on top of the generic 'updated' one above —
  // GET /analytics counts these by exact action string to report billing-
  // cycle changes and cancellations/reactivations per year, which the free-
  // text 'updated' entry alone can't be queried for reliably. Mutually
  // exclusive with the plain expiry-only correction below — a start_date
  // correction already covers (and supersedes) whatever happened to
  // expiry_date in the same edit.
  if (startDateChanged) {
    logActivity({
      userName: req.user.name,
      action: 'corrected start date',
      entityType: 'license',
      entityId: license.id,
      entityLabel: `${license.name} (${client.name}): ${existing.start_date} → ${start_date}` + (historyRowsRecalculated > 0 ? ` (${historyRowsRecalculated} renewal record${historyRowsRecalculated === 1 ? '' : 's'} recalculated to match)` : ''),
    });
  } else if (expiryChanged) {
    logActivity({
      userName: req.user.name,
      action: 'corrected expiry date',
      entityType: 'license',
      entityId: license.id,
      entityLabel: `${license.name} (${client.name}): ${existing.expiry_date} → ${expiry_date}`,
    });
  }
  if (existing.billing_cycle !== billing_cycle) {
    logActivity({
      userName: req.user.name,
      action: 'changed billing cycle',
      entityType: 'license',
      entityId: license.id,
      entityLabel: `${license.name} (${client.name}): ${existing.billing_cycle} → ${billing_cycle}`,
    });
  }
  if (existing.status !== nextStatus) {
    logActivity({
      userName: req.user.name,
      action: nextStatus === 'cancelled' ? 'cancelled' : 'reactivated',
      entityType: 'license',
      entityId: license.id,
      entityLabel: `${license.name} (${client.name})`,
    });
  }

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

  const nextExpiry = renewLicense(existing, req.user.name);

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

// The "renewal confirmation" email — a manual, staff-triggered send
// confirming to the client that their license is paid/renewed and current
// (client, license, billing cycle, amount, expiry date, and the license's
// own activation/portal `url` when set — see routes/licenses.js's own note
// on that column, added specifically for a future email like this one).
// Deliberately not tied to POST /:id/renew actually having just run —
// staff might renew, then send this a moment later once they've double-
// checked details, so this always reflects the license's *current* row,
// not a snapshot from whenever it was last renewed. Same "no PDF, this
// isn't a document" shape as /:id/remind, and same cancelled-license
// guard as renew/remind (confirming a cancelled license's "renewal" makes
// no sense). Unlike every other manual send in this app, there's no
// subject/message override accepted on the POST — the email's whole point
// is a fixed, designed summary of the license's own real data, not prose
// an admin edits per send (see lib/licenseRenewalEmail.js's own note).
// A successful send also stamps `last_renewal_confirmation_sent_at`,
// which `Licenses.jsx` uses to hide the "Send renewal confirmation" row
// action once it's been sent for the license's *current* renewal — one
// confirmation per renewal, not a repeatable action, so staff can't send
// the same confirmation twice by mistake; `lib/licenseRenewal.js`'s
// `renewLicense()` clears it back to NULL on the next real renewal (see
// that function's own note), which is what brings the button back.
router.get('/:id/renewal-confirm-preview', manage, (req, res) => {
  const row = db.prepare('SELECT licenses.*, clients.name AS client_name, clients.email AS client_email FROM licenses JOIN clients ON clients.id = licenses.client_id WHERE licenses.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'License not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const client = { name: row.client_name, email: row.client_email };
  res.json(renderLicenseRenewalEmail({ license: row, client, settings }));
});

router.post('/:id/renewal-confirm', manage, async (req, res) => {
  const row = db.prepare('SELECT licenses.*, clients.name AS client_name, clients.email AS client_email FROM licenses JOIN clients ON clients.id = licenses.client_id WHERE licenses.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'License not found' });
  if (row.status === 'cancelled') {
    return res.status(409).json({ error: 'This license is cancelled' });
  }
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const client = { name: row.client_name, email: row.client_email };
  const { to, subject, html } = renderLicenseRenewalEmail({ license: row, client, settings });

  try {
    await sendMail({ to, subject, html });
  } catch (err) {
    const status = err.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }

  db.prepare(`UPDATE licenses SET last_renewal_confirmation_sent_at = datetime('now') WHERE id = ?`).run(req.params.id);
  logActivity({ userName: req.user.name, action: 'sent renewal confirmation for', entityType: 'license', entityId: row.id, entityLabel: `${row.name} (${client.name})` });
  logEmail({ type: 'license_renewal_confirm', to, subject, sentByName: req.user.name, entityType: 'license', entityId: row.id, entityLabel: row.name });
  res.json({ license: withComputed(db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id)) });
});

module.exports = router;
