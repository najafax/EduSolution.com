const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const MailComposer = require('nodemailer/lib/mail-composer');
const { sendOpsAlert } = require('./opsAlert');

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

// Gmail API over HTTPS (port 443), preferred over everything else when the
// three GMAIL_* values are set. Needed because the droplet blocks outbound
// SMTP (so Gmail's own SMTP can't be used) — the Gmail API never opens a
// raw SMTP connection. Sends as the authorised account; Gmail rewrites any
// other From address to it unless that address is a verified "send as" alias.
const gmailConfigured = () =>
  Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);

let gmailToken = null; // { value, expiresAt }
async function gmailAccessToken() {
  if (gmailToken && gmailToken.expiresAt > Date.now() + 60_000) return gmailToken.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(`Gmail authorisation failed: ${data.error_description || data.error || res.status}`);
    err.code = 'GMAIL_AUTH_ERROR';
    throw err;
  }
  gmailToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return gmailToken.value;
}

async function sendViaGmail({ from, to, subject, html, attachments, replyTo }) {
  const raw = await new MailComposer({ from, to, subject, html, attachments, ...(replyTo && { replyTo }) })
    .compile()
    .build();
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await gmailAccessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: raw.toString('base64url') }),
  });
  if (!res.ok) {
    if (res.status === 401) gmailToken = null;
    const data = await res.json().catch(() => ({}));
    const err = new Error(`Gmail failed to send the email: ${data.error?.message || res.status}`);
    err.code = 'GMAIL_SEND_ERROR';
    throw err;
  }
}

async function sendMail({ to, subject, html, attachments }) {
  const from = process.env.SMTP_FROM || process.env.GMAIL_FROM || process.env.SMTP_USER;
  const replyTo = replyToAddress();

  if (gmailConfigured()) {
    try {
      await sendViaGmail({ from, to, subject, html, attachments, replyTo });
    } catch (err) {
      // Gmail is the sole sender (no fallback): tell the operator, then let the caller see the failure.
      sendOpsAlert(
        `⚠️ Gmail send failed — client emails are NOT going out.\n${err.message}\nCheck the GMAIL_* settings / Google authorisation on the server.`,
        'gmail-send'
      );
      throw err;
    }
    return;
  }

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
      'Email is not configured. Set GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN, RESEND_API_KEY, or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in backend/.env.',
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
  return Boolean(gmailConfigured() || process.env.RESEND_API_KEY || process.env.SMTP_HOST);
}

module.exports = { sendMail, textToHtml, escapeHtml, isEmailConfigured };
