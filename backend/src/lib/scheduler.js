const cron = require('node-cron');
const crypto = require('crypto');
const db = require('../db');
const { renderInvoicePdf } = require('./pdf');
const { sendMail } = require('./mailer');
const { computeTotals } = require('./totals');
const { nextInvoiceNumber } = require('./numbering');
const { runBackup } = require('./backup');

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

function advanceDate(dateStr, frequency) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly, the default
  return d.toISOString().slice(0, 10);
}

// Turns every due recurring-invoice template into a real draft invoice,
// then advances that template's next_run_date by its frequency. Generated
// invoices start as drafts — nothing gets emailed to a client automatically
// from this job, only created for review.
async function generateDueRecurringInvoices() {
  const due = db.prepare('SELECT * FROM recurring_invoices WHERE active = 1 AND next_run_date <= ?').all(today());

  let generated = 0;
  for (const recurring of due) {
    try {
      const items = db
        .prepare('SELECT * FROM recurring_invoice_items WHERE recurring_invoice_id = ? ORDER BY sort_order')
        .all(recurring.id);
      const totals = computeTotals(items, recurring.tax_rate, recurring.discount_type, recurring.discount_value);

      const number = nextInvoiceNumber();
      const publicToken = crypto.randomBytes(16).toString('hex');
      const issueDate = today();
      const dueDate = new Date(Date.now() + recurring.due_in_days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const result = db
        .prepare(
          `INSERT INTO invoices (number, client_id, recurring_invoice_id, status, issue_date, due_date, notes,
             discount_type, discount_value, subtotal, discount_amount, tax_rate, tax_amount, total, public_token)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          number,
          recurring.client_id,
          recurring.id,
          issueDate,
          dueDate,
          recurring.notes,
          totals.discountType,
          totals.discountValue,
          totals.subtotal,
          totals.discountAmount,
          totals.taxRate,
          totals.taxAmount,
          totals.total,
          publicToken,
        );

      const insertItem = db.prepare(
        'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const item of totals.items) {
        insertItem.run(result.lastInsertRowid, item.description, item.quantity, item.unit_price, item.amount, item.sort_order);
      }

      const nextRunDate = advanceDate(recurring.next_run_date, recurring.frequency);
      db.prepare(`UPDATE recurring_invoices SET last_generated_at = datetime('now'), next_run_date = ? WHERE id = ?`).run(
        nextRunDate,
        recurring.id,
      );

      generated += 1;
    } catch (err) {
      console.error(`[recurring] Failed to generate invoice for recurring #${recurring.id}:`, err.message);
    }
  }

  console.log(`[recurring] Generated ${generated} invoice(s) from recurring templates`);
  return { generated };
}

function startScheduler() {
  // Daily at 07:00 server time: generate any due recurring invoices first,
  // so a newly-generated invoice can't be reminded the same run.
  cron.schedule('0 7 * * *', () => {
    generateDueRecurringInvoices().catch((err) => console.error('[recurring] job failed:', err));
  });
  // Daily at 08:00 server time.
  cron.schedule('0 8 * * *', () => {
    runOverdueReminders().catch((err) => console.error('[reminders] job failed:', err));
  });
  // Daily at 03:00 server time, ahead of the other jobs — see lib/backup.js.
  cron.schedule('0 3 * * *', () => {
    runBackup().catch((err) => console.error('[backup] job failed:', err));
  });
}

module.exports = { startScheduler, runOverdueReminders, generateDueRecurringInvoices, runBackup };
