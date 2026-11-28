const { escapeHtml } = require('./mailer');

// Turns a staff member's plain-text Inbox signature into a styled, email-safe
// HTML block (table layout, inline styles only, no web fonts). The signature is
// still stored and edited as plain text; this only changes how it is sent.
//
// Layout it recognises (anything else falls back to small muted text):
//   Best regards,                         <- greeting (single line ending in a comma)
//
//   Hassan Najah                          <- name (bold)
//   Founder & CEO                         <- role (muted)
//   EDU SOLUTIONS PVT LTD                 <- company line (bold, brand blue)
//   Authorised EduPage partner · Maldives <- other lines (small, muted)
//
//   Phone / WhatsApp: +960 ...            <- "Label: value" contact rows
//   Email: info@...   Web: www....           (value becomes a tel:/mailto:/https link)
//
//   Smarter Schools Start Here.           <- tagline (italic)
//   Book a free demo: www.../contact      <- a "demo" line with a link becomes a button

const BRAND = '#1E40AF';
const INK = '#0F172A';
const MUTED = '#475569';
const FONT = 'Arial,Helvetica,sans-serif';
const COMPANY_RE = /\b(pvt|ltd|llc|inc|limited|company)\b/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/\S+|www\.\S+)$/i;
const PHONE_RE = /^\+?[\d\s().-]{6,}$/;

function linkFor(value) {
  const v = value.trim();
  if (EMAIL_RE.test(v)) return `<a href="mailto:${escapeHtml(v)}" style="color:${BRAND};text-decoration:none">${escapeHtml(v)}</a>`;
  if (URL_RE.test(v)) {
    const href = /^https?:/i.test(v) ? v : `https://${v}`;
    return `<a href="${escapeHtml(href)}" style="color:${BRAND};text-decoration:none">${escapeHtml(v)}</a>`;
  }
  if (PHONE_RE.test(v)) {
    return `<a href="tel:${escapeHtml(v.replace(/[^\d+]/g, ''))}" style="color:${INK};text-decoration:none">${escapeHtml(v)}</a>`;
  }
  return escapeHtml(v);
}

function hrefOf(value) {
  const v = value.trim();
  return /^https?:/i.test(v) ? v : `https://${v}`;
}

function renderSignatureHtml(signature, { origin } = {}) {
  const text = String(signature || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean)).filter((p) => p.length);

  let greeting = '';
  if (paragraphs.length && paragraphs[0].length === 1 && /,$/.test(paragraphs[0][0])) {
    greeting = paragraphs.shift()[0];
  }

  const identity = [];
  const contacts = [];
  const extras = []; // tagline / button lines
  let button = null;

  paragraphs.forEach((lines, idx) => {
    if (idx === 0) {
      lines.forEach((line, i) => {
        if (i === 0) identity.push(`<div style="font-size:16px;font-weight:bold;color:${INK}">${escapeHtml(line)}</div>`);
        else if (i === 1 && !COMPANY_RE.test(line) && line !== line.toUpperCase()) {
          identity.push(`<div style="font-size:13px;color:${MUTED}">${escapeHtml(line)}</div>`);
        } else if (COMPANY_RE.test(line) || line === line.toUpperCase()) {
          identity.push(`<div style="font-size:13px;font-weight:bold;color:${BRAND};margin-top:4px">${escapeHtml(line)}</div>`);
        } else {
          identity.push(`<div style="font-size:12px;color:${MUTED}">${escapeHtml(line)}</div>`);
        }
      });
      return;
    }
    lines.forEach((line) => {
      const demo = line.match(/^(.*demo.*?)\s*:?\s*(https?:\/\/\S+|www\.\S+)$/i);
      if (demo) {
        button = { label: demo[1].replace(/:$/, '').trim() || 'Book a demo', href: hrefOf(demo[2]) };
        return;
      }
      const kv = line.match(/^([^:]{1,30}):\s*(.+)$/);
      if (kv && (EMAIL_RE.test(kv[2].trim()) || URL_RE.test(kv[2].trim()) || PHONE_RE.test(kv[2].trim()) || idx === 1)) {
        contacts.push(`<span style="color:${MUTED}">${escapeHtml(kv[1])}</span>&nbsp; ${linkFor(kv[2])}`);
        return;
      }
      extras.push(`<span style="font-size:12px;font-style:italic;color:${MUTED}">${escapeHtml(line)}</span>`);
    });
  });

  const logo = origin
    ? `<td valign="top" style="padding-right:16px;border-right:3px solid ${BRAND}"><img src="${escapeHtml(origin.replace(/\/+$/, ''))}/logo-symbol.png" alt="" width="56" height="56" style="display:block;width:56px;height:56px;border:0"></td>`
    : '';
  const pad = origin ? 'padding-left:16px' : '';
  const contactHtml = contacts.length
    ? `<div style="font-size:13px;margin-top:8px;color:${INK};line-height:1.6">${contacts.join('<br>')}</div>`
    : '';

  const buttonHtml = button
    ? `<td style="background:#22C55E;border-radius:999px;padding:9px 18px"><a href="${escapeHtml(button.href)}" style="color:#052E16;font-size:13px;font-weight:bold;text-decoration:none;font-family:${FONT}">${escapeHtml(button.label)}</a></td>`
    : '';
  const extrasHtml = extras.length ? `<td style="${button ? 'padding-left:12px;' : ''}">${extras.join('<br>')}</td>` : '';
  const bottom = buttonHtml || extrasHtml
    ? `<tr><td style="padding-top:14px"><table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>${buttonHtml}${extrasHtml}</tr></table></td></tr>`
    : '';

  return (
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="font-family:${FONT};font-size:14px;line-height:1.5;color:${INK};margin-top:18px">` +
    (greeting ? `<tr><td style="padding-bottom:10px;color:${INK}">${escapeHtml(greeting)}</td></tr>` : '') +
    `<tr><td><table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>${logo}<td valign="top" style="${pad}">${identity.join('')}${contactHtml}</td></tr></table></td></tr>` +
    bottom +
    '</table>'
  );
}

module.exports = { renderSignatureHtml };
