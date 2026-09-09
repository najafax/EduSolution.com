// The automated "how'd we do yesterday" email sent to every active
// shareholder (routes/shareholders.js) — built as its own small module
// (not inlined into lib/scheduler.js) since routes/shareholders.js's own
// manual "Send report now" action needs to call the exact same function
// the cron job does, and requiring scheduler.js from a route file would
// pull in node-cron's own registration side effects for no reason.
const db = require('../db');
const { sendMail, textToHtml } = require('./mailer');
const { renderDailyEarningsPdf } = require('./reportPdf');
const { shareholderDailyEarningsEmail } = require('./emailTemplates');
const { logEmail } = require('./emailLog');
const { logActivity } = require('./activity');
// computeSummary() is routes/financials.js's own GET /summary computation,
// exported for exactly this kind of in-process reuse (routes/dashboard.js
// already calls it the same way) — called with no from/to here so it
// returns its own unfiltered/"as of today" bankBalance, the running
// balance at the moment this report actually renders (see its own note on
// why that's a different instant than `dateStr` below, which is always
// yesterday's date by the time this runs).
const { computeSummary } = require('../routes/financials');

// Payments/expenses recorded against yesterday's date — the job runs at
// 08:30 Maldives time (see lib/scheduler.js), so "today" has barely started
// and has essentially no data of its own yet; reporting on the
// just-completed day is the only reading that makes sense, the same
// "previous period" framing runMonthlyReport() already uses for the month
// before it.
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function computeDailyEarnings(dateStr) {
  const payments = db
    .prepare(
      `SELECT p.id, p.receipt_number, p.amount, p.method, i.number AS invoice_number, c.name AS client_name
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN clients c ON c.id = i.client_id
       WHERE date(p.paid_at) = ?
       ORDER BY p.paid_at`,
    )
    .all(dateStr);
  const totalReceived = Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;

  const expenses = db.prepare('SELECT * FROM expenses WHERE expense_date = ? ORDER BY category').all(dateStr);
  const totalExpenses = Math.round(expenses.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;

  const netEarning = Math.round((totalReceived - totalExpenses) * 100) / 100;

  return { date: dateStr, payments, totalReceived, expenses, totalExpenses, netEarning };
}

// `dateStr` defaults to yesterday (the cron job's own use) but is
// overridable so this stays testable/re-runnable for a specific date —
// the manual "Send report now" button (routes/shareholders.js) always
// calls this with no argument, matching the cron job exactly.
async function runDailyEarningsReport(dateStr = yesterday()) {
  if (!process.env.SMTP_HOST) {
    console.log('[daily-earnings] SMTP not configured, skipping');
    return { sent: 0, skipped: true, reason: 'smtp_not_configured' };
  }

  const { date, payments, totalReceived, expenses, totalExpenses, netEarning } = computeDailyEarnings(dateStr);

  // "If any earning is received only" — a day with zero payments received
  // sends nothing at all, regardless of expenses recorded, so a quiet day
  // doesn't put an empty/negative-looking report in every shareholder's
  // inbox.
  if (totalReceived <= 0) {
    console.log(`[daily-earnings] No payments received on ${date}, skipping`);
    return { sent: 0, skipped: true, reason: 'no_earnings' };
  }

  const shareholders = db.prepare('SELECT * FROM shareholders WHERE active = 1').all();
  if (shareholders.length === 0) {
    console.log('[daily-earnings] No active shareholders, skipping');
    return { sent: 0, skipped: true, reason: 'no_recipients' };
  }

  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const { bankBalance } = computeSummary();

  let buffer;
  try {
    buffer = await renderDailyEarningsPdf({ date, payments, totalReceived, expenses, totalExpenses, bankBalance, settings });
  } catch (err) {
    console.error('[daily-earnings] Failed to render PDF:', err.message);
    return { sent: 0, skipped: false, error: true };
  }

  let sent = 0;
  for (const shareholder of shareholders) {
    try {
      const { subject, message } = shareholderDailyEarningsEmail({
        shareholder,
        settings,
        date,
        totalReceived,
        totalExpenses,
        netEarning,
      });
      await sendMail({
        to: shareholder.email,
        subject,
        html: textToHtml(message),
        attachments: [{ filename: `daily-earnings-${date}.pdf`, content: buffer }],
      });
      logEmail({
        type: 'shareholder_daily_earnings',
        to: shareholder.email,
        subject,
        sentByName: 'Automated',
        entityType: 'shareholder',
        entityId: shareholder.id,
        entityLabel: `${shareholder.name} (${date})`,
      });
      sent += 1;
    } catch (err) {
      console.error(`[daily-earnings] Failed to send to ${shareholder.email}:`, err.message);
    }
  }

  if (sent > 0) {
    logActivity({
      userName: 'Automated',
      action: 'sent daily earnings report to',
      entityType: 'shareholder',
      entityId: null,
      entityLabel: `${sent} shareholder(s) for ${date}`,
    });
  }

  console.log(`[daily-earnings] Sent ${sent} daily earnings email(s) for ${date}`);
  return { sent, skipped: false, date, totalReceived, totalExpenses, netEarning };
}

module.exports = { computeDailyEarnings, runDailyEarningsReport };
