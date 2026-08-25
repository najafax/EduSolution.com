const db = require('../db');
const { sendMail } = require('./mailer');

// Optional per-user preference (MyAccount.jsx), same shape as
// lib/quoteAcceptedNotify.js's own notifyStaffOfQuoteAccepted() — an
// internal staff digest, not a client-facing send, so it deliberately
// doesn't go through lib/emailTemplates.js's editable-template system and
// isn't recorded to email_log (same reasoning notifyStaffOfReminders()
// itself documents). Called from routes/clientPortal.js's own
// POST /invoices/:id/payment-proof whenever a client uploads one —
// fire-and-forget from the caller's point of view (never awaited), so a
// slow or failed staff notification never delays or breaks the client's
// own upload response. Best-effort: one recipient's send failing doesn't
// stop the others.
async function notifyStaffOfPaymentProof({ invoice, client, fileName }) {
  if (!process.env.SMTP_HOST) return;

  const recipients = db.prepare('SELECT email FROM users WHERE active = 1 AND notify_payment_proofs = 1').all();
  if (recipients.length === 0) return;

  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const invoiceUrl = `${clientOrigin}/invoices/${invoice.id}`;
  const subject = `Payment proof uploaded for invoice ${invoice.number}`;
  const html = `<p>${client.client_name} just uploaded a payment proof (${fileName}) against invoice ${invoice.number}.</p><p><a href="${invoiceUrl}">Review it</a> and record the payment once verified against your bank statement.</p>`;

  for (const { email } of recipients) {
    try {
      await sendMail({ to: email, subject, html });
    } catch (err) {
      console.error(`[payment-proof] Failed to notify ${email}:`, err.message);
    }
  }
}

module.exports = { notifyStaffOfPaymentProof };
