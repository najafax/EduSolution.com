const db = require('../db');

// Records every client-facing email this app actually sends — the Email
// Center's "Sent log" (routes/emailCenter.js) reads this table. Distinct
// from lib/activity.js's activity_log: that's a general "who did what"
// audit trail and doesn't capture recipient/subject, and it already logs a
// separate "sent"/"sent reminder for" entry per action — this is additive,
// not a replacement. Called after a successful sendMail() only, from each
// manual send route (routes/quotes.js, routes/invoices.js) and from the
// automated overdue-reminder job (lib/scheduler.js), so a failed send is
// never recorded as sent.
function logEmail({ type, to, subject, sentByName = '', entityType = null, entityId = null, entityLabel = '' }) {
  db.prepare(
    `INSERT INTO email_log (type, to_email, subject, sent_by_name, entity_type, entity_id, entity_label)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(type, to, subject, sentByName, entityType, entityId, entityLabel);
}

module.exports = { logEmail };
