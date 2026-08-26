const { escapeHtml } = require('./mailer');

// The one client-facing email in this app whose body is a real designed
// HTML template rather than the usual admin-editable plain-text-through-
// textToHtml() pipeline (see lib/emailTemplates.js) — a renewal
// confirmation is a fixed structured summary (client/license/expiry/link),
// not prose an admin would want to freely rewrite, so it deliberately
// sits outside that system the same way the automated overdue-reminder
// digest does (see that file's own top-of-file note). `license.url`
// (routes/licenses.js) exists for exactly this — captured on the license
// form with no other reader anywhere in the app until now.
//
// Built with inline styles and a table-based layout (not flex/grid) for
// the widest possible email-client compatibility; the header's gradient
// is layered over a solid `background-color` fallback so a client that
// ignores `background-image` (older Outlook desktop) still shows the
// brand teal, just flat instead of gradient. Uses this app's own `lagoon`
// palette (see frontend/src/index.css) rather than inventing new colors.
const LAGOON_600 = '#0e7c86';
const LAGOON_400 = '#3fa9a6';
const LAGOON_700 = '#0b5a62';

function detailRow(label, value, { last = false, bold = false, color = '#0f172a' } = {}) {
  const border = last ? '' : 'border-bottom:1px solid #e2e8f0;';
  return `
    <tr>
      <td style="padding:12px 16px;background-color:#f8fafc;font-size:13px;font-weight:600;color:#64748b;width:38%;${border}">${escapeHtml(label)}</td>
      <td style="padding:12px 16px;font-size:14px;color:${color};font-weight:${bold ? '700' : '400'};${border}">${value}</td>
    </tr>`;
}

function renderLicenseRenewalEmail({ license, client, settings }) {
  const businessName = escapeHtml(settings.business_name || 'Us');
  const clientName = escapeHtml(client.name);
  const licenseName = escapeHtml(license.name);
  const symbol = settings.currency_symbol || '$';
  const cycleLabel = license.billing_cycle === 'monthly' ? 'Monthly' : 'Yearly';

  const rows = [
    detailRow('Client', clientName),
    detailRow('License', licenseName),
    detailRow('Billing cycle', cycleLabel),
    detailRow('Amount', `${symbol}${Number(license.amount).toFixed(2)}`),
  ];
  if (license.url) {
    const safeUrl = escapeHtml(license.url);
    rows.push(detailRow('Access link', `<a href="${safeUrl}" style="color:${LAGOON_600};">${safeUrl}</a>`));
  }
  rows.push(detailRow('New expiry date', escapeHtml(license.expiry_date), { last: true, bold: true, color: '#059669' }));

  const button = license.url
    ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
          <tr>
            <td style="border-radius:8px;background-color:${LAGOON_600};">
              <a href="${escapeHtml(license.url)}" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Access license</a>
            </td>
          </tr>
        </table>`
    : '';

  const footerBits = [settings.address, settings.phone, settings.email].filter(Boolean).map(escapeHtml).join(' &middot; ');

  const html = `
<div style="background-color:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
    <tr>
      <td style="background-color:${LAGOON_600};background-image:linear-gradient(135deg,${LAGOON_400},${LAGOON_700});border-radius:12px 12px 0 0;padding:32px 28px;">
        <span style="font-size:19px;font-weight:700;color:#ffffff;">${businessName}</span>
        <p style="margin:18px 0 0;font-size:24px;font-weight:800;color:#ffffff;">License Renewed</p>
      </td>
    </tr>
    <tr>
      <td style="padding:28px;">
        <p style="margin:0 0 16px;font-size:15px;color:#1e293b;">Dear Sir/Madam,</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#1e293b;">
          Your <strong>${licenseName}</strong> has been successfully renewed. Here are the details:
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;">
          ${rows.join('')}
        </table>
        ${button}
        <p style="margin:24px 0 0;font-size:14px;color:#475569;">Thank you for choosing <strong>${businessName}</strong>.</p>
      </td>
    </tr>
    ${
      footerBits
        ? `<tr>
      <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:16px 28px;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">${footerBits}</p>
      </td>
    </tr>`
        : ''
    }
  </table>
</div>`;

  return {
    to: client.email,
    subject: `${license.name} — renewal confirmed`,
    html,
  };
}

module.exports = { renderLicenseRenewalEmail };
