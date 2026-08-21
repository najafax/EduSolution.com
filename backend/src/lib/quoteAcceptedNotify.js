const db = require('../db');
const { sendMail } = require('./mailer');

// Optional per-user preference (MyAccount.jsx), same shape as
// lib/scheduler.js's notifyStaffOfReminders() — an internal staff digest,
// not a client-facing send, so it deliberately doesn't go through
// lib/emailTemplates.js's editable-template system and isn't recorded to
// email_log (same reasoning notifyStaffOfReminders() itself documents).
// Called from routes/public.js's and routes/clientPortal.js's own
// POST .../respond handlers whenever a client accepts a quote — fire-and-
// forget from the caller's point of view (never awaited), so a slow or
// failed staff notification never delays or breaks the client's own
// accept response. Best-effort: one recipient's send failing doesn't stop
// the others.
async function notifyStaffOfQuoteAccepted({ quote, client }) {
  if (!process.env.SMTP_HOST) return;

  const recipients = db.prepare('SELECT email FROM users WHERE active = 1 AND notify_quote_responses = 1').all();
  if (recipients.length === 0) return;

  const settings = db.prepare('SELECT currency_symbol FROM business_settings WHERE id = 1').get();
  const symbol = settings?.currency_symbol || '$';
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const quoteUrl = `${clientOrigin}/quotes/${quote.id}`;
  const subject = `Quote ${quote.number} accepted by ${client.name}`;
  const html = `<p>${client.name} just accepted quote ${quote.number} (${symbol}${quote.total.toFixed(2)}).</p><p><a href="${quoteUrl}">View the quote</a> to convert it to an invoice.</p>`;

  for (const { email } of recipients) {
    try {
      await sendMail({ to: email, subject, html });
    } catch (err) {
      console.error(`[quote-accepted] Failed to notify ${email}:`, err.message);
    }
  }
}

module.exports = { notifyStaffOfQuoteAccepted };
