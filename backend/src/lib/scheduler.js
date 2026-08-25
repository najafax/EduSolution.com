const cron = require('node-cron');
const crypto = require('crypto');
const db = require('../db');
const { renderInvoicePdf } = require('./pdf');
const { sendMail, textToHtml } = require('./mailer');
const { computeTotals } = require('./totals');
const { nextInvoiceNumber } = require('./numbering');
const { runBackup } = require('./backup');
const { logEmail } = require('./emailLog');
const { licenseRemindEmail } = require('./emailTemplates');

const today = () => new Date().toISOString().slice(0, 10);

// How many days overdue an invoice needs to be before the automated
// reminder escalates to a firmer tone, then a final notice. This is a
// dunning *ladder*, not a single flat reminder repeated verbatim — a
// 3-day-overdue invoice and a 45-day-overdue one don't warrant the same
// wording, and escalating automatically means a business doesn't have to
// remember to manually chase old balances harder. Deliberately just two
// thresholds/three rungs rather than a longer configurable sequence — this
// mirrors the app's existing "don't build it until needed" calls elsewhere
// (see routes/licenses.js's own renewal-history note) rather than adding a
// settings UI for something that can be revisited if a real need for more
// granularity ever comes up.
const DUNNING_FIRM_DAYS = 14;
const DUNNING_FINAL_DAYS = 30;

function daysOverdue(dueDate) {
  const due = new Date(`${dueDate}T00:00:00`);
  const now = new Date(`${today()}T00:00:00`);
  return Math.round((now - due) / (24 * 60 * 60 * 1000));
}

// Builds the stage-specific subject/HTML for one reminder. Deliberately
// hardcoded here rather than going through lib/emailTemplates.js's
// admin-editable system, the same way the original single-stage reminder
// text always was — see that file's own top comment on why this automated
// digest stays non-customizable (nobody reviews it before it goes out,
// unlike a human clicking "Send reminder" on InvoiceDetail.jsx, which still
// uses the one plain, unstaged invoice_remind template regardless of how
// overdue the invoice is).
function dunningContent({ invoice, client, settings, balanceDue, overdueDays }) {
  const amount = `${settings.currency_symbol}${balanceDue.toFixed(2)}`;
  if (overdueDays >= DUNNING_FINAL_DAYS) {
    return {
      stage: 'final',
      subject: `FINAL NOTICE: invoice ${invoice.number} is ${overdueDays} days overdue`,
      html: `<p>Hi ${client.name},</p><p><strong>This is a final notice.</strong> Invoice ${invoice.number} for ${amount} was due on ${invoice.due_date} and is now ${overdueDays} days overdue. Please settle this balance immediately to avoid further action. The invoice is attached for your reference.</p>`,
    };
  }
  if (overdueDays >= DUNNING_FIRM_DAYS) {
    return {
      stage: 'firm',
      subject: `Second reminder: invoice ${invoice.number} is now overdue`,
      html: `<p>Hi ${client.name},</p><p>Invoice ${invoice.number} for ${amount} was due on ${invoice.due_date} and remains unpaid, now ${overdueDays} days overdue. Please arrange payment as soon as possible. The invoice is attached again for your convenience.</p>`,
    };
  }
  return {
    stage: 'soft',
    subject: `Payment reminder: invoice ${invoice.number}`,
    html: `<p>Hi ${client.name},</p><p>This is an automated reminder that invoice ${invoice.number} for ${amount} was due on ${invoice.due_date}. Please find it attached.</p>`,
  };
}

// Auto-reminds invoices that are overdue and haven't been reminded (manually
// or automatically) in the last 7 days, so this doesn't re-nag daily once a
// human has already sent one. Each reminder's wording escalates with how
// overdue the invoice currently is (see dunningContent() above) — the same
// 7-day cadence just means a client 20 days overdue gets the firmer stage
// on their next reminder rather than the soft one they got at day 6, with
// no extra state needed beyond the days-overdue calculation itself.
// Exported separately from the cron registration so it can be invoked
// directly (tests, or a future manual "run now" route).
async function runOverdueReminders() {
  if (!process.env.SMTP_HOST) {
    console.log('[reminders] SMTP not configured, skipping automated overdue reminders');
    return { sent: 0, skipped: true };
  }

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  // Match SQLite's datetime('now') format ("YYYY-MM-DD HH:MM:SS", no "T"/ms/"Z")
  // so the string comparison below actually reflects chronological order.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  const candidates = db
    .prepare(
      `SELECT * FROM invoices
       WHERE status = 'sent' AND amount_paid < total AND due_date < ?
         AND (last_reminder_sent_at IS NULL OR last_reminder_sent_at < ?)`,
    )
    .all(today(), sevenDaysAgo);

  let sent = 0;
  const reminded = [];
  for (const invoice of candidates) {
    try {
      const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id);
      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(invoice.id);
      const balanceDue = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
      const overdueDays = daysOverdue(invoice.due_date);
      const { stage, subject, html } = dunningContent({ invoice, client, settings, balanceDue, overdueDays });

      const buffer = await renderInvoicePdf({ invoice, client, items, settings });
      await sendMail({
        to: client.email,
        subject,
        html,
        attachments: [{ filename: `${invoice.number}.pdf`, content: buffer }],
      });

      db.prepare(`UPDATE invoices SET last_reminder_sent_at = datetime('now') WHERE id = ?`).run(invoice.id);
      logEmail({
        type: 'overdue_reminder',
        to: client.email,
        subject,
        sentByName: 'Automated',
        entityType: 'invoice',
        entityId: invoice.id,
        entityLabel: `${invoice.number} (${stage})`,
      });
      sent += 1;
      reminded.push({ number: invoice.number, clientName: client.name, balanceDue, dueDate: invoice.due_date, stage });
    } catch (err) {
      console.error(`[reminders] Failed to send reminder for invoice ${invoice.number}:`, err.message);
    }
  }

  console.log(`[reminders] Sent ${sent} automated overdue reminder(s)`);
  if (reminded.length > 0) await notifyStaffOfReminders(reminded, settings);
  return { sent, skipped: false };
}

// Optional per-user preference (Settings → My account): email a short daily
// digest to anyone who opted in, whenever the job above actually reminded at
// least one client. Best-effort — one recipient's send failing doesn't stop
// the others, and this never blocks or fails the reminder job itself.
async function notifyStaffOfReminders(reminded, settings) {
  const recipients = db.prepare('SELECT name, email FROM users WHERE active = 1 AND notify_overdue = 1').all();
  if (recipients.length === 0) return;

  const STAGE_LABELS = { soft: 'reminder', firm: 'firm reminder', final: 'FINAL NOTICE' };
  const rows = reminded
    .map(
      (r) =>
        `<li>${r.number} — ${r.clientName} — ${settings.currency_symbol}${r.balanceDue.toFixed(2)} (due ${r.dueDate}) — ${STAGE_LABELS[r.stage] || 'reminder'}</li>`,
    )
    .join('');
  const html = `<p>The automated overdue-reminder job just emailed ${reminded.length} client${reminded.length === 1 ? '' : 's'}:</p><ul>${rows}</ul>`;

  for (const recipient of recipients) {
    try {
      await sendMail({ to: recipient.email, subject: `${reminded.length} overdue reminder(s) sent today`, html });
    } catch (err) {
      console.error(`[reminders] Failed to send staff digest to ${recipient.email}:`, err.message);
    }
  }
}

// Same shape as runOverdueReminders() above: emails clients whose license
// is within the expiry-warning window (or already lapsed) and hasn't been
// reminded — manually or automatically — in the last 7 days. `14` here is
// routes/licenses.js's EXPIRY_WARNING_DAYS duplicated as a literal (same
// acceptable-duplication call as that file's own comment explains) — keep
// both in sync if the window ever changes. Licenses don't attach a PDF
// (there's no license document to render, unlike an invoice), just the
// templated reminder text.
async function runLicenseExpiryAlerts() {
  if (!process.env.SMTP_HOST) {
    console.log('[license-alerts] SMTP not configured, skipping automated license expiry alerts');
    return { sent: 0, skipped: true };
  }

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const warningDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const candidates = db
    .prepare(
      `SELECT licenses.*, clients.name AS client_name, clients.email AS client_email
       FROM licenses JOIN clients ON clients.id = licenses.client_id
       WHERE licenses.status = 'active' AND licenses.expiry_date <= ?
         AND (licenses.last_reminder_sent_at IS NULL OR licenses.last_reminder_sent_at < ?)`,
    )
    .all(warningDate, sevenDaysAgo);

  let sent = 0;
  for (const license of candidates) {
    try {
      const client = { name: license.client_name, email: license.client_email };
      const { subject, message } = licenseRemindEmail({ license, client, settings });
      await sendMail({ to: client.email, subject, html: textToHtml(message) });

      db.prepare(`UPDATE licenses SET last_reminder_sent_at = datetime('now') WHERE id = ?`).run(license.id);
      logEmail({ type: 'license_expiry_alert', to: client.email, subject, sentByName: 'Automated', entityType: 'license', entityId: license.id, entityLabel: license.name });
      sent += 1;
    } catch (err) {
      console.error(`[license-alerts] Failed to send expiry alert for license #${license.id}:`, err.message);
    }
  }

  console.log(`[license-alerts] Sent ${sent} automated license expiry alert(s)`);
  return { sent, skipped: false };
}

// `quotes.status` includes 'expired' as a valid, filterable value (see
// routes/quotes.js's PUT /:id validStatuses and Quotes.jsx's own
// STATUS_OPTIONS), but nothing else in the app ever sets it — there's no
// status field anywhere in QuoteForm.jsx/QuoteDetail.jsx, and the only
// other status transitions (sent → accepted/declined) happen via the
// client's public-link response or POST /:id/convert-to-invoice. Without
// this job, a quote that's past its expiry_date and was never responded to
// just stays 'sent' forever, and the "Expired" filter/StatusBadge/
// QuoteAnalytics breakdown can only ever show quotes brought in via CSV
// import with that status pre-set. Only 'sent' quotes are eligible — a
// 'draft' quote was never actually offered to a client, so there's nothing
// for it to have expired *on*, and 'accepted'/'declined'/already-'expired'
// quotes already have a real, final answer.
function expireOverdueQuotes() {
  const result = db
    .prepare(`UPDATE quotes SET status = 'expired', updated_at = datetime('now') WHERE status = 'sent' AND expiry_date IS NOT NULL AND expiry_date < ?`)
    .run(today());
  console.log(`[quotes] Auto-expired ${result.changes} quote(s) past their expiry date`);
  return { expired: result.changes };
}

function advanceDate(dateStr, frequency) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }

  const originalDay = d.getDate();
  if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly, the default

  // setMonth/setFullYear roll over into the following month when the
  // anchor day doesn't exist in the target month (e.g. Jan 31 -> Mar 3).
  // Clamp back to the target month's last day instead of drifting forward.
  if (d.getDate() !== originalDay) d.setDate(0);
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
  // Daily at 07:30, between the recurring-invoice job above and the
  // reminder jobs below — no SMTP dependency (this doesn't email anyone,
  // just a status flip), so it always runs regardless of mail config.
  cron.schedule('30 7 * * *', () => {
    try {
      expireOverdueQuotes();
    } catch (err) {
      console.error('[quotes] expire job failed:', err);
    }
  });
  // Daily at 08:00 server time.
  cron.schedule('0 8 * * *', () => {
    runOverdueReminders().catch((err) => console.error('[reminders] job failed:', err));
  });
  // Daily at 08:15, staggered a few minutes after the overdue-invoice job
  // above purely so the two jobs' console/log output don't interleave.
  cron.schedule('15 8 * * *', () => {
    runLicenseExpiryAlerts().catch((err) => console.error('[license-alerts] job failed:', err));
  });
  // Daily at 03:00 server time, ahead of the other jobs — see lib/backup.js.
  cron.schedule('0 3 * * *', () => {
    runBackup().catch((err) => console.error('[backup] job failed:', err));
  });
}

module.exports = {
  startScheduler,
  runOverdueReminders,
  generateDueRecurringInvoices,
  runLicenseExpiryAlerts,
  expireOverdueQuotes,
  runBackup,
};
