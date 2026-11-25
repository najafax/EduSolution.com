const db = require('../db');
const { sendMail, isEmailConfigured, escapeHtml } = require('./mailer');

const INTERESTS = {
  edupage: 'EduPage',
  business_suite: 'Business Suite',
  both: 'Both',
  unsure: 'Not sure yet',
};

// Cloudflare Turnstile is optional: with TURNSTILE_SECRET_KEY unset the form
// relies on the honeypot, the minimum-fill-time check, per-IP and per-address
// rate limits. Set both TURNSTILE_SITE_KEY (served to the page) and
// TURNSTILE_SECRET_KEY to switch the challenge on.
function turnstileEnabled() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY);
}

async function verifyTurnstile(token, ip) {
  if (!turnstileEnabled()) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: String(token) });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const json = await res.json();
    return Boolean(json && json.success);
  } catch (err) {
    console.error('turnstile verify failed', err.message);
    return false;
  }
}

// Both mails are best-effort and never block or fail the submission.
async function notifyEnquiry(enquiry) {
  if (!isEmailConfigured()) return;
  const settings = db.prepare('SELECT business_name FROM business_settings WHERE id = 1').get() || {};
  const business = settings.business_name || 'Edu Solutions';
  const interest = INTERESTS[enquiry.interest] || INTERESTS.unsure;

  try {
    await sendMail({
      to: enquiry.email,
      subject: `We received your request — ${business}`,
      html:
        `<p>Hello ${escapeHtml(enquiry.name)},</p>` +
        `<p>Thank you for asking about a walkthrough. We have your request and will contact you within one working day to agree a time.</p>` +
        `<p style="color:#666">Your message:<br>${escapeHtml(enquiry.message || '(none)').replace(/\n/g, '<br>')}</p>` +
        `<p>— ${escapeHtml(business)}</p>`,
    });
  } catch (err) {
    console.error('[enquiry] confirmation email failed:', err.message);
  }

  const recipients = db.prepare('SELECT email FROM users WHERE active = 1 AND notify_enquiries = 1').all();
  if (recipients.length === 0) return;
  const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const html =
    `<p>New website enquiry from <b>${escapeHtml(enquiry.name)}</b>` +
    `${enquiry.organisation ? ` (${escapeHtml(enquiry.organisation)})` : ''}.</p>` +
    `<p>Interested in: ${escapeHtml(interest)}<br>Email: ${escapeHtml(enquiry.email)}` +
    `${enquiry.phone ? `<br>Phone: ${escapeHtml(enquiry.phone)}` : ''}</p>` +
    `${enquiry.message ? `<p>${escapeHtml(enquiry.message).replace(/\n/g, '<br>')}</p>` : ''}` +
    `<p><a href="${origin}/website-content?tab=enquiries">Open enquiries</a></p>`;
  for (const { email } of recipients) {
    try {
      await sendMail({ to: email, subject: `New enquiry: ${enquiry.name}`, html });
    } catch (err) {
      console.error(`[enquiry] Failed to notify ${email}:`, err.message);
    }
  }
}

module.exports = { INTERESTS, turnstileEnabled, verifyTurnstile, notifyEnquiry };
