const PDFDocument = require('pdfkit');

const MARGIN = 50;
const CONTENT_WIDTH = 495;
const PAGE_BOTTOM = 770;

const COLORS = {
  brand: '#4338ca',
  heading: '#0f172a',
  body: '#334155',
  muted: '#94a3b8',
  border: '#e2e8f0',
  headerFill: '#eef2ff',
  rowAlt: '#f8fafc',
  positive: '#059669',
  negative: '#dc2626',
  stampInk: '#b91c1c',
};

function docToBuffer(doc, onBeforeEnd) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (onBeforeEnd) onBeforeEnd(doc);
    doc.end();
  });
}

function money(amount, symbol) {
  const formatted = Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${formatted}`;
}

function newDoc() {
  return new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
}

// Adds "Page X of Y" to every page. Only meaningful once all content is
// drawn, since page count isn't known until then — call right before
// doc.end() via docToBuffer's onBeforeEnd hook. Temporarily zeroes the
// bottom margin while drawing: pdfkit's auto page-break triggers whenever
// a text call's y falls past (page height - margins.bottom), and a footer
// living in that margin would otherwise silently spawn a blank extra page
// on every switchToPage() call.
// A thin running footer on every buffered page: a divider line, then the
// business's own name/address/phone/email (so a page is identifiable on
// its own — useful once a document runs past one page and pages can get
// separated) and, only when there's more than one page, "Page X of Y"
// underneath it. Not to be confused with drawThankYouFooter, which draws
// the "Thank You For Your Business!" line once inline in the document's
// normal content flow, not pinned to the bottom of every page.
function addPageFooter(doc, settings) {
  const range = doc.bufferedPageRange();
  const businessLine = [settings.business_name, settings.address, settings.phone, settings.email]
    .filter(Boolean)
    .join('   ·   ');
  if (!businessLine && range.count <= 1) return;

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const footerY = doc.page.height - 42;
    doc.moveTo(MARGIN, footerY).lineTo(MARGIN + CONTENT_WIDTH, footerY).strokeColor(COLORS.border).lineWidth(1).stroke();

    if (businessLine) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text(businessLine, MARGIN, footerY + 8, { width: CONTENT_WIDTH, align: 'center' });
    }
    if (range.count > 1) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN, footerY + (businessLine ? 19 : 8), { width: CONTENT_WIDTH, align: 'center' });
    }

    doc.page.margins.bottom = bottomMargin;
  }
}

// A double-ring "PAID" ink stamp with the date it was actually paid —
// styled to read as a genuine rubber-stamp impression (a bordered ring,
// red ink, a modest hand-stamped tilt) rather than a huge diagonal banner
// stretched across the whole page. Semi-transparent so it never fully
// obscures the content underneath. `target`, if given, centers the stamp
// there (renderInvoicePdf uses this to overlap the Balance Due amount);
// otherwise it falls back to the page center.
const PAID_STAMP_SCALE = 0.55;

function drawPaidStamp(doc, paidDate, target) {
  const s = PAID_STAMP_SCALE;
  const cx = target ? target.x : doc.page.width / 2;
  const cy = target ? target.y : doc.page.height / 2;
  const w = 200 * s;
  const h = 92 * s;
  const x = cx - w / 2;
  const y = cy - h / 2;

  doc.save();
  doc.rotate(-12, { origin: [cx, cy] });
  doc.opacity(0.4);

  doc.lineWidth(3 * s).strokeColor(COLORS.stampInk).roundedRect(x, y, w, h, 8 * s).stroke();
  doc.lineWidth(1).strokeColor(COLORS.stampInk).roundedRect(x + 6 * s, y + 6 * s, w - 12 * s, h - 12 * s, 5 * s).stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(30 * s)
    .fillColor(COLORS.stampInk)
    .text('PAID', x, y + 16 * s, { width: w, align: 'center', characterSpacing: 2 * s });

  if (paidDate) {
    doc.moveTo(x + 28 * s, y + 56 * s).lineTo(x + w - 28 * s, y + 56 * s).lineWidth(1).strokeColor(COLORS.stampInk).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(11 * s)
      .fillColor(COLORS.stampInk)
      .text(paidDate, x, y + 63 * s, { width: w, align: 'center', characterSpacing: 1 * s });
  }

  doc.restore();
}

function addPaidStamp(doc, paidDate, target) {
  // A specific target position only makes sense on the one page the amount
  // it's overlapping was actually drawn on — every-page placement (the
  // page-center fallback) still stamps each page, same as before.
  if (target && typeof target.pageIndex === 'number') {
    doc.switchToPage(target.pageIndex);
    drawPaidStamp(doc, paidDate, target);
    return;
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawPaidStamp(doc, paidDate);
  }
}

// business_settings.signature_image/stamp_image/logo_image (see
// routes/settings.js) are stored as data URIs — decode back to a Buffer
// PDFKit's doc.image() can embed. Returns null on anything malformed
// rather than throwing, so a stray bad value in storage degrades to "no
// image" instead of failing PDF generation entirely.
function decodeImageDataUri(dataUri) {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUri || '');
  return match ? Buffer.from(match[2], 'base64') : null;
}

// Small hand-drawn (not font/emoji-dependent) icons for the section labels
// below — PDFKit's built-in fonts have no icon glyphs, and pulling in an
// icon font just for three glyphs isn't worth the dependency. Each draws
// inside roughly an 11x11 box anchored at (x, y).
function drawClipboardIcon(doc, x, y, color) {
  doc.save();
  doc.lineWidth(1).strokeColor(color);
  doc.roundedRect(x, y + 2, 10, 11, 1.5).stroke();
  doc.roundedRect(x + 3, y, 4, 3, 1).fillColor(color).fill();
  doc.restore();
}

function drawPencilIcon(doc, x, y, color) {
  doc.save();
  doc.lineWidth(1.4).strokeColor(color).lineCap('round');
  doc.moveTo(x + 1, y + 11).lineTo(x + 9, y + 3).stroke();
  doc.moveTo(x + 1, y + 11).lineTo(x + 1, y + 8).lineTo(x + 4, y + 11).closePath().fillColor(color).fill();
  doc.restore();
}

function drawBankIcon(doc, x, y, color) {
  doc.save();
  doc.lineWidth(1).strokeColor(color).lineCap('round').lineJoin('round');
  doc.moveTo(x, y + 3).lineTo(x + 5, y).lineTo(x + 10, y + 3).stroke();
  doc.moveTo(x, y + 11).lineTo(x + 10, y + 11).stroke();
  [x + 1.5, x + 5, x + 8.5].forEach((cx) => doc.moveTo(cx, y + 4).lineTo(cx, y + 10).stroke());
  doc.restore();
}

const ICONS = { clipboard: drawClipboardIcon, pencil: drawPencilIcon, bank: drawBankIcon };

// Logo (if uploaded) + business name side by side, contact details below
// spanning the full width, a right-aligned title ("INVOICE"/"QUOTE"/
// "RECEIPT") with a label:value meta list underneath (Date, the document's
// own number, TIN, and who prepared it — each only shown when there's a
// value), and an accent-colored divider closing off the block. Heights are
// measured rather than assumed so a long business name/address or an extra
// meta row never overlaps the divider.
function drawHeader(doc, { title, numberLabel, number, dateValue, tin, preparedBy, settings }) {
  // Left column (logo/name/contact) must stay clear of the right column's
  // meta labels, which start at x=300 — cap it 10pt short of that rather
  // than letting a long business name/address run into "Invoice #" etc.
  const leftColumnWidth = 240;
  const logoBuffer = settings.logo_image ? decodeImageDataUri(settings.logo_image) : null;
  const logoSize = 46;
  const nameX = logoBuffer ? MARGIN + logoSize + 12 : MARGIN;
  const nameWidth = leftColumnWidth - (logoBuffer ? logoSize + 12 : 0);

  if (logoBuffer) doc.image(logoBuffer, MARGIN, 45, { fit: [logoSize, logoSize] });

  const businessName = settings.business_name || 'Your Business';
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.heading).text(businessName, nameX, 50, { width: nameWidth });
  const nameHeight = doc.heightOfString(businessName, { width: nameWidth });
  const row1Height = Math.max(logoBuffer ? logoSize : 0, nameHeight);

  const contactY = 45 + row1Height + 8;
  const contactLines = [settings.address, settings.phone, settings.email].filter(Boolean).join('\n');
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.body).text(contactLines, MARGIN, contactY, { width: leftColumnWidth });
  const contactHeight = contactLines ? doc.heightOfString(contactLines, { width: leftColumnWidth }) : 0;

  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.heading).text(title, 300, 45, { width: 245, align: 'right' });
  const titleHeight = doc.heightOfString(title, { width: 245 });

  const metaRows = [['Date', dateValue], [numberLabel, number]];
  if (tin) metaRows.push(['TIN', tin]);
  if (preparedBy) metaRows.push(['Prepared By', preparedBy]);

  const metaLabelWidth = 90;
  const metaValueWidth = 155;
  let metaY = 45 + titleHeight + 10;
  metaRows.forEach(([label, value]) => {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(label, 300, metaY, { width: metaLabelWidth });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.heading).text(value, 300 + metaLabelWidth, metaY, { width: metaValueWidth, align: 'right' });
    metaY += 15;
  });

  const dividerY = Math.max(contactY + contactHeight, metaY) + 12;
  doc.moveTo(MARGIN, dividerY).lineTo(MARGIN + CONTENT_WIDTH, dividerY).strokeColor(COLORS.brand).lineWidth(2).stroke();
  return dividerY + 24;
}

// "BILL TO" (with a small clipboard icon) and the client's details on the
// left; a single bold "<dueLabel>: <dueValue>" line right-aligned on the
// right, at the same starting height. Only used by quote/invoice — receipts
// keep the older drawInfoColumns layout below, since "who's this payment
// for" doesn't fit the bill-to/due-date shape.
function drawBillTo(doc, { client, dueLabel, dueValue }, y) {
  const leftWidth = 240;

  drawClipboardIcon(doc, MARGIN, y - 1, COLORS.brand);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.brand).text('BILL TO', MARGIN + 16, y);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.heading).text(client.name, MARGIN, y + 16, { width: leftWidth });
  const clientDetail = [client.email, client.address].filter(Boolean).join('\n');
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.body).text(clientDetail, MARGIN, y + 32, { width: leftWidth });
  const leftHeight = 32 + (clientDetail ? doc.heightOfString(clientDetail, { width: leftWidth }) : 0);

  if (dueValue) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.heading).text(`${dueLabel}: ${dueValue}`, 300, y, { width: 245, align: 'right' });
  }

  return y + Math.max(leftHeight, 16) + 24;
}

// Receipt-only variant kept from the previous layout: a left "BILL TO"
// block plus an arbitrary list of right-aligned label:value meta rows
// (payment date/invoice/method) rather than the single due-date line
// drawBillTo uses for quote/invoice.
function drawInfoColumns(doc, { client, metaRows }, y) {
  const leftX = MARGIN;
  const leftWidth = 240;
  const rightX = 320;
  const rightLabelWidth = 100;
  const rightValueWidth = 125;

  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('BILL TO', leftX, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.heading).text(client.name, leftX, y + 14, { width: leftWidth });
  const clientDetail = [client.email, client.address].filter(Boolean).join('\n');
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.body).text(clientDetail, leftX, y + 30, { width: leftWidth });
  const leftHeight = 30 + (clientDetail ? doc.heightOfString(clientDetail, { width: leftWidth }) : 0);

  let rowY = y;
  for (const [label, value] of metaRows) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(label, rightX, rowY, { width: rightLabelWidth });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.heading).text(value, rightX + rightLabelWidth, rowY, { width: rightValueWidth, align: 'right' });
    rowY += 16;
  }
  const rightHeight = rowY - y;

  return y + Math.max(leftHeight, rightHeight) + 24;
}

function drawTableHeader(doc, y) {
  doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fill(COLORS.headerFill);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.body);
  doc.text('#', MARGIN + 8, y + 7, { width: 20 });
  doc.text('DESCRIPTION', MARGIN + 32, y + 7);
  doc.text('QTY', MARGIN + 230, y + 7, { width: 45, align: 'right' });
  doc.text('RATE', MARGIN + 280, y + 7, { width: 70, align: 'right' });
  doc.text('TAX', MARGIN + 355, y + 7, { width: 45, align: 'right' });
  doc.text('AMOUNT', MARGIN + 405, y + 7, { width: 80, align: 'right' });
  return y + 22;
}

// Paginates: if a row would run past PAGE_BOTTOM, starts a new page and
// redraws the table header there, so long item lists never render off-page.
// taxRate is the document's single overall rate (see lib/totals.js — there's
// no per-line-item tax in this app's data model), repeated on every row
// since that's the rate each line item actually contributed to the total.
function drawItemsTable(doc, items, startY, symbol, taxRate) {
  let y = drawTableHeader(doc, startY);
  const taxLabel = taxRate ? `${taxRate}%` : '—';

  items.forEach((item, index) => {
    doc.font('Helvetica').fontSize(10);
    const rowHeight = Math.max(20, doc.heightOfString(item.description, { width: 195 }) + 10);

    if (y + rowHeight > PAGE_BOTTOM) {
      doc.addPage();
      y = drawTableHeader(doc, MARGIN);
    }

    if (index % 2 === 1) {
      doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(COLORS.rowAlt);
    }

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(String(index + 1), MARGIN + 8, y + 6, { width: 20 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.heading).text(item.description, MARGIN + 32, y + 6, { width: 195 });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(String(item.quantity), MARGIN + 230, y + 6, { width: 45, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(money(item.unit_price, symbol), MARGIN + 280, y + 6, { width: 70, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(taxLabel, MARGIN + 355, y + 6, { width: 45, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.heading).text(money(item.amount, symbol), MARGIN + 405, y + 6, { width: 80, align: 'right' });

    y += rowHeight;
  });

  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor(COLORS.border).stroke();
  return y + 16;
}

// Subtotal/discount/tax as plain rows, a divider, then the bold final
// figure: "Balance Due" for invoices (red while still owed, green once
// fully paid), "Total" for quotes (brand color — quotes have no paid
// state). "Total"/"Paid" rows only appear on an invoice that's actually
// received a payment; otherwise balance due already equals the total and a
// redundant pair of rows saying so twice adds nothing. Breaks to a new page
// if it wouldn't fit under the table.
// `info`, if passed, gets the on-page position of the final Balance
// Due/Total row written into it (info.balanceX/balanceY, plus the buffered
// page index it landed on) — renderInvoicePdf uses this to place the PAID
// stamp directly over the amount instead of at a fixed page-center spot.
function drawTotals(
  doc,
  { subtotal, discountType, discountValue, discountAmount, taxRate, taxAmount, total, amountPaid, balanceDue },
  y,
  symbol,
  info,
) {
  const boxX = 300;
  const boxWidth = 245;
  const isInvoice = amountPaid !== undefined;
  const rows = [['Subtotal', money(subtotal, symbol)]];
  if (discountAmount > 0) {
    const discountLabel = discountType === 'percentage' ? `Discount (${discountValue}%)` : 'Discount';
    rows.push([discountLabel, `-${money(discountAmount, symbol)}`]);
  }
  if (taxRate) rows.push([`Tax (${taxRate}%)`, money(taxAmount, symbol)]);
  if (isInvoice && amountPaid > 0) {
    rows.push(['Total', money(total, symbol)]);
    rows.push(['Paid', money(amountPaid, symbol)]);
  }

  const blockHeight = rows.length * 18 + 46;
  if (y + blockHeight > PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }

  let rowY = y;
  rows.forEach(([label, value]) => {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(label, boxX, rowY, { width: 130 });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.heading).text(value, boxX + 130, rowY, { width: 115, align: 'right' });
    rowY += 18;
  });

  rowY += 6;
  doc.moveTo(boxX, rowY).lineTo(boxX + boxWidth, rowY).strokeColor(COLORS.border).lineWidth(1).stroke();
  rowY += 12;

  const finalLabel = isInvoice ? 'Balance Due' : 'Total';
  const finalValue = isInvoice ? balanceDue : total;
  const finalColor = isInvoice ? (balanceDue > 0 ? COLORS.negative : COLORS.positive) : COLORS.brand;

  doc.font('Helvetica-Bold').fontSize(13).fillColor(finalColor).text(finalLabel, boxX, rowY, { width: 130 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(finalColor).text(money(finalValue, symbol), boxX + 130, rowY, { width: 115, align: 'right' });

  if (info) {
    info.balanceX = boxX + 130 + 115 / 2;
    info.balanceY = rowY + 8;
    const range = doc.bufferedPageRange();
    info.pageIndex = range.start + range.count - 1;
  }

  return rowY + 34;
}

// Measures the height a bordered icon+label+body box (see drawIconLabelBox)
// would need for the given body text, without drawing anything — so callers
// can page-break *before* drawing if it wouldn't fit.
function measureBoxHeight(doc, bodyText, width) {
  const padding = 12;
  const headerHeight = 20;
  doc.font('Helvetica').fontSize(9);
  const textHeight = doc.heightOfString(bodyText, { width: width - padding * 2 });
  return headerHeight + textHeight + padding * 2;
}

// The bordered rounded-rect box style shared by the Comments and Payments
// Payable To sections: an icon + bold brand-colored label along the top,
// body text below. Returns the height it drew at, matching
// measureBoxHeight's calculation for the same inputs.
function drawIconLabelBox(doc, { icon, label, bodyText, mutedBody }, x, width, y) {
  const padding = 12;
  const headerHeight = 20;
  const height = measureBoxHeight(doc, bodyText, width);

  doc.roundedRect(x, y, width, height, 6).strokeColor(COLORS.border).lineWidth(1).stroke();

  const iconFn = ICONS[icon];
  if (iconFn) iconFn(doc, x + padding, y + padding - 3, COLORS.brand);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.brand).text(label, x + padding + 16, y + padding - 2, { width: width - padding * 2 - 16 });

  doc.font('Helvetica').fontSize(9).fillColor(mutedBody ? COLORS.muted : COLORS.body).text(bodyText, x + padding, y + padding + headerHeight - 6, { width: width - padding * 2 });

  return height;
}

// Always rendered (unlike the old NOTES block, which was skipped entirely
// when empty) — matching the reference design's Comments box, which shows
// a "No additional comments" placeholder rather than disappearing.
function drawCommentsBox(doc, notes, y) {
  const text = notes || 'No additional comments';
  const height = measureBoxHeight(doc, text, CONTENT_WIDTH);
  if (y + height > PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }
  drawIconLabelBox(doc, { icon: 'pencil', label: 'COMMENTS', bodyText: text, mutedBody: !notes }, MARGIN, CONTENT_WIDTH, y);
  return y + height + 20;
}

// Deliberately narrower than the classic "3:1 cursive signature" box: at
// 150pt, a squarer signature (this one is ~1.2:1, not unusual) gets
// right-aligned (see align: 'right' below) with so much empty box to its
// left that the box's own edges — where the signing line and "Authorized
// Signature"/name text are drawn — end up nowhere near the actual ink,
// no matter where the box itself is positioned. Narrower means less
// wasted padding, so the visible signature, the line, and the stamp all
// end up close together without needing off-page coordinates to force it.
const SIGNATURE_BOX_WIDTH = 95;
const SIGNATURE_IMG_HEIGHT = 46;
const STAMP_BOX_SIZE = 55;
const STAMP_ROTATION_DEGREES = -20; // negative = anti-clockwise
// Rotating a square inflates its axis-aligned bounding box by (|cos|+|sin|)
// times its side — drawing the stamp at a plain STAMP_BOX_SIZE fit *before*
// rotating (the naive approach) made its actual on-page footprint
// noticeably bigger than STAMP_BOX_SIZE once rotated, tall enough to bleed
// past the signing line drawn below it. Shrinking the pre-rotation fit size
// by this factor makes the *rotated* bounding box come out to exactly
// STAMP_BOX_SIZE, matching what the rest of the layout math assumes.
const STAMP_ROTATION_RAD = (STAMP_ROTATION_DEGREES * Math.PI) / 180;
const STAMP_ROTATED_INFLATION = Math.abs(Math.cos(STAMP_ROTATION_RAD)) + Math.abs(Math.sin(STAMP_ROTATION_RAD));
const STAMP_FIT_SIZE = STAMP_BOX_SIZE / STAMP_ROTATED_INFLATION;
// Fixed clearance between the bottom of the signature/stamp artwork and the
// signing line — kept as its own constant (rather than derived from
// centering the stamp against the signature image's height, which is what
// left only ~1.5pt of margin before the rotation-footprint bug above) so
// the gap is deliberate and doesn't shrink to nothing if either image's
// box size changes later.
const STAMP_LINE_CLEARANCE = 8;
// Total downward extent of the block from `y`: signature image, the
// STAMP_LINE_CLEARANCE gap, then the line/caption/name text beneath it —
// used for page-break budgeting (drawSignatureAndPayment), so it only
// needs to cover the *downward* reach; the stamp's rotated artwork can
// extend a little above `y` too (it's drawn "stamped over" the signature),
// but that eats into the ≥20pt gap already left above this block, not this
// budget.
const SIGNATURE_BLOCK_HEIGHT = SIGNATURE_IMG_HEIGHT + STAMP_LINE_CLEARANCE + 16 + 11 + 6;

// An authorized-signature image over a signing line (with the signatory's
// printed name below it), and a company stamp, both centered on the same
// horizontal axis within a shared SIGNATURE_BOX_WIDTH-wide slot whose right
// edge lines up with `rightBound` — the caller decides where that is (e.g.
// the right edge of a narrower left-hand column, or the page's own right
// margin). Each image is fully independent and only drawn if its own
// business_settings field is set. When both are present, the stamp sits
// rotated 20° anti-clockwise directly over the signature's own center
// (drawn after it, so it's visually in front) — mirroring how a physical
// stamp is typically pressed over a signature, not off to one side of it.
function drawSignatureBlock(doc, settings, y, rightBound) {
  const slotX = rightBound - SIGNATURE_BOX_WIDTH;
  const slotCenterX = slotX + SIGNATURE_BOX_WIDTH / 2;

  if (settings.signature_image) {
    const buffer = decodeImageDataUri(settings.signature_image);
    // Centered both ways within its box — a signature squarer than this
    // wide/short box (common — most signatures aren't 3:1) shrinks to fit
    // the height and leaves empty space on either side; centering splits
    // that evenly rather than pushing all of it to one side, and keeps the
    // ink's own center at slotCenterX, same as the stamp below.
    if (buffer) doc.image(buffer, slotX, y, { fit: [SIGNATURE_BOX_WIDTH, SIGNATURE_IMG_HEIGHT], align: 'center', valign: 'center' });
  }

  // Fixed, deliberate gap below the signature image — not tied to the
  // stamp at all, so the line's position never depends on the stamp's own
  // (separately bottom-anchored, see below) placement.
  const lineY = y + SIGNATURE_IMG_HEIGHT + STAMP_LINE_CLEARANCE;

  if (settings.stamp_image) {
    const buffer = decodeImageDataUri(settings.stamp_image);
    if (buffer) {
      // Centered on slotCenterX — the same horizontal center the signature
      // ink is drawn around above — so the stamp lands over the ink itself
      // rather than off toward one edge of the box.
      const stampX = slotCenterX - STAMP_BOX_SIZE / 2;
      // Bottom-anchored STAMP_LINE_CLEARANCE above the line when there's a
      // signature (and therefore a line) to sit above; otherwise flush at
      // the top of the block, same as before.
      const stampY = settings.signature_image ? lineY - STAMP_LINE_CLEARANCE - STAMP_BOX_SIZE : y;
      const centerY = stampY + STAMP_BOX_SIZE / 2;
      const fitOffset = (STAMP_BOX_SIZE - STAMP_FIT_SIZE) / 2;
      doc.save();
      doc.rotate(STAMP_ROTATION_DEGREES, { origin: [slotCenterX, centerY] });
      doc.image(buffer, stampX + fitOffset, stampY + fitOffset, { fit: [STAMP_FIT_SIZE, STAMP_FIT_SIZE] });
      doc.restore();
    }
  }

  if (settings.signature_image) {
    doc.moveTo(slotX, lineY).lineTo(slotX + SIGNATURE_BOX_WIDTH, lineY).strokeColor(COLORS.border).lineWidth(1).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('Authorized Signature', slotX, lineY + 4, { width: SIGNATURE_BOX_WIDTH, align: 'center' });
    if (settings.signatory_name) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.heading).text(settings.signatory_name, slotX, lineY + 16, { width: SIGNATURE_BOX_WIDTH, align: 'center' });
    }
  }
}

// The signature block (left column) and a "PAYMENTS PAYABLE TO" box (right
// column) side by side. Either column is independently optional — a
// business with no signature/stamp uploaded yet just doesn't get that
// column, same for a quote (which never has bank details — see
// renderQuotePdf) or an invoice whose business_settings.bank_details is
// blank. Draws nothing at all if neither has anything to show.
function drawSignatureAndPayment(doc, { settings, bankDetails }, y) {
  const hasSig = Boolean(settings.signature_image || settings.stamp_image);
  const hasBank = Boolean(bankDetails);
  if (!hasSig && !hasBank) return y;

  const leftWidth = 210;
  const gap = 25;
  const rightX = MARGIN + leftWidth + gap;
  const rightWidth = MARGIN + CONTENT_WIDTH - rightX;

  const bankBoxHeight = hasBank ? measureBoxHeight(doc, bankDetails, rightWidth) : 0;
  const rowHeight = Math.max(hasSig ? SIGNATURE_BLOCK_HEIGHT : 0, bankBoxHeight);

  if (y + rowHeight > PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }

  // Anchors the signature slot flush at the page margin (slotX in
  // drawSignatureBlock ends up exactly MARGIN), matching BILL TO/Comments,
  // same as everywhere else on the page — regardless of whether one or
  // both of signature_image/stamp_image are set, since both are now
  // centered within the same SIGNATURE_BOX_WIDTH-wide slot rather than
  // needing extra width budgeted for a stamp overhanging past it. An
  // earlier attempt to nudge this ~1cm further left than MARGIN (to match
  // the Bank/Payments box's own visual weight) instead made the signature
  // line stick out past the page's left margin relative to every other
  // section — reverted in favor of staying flush with MARGIN like the rest
  // of the document.
  const sigRightBound = MARGIN + SIGNATURE_BOX_WIDTH;
  if (hasSig) drawSignatureBlock(doc, settings, y, sigRightBound);
  if (hasBank) drawIconLabelBox(doc, { icon: 'bank', label: 'PAYMENTS PAYABLE TO', bodyText: bankDetails }, rightX, rightWidth, y);

  return y + rowHeight + 20;
}

// Closing divider + centered "Thank You For Your Business!" + a contact
// line built from whichever of phone/email are set (skipped entirely if
// neither is).
function drawThankYouFooter(doc, settings, y) {
  if (y + 50 > PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor(COLORS.border).lineWidth(1).stroke();
  y += 16;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.brand).text('Thank You For Your Business!', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
  y += 20;

  const contact = [settings.phone, settings.email].filter(Boolean).join(' · ');
  if (contact) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(`Questions? Contact ${contact}`, MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
  }
}

// --- Minimal template ---------------------------------------------------
// A second, opt-in layout (business_settings.pdf_template, see
// routes/settings.js) for businesses that want a plainer document: black/
// gray text only, thin rules instead of filled boxes/zebra striping, and
// no logo/signature/stamp image compositing — just a text-only signature
// line with the signatory's printed name, since replicating the modern
// template's stamp-over-signature overlap math would be most of its
// complexity for a template whose whole point is to have less of it. Still
// shares every numeric/layout constant (MARGIN, CONTENT_WIDTH, PAGE_BOTTOM),
// money()/decodeImageDataUri()/docToBuffer(), and addPageFooter — only the
// drawing is different, not the page geometry or footer.
const MINIMAL_COLORS = {
  heading: '#111111',
  body: '#333333',
  muted: '#8a8a8a',
  border: '#cccccc',
};

function drawMinimalHeader(doc, { title, numberLabel, number, dateValue, tin, settings }) {
  const logoBuffer = settings.logo_image ? decodeImageDataUri(settings.logo_image) : null;
  const logoSize = 36;
  const nameX = logoBuffer ? MARGIN + logoSize + 10 : MARGIN;
  const nameWidth = 240 - (logoBuffer ? logoSize + 10 : 0);

  if (logoBuffer) doc.image(logoBuffer, MARGIN, 48, { fit: [logoSize, logoSize] });

  const businessName = settings.business_name || 'Your Business';
  doc.font('Helvetica-Bold').fontSize(15).fillColor(MINIMAL_COLORS.heading).text(businessName, nameX, 50, { width: nameWidth });
  const nameHeight = doc.heightOfString(businessName, { width: nameWidth });
  let y = 50 + Math.max(logoBuffer ? logoSize : 0, nameHeight) + 6;

  const contactLines = [settings.address, settings.phone, settings.email].filter(Boolean).join('  ·  ');
  if (contactLines) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MINIMAL_COLORS.muted).text(contactLines, MARGIN, y, { width: 240 });
    y += doc.heightOfString(contactLines, { width: 240 });
  }

  doc.font('Helvetica').fontSize(16).fillColor(MINIMAL_COLORS.heading).text(title, 300, 50, { width: 245, align: 'right' });
  const metaLabelWidth = 90;
  const metaValueWidth = 155;
  const metaRows = [[numberLabel, number], ['Date', dateValue]];
  if (tin) metaRows.push(['TIN', tin]);
  let metaY = 76;
  metaRows.forEach(([label, value]) => {
    doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.muted).text(label, 300, metaY, { width: metaLabelWidth });
    doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.heading).text(value, 300 + metaLabelWidth, metaY, { width: metaValueWidth, align: 'right' });
    metaY += 14;
  });

  const dividerY = Math.max(y, metaY) + 10;
  doc.moveTo(MARGIN, dividerY).lineTo(MARGIN + CONTENT_WIDTH, dividerY).strokeColor(MINIMAL_COLORS.border).lineWidth(0.75).stroke();
  return dividerY + 20;
}

function drawMinimalBillTo(doc, { client, dueLabel, dueValue }, y) {
  const leftWidth = 240;
  doc.font('Helvetica').fontSize(8.5).fillColor(MINIMAL_COLORS.muted).text('BILL TO', MARGIN, y);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(MINIMAL_COLORS.heading).text(client.name, MARGIN, y + 13, { width: leftWidth });
  const clientDetail = [client.email, client.address].filter(Boolean).join('\n');
  doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.body).text(clientDetail, MARGIN, y + 28, { width: leftWidth });
  const leftHeight = 28 + (clientDetail ? doc.heightOfString(clientDetail, { width: leftWidth }) : 0);

  if (dueValue) {
    doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.muted).text(dueLabel, 300, y, { width: 245, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(MINIMAL_COLORS.heading).text(dueValue, 300, y + 13, { width: 245, align: 'right' });
  }

  return y + Math.max(leftHeight, 26) + 20;
}

function drawMinimalInfoColumns(doc, { client, metaRows }, y) {
  const leftWidth = 240;
  const rightX = 320;

  doc.font('Helvetica').fontSize(8.5).fillColor(MINIMAL_COLORS.muted).text('BILL TO', MARGIN, y);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(MINIMAL_COLORS.heading).text(client.name, MARGIN, y + 13, { width: leftWidth });
  const clientDetail = [client.email, client.address].filter(Boolean).join('\n');
  doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.body).text(clientDetail, MARGIN, y + 28, { width: leftWidth });
  const leftHeight = 28 + (clientDetail ? doc.heightOfString(clientDetail, { width: leftWidth }) : 0);

  let rowY = y;
  for (const [label, value] of metaRows) {
    doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.muted).text(label, rightX, rowY, { width: 100 });
    doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.heading).text(value, rightX + 100, rowY, { width: 125, align: 'right' });
    rowY += 15;
  }
  const rightHeight = rowY - y;

  return y + Math.max(leftHeight, rightHeight) + 20;
}

function drawMinimalTableHeader(doc, y) {
  doc.font('Helvetica').fontSize(8).fillColor(MINIMAL_COLORS.muted);
  doc.text('DESCRIPTION', MARGIN, y, { width: 220 });
  doc.text('QTY', MARGIN + 230, y, { width: 45, align: 'right' });
  doc.text('RATE', MARGIN + 280, y, { width: 70, align: 'right' });
  doc.text('TAX', MARGIN + 355, y, { width: 45, align: 'right' });
  doc.text('AMOUNT', MARGIN + 405, y, { width: 80, align: 'right' });
  const lineY = y + 14;
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT_WIDTH, lineY).strokeColor(MINIMAL_COLORS.border).lineWidth(0.75).stroke();
  return lineY + 10;
}

function drawMinimalItemsTable(doc, items, startY, symbol, taxRate) {
  let y = drawMinimalTableHeader(doc, startY);
  const taxLabel = taxRate ? `${taxRate}%` : '—';

  items.forEach((item) => {
    doc.font('Helvetica').fontSize(9.5);
    const rowHeight = Math.max(18, doc.heightOfString(item.description, { width: 220 }) + 8);

    if (y + rowHeight > PAGE_BOTTOM) {
      doc.addPage();
      y = drawMinimalTableHeader(doc, MARGIN);
    }

    doc.font('Helvetica').fontSize(9.5).fillColor(MINIMAL_COLORS.heading).text(item.description, MARGIN, y, { width: 220 });
    doc.font('Helvetica').fontSize(9.5).fillColor(MINIMAL_COLORS.body).text(String(item.quantity), MARGIN + 230, y, { width: 45, align: 'right' });
    doc.font('Helvetica').fontSize(9.5).fillColor(MINIMAL_COLORS.body).text(money(item.unit_price, symbol), MARGIN + 280, y, { width: 70, align: 'right' });
    doc.font('Helvetica').fontSize(9.5).fillColor(MINIMAL_COLORS.body).text(taxLabel, MARGIN + 355, y, { width: 45, align: 'right' });
    doc.font('Helvetica').fontSize(9.5).fillColor(MINIMAL_COLORS.heading).text(money(item.amount, symbol), MARGIN + 405, y, { width: 80, align: 'right' });

    y += rowHeight;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor(MINIMAL_COLORS.border).lineWidth(0.5).stroke();
    y += 8;
  });

  return y + 8;
}

function drawMinimalTotals(
  doc,
  { subtotal, discountType, discountValue, discountAmount, taxRate, taxAmount, total, amountPaid, balanceDue },
  y,
  symbol,
  info,
) {
  const boxX = 300;
  const boxWidth = 245;
  const isInvoice = amountPaid !== undefined;
  const rows = [['Subtotal', money(subtotal, symbol)]];
  if (discountAmount > 0) {
    const discountLabel = discountType === 'percentage' ? `Discount (${discountValue}%)` : 'Discount';
    rows.push([discountLabel, `-${money(discountAmount, symbol)}`]);
  }
  if (taxRate) rows.push([`Tax (${taxRate}%)`, money(taxAmount, symbol)]);
  if (isInvoice && amountPaid > 0) {
    rows.push(['Total', money(total, symbol)]);
    rows.push(['Paid', money(amountPaid, symbol)]);
  }

  const blockHeight = rows.length * 16 + 44;
  if (y + blockHeight > PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }

  let rowY = y;
  rows.forEach(([label, value]) => {
    doc.font('Helvetica').fontSize(9.5).fillColor(MINIMAL_COLORS.body).text(label, boxX, rowY, { width: 130 });
    doc.font('Helvetica').fontSize(9.5).fillColor(MINIMAL_COLORS.heading).text(value, boxX + 130, rowY, { width: 115, align: 'right' });
    rowY += 16;
  });

  rowY += 4;
  doc.moveTo(boxX, rowY).lineTo(boxX + boxWidth, rowY).strokeColor(MINIMAL_COLORS.border).lineWidth(0.75).stroke();
  rowY += 10;

  const finalLabel = isInvoice ? 'Balance Due' : 'Total';
  const finalValue = isInvoice ? balanceDue : total;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(MINIMAL_COLORS.heading).text(finalLabel, boxX, rowY, { width: 130 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(MINIMAL_COLORS.heading).text(money(finalValue, symbol), boxX + 130, rowY, { width: 115, align: 'right' });

  if (info) {
    info.balanceX = boxX + 130 + 115 / 2;
    info.balanceY = rowY + 7;
    const range = doc.bufferedPageRange();
    info.pageIndex = range.start + range.count - 1;
  }

  return rowY + 30;
}

function drawMinimalNotes(doc, notes, y) {
  const text = notes || 'No additional comments';
  const labelHeight = 13;
  const bodyHeight = doc.font('Helvetica').fontSize(9.5).heightOfString(text, { width: CONTENT_WIDTH });
  const height = labelHeight + bodyHeight;
  if (y + height > PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }
  doc.font('Helvetica').fontSize(8.5).fillColor(MINIMAL_COLORS.muted).text('NOTES', MARGIN, y);
  doc.font('Helvetica').fontSize(9.5).fillColor(notes ? MINIMAL_COLORS.body : MINIMAL_COLORS.muted).text(text, MARGIN, y + labelHeight, { width: CONTENT_WIDTH });
  return y + height + 20;
}

function drawMinimalSignatureAndPayment(doc, { settings, bankDetails }, y) {
  const hasBank = Boolean(bankDetails);
  const hasSignatory = Boolean(settings.signatory_name);
  if (!hasBank && !hasSignatory) return y;

  const leftWidth = 210;
  const rightX = MARGIN + leftWidth + 25;
  const rightWidth = MARGIN + CONTENT_WIDTH - rightX;

  const bankHeight = hasBank ? 13 + doc.font('Helvetica').fontSize(9).heightOfString(bankDetails, { width: rightWidth }) : 0;
  const sigHeight = hasSignatory ? 50 : 0;
  const rowHeight = Math.max(sigHeight, bankHeight);

  if (y + rowHeight > PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }

  if (hasSignatory) {
    const lineY = y + 34;
    doc.moveTo(MARGIN, lineY).lineTo(MARGIN + leftWidth, lineY).strokeColor(MINIMAL_COLORS.border).lineWidth(0.75).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MINIMAL_COLORS.muted).text('Authorized Signature', MARGIN, lineY + 4, { width: leftWidth });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MINIMAL_COLORS.heading).text(settings.signatory_name, MARGIN, lineY + 16, { width: leftWidth });
  }
  if (hasBank) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MINIMAL_COLORS.muted).text('PAYMENT DETAILS', rightX, y);
    doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.body).text(bankDetails, rightX, y + 13, { width: rightWidth });
  }

  return y + rowHeight + 20;
}

function drawMinimalThankYouFooter(doc, settings, y) {
  if (y + 40 > PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor(MINIMAL_COLORS.border).lineWidth(0.75).stroke();
  y += 14;
  doc.font('Helvetica').fontSize(10).fillColor(MINIMAL_COLORS.body).text('Thank you for your business.', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
  y += 16;

  const contact = [settings.phone, settings.email].filter(Boolean).join(' · ');
  if (contact) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MINIMAL_COLORS.muted).text(`Questions? Contact ${contact}`, MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
  }
}

// A plain text "PAID" watermark, no ring/border — the minimal template's
// counterpart to drawPaidStamp above.
function drawMinimalPaidStamp(doc, paidDate, target) {
  const cx = target ? target.x : doc.page.width / 2;
  const cy = target ? target.y : doc.page.height / 2;
  const w = 130;

  doc.save();
  doc.rotate(-12, { origin: [cx, cy] });
  doc.opacity(0.35);
  doc.font('Helvetica-Bold').fontSize(24).fillColor(MINIMAL_COLORS.heading).text('PAID', cx - w / 2, cy - 18, { width: w, align: 'center', characterSpacing: 2 });
  if (paidDate) {
    doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.heading).text(paidDate, cx - w / 2, cy + 8, { width: w, align: 'center' });
  }
  doc.restore();
}

function addMinimalPaidStamp(doc, paidDate, target) {
  if (target && typeof target.pageIndex === 'number') {
    doc.switchToPage(target.pageIndex);
    drawMinimalPaidStamp(doc, paidDate, target);
    return;
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawMinimalPaidStamp(doc, paidDate);
  }
}

function renderQuotePdfMinimal({ quote, client, items, settings }) {
  const doc = newDoc();
  const symbol = settings.currency_symbol || '$';

  let y = drawMinimalHeader(doc, {
    title: 'QUOTE',
    numberLabel: 'Quote #',
    number: quote.number,
    dateValue: quote.issue_date,
    tin: settings.tax_id,
    settings,
  });
  y = drawMinimalBillTo(doc, { client, dueLabel: 'Expiry Date', dueValue: quote.expiry_date || '—' }, y);
  y = drawMinimalItemsTable(doc, items, y, symbol, quote.tax_rate);
  y = drawMinimalTotals(
    doc,
    {
      subtotal: quote.subtotal,
      discountType: quote.discount_type,
      discountValue: quote.discount_value,
      discountAmount: quote.discount_amount,
      taxRate: quote.tax_rate,
      taxAmount: quote.tax_amount,
      total: quote.total,
    },
    y,
    symbol,
  );
  y = drawMinimalNotes(doc, quote.notes, y);
  y = drawMinimalSignatureAndPayment(doc, { settings, bankDetails: '' }, y);
  drawMinimalThankYouFooter(doc, settings, y);

  return docToBuffer(doc, (d) => addPageFooter(d, settings));
}

function renderInvoicePdfMinimal({ invoice, client, items, settings, payments }) {
  const doc = newDoc();
  const symbol = settings.currency_symbol || '$';
  const balanceDue = invoice.total - invoice.amount_paid;
  const paidDate = payments && payments.length ? payments[payments.length - 1].paid_at : null;

  let y = drawMinimalHeader(doc, {
    title: 'INVOICE',
    numberLabel: 'Invoice #',
    number: invoice.number,
    dateValue: invoice.issue_date,
    tin: settings.tax_id,
    settings,
  });
  y = drawMinimalBillTo(doc, { client, dueLabel: 'Due Date', dueValue: invoice.due_date }, y);
  y = drawMinimalItemsTable(doc, items, y, symbol, invoice.tax_rate);
  const totalsInfo = {};
  y = drawMinimalTotals(
    doc,
    {
      subtotal: invoice.subtotal,
      discountType: invoice.discount_type,
      discountValue: invoice.discount_value,
      discountAmount: invoice.discount_amount,
      taxRate: invoice.tax_rate,
      taxAmount: invoice.tax_amount,
      total: invoice.total,
      amountPaid: invoice.amount_paid,
      balanceDue,
    },
    y,
    symbol,
    totalsInfo,
  );
  y = drawMinimalNotes(doc, invoice.notes, y);
  y = drawMinimalSignatureAndPayment(doc, { settings, bankDetails: settings.bank_details }, y);
  drawMinimalThankYouFooter(doc, settings, y);

  return docToBuffer(doc, (d) => {
    if (invoice.status === 'paid') {
      addMinimalPaidStamp(d, paidDate, { x: totalsInfo.balanceX, y: totalsInfo.balanceY, pageIndex: totalsInfo.pageIndex });
    }
    addPageFooter(d, settings);
  });
}

function renderReceiptPdfMinimal({ payment, invoice, client, settings }) {
  const doc = newDoc();
  const symbol = settings.currency_symbol || '$';

  let y = drawMinimalHeader(doc, {
    title: 'RECEIPT',
    numberLabel: 'Receipt #',
    number: payment.receipt_number,
    dateValue: payment.paid_at,
    tin: settings.tax_id,
    settings,
  });
  y = drawMinimalInfoColumns(doc, {
    client,
    metaRows: [
      ['Payment date', payment.paid_at],
      ['For invoice', invoice.number],
      ['Method', payment.method.replace('_', ' ').toUpperCase()],
    ],
  }, y);

  doc.font('Helvetica').fontSize(9).fillColor(MINIMAL_COLORS.muted).text('AMOUNT RECEIVED', MARGIN, y);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(MINIMAL_COLORS.heading).text(money(payment.amount, symbol), MARGIN, y + 14);
  y += 50;

  if (payment.reference) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MINIMAL_COLORS.muted).text('REFERENCE', MARGIN, y);
    doc.font('Helvetica').fontSize(9.5).fillColor(MINIMAL_COLORS.body).text(payment.reference, MARGIN, y + 13);
    y += 36;
  }
  if (payment.notes) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MINIMAL_COLORS.muted).text('NOTES', MARGIN, y);
    doc.font('Helvetica').fontSize(9.5).fillColor(MINIMAL_COLORS.body).text(payment.notes, MARGIN, y + 13, { width: CONTENT_WIDTH });
    y += 36 + doc.heightOfString(payment.notes, { width: CONTENT_WIDTH });
  }

  drawMinimalThankYouFooter(doc, settings, y + 10);

  return docToBuffer(doc, (d) => {
    addMinimalPaidStamp(d, payment.paid_at);
    addPageFooter(d, settings);
  });
}

function renderQuotePdf({ quote, client, items, settings }) {
  if (settings.pdf_template === 'minimal') return renderQuotePdfMinimal({ quote, client, items, settings });
  const doc = newDoc();
  const symbol = settings.currency_symbol || '$';

  let y = drawHeader(doc, {
    title: 'QUOTE',
    numberLabel: 'Quote #',
    number: quote.number,
    dateValue: quote.issue_date,
    tin: settings.tax_id,
    preparedBy: quote.created_by_name,
    settings,
  });
  y = drawBillTo(doc, { client, dueLabel: 'Expiry Date', dueValue: quote.expiry_date || '—' }, y);
  y = drawItemsTable(doc, items, y, symbol, quote.tax_rate);
  y = drawTotals(
    doc,
    {
      subtotal: quote.subtotal,
      discountType: quote.discount_type,
      discountValue: quote.discount_value,
      discountAmount: quote.discount_amount,
      taxRate: quote.tax_rate,
      taxAmount: quote.tax_amount,
      total: quote.total,
    },
    y,
    symbol,
  );
  y = drawCommentsBox(doc, quote.notes, y);
  y = drawSignatureAndPayment(doc, { settings, bankDetails: '' }, y);
  drawThankYouFooter(doc, settings, y);

  return docToBuffer(doc, (d) => addPageFooter(d, settings));
}

function renderInvoicePdf({ invoice, client, items, settings, payments }) {
  if (settings.pdf_template === 'minimal') return renderInvoicePdfMinimal({ invoice, client, items, settings, payments });
  const doc = newDoc();
  const symbol = settings.currency_symbol || '$';
  const balanceDue = invoice.total - invoice.amount_paid;
  // payments is ordered oldest-first (see routes/invoices.js's
  // getInvoiceWithItems), so the last entry is whichever payment most
  // recently pushed this invoice's balance to zero — the date printed on
  // the PAID stamp below.
  const paidDate = payments && payments.length ? payments[payments.length - 1].paid_at : null;

  let y = drawHeader(doc, {
    title: 'INVOICE',
    numberLabel: 'Invoice #',
    number: invoice.number,
    dateValue: invoice.issue_date,
    tin: settings.tax_id,
    preparedBy: invoice.created_by_name,
    settings,
  });
  y = drawBillTo(doc, { client, dueLabel: 'Due Date', dueValue: invoice.due_date }, y);
  y = drawItemsTable(doc, items, y, symbol, invoice.tax_rate);
  const totalsInfo = {};
  y = drawTotals(
    doc,
    {
      subtotal: invoice.subtotal,
      discountType: invoice.discount_type,
      discountValue: invoice.discount_value,
      discountAmount: invoice.discount_amount,
      taxRate: invoice.tax_rate,
      taxAmount: invoice.tax_amount,
      total: invoice.total,
      amountPaid: invoice.amount_paid,
      balanceDue,
    },
    y,
    symbol,
    totalsInfo,
  );
  y = drawCommentsBox(doc, invoice.notes, y);
  y = drawSignatureAndPayment(doc, { settings, bankDetails: settings.bank_details }, y);
  drawThankYouFooter(doc, settings, y);

  return docToBuffer(doc, (d) => {
    if (invoice.status === 'paid') {
      addPaidStamp(d, paidDate, { x: totalsInfo.balanceX, y: totalsInfo.balanceY, pageIndex: totalsInfo.pageIndex });
    }
    addPageFooter(d, settings);
  });
}

function renderReceiptPdf({ payment, invoice, client, settings }) {
  if (settings.pdf_template === 'minimal') return renderReceiptPdfMinimal({ payment, invoice, client, settings });
  const doc = newDoc();
  const symbol = settings.currency_symbol || '$';

  let y = drawHeader(doc, {
    title: 'RECEIPT',
    numberLabel: 'Receipt #',
    number: payment.receipt_number,
    dateValue: payment.paid_at,
    tin: settings.tax_id,
    preparedBy: '',
    settings,
  });
  y = drawInfoColumns(doc, {
    client,
    metaRows: [
      ['Payment date', payment.paid_at],
      ['For invoice', invoice.number],
      ['Method', payment.method.replace('_', ' ').toUpperCase()],
    ],
  }, y);

  doc.rect(MARGIN, y, CONTENT_WIDTH, 60).fill(COLORS.headerFill);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('AMOUNT RECEIVED', MARGIN + 16, y + 14);
  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.positive).text(money(payment.amount, symbol), MARGIN + 16, y + 28);
  y += 80;

  if (payment.reference) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('REFERENCE', MARGIN, y);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(payment.reference, MARGIN, y + 14);
    y += 40;
  }
  if (payment.notes) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('NOTES', MARGIN, y);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(payment.notes, MARGIN, y + 14, { width: CONTENT_WIDTH });
    y += 40 + doc.heightOfString(payment.notes, { width: CONTENT_WIDTH });
  }

  drawThankYouFooter(doc, settings, y + 10);

  return docToBuffer(doc, (d) => {
    addPaidStamp(d, payment.paid_at);
    addPageFooter(d, settings);
  });
}

module.exports = { renderQuotePdf, renderInvoicePdf, renderReceiptPdf };
