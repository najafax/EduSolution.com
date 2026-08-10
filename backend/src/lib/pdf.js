const PDFDocument = require('pdfkit');

const MARGIN = 50;
const CONTENT_WIDTH = 495;
const PAGE_BOTTOM = 770;

const COLORS = {
  brand: '#4f46e5',
  heading: '#0f172a',
  body: '#334155',
  muted: '#94a3b8',
  border: '#e2e8f0',
  headerFill: '#eef2ff',
  rowAlt: '#f8fafc',
  positive: '#059669',
  negative: '#dc2626',
};

const STATUS_COLORS = {
  paid: COLORS.positive,
  accepted: COLORS.positive,
  overdue: COLORS.negative,
  declined: COLORS.negative,
  void: COLORS.negative,
  sent: COLORS.brand,
  draft: COLORS.muted,
  expired: '#d97706',
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
function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  if (range.count <= 1) return;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN, doc.page.height - 30, { width: CONTENT_WIDTH, align: 'center' });
    doc.page.margins.bottom = bottomMargin;
  }
}

// Large translucent diagonal "PAID" watermark across the page center —
// low opacity so it never obscures the content underneath, drawn on every
// buffered page (via addPaidStamp) so it survives pagination too.
function drawPaidStamp(doc) {
  const cx = doc.page.width / 2;
  const cy = doc.page.height / 2;

  doc.save();
  doc.rotate(-30, { origin: [cx, cy] });
  doc.opacity(0.15);
  doc.lineWidth(4).strokeColor(COLORS.positive).rect(cx - 160, cy - 45, 320, 90).stroke();
  doc.fontSize(56).fillColor(COLORS.positive).text('PAID', cx - 160, cy - 32, { width: 320, align: 'center' });
  doc.restore();
}

function addPaidStamp(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawPaidStamp(doc);
  }
}

function drawHeader(doc, { title, number, settings }) {
  const nameWidth = 230;
  const businessName = settings.business_name || 'Your Business';
  doc.fontSize(20).fillColor(COLORS.brand).text(businessName, MARGIN, 50, { width: nameWidth });
  const nameHeight = doc.heightOfString(businessName, { width: nameWidth });

  const contactY = 50 + nameHeight + 6;
  const contactLines = [settings.address, settings.email, settings.phone, settings.tax_id ? `Tax ID: ${settings.tax_id}` : '']
    .filter(Boolean)
    .join('\n');
  doc.fontSize(9).fillColor(COLORS.body).text(contactLines, MARGIN, contactY, { width: 260 });

  doc.fontSize(24).fillColor(COLORS.heading).text(title, 300, 50, { width: 245, align: 'right' });
  doc.fontSize(10).fillColor(COLORS.body).text(number, 300, 80, { width: 245, align: 'right' });

  const contactHeight = contactLines ? doc.heightOfString(contactLines, { width: 260 }) : 0;
  const dividerY = Math.max(contactY + contactHeight, 100) + 12;
  doc.moveTo(MARGIN, dividerY).lineTo(MARGIN + CONTENT_WIDTH, dividerY).strokeColor(COLORS.border).lineWidth(1).stroke();
  return dividerY + 24;
}

// Bill-to details (left) and issue/due/status meta (right), side by side.
// Heights are measured rather than assumed, so a long address or an extra
// meta row can never overlap the items table below it.
function drawInfoColumns(doc, { client, metaRows }, y) {
  const leftX = MARGIN;
  const leftWidth = 240;
  const rightX = 320;
  const rightLabelWidth = 100;
  const rightValueWidth = 125;

  doc.fontSize(9).fillColor(COLORS.muted).text('BILL TO', leftX, y);
  doc.fontSize(11).fillColor(COLORS.heading).text(client.name, leftX, y + 14, { width: leftWidth });
  const clientDetail = [client.email, client.address].filter(Boolean).join('\n');
  doc.fontSize(9).fillColor(COLORS.body).text(clientDetail, leftX, y + 30, { width: leftWidth });
  const leftHeight = 30 + (clientDetail ? doc.heightOfString(clientDetail, { width: leftWidth }) : 0);

  let rowY = y;
  for (const [label, value, color] of metaRows) {
    doc.fontSize(9).fillColor(COLORS.muted).text(label, rightX, rowY, { width: rightLabelWidth });
    doc
      .fontSize(9)
      .fillColor(color || COLORS.heading)
      .text(value, rightX + rightLabelWidth, rowY, { width: rightValueWidth, align: 'right' });
    rowY += 16;
  }
  const rightHeight = rowY - y;

  return y + Math.max(leftHeight, rightHeight) + 24;
}

function drawTableHeader(doc, y) {
  doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fill(COLORS.headerFill);
  doc.fontSize(9).fillColor(COLORS.body);
  doc.text('DESCRIPTION', MARGIN + 10, y + 7);
  doc.text('QTY', MARGIN + 280, y + 7, { width: 50, align: 'right' });
  doc.text('UNIT PRICE', MARGIN + 340, y + 7, { width: 75, align: 'right' });
  doc.text('AMOUNT', MARGIN + 420, y + 7, { width: 65, align: 'right' });
  return y + 22;
}

// Paginates: if a row would run past PAGE_BOTTOM, starts a new page and
// redraws the table header there, so long item lists never render off-page.
function drawItemsTable(doc, items, startY, symbol) {
  let y = drawTableHeader(doc, startY);

  items.forEach((item, index) => {
    const rowHeight = Math.max(20, doc.heightOfString(item.description, { width: 260 }) + 10);

    if (y + rowHeight > PAGE_BOTTOM) {
      doc.addPage();
      y = drawTableHeader(doc, MARGIN);
    }

    if (index % 2 === 1) {
      doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(COLORS.rowAlt);
    }

    doc.fontSize(10).fillColor(COLORS.heading);
    doc.text(item.description, MARGIN + 10, y + 6, { width: 260 });
    doc.text(String(item.quantity), MARGIN + 280, y + 6, { width: 50, align: 'right' });
    doc.text(money(item.unit_price, symbol), MARGIN + 340, y + 6, { width: 75, align: 'right' });
    doc.text(money(item.amount, symbol), MARGIN + 420, y + 6, { width: 65, align: 'right' });

    y += rowHeight;
  });

  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor(COLORS.border).stroke();
  return y + 16;
}

// Subtotal/tax as plain rows, then a highlighted box for the figure that
// matters most: Total for quotes, Balance due (colored red/green) for
// invoices. Breaks to a new page if it wouldn't fit under the table.
function drawTotals(
  doc,
  { subtotal, discountType, discountValue, discountAmount, taxRate, taxAmount, total, amountPaid, balanceDue },
  y,
  symbol,
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
  if (isInvoice) {
    rows.push(['Total', money(total, symbol)]);
    rows.push(['Paid', money(amountPaid, symbol)]);
  }

  const blockHeight = rows.length * 18 + 40;
  if (y + blockHeight > PAGE_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }

  let rowY = y;
  doc.fontSize(10);
  rows.forEach(([label, value]) => {
    doc.fillColor(COLORS.body).text(label, boxX, rowY, { width: 130 });
    doc.fillColor(COLORS.heading).text(value, boxX + 130, rowY, { width: 115, align: 'right' });
    rowY += 18;
  });

  const finalLabel = isInvoice ? 'Balance due' : 'Total';
  const finalValue = isInvoice ? balanceDue : total;
  const finalColor = isInvoice ? (balanceDue > 0 ? COLORS.negative : COLORS.positive) : COLORS.heading;

  doc.rect(boxX, rowY + 4, boxWidth, 32).fill(COLORS.headerFill);
  doc.fontSize(12).fillColor(COLORS.heading).text(finalLabel, boxX + 12, rowY + 14, { width: 120 });
  doc.fontSize(13).fillColor(finalColor).text(money(finalValue, symbol), boxX + 128, rowY + 13, { width: 105, align: 'right' });

  return rowY + 48;
}

function drawFooter(doc, { notes, bankDetails }, y) {
  if (y > PAGE_BOTTOM - 40) {
    doc.addPage();
    y = MARGIN;
  }
  if (notes) {
    doc.fontSize(9).fillColor(COLORS.muted).text('NOTES', MARGIN, y);
    doc.fontSize(9).fillColor(COLORS.body).text(notes, MARGIN, y + 14, { width: CONTENT_WIDTH });
    y += 14 + doc.heightOfString(notes, { width: CONTENT_WIDTH }) + 20;
  }
  if (bankDetails) {
    doc.fontSize(9).fillColor(COLORS.muted).text('PAYMENT DETAILS', MARGIN, y);
    doc.fontSize(9).fillColor(COLORS.body).text(bankDetails, MARGIN, y + 14, { width: CONTENT_WIDTH });
  }
}

function renderQuotePdf({ quote, client, items, settings }) {
  const doc = newDoc();
  const symbol = settings.currency_symbol || '$';

  let y = drawHeader(doc, { title: 'QUOTE', number: quote.number, settings });
  y = drawInfoColumns(doc, {
    client,
    metaRows: [
      ['Issue date', quote.issue_date],
      ['Expiry date', quote.expiry_date || '—'],
      ['Status', quote.status.toUpperCase(), STATUS_COLORS[quote.status]],
    ],
  }, y);
  y = drawItemsTable(doc, items, y, symbol);
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
  drawFooter(doc, { notes: quote.notes, bankDetails: '' }, y);

  return docToBuffer(doc, addPageNumbers);
}

function renderInvoicePdf({ invoice, client, items, settings }) {
  const doc = newDoc();
  const symbol = settings.currency_symbol || '$';
  const balanceDue = invoice.total - invoice.amount_paid;

  let y = drawHeader(doc, { title: 'INVOICE', number: invoice.number, settings });
  y = drawInfoColumns(doc, {
    client,
    metaRows: [
      ['Issue date', invoice.issue_date],
      ['Due date', invoice.due_date],
      ['Status', invoice.status.toUpperCase(), STATUS_COLORS[invoice.status]],
    ],
  }, y);
  y = drawItemsTable(doc, items, y, symbol);
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
  );
  drawFooter(doc, { notes: invoice.notes, bankDetails: settings.bank_details }, y);

  return docToBuffer(doc, (d) => {
    if (invoice.status === 'paid') addPaidStamp(d);
    addPageNumbers(d);
  });
}

function renderReceiptPdf({ payment, invoice, client, settings }) {
  const doc = newDoc();
  const symbol = settings.currency_symbol || '$';

  let y = drawHeader(doc, { title: 'RECEIPT', number: payment.receipt_number, settings });
  y = drawInfoColumns(doc, {
    client,
    metaRows: [
      ['Payment date', payment.paid_at],
      ['For invoice', invoice.number],
      ['Method', payment.method.replace('_', ' ').toUpperCase()],
    ],
  }, y);

  doc.rect(MARGIN, y, CONTENT_WIDTH, 60).fill(COLORS.headerFill);
  doc.fontSize(9).fillColor(COLORS.muted).text('AMOUNT RECEIVED', MARGIN + 16, y + 14);
  doc.fontSize(24).fillColor(COLORS.positive).text(money(payment.amount, symbol), MARGIN + 16, y + 28);
  y += 80;

  if (payment.reference) {
    doc.fontSize(9).fillColor(COLORS.muted).text('REFERENCE', MARGIN, y);
    doc.fontSize(10).fillColor(COLORS.body).text(payment.reference, MARGIN, y + 14);
    y += 40;
  }
  if (payment.notes) {
    doc.fontSize(9).fillColor(COLORS.muted).text('NOTES', MARGIN, y);
    doc.fontSize(10).fillColor(COLORS.body).text(payment.notes, MARGIN, y + 14, { width: CONTENT_WIDTH });
  }

  return docToBuffer(doc, (d) => {
    addPaidStamp(d);
    addPageNumbers(d);
  });
}

module.exports = { renderQuotePdf, renderInvoicePdf, renderReceiptPdf };
