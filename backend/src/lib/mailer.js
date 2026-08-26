const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter !== undefined) return transporter;

  if (!process.env.SMTP_HOST) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

async function sendMail({ to, subject, html, attachments }) {
  const t = getTransporter();
  if (!t) {
    const error = new Error(
      'Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in backend/.env.',
    );
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    attachments,
  });
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const URL_RE = /(https?:\/\/[^\s<]+)/g;

// Converts the plain-text body a user edits in the Send-preview modal
// (routes/quotes.js, routes/invoices.js) into the HTML actually emailed.
// Escapes entities first so a literal '<'/'&' typed by the user can't
// break the markup, then auto-linkifies bare URLs (the public quote/
// invoice link is included as plain text in the default message — see
// lib/emailTemplates.js — so it needs to become clickable here rather
// than the caller having to hand-write an <a> tag), and turns blank-line-
// separated blocks into paragraphs with single newlines as <br>.
function textToHtml(text) {
  const paragraphs = String(text || '').trim().split(/\n\s*\n/).filter(Boolean);
  return paragraphs
    .map((p) => escapeHtml(p).replace(/\n/g, '<br>').replace(URL_RE, (url) => `<a href="${url}">${url}</a>`))
    .map((p) => `<p>${p}</p>`)
    .join('');
}

module.exports = { sendMail, textToHtml, escapeHtml };
