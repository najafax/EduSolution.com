const nodemailer = require('nodemailer');
const { Resend } = require('resend');

let transporter;
let resendClient;

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

// Resend's HTTPS API is preferred over raw SMTP whenever RESEND_API_KEY is
// set — some hosts (e.g. a DigitalOcean droplet) block outbound SMTP ports
// by default or reactively, which an HTTPS API call sidesteps entirely,
// since it never opens a raw SMTP connection at all. Falls back to the
// SMTP transporter above when RESEND_API_KEY isn't set, so a deployment
// that only has SMTP_* configured keeps working exactly as before.
function getResendClient() {
  if (resendClient !== undefined) return resendClient;
  resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  return resendClient;
}

// Where client replies land. The From address (SMTP_FROM) is often a
// send-only address, so replies are routed to a real inbox via Reply-To.
// Override with MAIL_REPLY_TO; set it to an empty value to disable.
const DEFAULT_REPLY_TO = 'info@edusolutionsmv.com';
function replyToAddress() {
  const v = process.env.MAIL_REPLY_TO;
  return v === undefined ? DEFAULT_REPLY_TO : v.trim() || undefined;
}

async function sendMail({ to, subject, html, attachments }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const replyTo = replyToAddress();
  const resend = getResendClient();

  if (resend) {
    const { error } = await resend.emails.send({ from, to, subject, html, attachments, ...(replyTo && { replyTo }) });
    if (error) {
      const err = new Error(error.message || 'Resend failed to send the email.');
      err.code = error.name || 'RESEND_ERROR';
      throw err;
    }
    return;
  }

  const t = getTransporter();
  if (!t) {
    const error = new Error(
      'Email is not configured. Set RESEND_API_KEY (preferred) or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in backend/.env.',
    );
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }

  await t.sendMail({ from, to, subject, html, attachments, ...(replyTo && { replyTo }) });
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

// True when ANY transport is configured (Resend's API key, or raw SMTP).
// The automated jobs and staff notifications gate on this rather than on
// SMTP_HOST alone: a deployment using Resend (as production does, since the
// droplet blocks outbound SMTP) has no SMTP_HOST, and gating on it silently
// disabled every automated email.
function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
}

module.exports = { sendMail, textToHtml, escapeHtml, isEmailConfigured };
