const cron = require('node-cron');
const db = require('../db');
const { renderInvoicePdf } = require('./pdf');
const { sendMail } = require('./mailer');

const today = () => new Date().toISOString().slice(0, 10);

// Auto-reminds invoices that are overdue and haven't been reminded (manually
// or automatically) in the last 7 days, so this doesn't re-nag daily once a
// human has already sent one. Exported separately from the cron registration
// so it can be invoked directly (tests, or a future manual "run now" route).
async function runOverdueReminders() {
  if (!process.env.SMTP_HOST) {
    console.log('[reminders] SMTP not configured, skipping automated overdue reminders');
    return { sent: 0, skipped: true };
  }

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const candidates = db
    .prepare(
      `SELECT * FROM invoices
       WHERE status = 'sent' AND amount_paid < total AND due_date < ?
         AND (last_reminder_sent_at IS NULL OR last_reminder_sent_at < ?)`,
    )
    .all(today(), sevenDaysAgo);

  let sent = 0;
  for (const invoice of candidates) {
    try {
      const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id);
      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(invoice.id);
      const balanceDue = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;

      const buffer = await renderInvoicePdf({ invoice, client, items, settings });
      await sendMail({
        to: client.email,
        subject: `Payment reminder: invoice ${invoice.number}`,
        html: `<p>Hi ${client.name},</p><p>This is an automated reminder that invoice ${invoice.number} for ${settings.currency_symbol}${balanceDue.toFixed(2)} was due on ${invoice.due_date}. Please find it attached.</p>`,
        attachments: [{ filename: `${invoice.number}.pdf`, content: buffer }],
      });

      db.prepare(`UPDATE invoices SET last_reminder_sent_at = datetime('now') WHERE id = ?`).run(invoice.id);
      sent += 1;
    } catch (err) {
      console.error(`[reminders] Failed to send reminder for invoice ${invoice.number}:`, err.message);
    }
  }

  console.log(`[reminders] Sent ${sent} automated overdue reminder(s)`);
  return { sent, skipped: false };
}

function startScheduler() {
  // Daily at 08:00 server time.
  cron.schedule('0 8 * * *', () => {
    runOverdueReminders().catch((err) => console.error('[reminders] job failed:', err));
  });
}

module.exports = { startScheduler, runOverdueReminders };
