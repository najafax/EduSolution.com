const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { computeTotals } = require('../lib/totals');
const { nextInvoiceNumber, nextReceiptNumber } = require('../lib/numbering');
const { renderInvoicePdf, renderReceiptPdf } = require('../lib/pdf');
const { sendMail, textToHtml } = require('../lib/mailer');
const { invoiceSendEmail, invoiceRemindEmail, receiptSendEmail } = require('../lib/emailTemplates');
const { logActivity } = require('../lib/activity');
const { logEmail } = require('../lib/emailLog');
const { toCsv } = require('../lib/csv');
const { toXlsxBuffer } = require('../lib/xlsx');
const { renewLicense } = require('../lib/licenseRenewal');

const router = Router();
router.use(requireAuth);
const view = requirePermission('invoices', 'view');
const manage = requirePermission('invoices', 'manage');

const today = () => new Date().toISOString().slice(0, 10);

function withComputed(invoice) {
  const balanceDue = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
  return {
    ...invoice,
    balance_due: balanceDue,
    is_overdue: invoice.status === 'sent' && balanceDue > 0 && invoice.due_date < today(),
    is_partially_paid: invoice.amount_paid > 0 && balanceDue > 0,
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
}

const PAGE_SIZE = 20;

router.get('/', view, (req, res) => {
  const { status, q, page: pageParam } = req.query;
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('invoices.status = ?');
    params.push(status);
  }
  if (q) {
    conditions.push('(invoices.number LIKE ? OR clients.name LIKE ? OR invoices.status LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
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
function loadInvoiceExport() {
  return {
    rows: db
      .prepare(
        `SELECT invoices.*, clients.name AS client_name, clients.email AS client_email
         FROM invoices JOIN clients ON clients.id = invoices.client_id
         ORDER BY invoices.issue_date DESC, invoices.id DESC`,
      )
      .all()
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

router.get('/export.csv', view, (req, res) => {
  const { rows, columns } = loadInvoiceExport();
  const csv = toCsv(rows, columns);
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="invoices.csv"' });
  res.send(csv);
});

router.get('/export.xlsx', view, async (req, res) => {
  const { rows, columns } = loadInvoiceExport();
  const buffer = await toXlsxBuffer(rows, columns, 'Invoices');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="invoices.xlsx"',
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
    const voidEvents = db.prepare("SELECT created_at FROM activity_log WHERE entity_type = 'invoice' AND action = 'voided'").all();

    const currentYear = new Date().getFullYear();
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
        amountInvoiced: round2(issuedThisYear.filter((i) => i.status !== 'void').reduce((sum, i) => sum + i.total, 0)),
        paymentsReceived: paymentsThisYear.length,
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
         WHERE invoices.status != 'void'
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
        totalInvoiced: round2(invoices.filter((i) => i.status !== 'void').reduce((sum, i) => sum + i.total, 0)),
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
  logActivity({ userName: req.user.name, action: 'created', entityType: 'invoice', entityId: result.lastInsertRowid, entityLabel: number });

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

  const validStatuses = ['draft', 'sent', 'void'];
  const nextStatus = validStatuses.includes(status) ? status : existing.status;

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
  logActivity({ userName: req.user.name, action: 'updated', entityType: 'invoice', entityId: Number(req.params.id), entityLabel: existing.number });

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
// by voiding it).
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

  db.prepare(`UPDATE invoices SET status = 'void', void_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(reason, req.params.id);
  logActivity({ userName: req.user.name, action: 'voided', entityType: 'invoice', entityId: existing.id, entityLabel: `${existing.number} — ${reason}` });
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
  logActivity({ userName: req.user.name, action: 'sent', entityType: 'invoice', entityId: data.invoice.id, entityLabel: data.invoice.number });
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
  logActivity({ userName: req.user.name, action: 'sent reminder for', entityType: 'invoice', entityId: data.invoice.id, entityLabel: data.invoice.number });
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
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (amountNum > data.invoice.balance_due) {
    return res.status(400).json({ error: `amount cannot exceed the balance due (${data.invoice.balance_due})` });
  }
  const validMethods = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];
  if (!validMethods.includes(method)) {
    return res.status(400).json({ error: `method must be one of: ${validMethods.join(', ')}` });
  }

  const receiptNumber = nextReceiptNumber();
  const paidAt = paid_at || today();

  const result = db
    .prepare(
      'INSERT INTO payments (receipt_number, invoice_id, amount, method, reference, notes, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(receiptNumber, req.params.id, amountNum, method, reference, notes, paidAt);

  const newAmountPaid = Math.round((data.invoice.amount_paid + amountNum) * 100) / 100;
  const newStatus = newAmountPaid >= data.invoice.total ? 'paid' : data.invoice.status;

  db.prepare(`UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    newAmountPaid,
    newStatus,
    req.params.id,
  );

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'recorded payment for', entityType: 'invoice', entityId: Number(req.params.id), entityLabel: `${data.invoice.number} (${receiptNumber})` });

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
          logActivity({
            userName: req.user.name,
            action: 'reactivated',
            entityType: 'license',
            entityId: license.id,
            entityLabel: `${license.name} (${data.client.name}) — via invoice payment`,
          });
        }
        const nextExpiry = renewLicense(license, req.user.name, amountByDescription.get(key));
        logActivity({
          userName: req.user.name,
          action: 'auto-renewed via invoice payment for',
          entityType: 'license',
          entityId: license.id,
          entityLabel: `${license.name} (${data.client.name}) → ${nextExpiry}`,
        });
        autoRenewedLicenses.push({ id: license.id, name: license.name, expiry_date: nextExpiry, reactivated: wasCancelled });
      }
    }
  }

  res.status(201).json({ payment, invoice: getInvoiceWithItems(req.params.id).invoice, autoRenewedLicenses });
});

router.get('/:id/payments/:paymentId/pdf', view, async (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
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

router.get('/:id/payments/:paymentId/receipt-preview', manage, (req, res) => {
  const data = getInvoiceWithItems(req.params.id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const payment = db
    .prepare('SELECT * FROM payments WHERE id = ? AND invoice_id = ?')
    .get(req.params.paymentId, req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
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

// Streams the actual file — decoded from the stored base64 data URI, same
// as lib/pdf.js's own decodeImageDataUri approach for settings images —
// rather than returning it as JSON, so the browser can render an image
// inline or open a PDF the same way GET /:id/pdf already does. This is the
// one payment-proof route that isn't embedded in getInvoiceWithItems()'s
// own response (see that function's own note on why file_data stays out
// of the regular invoice fetch).
router.get('/:id/payment-proofs/:proofId/file', view, (req, res) => {
  const proof = db.prepare('SELECT * FROM payment_proofs WHERE id = ? AND invoice_id = ?').get(req.params.proofId, req.params.id);
  if (!proof) return res.status(404).json({ error: 'Payment proof not found' });
  const match = /^data:[^;]+;base64,([A-Za-z0-9+/]+=*)$/.exec(proof.file_data);
  if (!match) return res.status(500).json({ error: 'Stored file could not be read' });
  res.set({
    'Content-Type': proof.file_type,
    'Content-Disposition': `inline; filename="${proof.file_name}"`,
  });
  res.send(Buffer.from(match[1], 'base64'));
});

// "Reviewed" means a staff member has looked at the proof and either
// recorded the real payment (POST /:id/payments, unchanged by this
// feature) or decided it doesn't apply — this route only flips the status
// flag, it never touches amount_paid/status on the invoice itself, since a
// proof is evidence, not an instruction to auto-record anything.
router.post('/:id/payment-proofs/:proofId/review', manage, (req, res) => {
  const proof = db.prepare('SELECT * FROM payment_proofs WHERE id = ? AND invoice_id = ?').get(req.params.proofId, req.params.id);
  if (!proof) return res.status(404).json({ error: 'Payment proof not found' });
  db.prepare(`UPDATE payment_proofs SET status = 'reviewed', reviewed_by_name = ?, reviewed_at = datetime('now') WHERE id = ?`).run(
    req.user.name,
    proof.id,
  );
  res.json({ message: 'Marked reviewed.' });
});

// The other terminal outcome for a proof, alongside "review" above —
// staff looked at it and it doesn't check out (amount doesn't match,
// unreadable, wrong invoice referenced, etc.), and wants the client to
// know why rather than silently deleting the upload. Requires a non-blank
// `note` (unlike review, which needs no explanation) — the whole point of
// a reject action over just deleting the row is that the client gets to
// see the reason on their own copy (see routes/clientPortal.js's own
// getClientInvoice(), which now selects review_note alongside status).
// Like review, this only ever touches the proof's own row — never
// amount_paid/status on the invoice.
router.post('/:id/payment-proofs/:proofId/reject', manage, (req, res) => {
  const invoice = db.prepare('SELECT number FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const proof = db.prepare('SELECT * FROM payment_proofs WHERE id = ? AND invoice_id = ?').get(req.params.proofId, req.params.id);
  if (!proof) return res.status(404).json({ error: 'Payment proof not found' });
  const note = (req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Please explain why this proof is being rejected' });

  db.prepare(
    `UPDATE payment_proofs SET status = 'rejected', review_note = ?, reviewed_by_name = ?, reviewed_at = datetime('now') WHERE id = ?`,
  ).run(note, req.user.name, proof.id);
  logActivity({
    userName: req.user.name,
    action: 'rejected a payment proof for',
    entityType: 'invoice',
    entityId: Number(req.params.id),
    entityLabel: invoice.number,
  });
  res.json({ message: 'Payment proof rejected.' });
});

router.delete('/:id/payment-proofs/:proofId', manage, (req, res) => {
  const invoice = db.prepare('SELECT number FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const proof = db.prepare('SELECT * FROM payment_proofs WHERE id = ? AND invoice_id = ?').get(req.params.proofId, req.params.id);
  if (!proof) return res.status(404).json({ error: 'Payment proof not found' });
  db.prepare('DELETE FROM payment_proofs WHERE id = ?').run(proof.id);
  logActivity({
    userName: req.user.name,
    action: 'deleted a payment proof for',
    entityType: 'invoice',
    entityId: Number(req.params.id),
    entityLabel: invoice.number,
  });
  res.status(204).end();
});

module.exports = router;
