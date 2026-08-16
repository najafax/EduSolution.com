// The default subject/message for every client-facing email this app
// sends from a "Send"/"Remind"/"Email receipt" button. Kept in one place
// so the Send-preview endpoints (routes/quotes.js, routes/invoices.js) and
// the actual send routes always show/use the exact same default text —
// the preview endpoint calls the same function the send route falls back
// to when the caller doesn't override subject/message, so there's no
// second copy of this wording to drift out of sync.
function quoteSendEmail({ quote, client, settings, publicUrl }) {
  return {
    to: client.email,
    subject: `Quote ${quote.number} from ${settings.business_name || 'us'}`,
    message: `Hi ${client.name},\n\nPlease find attached quote ${quote.number} for your review.\n\nYou can also view it online and let us know your decision here: ${publicUrl}`,
  };
}

function invoiceSendEmail({ invoice, client, settings, publicUrl }) {
  return {
    to: client.email,
    subject: `Invoice ${invoice.number} from ${settings.business_name || 'us'}`,
    message: `Hi ${client.name},\n\nPlease find attached invoice ${invoice.number}, due ${invoice.due_date}.\n\nYou can also view it online here: ${publicUrl}`,
  };
}

function invoiceRemindEmail({ invoice, client, settings }) {
  return {
    to: client.email,
    subject: `Payment reminder: invoice ${invoice.number}`,
    message: `Hi ${client.name},\n\nThis is a reminder that invoice ${invoice.number} for ${settings.currency_symbol}${invoice.balance_due.toFixed(2)} was due on ${invoice.due_date}. Please find it attached.`,
  };
}

function receiptSendEmail({ payment, client, settings }) {
  return {
    to: client.email,
    subject: `Receipt ${payment.receipt_number} from ${settings.business_name || 'us'}`,
    message: `Hi ${client.name},\n\nThanks for your payment. Please find your receipt attached.`,
  };
}

module.exports = { quoteSendEmail, invoiceSendEmail, invoiceRemindEmail, receiptSendEmail };
