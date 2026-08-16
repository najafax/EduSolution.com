const db = require('../db');

// The default subject/message for every client-facing email this app sends
// from a "Send"/"Remind"/"Email receipt" button — now admin-editable via the
// Email Center (routes/emailCenter.js), stored in the `email_templates`
// table (one row per `type`, primary-keyed on it) and rendered with
// {{placeholder}} substitution. A type with no stored row (the common case —
// nobody has customized it yet) falls back to the text below, so the app
// behaves identically out of the box. Every {{placeholder}} an admin might
// use is documented in PLACEHOLDERS below and shown in the Email Center UI;
// an unknown placeholder is left as literal text rather than silently
// blanked, so a typo is visible/debuggable instead of vanishing.
//
// This intentionally does NOT cover the automated overdue-reminder digest
// (lib/scheduler.js's runOverdueReminders()) — that email stays fully
// automatic and non-customizable by design (see CLAUDE.md); its sends are
// still recorded to the Email Center's sent log (lib/emailLog.js), just
// under a distinct, non-editable `overdue_reminder` type that never reads
// from this file.
const DEFAULT_TEMPLATES = {
  quote_send: {
    subject: 'Quote {{quote_number}} from {{business_name}}',
    message:
      'Hi {{client_name}},\n\nPlease find attached quote {{quote_number}} for your review.\n\nYou can also view it online and let us know your decision here: {{public_url}}',
  },
  invoice_send: {
    subject: 'Invoice {{invoice_number}} from {{business_name}}',
    message:
      'Hi {{client_name}},\n\nPlease find attached invoice {{invoice_number}}, due {{due_date}}.\n\nYou can also view it online here: {{public_url}}',
  },
  invoice_remind: {
    subject: 'Payment reminder: invoice {{invoice_number}}',
    message:
      'Hi {{client_name}},\n\nThis is a reminder that invoice {{invoice_number}} for {{balance_due}} was due on {{due_date}}. Please find it attached.',
  },
  receipt_send: {
    subject: 'Receipt {{receipt_number}} from {{business_name}}',
    message: 'Hi {{client_name}},\n\nThanks for your payment. Please find your receipt attached.',
  },
};

// Which placeholders are valid for each type, and a human label for the
// Email Center's "insert placeholder" hint list.
const PLACEHOLDERS = {
  quote_send: [
    { key: 'client_name', label: 'Client name' },
    { key: 'quote_number', label: 'Quote number' },
    { key: 'business_name', label: 'Business name' },
    { key: 'public_url', label: 'Public quote link' },
  ],
  invoice_send: [
    { key: 'client_name', label: 'Client name' },
    { key: 'invoice_number', label: 'Invoice number' },
    { key: 'due_date', label: 'Due date' },
    { key: 'business_name', label: 'Business name' },
    { key: 'public_url', label: 'Public invoice link' },
  ],
  invoice_remind: [
    { key: 'client_name', label: 'Client name' },
    { key: 'invoice_number', label: 'Invoice number' },
    { key: 'balance_due', label: 'Balance due' },
    { key: 'due_date', label: 'Due date' },
  ],
  receipt_send: [
    { key: 'client_name', label: 'Client name' },
    { key: 'receipt_number', label: 'Receipt number' },
    { key: 'business_name', label: 'Business name' },
  ],
};

const TYPE_LABELS = {
  quote_send: 'Quote sent',
  invoice_send: 'Invoice sent',
  invoice_remind: 'Payment reminder',
  receipt_send: 'Payment receipt',
};

function renderTemplate(str, vars) {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

function getStoredTemplate(type) {
  return db.prepare('SELECT subject, message FROM email_templates WHERE type = ?').get(type);
}

function buildEmail(type, to, vars) {
  const stored = getStoredTemplate(type);
  const template = stored || DEFAULT_TEMPLATES[type];
  return {
    to,
    subject: renderTemplate(template.subject, vars),
    message: renderTemplate(template.message, vars),
  };
}

function quoteSendEmail({ quote, client, settings, publicUrl }) {
  return buildEmail('quote_send', client.email, {
    client_name: client.name,
    quote_number: quote.number,
    business_name: settings.business_name || 'us',
    public_url: publicUrl,
  });
}

function invoiceSendEmail({ invoice, client, settings, publicUrl }) {
  return buildEmail('invoice_send', client.email, {
    client_name: client.name,
    invoice_number: invoice.number,
    due_date: invoice.due_date,
    business_name: settings.business_name || 'us',
    public_url: publicUrl,
  });
}

function invoiceRemindEmail({ invoice, client, settings }) {
  return buildEmail('invoice_remind', client.email, {
    client_name: client.name,
    invoice_number: invoice.number,
    balance_due: `${settings.currency_symbol}${invoice.balance_due.toFixed(2)}`,
    due_date: invoice.due_date,
  });
}

function receiptSendEmail({ payment, client, settings }) {
  return buildEmail('receipt_send', client.email, {
    client_name: client.name,
    receipt_number: payment.receipt_number,
    business_name: settings.business_name || 'us',
  });
}

// Admin management (routes/emailCenter.js). Returns every editable type with
// its currently-effective subject/message (stored override or default) plus
// `isCustom` so the frontend can show a "Reset to default" action only when
// there's actually a stored override to clear.
function getAllTemplates() {
  return Object.keys(DEFAULT_TEMPLATES).map((type) => {
    const stored = getStoredTemplate(type);
    return {
      type,
      label: TYPE_LABELS[type],
      placeholders: PLACEHOLDERS[type],
      subject: stored ? stored.subject : DEFAULT_TEMPLATES[type].subject,
      message: stored ? stored.message : DEFAULT_TEMPLATES[type].message,
      isCustom: Boolean(stored),
      defaultSubject: DEFAULT_TEMPLATES[type].subject,
      defaultMessage: DEFAULT_TEMPLATES[type].message,
    };
  });
}

function setTemplate(type, { subject, message }) {
  if (!DEFAULT_TEMPLATES[type]) {
    throw new Error(`Unknown email template type: ${type}`);
  }
  db.prepare(
    `INSERT INTO email_templates (type, subject, message, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(type) DO UPDATE SET subject = excluded.subject, message = excluded.message, updated_at = excluded.updated_at`,
  ).run(type, subject, message);
}

function resetTemplate(type) {
  if (!DEFAULT_TEMPLATES[type]) {
    throw new Error(`Unknown email template type: ${type}`);
  }
  db.prepare('DELETE FROM email_templates WHERE type = ?').run(type);
}

module.exports = {
  quoteSendEmail,
  invoiceSendEmail,
  invoiceRemindEmail,
  receiptSendEmail,
  getAllTemplates,
  setTemplate,
  resetTemplate,
};
