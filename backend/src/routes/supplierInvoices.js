const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { todayStr } = require('../lib/businessDate');
const { isValidDate, round2 } = require('../lib/validate');
const { applyValidated } = require('../lib/usdLedger');

// Supplier invoices: a bill from a supplier, always paid in full from the USD
// account. Paying writes one `supplier_payment` row in usd_transactions (that
// is the expense, at the account's average cost) and marks the invoice paid.
// A supplier invoice may fund several client invoices and a client invoice
// may be funded by several supplier invoices: supplier_invoice_links carries
// the USD share assigned to each client invoice (used for profit per sale and
// to know which sales are still waiting for a supplier invoice).
const router = Router();
router.use(requireAuth);
const view = requirePermission('financials', 'view');
const manage = requirePermission('financials', 'manage');

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const FILE_MAX_BYTES = 6 * 1024 * 1024;
const DATA_URI_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;

const COLS = 'id, supplier, number, invoice_date, due_date, usd_amount, notes, file_name, file_type, status, paid_txn_id, paid_at, created_by_name, created_at';

function linksFor(ids) {
  if (!ids.length) return new Map();
  const rows = db
    .prepare(
      `SELECT l.id, l.supplier_invoice_id, l.invoice_id, l.usd_amount, i.number AS invoice_number, c.name AS client_name
         FROM supplier_invoice_links l
         JOIN invoices i ON i.id = l.invoice_id
         LEFT JOIN clients c ON c.id = i.client_id
        WHERE l.supplier_invoice_id IN (${ids.map(() => '?').join(',')})
        ORDER BY l.id`,
    )
    .all(...ids);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.supplier_invoice_id)) map.set(r.supplier_invoice_id, []);
    map.get(r.supplier_invoice_id).push(r);
  }
  return map;
}

function shape(rows, today = todayStr()) {
  const links = linksFor(rows.map((r) => r.id));
  return rows.map((r) => {
    const l = links.get(r.id) || [];
    const assigned = round2(l.reduce((s, x) => s + x.usd_amount, 0));
    return {
      ...r,
      has_file: Boolean(r.file_name),
      links: l,
      assigned_usd: assigned,
      unassigned_usd: round2(Math.max(r.usd_amount - assigned, 0)),
      is_overdue: r.status === 'unpaid' && Boolean(r.due_date) && r.due_date < today,
    };
  });
}

function parseBody(body, { partial = false } = {}) {
  const supplier = String(body.supplier || '').trim();
  if (!supplier) return { error: 'Supplier is required' };
  const invoiceDate = body.invoice_date || todayStr();
  if (!isValidDate(invoiceDate)) return { error: 'Invoice date must be a valid date' };
  const dueDate = body.due_date ? String(body.due_date) : '';
  if (dueDate && !isValidDate(dueDate)) return { error: 'Due date must be a valid date' };
  const usd = Number(body.usd_amount);
  if (!Number.isFinite(usd) || usd <= 0) return { error: 'USD amount must be a positive number' };
  void partial;
  return {
    supplier,
    number: String(body.number || '').trim(),
    invoice_date: invoiceDate,
    due_date: dueDate,
    usd_amount: round2(usd),
    notes: String(body.notes || '').trim(),
  };
}

// Validates an attachment data URI; returns { data, name, type } or { error }.
function parseFile(fileData, fileName) {
  const m = DATA_URI_RE.exec(String(fileData || ''));
  if (!m) return { error: 'The attachment must be a PNG, JPEG, WEBP or PDF file' };
  if (!FILE_TYPES.includes(m[1])) return { error: 'The attachment must be a PNG, JPEG, WEBP or PDF file' };
  if (Math.ceil((m[2].length * 3) / 4) > FILE_MAX_BYTES) return { error: 'The attachment is too large (6MB maximum)' };
  return { data: fileData, name: String(fileName || 'supplier-invoice').slice(0, 120), type: m[1] };
}

// Validates a links array against the invoice amount.
function parseLinks(links, usdAmount) {
  if (links === undefined) return { links: undefined };
  if (!Array.isArray(links)) return { error: 'links must be a list' };
  const seen = new Set();
  const out = [];
  let total = 0;
  for (const l of links) {
    const invoiceId = Number(l.invoice_id);
    const amt = round2(Number(l.usd_amount));
    if (!Number.isInteger(invoiceId)) return { error: 'Choose a client invoice for every link' };
    if (!Number.isFinite(amt) || amt <= 0) return { error: 'Each link needs a USD amount above zero' };
    if (seen.has(invoiceId)) return { error: 'A client invoice can only be linked once per supplier invoice' };
    seen.add(invoiceId);
    const inv = db.prepare('SELECT id, status FROM invoices WHERE id = ?').get(invoiceId);
    if (!inv) return { error: 'A linked client invoice no longer exists' };
    if (inv.status === 'void') return { error: 'A void invoice cannot be linked' };
    total += amt;
    out.push({ invoice_id: invoiceId, usd_amount: amt });
  }
  if (total > usdAmount + 0.005) {
    return { error: `The linked amounts ($${round2(total).toFixed(2)}) are more than the supplier invoice ($${usdAmount.toFixed(2)})` };
  }
  return { links: out };
}

function saveLinks(id, links) {
  db.prepare('DELETE FROM supplier_invoice_links WHERE supplier_invoice_id = ?').run(id);
  const ins = db.prepare('INSERT INTO supplier_invoice_links (supplier_invoice_id, invoice_id, usd_amount) VALUES (?, ?, ?)');
  for (const l of links) ins.run(id, l.invoice_id, l.usd_amount);
}

// GET /?status=unpaid|paid
router.get('/', view, (req, res) => {
  const status = req.query.status;
  const where = status === 'unpaid' || status === 'paid' ? 'WHERE status = ?' : '';
  const order = status === 'paid' ? 'ORDER BY paid_at DESC, id DESC' : "ORDER BY CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date ASC, id ASC";
  const rows = db.prepare(`SELECT ${COLS} FROM supplier_invoices ${where} ${order}`).all(...(where ? [status] : []));
  res.json({ supplierInvoices: shape(rows) });
});

router.get('/:id/file', view, (req, res) => {
  const row = db.prepare('SELECT file_data, file_name, file_type FROM supplier_invoices WHERE id = ?').get(req.params.id);
  if (!row || !row.file_data) return res.status(404).json({ error: 'No file attached' });
  const m = DATA_URI_RE.exec(row.file_data);
  if (!m) return res.status(404).json({ error: 'No file attached' });
  res.setHeader('Content-Type', row.file_type);
  res.setHeader('Content-Disposition', `inline; filename="${row.file_name.replace(/[^\w.-]+/g, '_')}"`);
  res.send(Buffer.from(m[2], 'base64'));
});

router.post('/', manage, (req, res) => {
  const parsed = parseBody(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const lk = parseLinks(req.body.links, parsed.usd_amount);
  if (lk.error) return res.status(400).json({ error: lk.error });
  let file = { data: '', name: '', type: '' };
  if (req.body.file_data) {
    file = parseFile(req.body.file_data, req.body.file_name);
    if (file.error) return res.status(400).json({ error: file.error });
  }
  const id = db.transaction(() => {
    const newId = db
      .prepare(
        `INSERT INTO supplier_invoices (supplier, number, invoice_date, due_date, usd_amount, notes, file_data, file_name, file_type, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(parsed.supplier, parsed.number, parsed.invoice_date, parsed.due_date, parsed.usd_amount, parsed.notes, file.data, file.name, file.type, req.user.name)
      .lastInsertRowid;
    if (lk.links) saveLinks(newId, lk.links);
    return newId;
  })();
  res.status(201).json({ id });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM supplier_invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Supplier invoice not found' });
  if (existing.status === 'paid') return res.status(409).json({ error: 'A paid supplier invoice cannot be edited. Undo the payment first.' });
  const parsed = parseBody(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const lk = parseLinks(req.body.links, parsed.usd_amount);
  if (lk.error) return res.status(400).json({ error: lk.error });
  let file = { data: existing.file_data, name: existing.file_name, type: existing.file_type };
  if (req.body.file_data === null) file = { data: '', name: '', type: '' };
  else if (req.body.file_data) {
    file = parseFile(req.body.file_data, req.body.file_name);
    if (file.error) return res.status(400).json({ error: file.error });
  }
  db.transaction(() => {
    db.prepare(
      `UPDATE supplier_invoices SET supplier = ?, number = ?, invoice_date = ?, due_date = ?, usd_amount = ?, notes = ?,
         file_data = ?, file_name = ?, file_type = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(parsed.supplier, parsed.number, parsed.invoice_date, parsed.due_date, parsed.usd_amount, parsed.notes, file.data, file.name, file.type, existing.id);
    if (lk.links) saveLinks(existing.id, lk.links);
    else {
      // Amount shrank below what was already assigned: refuse rather than silently trim.
      const assigned = db.prepare('SELECT COALESCE(SUM(usd_amount),0) AS t FROM supplier_invoice_links WHERE supplier_invoice_id = ?').get(existing.id).t;
      if (assigned > parsed.usd_amount + 0.005) throw Object.assign(new Error('The amount is less than what is already linked to client invoices'), { status: 400 });
    }
  })();
  res.json({ ok: true });
});

// Which client invoices this supplier invoice funded. Allowed even once paid:
// links only describe cost, they never touch the ledger.
router.put('/:id/links', manage, (req, res) => {
  const existing = db.prepare('SELECT id, usd_amount, supplier, number FROM supplier_invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Supplier invoice not found' });
  const lk = parseLinks(req.body && req.body.links, existing.usd_amount);
  if (lk.error) return res.status(400).json({ error: lk.error });
  if (!lk.links) return res.status(400).json({ error: 'links is required' });
  db.transaction(() => saveLinks(existing.id, lk.links))();
  res.json({ ok: true });
});

// Pay in full from the USD account.
router.post('/:id/pay', manage, (req, res) => {
  const si = db.prepare('SELECT * FROM supplier_invoices WHERE id = ?').get(req.params.id);
  if (!si) return res.status(404).json({ error: 'Supplier invoice not found' });
  if (si.status === 'paid') return res.status(409).json({ error: 'This supplier invoice is already paid.' });
  const date = (req.body && req.body.txn_date) || todayStr();
  if (!isValidDate(date)) return res.status(400).json({ error: 'Payment date must be a valid date' });
  if (date > todayStr()) return res.status(400).json({ error: 'Payment date cannot be in the future' });
  const { result, error, short } = applyValidated(() => {
    const txnId = db
      .prepare(
        `INSERT INTO usd_transactions (txn_date, type, usd_amount, mvr_amount, payee, reference, notes, created_by_name)
         VALUES (?, 'supplier_payment', ?, 0, ?, ?, ?, ?)`,
      )
      .run(date, si.usd_amount, si.supplier, si.number, `Supplier invoice #${si.id}`, req.user.name).lastInsertRowid;
    db.prepare("UPDATE supplier_invoices SET status = 'paid', paid_txn_id = ?, paid_at = ?, updated_at = datetime('now') WHERE id = ?").run(txnId, date, si.id);
    return txnId;
  });
  if (error) {
    return res.status(400).json({
      error: `Not enough USD in the account to pay this. ${error}`,
      shortUsd: short ? short.shortUsd : null,
    });
  }
  res.json({ ok: true, txnId: result });
});

// Undo a payment: removes the ledger row and reopens the invoice.
router.post('/:id/unpay', manage, (req, res) => {
  const si = db.prepare('SELECT * FROM supplier_invoices WHERE id = ?').get(req.params.id);
  if (!si) return res.status(404).json({ error: 'Supplier invoice not found' });
  if (si.status !== 'paid') return res.status(409).json({ error: 'This supplier invoice is not paid.' });
  const { error } = applyValidated(() => {
    if (si.paid_txn_id) db.prepare('DELETE FROM usd_transactions WHERE id = ?').run(si.paid_txn_id);
    db.prepare("UPDATE supplier_invoices SET status = 'unpaid', paid_txn_id = NULL, paid_at = '', updated_at = datetime('now') WHERE id = ?").run(si.id);
  });
  if (error) return res.status(409).json({ error: `Can't undo this payment. ${error}` });
  res.json({ ok: true });
});

router.delete('/:id', manage, (req, res) => {
  const si = db.prepare('SELECT * FROM supplier_invoices WHERE id = ?').get(req.params.id);
  if (!si) return res.status(404).json({ error: 'Supplier invoice not found' });
  if (si.status === 'paid') return res.status(409).json({ error: 'A paid supplier invoice cannot be deleted. Undo the payment first.' });
  db.prepare('DELETE FROM supplier_invoices WHERE id = ?').run(si.id);
  res.json({ ok: true });
});

router.use((err, req, res, next) => {
  if (err && err.status === 400) return res.status(400).json({ error: err.message });
  return next(err);
});

module.exports = router;
