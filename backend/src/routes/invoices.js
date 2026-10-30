const { Router } = require('express');
const { dateError, round2: roundCents } = require('../lib/validate');
const { stampItemCosts } = require('../lib/costSnapshot');
const { todayStr, businessYear } = require('../lib/businessDate');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { computeTotals } = require('../lib/totals');
const { nextInvoiceNumber, nextReceiptNumber } = require('../lib/numbering');
const { renderInvoicePdf, renderReceiptPdf } = require('../lib/pdf');
const { sendMail, textToHtml } = require('../lib/mailer');
const { invoiceSendEmail, invoiceRemindEmail, receiptSendEmail } = require('../lib/emailTemplates');
const { logEmail } = require('../lib/emailLog');
const { toCsv } = require('../lib/csv');
const { toXlsxBuffer } = require('../lib/xlsx');
const { renewLicense } = require('../lib/licenseRenewal');
const { hasPermission } = require('../lib/permissions');

const router = Router();
router.use(requireAuth);

// invoice_items.cost_price is the supplier cost snapshot (margin data). Only
// users who can see Financials may receive it; everyone else gets items
// without it, whichever invoice route is answering.
router.use((req, res, next) => {
  if (hasPermission(req.user, 'financials', 'view')) return next();
  const json = res.json.bind(res);
  res.json = (body) =>
    json(
      body && Array.isArray(body.items)
        ? { ...body, items: body.items.map(({ cost_price, ...rest }) => rest) }
        : body,
    );
  next();
});
const view = requirePermission('invoices', 'view');
const manage = requirePermission('invoices', 'manage');

const today = () => todayStr();

function withComputed(invoice) {
  const balanceDue = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
  return {
    ...invoice,
    balance_due: balanceDue,
    is_overdue: invoice.status === 'sent' && balanceDue > 0 && invoice.due_date < today(),
    is_partially_paid: invoice.amount_paid > 0 && balanceDue > 0,
    is_reminder_held: Boolean(invoice.reminder_hold_until && invoice.reminder_hold_until >= today()),
  };
}

function getInvoiceWithItems(id) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!invoice) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at').all(id);
  // file_data deliberately excluded here — kept lean the same way the
  // portal's own getClientInvoice() is, since a proof can be a few MB and
  // this response is fetched on every page load. GET /:id/payment-
  // proofs/:proofId below is the dedicated view/download route that
  // returns the full row.
  const paymentProofs = db
    .prepare('SELECT id, file_name, file_type, note, status, uploaded_at, review_note, reviewed_by_name, reviewed_at FROM payment_proofs WHERE invoice_id = ? ORDER BY uploaded_at DESC')
    .all(id);
  return { invoice: withComputed(invoice), items, client, payments, paymentProofs };
}

function saveItems(invoiceId, items) {
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
  const insert = db.prepare(
    'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, product_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const item of items) {
    insert.run(invoiceId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order, item.product_id ?? null);
  }
  stampItemCosts(invoiceId);
}

const PAGE_SIZE = 20;

// 'overdue' isn't a stored status — withComputed() above derives it from
// status/due_date/amount_paid at read time, same "don't store what you can
// compute" approach routes/licenses.js's own statusWhere() already applies
// to 'expired'/'expiring_soon' there. Mirrors withComputed()'s own
// is_overdue condition exactly (status='sent', a real balance left, due
// date in the past) so this filter can never disagree with the badge/
// dashboard's own overdue query.
function statusWhere(status) {
  if (status === 'overdue') {
    return { clause: "invoices.status = 'sent' AND (invoices.total - invoices.amount_paid) > 0 AND invoices.due_date < ?", params: [today()] };
  }
  return { clause: 'invoices.status = ?', params: [status] };
}

// Shared by GET / and both export routes below, so a filtered export can
// never drift from what the list page itself is actually showing when the
// download button is clicked — one place builds the WHERE clause, every
// caller reuses it rather than re-deriving the same status/q conditions.
function buildInvoiceWhere({ status, q }) {
  const conditions = [];
  const params = [];
  if (status) {
    const statusFilter = statusWhere(status);
    conditions.push(statusFilter.clause);
    params.push(...statusFilter.params);
  }
  if (q) {
    conditions.push('(invoices.number LIKE ? OR clients.name LIKE ? OR invoices.status LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

router.get('/', view, (req, res) => {
  const { status, q, page: pageParam } = req.query;
  const { where, params } = buildInvoiceWhere({ status, q });
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

// Shared by both export routes below so the CSV and XLSX downloads can
// never drift apart — one row query, one column list, two serializers.
// Note: this export is a financial summary, not a full reimport source —
// unlike clients/expenses/licenses/products, an invoice reimported via
// routes/import.js's processInvoices() always collapses to one synthetic
// line item with a hardcoded zero discount (see that route's own INSERT),
// so even with every column perfectly named, reimporting an invoice that
// had multiple real line items or any real discount would silently
// produce a different (wrong) total than the original — there's no
// column here that safely reverses to the raw `amount`/`tax_rate`/
// `description` the importer actually needs. Only the client columns
// below are fixed for reimport purposes (so at least client matching
// works if someone tries), not the rest of this shape.
//
// **Filtered export**: unlike every other export-capable list route in
// this app (see "Pagination convention" above — those deliberately ignore
// `q`/`page` so a downloaded file is always the complete, unfiltered set),
// this one accepts an optional `{ status, q }` and reuses buildInvoiceWhere()
// — the same WHERE clause GET / itself builds — so "Export CSV"/"Export
// Excel" clicked from Invoices.jsx download exactly what's currently on
// screen (e.g. only overdue invoices, once that filter's selected) rather
// than always the full table regardless of what's filtered. Called with no
// argument (or `{}`), it behaves exactly as before this existed — every
// invoice, unfiltered — so a caller that never passes a filter (or hits
// these routes directly) sees no change.
function loadInvoiceExport({ status, q } = {}) {
  const { where, params } = buildInvoiceWhere({ status, q });
  return {
    rows: db
      .prepare(
        `SELECT invoices.*, clients.name AS client_name, clients.email AS client_email
         FROM invoices JOIN clients ON clients.id = invoices.client_id
         ${where}
         ORDER BY invoices.issue_date DESC, invoices.id DESC`,
      )
      .all(...params)
      .map(withComputed),
    columns: [
      { label: 'Number', key: 'number' },
      { label: 'Client email', key: 'client_email' },
      { label: 'Client name', key: 'client_name' },
      { label: 'Status', key: 'status' },
      { label: 'Issue date', key: 'issue_date' },
      { label: 'Due date', key: 'due_date' },
      { label: 'PO number', key: 'po_number' },
      { label: 'Subtotal', key: 'subtotal' },
      { label: 'Discount', key: 'discount_amount' },
      { label: 'Tax', key: 'tax_amount' },
      { label: 'Total', key: 'total' },
      { label: 'Amount paid', key: 'amount_paid' },
      { label: 'Balance due', key: 'balance_due' },
    ],
  };
}

// A status-specific filename (e.g. "invoices-overdue.csv") when the
// download is actually filtered, so the file itself says what's in it
// rather than reading like the full table; plain "invoices.csv" otherwise,
// unchanged from before filtering existed.
function exportFilename(status, ext) {
  return status ? `invoices-${status}.${ext}` : `invoices.${ext}`;
}

router.get('/export.csv', view, (req, res) => {
  const { status, q } = req.query;
  const { rows, columns } = loadInvoiceExport({ status, q });
  const csv = toCsv(rows, columns);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${exportFilename(status, 'csv')}"` });
  res.send(csv);
});

router.get('/export.xlsx', view, async (req, res) => {
  const { status, q } = req.query;
  const { rows, columns } = loadInvoiceExport({ status, q });
  const buffer = await toXlsxBuffer(rows, columns, 'Invoices');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${exportFilename(status, 'xlsx')}"`,
  });
  res.send(buffer);
});

// Year-over-year view, mirrors routes/licenses.js's own GET /analytics
// (registered before GET /:id for the same "don't let :id swallow a literal
// path" reason that route documents). For every year from the earliest
// invoice's issue_date through the current year (gap years included at
// zero, never skipped), reports `issued`/`amountInvoiced` (by issue_date,
// void excluded from the money figure the same way routes/financials.js
// excludes it from totalInvoiced) and `paymentsReceived`/`amountCollected`
// (by payments.paid_at — an exact cash figure, not an estimate, since
// unlike license renewals every invoice payment already records its own
// amount) and `voided` (by the activity_log 'voided' entry POST /:id/void
// above writes).
const round2 = (n) => Math.round(n * 100) / 100;

router.get('/analytics', view, (req, res) => {
  try {
    const invoices = db.prepare('SELECT id, client_id, status, issue_date, total, amount_paid FROM invoices').all();
    const payments = db.prepare('SELECT invoice_id, amount, paid_at FROM payments').all();
    const voidEvents = db.prepare("SELECT updated_at AS created_at FROM invoices WHERE status = 'void'").all();

    const currentYear = businessYear();
    // See routes/expenses.js's own GET /analytics for why this can't be a
    // bare `dateStr.slice(0, 4)` — a blank/malformed date (a pre-validation
    // row, a direct DB edit) would otherwise either throw or, worse, silently
    // compute as year 0 and blow the loop below out to ~2000 iterations.
    // yearOf() returns null for anything that isn't a plausible year, and
    // such a row is simply left out of the yearly breakdown.
    const yearOf = (dateStr) => {
      if (typeof dateStr !== 'string' || dateStr.length < 4) return null;
      const y = Number(dateStr.slice(0, 4));
      return Number.isInteger(y) && y >= 1990 && y <= currentYear + 1 ? y : null;
    };
    const validYears = [...invoices.map((i) => i.issue_date), ...payments.map((p) => p.paid_at), ...voidEvents.map((v) => v.created_at)]
      .map(yearOf)
      .filter((y) => y !== null);
    const minYear = validYears.length ? Math.min(currentYear, ...validYears) : currentYear;

    const byYear = [];
    for (let year = currentYear; year >= minYear; year--) {
      const issuedThisYear = invoices.filter((i) => yearOf(i.issue_date) === year);
      const paymentsThisYear = payments.filter((p) => yearOf(p.paid_at) === year);
      byYear.push({
        year,
        issued: issuedThisYear.length,
        amountInvoiced: round2(issuedThisYear.filter((i) => i.status !== 'void' && i.status !== 'draft').reduce((sum, i) => sum + i.total, 0)),
        paymentsReceived: paymentsThisYear.filter((p) => p.amount > 0).length,
        amountCollected: round2(paymentsThisYear.reduce((sum, p) => sum + p.amount, 0)),
        voided: voidEvents.filter((v) => yearOf(v.created_at) === year).length,
      });
    }

    const byStatus = db
      .prepare('SELECT status, COUNT(*) AS c FROM invoices GROUP BY status')
      .all()
      .reduce((acc, row) => ({ ...acc, [row.status]: row.c }), { draft: 0, sent: 0, paid: 0, void: 0 });

    const topClients = db
      .prepare(
        `SELECT clients.id, clients.name, COUNT(*) AS invoice_count, COALESCE(SUM(invoices.total), 0) AS total_amount
         FROM invoices JOIN clients ON clients.id = invoices.client_id
         WHERE invoices.status NOT IN ('void', 'draft')
         GROUP BY clients.id
         ORDER BY total_amount DESC, invoice_count DESC
         LIMIT 5`,
      )
      .all();

    res.json({
      byYear,
      byStatus,
      topClients,
      totals: {
        totalInvoices: invoices.length,
        totalInvoiced: round2(invoices.filter((i) => i.status !== 'void' && i.status !== 'draft').reduce((sum, i) => sum + i.total, 0)),
        totalCollected: round2(payments.reduce((sum, p) => sum + p.amount, 0)),
        totalOutstanding: round2(invoices.filter((i) => i.status === 'sent').reduce((sum, i) => sum + (i.total - i.amount_paid), 0)),
        totalVoided: byStatus.void,
      },
    });
  } catch (err) {
    console.error('GET /api/invoices/analytics failed:', err);
    res.status(500).json({ error: 'Failed to load invoice analytics' });
  }
});

router.post('/', manage, (req, res) => {
  const {
    client_id,
    issue_date,
    due_date,
    notes = '',
    po_number = '',
    tax_rate = 0,
    discount_type = 'percentage',
    discount_value = 0,
    items,
  } = req.body || {};

  if (!client_id || !issue_date || !due_date) {
    return res.status(400).json({ error: 'client_id, issue_date and due_date are required' });
  }
  const invoiceDateError = dateError(issue_date, 'issue_date') || dateError(due_date, 'due_date')
    || (due_date < issue_date ? 'due_date cannot be before issue_date' : null);
  if (invoiceDateError) return res.status(400).json({ error: invoiceDateError });
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
         subtotal, discount_amount, tax_rate, tax_amount, total, public_token, created_by_name, po_number)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      po_number,
    );

  saveItems(result.lastInsertRowid, totals.items);

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
    po_number = '',
    tax_rate = 0,
    discount_type = 'percentage',
    discount_value = 0,
    status,
    items,
  } = req.body || {};
  if (!client_id || !issue_date || !due_date) {
    return res.status(400).json({ error: 'client_id, issue_date and due_date are required' });
  }
  const invoiceDateError = dateError(issue_date, 'issue_date') || dateError(due_date, 'due_date')
    || (due_date < issue_date ? 'due_date cannot be before issue_date' : null);
  if (invoiceDateError) return res.status(400).json({ error: invoiceDateError });
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

  // Status only changes through the dedicated actions (send, void, recover,
  // record payment) — never by editing the document — so a draft cannot be
  // flipped to "sent" (or voided without a reason) by a crafted PUT.
  const nextStatus = existing.status;

  db.prepare(
    `UPDATE invoices SET client_id = ?, status = ?, issue_date = ?, due_date = ?, notes = ?, po_number = ?,
       discount_type = ?, discount_value = ?, subtotal = ?, discount_amount = ?, tax_rate = ?, tax_amount = ?, total = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    client_id,
    nextStatus,
    issue_date,
    due_date,
    notes,
    po_number,
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

  res.json(getInvoiceWithItems(req.params.id));
});

// There is deliberately no DELETE /:id on this router — an invoice is a
// real financial document, and this app never lets one simply disappear.
// Void (below) is the only way to cancel one: unlike a delete, it keeps
// the record (and, now, a required remark explaining why) instead of
// destroying it. The old DELETE route only ever worked on a zero-payment
// invoice anyway (it 409'd the moment any payment existed), which is
// exactly the same set of invoices void already covers — so removing it
// loses no real capability, only the one true "make this vanish" escape
// hatch this app no longer wants to offer.
//
// Cancels an invoice without deleting it — a void invoice is excluded from
// financial totals/reports (see routes/financials.js, routes/reports.js)
// but the record itself stays. Deliberately its own action route rather
// than a status value on PUT /:id: that route already 409s once status is
// 'sent'/'paid' (a delivered/settled document can't be edited), but
// voiding is exactly the escape hatch a sent invoice needs — it has to
// work precisely where PUT refuses to. Requires a non-blank `reason` in
// the body (400 otherwise) — see void_reason on the invoices table
// (db/index.js) for why this is mandatory now that voiding is the only
// cancellation path this app offers. Only blocked when the invoice is
// already void, already paid (voiding paid money needs a real refund
// process, not a status flip), or has any recorded payments at all (a
// partially-paid invoice can't just have its payments silently orphaned
// by voiding it). Not permanent, though — see POST /:id/recover just
// below, for undoing a void that turns out to have been a mistake.
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
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) {
    return res.status(400).json({ error: 'A reason is required to void an invoice' });
  }

  db.prepare(
    `UPDATE invoices SET status = 'void', void_reason = ?, void_previous_status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(reason, existing.status, req.params.id);
  res.json(getInvoiceWithItems(req.params.id));
});

// The recovery half of void above — puts a mistakenly-voided invoice back
// to the status it actually had right before voiding (void_previous_status,
// stored by POST /:id/void itself), rather than leaving void as the
// one-way door it used to be. Deliberately its own action route, not a
// status value PUT /:id accepts (that route's validStatuses does include
// 'void', but restoring a specific prior status — draft vs. sent — isn't
// something a generic PUT body can express without the caller already
// knowing what to ask for). Falls back to 'draft' when there's no recorded
// previous status (an invoice voided before this column existed) — the
// safer of the two possible prior states, since it makes no claim about
// whether the invoice was ever actually sent to the client. Clears
// void_reason/void_previous_status back to their defaults; the original
// void's own reason still survives permanently in the activity_log entry
// POST /:id/void already wrote, so nothing about why it was voided is
// lost by clearing the live column. No amount_paid concern here the way
// void's own guard has one — void was only ever allowed on a
// zero-payment invoice, so there's nothing to reconcile on the way back.
router.post('/:id/recover', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.status !== 'void') {
    return res.status(409).json({ error: 'This invoice is not void' });
  }

  const restoredStatus = existing.void_previous_status === 'sent' ? 'sent' : 'draft';
  db.prepare(
    `UPDATE invoices SET status = ?, void_reason = '', void_previous_status = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).run(restoredStatus, req.params.id);
  res.json(getInvoiceWithItems(req.params.id));
});

// Manually pauses lib/scheduler.js's runOverdueReminders() dunning ladder
// for this invoice until a given date — for the "client says payment is
// already on its way" case, so staff aren't stuck choosing between a
// week-long silent gap (the job's own last_reminder_sent_at suppression)
// and an automated reminder firing while a real payment is genuinely in
// transit. Deliberately a manual, staff-driven action rather than
// something a payment-proof upload auto-triggers — an unreviewed proof
// isn't itself trusted (see "Payment proof upload" in CLAUDE.md), so
// requiring a human to actually set the hold keeps that same review step
// in the loop here too. 400s on a missing/invalid/past `hold_until` date
// and 409s on a void invoice (nothing to hold reminders on — voiding
// already stops reminders outright, see POST /:id/remind's own guard).
router.post('/:id/reminder-hold', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.status === 'void') {
    return res.status(409).json({ error: 'This invoice has been voided and never sends reminders' });
  }
  const holdUntil = typeof req.body?.hold_until === 'string' ? req.body.hold_until.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(holdUntil)) {
    return res.status(400).json({ error: 'hold_until must be a valid date (YYYY-MM-DD)' });
  }
  if (holdUntil <= today()) {
    return res.status(400).json({ error: 'hold_until must be a future date' });
  }
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

  db.prepare(`UPDATE invoices SET reminder_hold_until = ?, reminder_hold_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(holdUntil, note, req.params.id);
  res.json(getInvoiceWithItems(req.params.id));
});

router.delete('/:id/reminder-hold', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (!existing.reminder_hold_until) {
    return res.status(409).json({ error: 'This invoice has no active reminder hold' });
  }

  db.prepare(`UPDATE invoices SET reminder_hold_until = NULL, reminder_hold_note = '', updated_at = datetime('now') WHERE id = ?`)
    .run(req.params.id);
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

// See routes/quotes.js's own resolveClientOrigin()/send-preview for why
// this exists: the frontend passes its own window.location.origin so the
// emailed link matches exactly what InvoiceDetail.jsx's "Copy public link"
// button produces, rather than trusting CLIENT_ORIGIN to still match
// whatever domain is actually being served. Same duplicated helper, same
// reasoning — this router has no shared module with quotes.js to put it
// in without adding one for a single four-line function.
function resolveClientOrigin(candidate) {
  if (typeof candidate === 'string' && /^https?:\/\/\S+$/.test(candidate)) {
    return candidate.replace(/\/+$/, '');
  }
  return process.env.CLIENT_ORIGIN || 'http://localhost:5173';
}

// See routes/quotes.js's /:id/send-preview for why this exists: the exact
// same emailTemplates.js function backs both this preview and the actual
// send's fallback-when-not-overridden defaults below.
router.get('/:id/send-preview', manage, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const clientOrigin = resolveClientOrigin(req.query.client_origin);
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

  const clientOrigin = resolveClientOrigin(req.body?.client_origin);
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
  logEmail({ type: 'invoice_remind', to: data.client.email, subject, sentByName: req.user.name, entityType: 'invoice', entityId: data.invoice.id, entityLabel: data.invoice.number });
  res.json(getInvoiceWithItems(req.params.id));
});

router.post('/:id/payments', manage, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  if (data.invoice.status === 'void' || data.invoice.status === 'draft') {
    return res.status(400).json({ error: `cannot record a payment against a ${data.invoice.status} invoice` });
  }

  const { amount, method = 'bank_transfer', reference = '', notes = '', paid_at } = req.body || {};
  const amountNum = roundCents(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (amountNum > data.invoice.balance_due + 0.001) {
    return res.status(400).json({ error: `amount cannot exceed the balance due (${data.invoice.balance_due})` });
  }
  const validMethods = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];
  if (!validMethods.includes(method)) {
    return res.status(400).json({ error: `method must be one of: ${validMethods.join(', ')}` });
  }
  const paidAt = paid_at || today();
  const paidAtError = dateError(paidAt, 'paid_at');
  if (paidAtError) return res.status(400).json({ error: paidAtError });
  if (paidAt > today()) return res.status(400).json({ error: 'paid_at cannot be in the future' });

  // The payment row, the invoice's running total/status and any license
  // renewal it triggers all commit together or not at all.
  const record = db.transaction(() => {
    const receiptNumber = nextReceiptNumber();
    const result = db
      .prepare(
        'INSERT INTO payments (receipt_number, invoice_id, amount, method, reference, notes, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(receiptNumber, req.params.id, amountNum, method, reference, notes, paidAt);

    const newAmountPaid = roundCents(data.invoice.amount_paid + amountNum);
    const newStatus = newAmountPaid >= data.invoice.total ? 'paid' : data.invoice.status;

    db.prepare(`UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      newAmountPaid,
      newStatus,
      req.params.id,
    );

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);

  // Auto-renew any of this client's active *or cancelled* licenses that
  // this invoice was actually billing for — matched by a line item
  // description naming the license exactly (trimmed, case-insensitive),
  // not just "client has an invoice," so an unrelated invoice for the same
  // client never touches a license it didn't bill. Only fires the moment
  // the invoice is fully paid (newStatus === 'paid'), not on a partial
  // payment — mirrors the "once they've paid, renew it" framing the manual
  // Renew button already uses. Reuses the exact same renewLicense() the
  // manual Renew button and routes/licenses.js's POST /:id/renew call, so
  // an auto-renewal writes the same license_renewals row and resets
  // last_reminder_sent_at identically to a human clicking "Renew".
  //
  // A *cancelled* license is included in the candidate set (unlike the
  // manual Renew button, which stays blocked on a cancelled license and
  // requires an explicit Reactivate click first — see routes/licenses.js's
  // POST /:id/renew) because a real payment against it is a stronger,
  // unambiguous signal than a manual renew click ever is: the client is
  // actively paying to keep using it right now, so reactivating on their
  // behalf is the correct outcome, not friction to route around. It's
  // reactivated (status set back to 'active') immediately before renewing,
  // with its own `logActivity()` entry using the exact `action: 'reactivated'`
  // string PUT /:id's own structured-change-tracking uses — not a
  // payment-specific variant — so `GET /licenses/analytics`'s
  // `reactivated`-per-year count (which matches on that literal string)
  // picks this up the same as a manual status-flip edit; the "via invoice
  // payment" context instead goes in `entity_label`, mirroring how the
  // renewal's own log entry below already carries its context there rather
  // than in the action string.
  const autoRenewedLicenses = [];
  if (newStatus === 'paid') {
    // Keyed by trimmed/lowercased description, same matching key the license
    // lookup below uses — summed rather than a bare Set now, so a matched
    // license's `amount` (see lib/licenseRenewal.js) updates to exactly what
    // this invoice actually billed for it, not left at whatever it was
    // before. A license named by more than one line item on the same
    // invoice (unusual, but possible) sums both — the real total paid for
    // it — rather than only the last one seen.
    const amountByDescription = new Map();
    for (const item of data.items) {
      const key = (item.description || '').trim().toLowerCase();
      if (!key) continue;
      amountByDescription.set(key, (amountByDescription.get(key) || 0) + (item.amount || 0));
    }
    if (amountByDescription.size > 0) {
      const clientLicenses = db.prepare("SELECT * FROM licenses WHERE client_id = ? AND status IN ('active', 'cancelled')").all(data.invoice.client_id);
      for (const license of clientLicenses) {
        const key = license.name.trim().toLowerCase();
        if (!amountByDescription.has(key)) continue;
        const wasCancelled = license.status === 'cancelled';
        if (wasCancelled) {
          db.prepare(`UPDATE licenses SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(license.id);
        }
        const nextExpiry = renewLicense(license, req.user.name, amountByDescription.get(key));
        autoRenewedLicenses.push({ id: license.id, name: license.name, expiry_date: nextExpiry, reactivated: wasCancelled });
      }
    }
  }

    return { payment, autoRenewedLicenses };
  });

  const { payment, autoRenewedLicenses } = record();
  res.status(201).json({ payment, invoice: getInvoiceWithItems(req.params.id).invoice, autoRenewedLicenses });
});

// Reverses (cancels) a recorded payment — for a payment entered against the
// wrong invoice, with the wrong amount, or that bounced. Never edits or
// deletes the original: it appends a negative payment row that points back
// at it, so every payment total stays correct and the trail is permanent.
// Licenses auto-renewed by the original payment are NOT rolled back.
router.post('/:id/payments/:paymentId/reverse', manage, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const original = db.prepare('SELECT * FROM payments WHERE id = ? AND invoice_id = ?').get(req.params.paymentId, req.params.id);
  if (!original) return res.status(404).json({ error: 'Payment not found' });
  if (original.amount <= 0 || original.reverses_payment_id) {
    return res.status(409).json({ error: 'A reversal entry cannot be reversed' });
  }
  if (db.prepare('SELECT 1 FROM payments WHERE reverses_payment_id = ?').get(original.id)) {
    return res.status(409).json({ error: 'This payment has already been reversed' });
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) return res.status(400).json({ error: 'A reason is required to reverse a payment' });

  const reverse = db.transaction(() => {
    const receiptNumber = nextReceiptNumber();
    db.prepare(
      'INSERT INTO payments (receipt_number, invoice_id, amount, method, reference, notes, paid_at, reverses_payment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(receiptNumber, original.invoice_id, -original.amount, original.method, `Reversal of ${original.receipt_number}`, reason, today(), original.id);
    const newAmountPaid = Math.max(roundCents(data.invoice.amount_paid - original.amount), 0);
    const newStatus = data.invoice.status === 'paid' && newAmountPaid < data.invoice.total ? 'sent' : data.invoice.status;
    db.prepare(`UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(newAmountPaid, newStatus, original.invoice_id);
  });
  reverse();
  res.json(getInvoiceWithItems(req.params.id));
});

router.get('/:id/payments/:paymentId/pdf', view, async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const payment = db
    .prepare('SELECT * FROM payments WHERE id = ? AND invoice_id = ?')
    .get(req.params.paymentId, req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.amount <= 0) return res.status(400).json({ error: 'No receipt exists for a payment reversal' });

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
  if (payment.amount <= 0) return res.status(400).json({ error: 'No receipt exists for a payment reversal' });
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
  if (payment.amount <= 0) return res.status(400).json({ error: 'No receipt exists for a payment reversal' });

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

// Payment proofs (view / review / reject / delete) live in their own file.
router.use('/:id/payment-proofs', require('./invoicePaymentProofs'));

module.exports = router;
