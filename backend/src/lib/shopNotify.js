const db = require('../db');
const { sendMail, isEmailConfigured, escapeHtml } = require('./mailer');
const { splitEmails, EMAIL_RE } = require('./emails');

const money = (n) => `MVR ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const PAYMENT_LABELS = { cod: 'Cash on delivery', bank_transfer: 'Bank transfer', card: 'Card payment link' };

function itemsTable(items) {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(i.name)}<br><span style="color:#777;font-size:12px">${escapeHtml(i.sku)}</span></td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(i.amount)}</td></tr>`,
    )
    .join('');
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>`;
}

// Best-effort, never blocks or fails the order. Customer gets a confirmation
// (when they gave an email); staff get a heads-up.
async function notifyNewOrder(order, items) {
  if (!isEmailConfigured()) return;
  const settings = db.prepare('SELECT * FROM shop_settings WHERE id = 1').get() || {};
  const shop = settings.shop_name || 'Edu Solutions Shop';
  const origin = process.env.SHOP_ORIGIN || process.env.CLIENT_ORIGIN || '';
  const trackUrl = `${origin}/order/${order.public_token}`;

  if (order.email && EMAIL_RE.test(order.email)) {
    let payment = `<p>Payment: <b>${escapeHtml(PAYMENT_LABELS[order.payment_method] || order.payment_method)}</b>.</p>`;
    if (order.payment_method === 'bank_transfer') {
      const bank = settings.bank_details || (db.prepare('SELECT bank_details FROM business_settings WHERE id = 1').get() || {}).bank_details || '';
      if (bank) payment += `<p>Please transfer to:<br><span style="white-space:pre-line">${escapeHtml(bank)}</span><br>Reference: <b>${escapeHtml(order.number)}</b></p>`;
    }
    if (order.payment_method === 'card') payment += '<p>We will send you a secure card payment link shortly.</p>';
    try {
      await sendMail({
        to: order.email,
        subject: `Order ${order.number} received — ${shop}`,
        html:
          `<p>Hello ${escapeHtml(order.customer_name)},</p>` +
          `<p>Thank you for your order. We have it and will confirm availability and delivery shortly.</p>` +
          itemsTable(items) +
          `<p style="font-size:16px"><b>Total: ${money(order.total)}</b></p>${payment}` +
          `<p>Deliver to: ${escapeHtml(order.island)}${order.boat ? ` — boat: ${escapeHtml(order.boat)}` : ''}</p>` +
          (origin ? `<p><a href="${trackUrl}">Track your order</a></p>` : '') +
          `<p>— ${escapeHtml(shop)}</p>`,
      });
    } catch (err) {
      console.error('[shop] customer confirmation failed:', err.message);
    }
  }

  const fromSettings = splitEmails(settings.notify_email || '').filter((e) => EMAIL_RE.test(e));
  const recipients = fromSettings.length
    ? fromSettings
    : db.prepare('SELECT email FROM users WHERE active = 1 AND notify_enquiries = 1').all().map((r) => r.email);
  if (recipients.length === 0) return;
  const staffUrl = `${process.env.CLIENT_ORIGIN || ''}/shop?tab=orders`;
  for (const to of recipients) {
    try {
      await sendMail({
        to,
        subject: `New shop order ${order.number} — ${money(order.total)}`,
        html:
          `<p>New order <b>${escapeHtml(order.number)}</b> from <b>${escapeHtml(order.customer_name)}</b> (${escapeHtml(order.phone)}).</p>` +
          itemsTable(items) +
          `<p>Total <b>${money(order.total)}</b> · ${escapeHtml(PAYMENT_LABELS[order.payment_method] || order.payment_method)}</p>` +
          `<p>Deliver to ${escapeHtml(order.island)}${order.boat ? `, boat ${escapeHtml(order.boat)}` : ''}.<br>${escapeHtml(order.address)}</p>` +
          (order.notes ? `<p>Notes: ${escapeHtml(order.notes)}</p>` : '') +
          `<p><a href="${staffUrl}">Open orders</a></p>`,
      });
    } catch (err) {
      console.error('[shop] staff notification failed:', err.message);
    }
  }
}

module.exports = { notifyNewOrder, money, PAYMENT_LABELS };
