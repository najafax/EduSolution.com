const { Router } = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/auth');

// Staff-side handling of client-uploaded payment proofs. Mounted by
// routes/invoices.js at /:id/payment-proofs, so it inherits that router's
// requireAuth and every path here is relative to one invoice (req.params.id).
const router = Router({ mergeParams: true });
const view = requirePermission('invoices', 'view');
const manage = requirePermission('invoices', 'manage');

// Streams the actual file — decoded from the stored base64 data URI, same
// as lib/pdf.js's own decodeImageDataUri approach for settings images —
// rather than returning it as JSON, so the browser can render an image
// inline or open a PDF the same way GET /:id/pdf already does. This is the
// one payment-proof route that isn't embedded in getInvoiceWithItems()'s
// own response (see that function's own note on why file_data stays out
// of the regular invoice fetch).
router.get('/:proofId/file', view, (req, res) => {
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
router.post('/:proofId/review', manage, (req, res) => {
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
router.post('/:proofId/reject', manage, (req, res) => {
  const invoice = db.prepare('SELECT number FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const proof = db.prepare('SELECT * FROM payment_proofs WHERE id = ? AND invoice_id = ?').get(req.params.proofId, req.params.id);
  if (!proof) return res.status(404).json({ error: 'Payment proof not found' });
  const note = (req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Please explain why this proof is being rejected' });

  db.prepare(
    `UPDATE payment_proofs SET status = 'rejected', review_note = ?, reviewed_by_name = ?, reviewed_at = datetime('now') WHERE id = ?`,
  ).run(note, req.user.name, proof.id);
  res.json({ message: 'Payment proof rejected.' });
});

router.delete('/:proofId', manage, (req, res) => {
  const invoice = db.prepare('SELECT number FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const proof = db.prepare('SELECT * FROM payment_proofs WHERE id = ? AND invoice_id = ?').get(req.params.proofId, req.params.id);
  if (!proof) return res.status(404).json({ error: 'Payment proof not found' });
  db.prepare('DELETE FROM payment_proofs WHERE id = ?').run(proof.id);
  res.status(204).end();
});

module.exports = router;
