const db = require('../db');
const { sendMail } = require('./mailer');

// Optional per-user preference (MyAccount.jsx's notify_admin_changes,
// meaningful only for a super_admin account), same shape as
// lib/quoteAcceptedNotify.js's notifyStaffOfQuoteAccepted() — an internal
// staff digest, not a client-facing send, so it deliberately doesn't go
// through lib/emailTemplates.js's editable-template system and isn't
// recorded to email_log (same reasoning that file's own top-of-file note
// and notifyStaffOfReminders() both document). Called — never awaited,
// just fired with a `.catch()` — from routes/users.js's `POST /` and
// `PUT /:id`, only when the account being written either newly becomes
// admin-tier (a brand-new account created as admin/super_admin) or is
// promoted into admin-tier from staff. A role change between the two
// admin tiers (admin <-> super_admin) doesn't fire this — the account was
// already admin-tier before and after, so there's no *new* admin-tier
// access to flag. Best-effort: one recipient's send failing doesn't stop
// the others, and every recipient except the actor themselves gets it —
// notifying the person who just made the change would be noise, not a
// signal.
async function notifyOfAdminTierChange({ user, actorId, actorName, wasNew }) {
  if (!process.env.SMTP_HOST) return;

  const recipients = db
    .prepare("SELECT email FROM users WHERE active = 1 AND role = 'super_admin' AND notify_admin_changes = 1 AND id != ?")
    .all(actorId);
  if (recipients.length === 0) return;

  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const usersUrl = `${clientOrigin}/users`;
  const roleLabel = user.role === 'super_admin' ? 'super admin' : 'admin';
  const verb = wasNew ? 'created as' : 'promoted to';
  const subject = `${user.name} was ${verb} ${roleLabel}`;
  const html = `<p>${actorName} just ${wasNew ? 'created' : 'promoted'} <strong>${user.name}</strong> (${user.email}) ${wasNew ? 'as' : 'to'} <strong>${roleLabel}</strong>.</p><p><a href="${usersUrl}">Review the Users page</a> if this wasn't expected.</p>`;

  for (const { email } of recipients) {
    try {
      await sendMail({ to: email, subject, html });
    } catch (err) {
      console.error(`[admin-change] Failed to notify ${email}:`, err.message);
    }
  }
}

module.exports = { notifyOfAdminTierChange };
