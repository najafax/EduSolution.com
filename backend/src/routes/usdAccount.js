const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { todayStr } = require('../lib/businessDate');
const { TYPES, replay, position, round2, applyValidated, negativeMessage } = require('../lib/usdLedger');

// The USD account ledger (see lib/usdLedger.js for the accounting model).
// Gated on `financials`, same as the rest of the money-movement screens.
const router = Router();
router.use(requireAuth);
const view = requirePermission('financials', 'view');
const manage = requirePermission('financials', 'manage');

const TYPE_LABELS = {
  opening: 'Opening balance',
  buy: 'Bought USD',
  supplier_payment: 'Paid supplier',
  sell: 'Converted to MVR',
};

const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

// Validates a request body into a row (or an error string).
function parseBody(body, existingType) {
  const type = existingType || body.type;
  if (!TYPES.includes(type)) return { error: `type must be one of: ${TYPES.join(', ')}` };
  const txnDate = body.txn_date || todayStr();
  if (!isDate(txnDate)) return { error: 'Date must be a valid date (YYYY-MM-DD)' };
  const usd = Number(body.usd_amount);
  if (!Number.isFinite(usd) || usd <= 0) return { error: 'USD amount must be a positive number' };

  let mvr = 0;
  if (type !== 'supplier_payment') {
    // Accept either the MVR amount or a rate (MVR per USD).
    if (body.mvr_amount !== undefined && body.mvr_amount !== '' && body.mvr_amount !== null) mvr = Number(body.mvr_amount);
    else if (body.rate !== undefined && body.rate !== '' && body.rate !== null) mvr = usd * Number(body.rate);
    else return { error: 'Enter the MVR amount or the exchange rate' };
    if (!Number.isFinite(mvr) || mvr <= 0) return { error: 'MVR amount / rate must be a positive number' };
  }

  return {
    type,
    txn_date: txnDate,
    usd_amount: round2(usd),
    mvr_amount: round2(mvr),
    payee: String(body.payee || '').trim(),
    reference: String(body.reference || '').trim(),
    notes: String(body.notes || '').trim(),
  };
}

router.get('/', view, (req, res) => {
  const { rows, error } = replay();
  const pos = position(null, rows);
  const buys = rows.filter((r) => r.type === 'buy');
  const payments = rows.filter((r) => r.type === 'supplier_payment');
  res.json({
    ...pos,
    hasOpening: rows.some((r) => r.type === 'opening'),
    totalBoughtUsd: round2(buys.reduce((s, r) => s + r.usd_amount, 0)),
    totalBoughtMvr: round2(buys.reduce((s, r) => s + r.mvr_amount, 0)),
    totalPaidUsd: round2(payments.reduce((s, r) => s + r.usd_amount, 0)),
    totalPaidCostMvr: round2(payments.reduce((s, r) => s + r.costMvr, 0)),
    lastBuyRate: buys.length ? buys[buys.length - 1].mvr_amount / buys[buys.length - 1].usd_amount : null,
    warning: error ? negativeMessage(error) : null,
    transactions: rows.slice().reverse().map((r) => ({ ...r, type_label: TYPE_LABELS[r.type] })),
  });
});

const COLS = 'txn_date, type, usd_amount, mvr_amount, payee, reference, notes';


// A payment made from a supplier invoice is managed from that invoice.
function supplierInvoiceFor(txnId) {
  return db.prepare('SELECT id, supplier, number FROM supplier_invoices WHERE paid_txn_id = ?').get(txnId);
}
function lockedMessage(si) {
  return `This payment belongs to supplier invoice ${si.number || '#' + si.id} (${si.supplier}). Undo it from that invoice instead.`;
}

router.post('/', manage, (req, res) => {
  const parsed = parseBody(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (parsed.type === 'opening' && db.prepare("SELECT 1 FROM usd_transactions WHERE type = 'opening'").get()) {
    return res.status(409).json({ error: 'An opening balance already exists. Edit it instead.' });
  }
  const { result, error } = applyValidated(
    () =>
      db
        .prepare(`INSERT INTO usd_transactions (${COLS}, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(parsed.txn_date, parsed.type, parsed.usd_amount, parsed.mvr_amount, parsed.payee, parsed.reference, parsed.notes, req.user.name)
        .lastInsertRowid,
  );
  if (error) return res.status(400).json({ error });
  res.status(201).json({ id: result });
});

router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM usd_transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  const lockedBy = supplierInvoiceFor(existing.id);
  if (lockedBy) return res.status(409).json({ error: lockedMessage(lockedBy) });
  const parsed = parseBody(req.body || {}, existing.type);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { error } = applyValidated(() =>
    db
      .prepare(
        `UPDATE usd_transactions SET txn_date = ?, usd_amount = ?, mvr_amount = ?, payee = ?, reference = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(parsed.txn_date, parsed.usd_amount, parsed.mvr_amount, parsed.payee, parsed.reference, parsed.notes, existing.id),
  );
  if (error) return res.status(400).json({ error });
  res.json({ ok: true });
});

router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM usd_transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  const lockedBy = supplierInvoiceFor(existing.id);
  if (lockedBy) return res.status(409).json({ error: lockedMessage(lockedBy) });
  const { error } = applyValidated(() => db.prepare('DELETE FROM usd_transactions WHERE id = ?').run(existing.id));
  if (error) return res.status(409).json({ error: `Can't delete this entry. ${error}` });
  res.json({ ok: true });
});

module.exports = router;
