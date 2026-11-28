const db = require('../db');
const { escapeHtml } = require('./mailer');
const { publicProduct, imageIdsFor } = require('./shop');
const { money } = require('./shopNotify');

const THEMES = {
  ember: { bg: '#E8472B', bg2: '#B3260F', fg: '#FFFFFF', accent: '#FFD23F' },
  ocean: { bg: '#0B5FD6', bg2: '#06307A', fg: '#FFFFFF', accent: '#7DD3FC' },
  forest: { bg: '#0F7B4E', bg2: '#08452C', fg: '#FFFFFF', accent: '#FDE68A' },
  ink: { bg: '#10131A', bg2: '#000000', fg: '#FFFFFF', accent: '#FFD23F' },
};

function apiBase() {
  if (process.env.PUBLIC_API_URL) return process.env.PUBLIC_API_URL.replace(/\/+$/, '');
  const origin = (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '');
  return origin.replace('://www.', '://api.');
}

function shopBase() {
  return (process.env.SHOP_ORIGIN || 'https://shop.edusolutionsmv.com').replace(/\/+$/, '');
}

function endsLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Indian/Maldives',
  }).format(d);
}

// Table-based, inline-styled email with the promotion banner on top and up to
// four on-sale products below. Product pictures are plain <img> links to the
// public image endpoint (email clients load remote images; nothing is attached).
function renderPromoEmail(promo) {
  const t = THEMES[promo.theme] || THEMES.ember;
  const shop = shopBase();
  const link = `${shop}${promo.link_path && promo.link_path.startsWith('/') ? promo.link_path : '/sale'}`;
  const settings = db.prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get() || {};
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name FROM shop_products p
       LEFT JOIN shop_categories c ON c.id = p.category_id
       WHERE p.visible = 1 AND p.stock_status != 'out' AND p.sale_price IS NOT NULL AND p.sale_price > 0 AND p.sale_price < p.retail_price
       ORDER BY (1 - p.sale_price / p.retail_price) DESC LIMIT 4`,
    )
    .all();
  const imgs = imageIdsFor(rows.map((r) => r.id));
  const products = rows.map((r) => publicProduct(r, imgs.get(r.id) || [], now)).filter((p) => p.on_sale);
  const ends = endsLabel(promo.ends_at);

  const cards = products
    .map((p) => {
      const img = p.images[0] ? `${apiBase()}/api/public/shop/images/${p.images[0]}` : '';
      return (
        `<td width="50%" valign="top" style="padding:8px">` +
        `<a href="${shop}/product/${p.id}" style="text-decoration:none;color:#10131A">` +
        `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;background:#fff"><tr><td style="padding:12px;text-align:center">` +
        (img ? `<img src="${img}" alt="" width="160" style="max-width:100%;height:auto;border:0;display:block;margin:0 auto 8px">` : '') +
        `<div style="font:600 13px Arial,sans-serif;line-height:1.35;min-height:36px">${escapeHtml(p.name.slice(0, 70))}</div>` +
        `<div style="font:700 18px Arial,sans-serif;color:${t.bg};margin-top:6px">${money(p.price)}</div>` +
        `<div style="font:12px Arial,sans-serif;color:#6B7280"><s>${money(p.retail_price)}</s> &nbsp;<b style="color:${t.bg}">-${p.discount_percent}%</b></div>` +
        `</td></tr></table></a></td>`
      );
    })
    .reduce((acc, cell, i) => (i % 2 === 0 ? [...acc, [cell]] : [...acc.slice(0, -1), [...acc[acc.length - 1], cell]]), [])
    .map((pair) => `<tr>${pair.join('')}${pair.length === 1 ? '<td width="50%"></td>' : ''}</tr>`)
    .join('');

  const html =
    `<table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6"><tr><td align="center" style="padding:16px">` +
    `<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;font-family:Arial,sans-serif">` +
    `<tr><td style="background:${t.bg};background-image:linear-gradient(135deg,${t.bg},${t.bg2});padding:32px 28px;color:${t.fg}">` +
    `<span style="display:inline-block;background:${t.accent};color:#10131A;font:800 12px Arial,sans-serif;letter-spacing:1.5px;padding:6px 12px;border-radius:99px">${escapeHtml(promo.badge)}</span>` +
    `<div style="font:800 34px/1.1 Arial,sans-serif;margin:16px 0 8px;color:${t.fg}">${escapeHtml(promo.title)}</div>` +
    (promo.subtitle ? `<div style="font:16px/1.5 Arial,sans-serif;color:${t.fg};opacity:.92">${escapeHtml(promo.subtitle)}</div>` : '') +
    (ends ? `<div style="font:700 14px Arial,sans-serif;margin-top:14px;color:${t.accent}">Ends ${escapeHtml(ends)}</div>` : '') +
    `<div style="margin-top:22px"><a href="${link}" style="display:inline-block;background:#fff;color:${t.bg2};font:800 16px Arial,sans-serif;text-decoration:none;padding:14px 26px;border-radius:99px">${escapeHtml(promo.cta_label)} &rarr;</a></div>` +
    `</td></tr>` +
    (cards ? `<tr><td style="padding:12px 12px 4px"><table width="100%" cellpadding="0" cellspacing="0">${cards}</table></td></tr>` : '') +
    `<tr><td style="padding:8px 28px 28px;text-align:center"><a href="${link}" style="display:inline-block;background:#10131A;color:#fff;font:700 15px Arial,sans-serif;text-decoration:none;padding:13px 24px;border-radius:99px">See all offers</a></td></tr>` +
    `<tr><td style="background:#F9FAFB;padding:16px 28px;font:12px/1.5 Arial,sans-serif;color:#6B7280;text-align:center">` +
    `${escapeHtml(settings.shop_name || 'Edu Solutions Shop')} &middot; Delivery to the boat you choose.<br>You are receiving this because you are a customer of Edu Solutions. Reply to this email to stop receiving offers.</td></tr>` +
    `</table></td></tr></table>`;
  return { html, products: products.length };
}

module.exports = { renderPromoEmail, THEMES };
