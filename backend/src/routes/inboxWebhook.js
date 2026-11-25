const { verifySignature, ingestMetadata, loadBody } = require('../lib/inbox');

// POST /api/webhooks/resend — mounted in index.js with express.raw() BEFORE
// the global JSON parser, because the signature is computed over the exact
// bytes Resend sent (re-serialised JSON would never match).
//
// Only "email.received" is acted on; every other event type is acknowledged
// and ignored. The metadata row is written before we answer, the body is
// fetched afterwards so a slow Resend API call can't make this time out
// (and cause Resend to retry). The unique resend_email_id makes retries safe.
module.exports = function resendWebhook(req, res) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Inbound email webhook is not configured' });

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const ok = verifySignature({
    secret,
    id: req.get('svix-id'),
    timestamp: req.get('svix-timestamp'),
    signature: req.get('svix-signature'),
    rawBody: raw,
  });
  if (!ok) return res.status(401).json({ error: 'Invalid signature' });

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  if (!event || event.type !== 'email.received') return res.json({ ok: true, ignored: true });

  let result;
  try {
    result = ingestMetadata(event.data || {});
  } catch (err) {
    console.error('inbound email store failed', err);
    return res.status(500).json({ error: 'Could not store the email' });
  }
  res.json({ ok: true });
  if (result && result.created) {
    loadBody(result.row.id).catch((err) => console.error('inbound email body load failed', err.message));
  }
};
