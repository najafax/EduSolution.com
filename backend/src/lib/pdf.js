const PDFDocument = require('pdfkit');

function docToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function money(amount, symbol) {
  return `${symbol}${Number(amount).toFixed(2)}`;
}

function drawHeader(doc, { title, number, settings }) {
  doc.fontSize(20).fillColor('#4f46e5').text(settings.business_name || 'Your Business', 50, 50);
  doc
    .fontSize(9)
    .fillColor('#475569')
    .text(
      [settings.address, settings.email, settings.phone, settings.tax_id ? `Tax ID: ${settings.tax_id}` : '']
        .filter(Boolean)
        .join('\n'),
      50,
      75,
    );

  doc.fontSize(24).fillColor('#0f172a').text(title, 300, 50, { width: 245, align: 'right' });
  doc.fontSize(10).fillColor('#475569').text(number, 300, 80, { width: 245, align: 'right' });
}

function drawMeta(doc, rows, y) {
  doc.fontSize(9).fillColor('#475569');
  rows.forEach(([label, value], i) => {
    doc.text(label, 300, y + i * 14, { width: 110, align: 'right' });
    doc.fillColor('#0f172a').text(value, 415, y + i * 14, { width: 130, align: 'right' });
    doc.fillColor('#475569');
  });
}

function drawClient(doc, client, y) {
  doc.fontSize(9).fillColor('#94a3b8').text('BILL TO', 50, y);
  doc
    .fontSize(11)
    .fillColor('#0f172a')
    .text(client.company || client.name, 50, y + 14);
  doc
    .fontSize(9)
    .fillColor('#475569')
    .text([client.company ? client.name : null, client.email, client.phone, client.address].filter(Boolean).join('\n'), 50, y + 30);
}

function drawItemsTable(doc, items, y, symbol) {
  const colX = { desc: 50, qty: 330, price: 390, amount: 470 };
  doc.rect(50, y, 495, 20).fill('#f1f5f9');
  doc.fontSize(9).fillColor('#475569');
  doc.text('DESCRIPTION', colX.desc + 8, y + 6);
  doc.text('QTY', colX.qty, y + 6, { width: 50, align: 'right' });
  doc.text('UNIT PRICE', colX.price, y + 6, { width: 70, align: 'right' });
  doc.text('AMOUNT', colX.amount, y + 6, { width: 65, align: 'right' });

  let rowY = y + 28;
  doc.fontSize(10).fillColor('#0f172a');
  for (const item of items) {
    const rowHeight = Math.max(16, doc.heightOfString(item.description, { width: 270 }));
    doc.text(item.description, colX.desc + 8, rowY, { width: 270 });
    doc.text(String(item.quantity), colX.qty, rowY, { width: 50, align: 'right' });
    doc.text(money(item.unit_price, symbol), colX.price, rowY, { width: 70, align: 'right' });
    doc.text(money(item.amount, symbol), colX.amount, rowY, { width: 65, align: 'right' });
    rowY += rowHeight + 10;
  }

  doc.moveTo(50, rowY).lineTo(545, rowY).strokeColor('#e2e8f0').stroke();
  return rowY + 12;
}

function drawTotals(doc, { subtotal, taxRate, taxAmount, total, amountPaid, balanceDue }, y, symbol) {
  const rows = [['Subtotal', money(subtotal, symbol)]];
  if (taxRate) rows.push([`Tax (${taxRate}%)`, money(taxAmount, symbol)]);
  rows.push(['Total', money(total, symbol)]);
  if (amountPaid !== undefined) {
    rows.push(['Paid', money(amountPaid, symbol)]);
    rows.push(['Balance due', money(balanceDue, symbol)]);
  }

  let rowY = y;
  rows.forEach(([label, value], i) => {
    const isLast = i === rows.length - 1;
    doc
      .fontSize(isLast ? 12 : 10)
      .fillColor(isLast ? '#0f172a' : '#475569')
      .text(label, 350, rowY, { width: 110, align: 'right' });
    doc
      .fontSize(isLast ? 12 : 10)
      .fillColor(isLast ? '#0f172a' : '#475569')
      .text(value, 470, rowY, { width: 65, align: 'right' });
    rowY += isLast ? 20 : 16;
  });
  return rowY;
}

function drawFooter(doc, { notes, bankDetails }, y) {
  if (notes) {
    doc.fontSize(9).fillColor('#94a3b8').text('NOTES', 50, y);
    doc.fontSize(9).fillColor('#475569').text(notes, 50, y + 14, { width: 495 });
    y += 14 + doc.heightOfString(notes, { width: 495 }) + 20;
  }
  if (bankDetails) {
    doc.fontSize(9).fillColor('#94a3b8').text('PAYMENT DETAILS', 50, y);
    doc.fontSize(9).fillColor('#475569').text(bankDetails, 50, y + 14, { width: 495 });
  }
}

function renderQuotePdf({ quote, client, items, settings }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const symbol = settings.currency_symbol || '$';

  drawHeader(doc, { title: 'QUOTE', number: quote.number, settings });
  drawMeta(
    doc,
    [
      ['Issue date', quote.issue_date],
      ['Expiry date', quote.expiry_date || '—'],
      ['Status', quote.status.toUpperCase()],
    ],
    120,
  );
  drawClient(doc, client, 170);
  const afterTable = drawItemsTable(doc, items, 240, symbol);
  const afterTotals = drawTotals(
    doc,
    { subtotal: quote.subtotal, taxRate: quote.tax_rate, taxAmount: quote.tax_amount, total: quote.total },
    afterTable,
    symbol,
  );
  drawFooter(doc, { notes: quote.notes, bankDetails: '' }, afterTotals + 20);

  return docToBuffer(doc);
}

function renderInvoicePdf({ invoice, client, items, settings }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const symbol = settings.currency_symbol || '$';
  const balanceDue = invoice.total - invoice.amount_paid;

  drawHeader(doc, { title: 'INVOICE', number: invoice.number, settings });
  drawMeta(
    doc,
    [
      ['Issue date', invoice.issue_date],
      ['Due date', invoice.due_date],
      ['Status', invoice.status.toUpperCase()],
    ],
    120,
  );
  drawClient(doc, client, 170);
  const afterTable = drawItemsTable(doc, items, 240, symbol);
  const afterTotals = drawTotals(
    doc,
    {
      subtotal: invoice.subtotal,
      taxRate: invoice.tax_rate,
      taxAmount: invoice.tax_amount,
      total: invoice.total,
      amountPaid: invoice.amount_paid,
      balanceDue,
    },
    afterTable,
    symbol,
  );
  drawFooter(doc, { notes: invoice.notes, bankDetails: settings.bank_details }, afterTotals + 20);

  return docToBuffer(doc);
}

function renderReceiptPdf({ payment, invoice, client, settings }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const symbol = settings.currency_symbol || '$';

  drawHeader(doc, { title: 'RECEIPT', number: payment.receipt_number, settings });
  drawMeta(
    doc,
    [
      ['Payment date', payment.paid_at],
      ['For invoice', invoice.number],
      ['Method', payment.method.replace('_', ' ').toUpperCase()],
    ],
    120,
  );
  drawClient(doc, client, 170);

  doc.fontSize(9).fillColor('#94a3b8').text('AMOUNT RECEIVED', 50, 250);
  doc.fontSize(22).fillColor('#0f172a').text(money(payment.amount, symbol), 50, 265);

  if (payment.reference) {
    doc.fontSize(9).fillColor('#94a3b8').text('REFERENCE', 50, 310);
    doc.fontSize(10).fillColor('#475569').text(payment.reference, 50, 324);
  }
  if (payment.notes) {
    doc.fontSize(9).fillColor('#94a3b8').text('NOTES', 50, 354);
    doc.fontSize(10).fillColor('#475569').text(payment.notes, 50, 368, { width: 495 });
  }

  return docToBuffer(doc);
}

module.exports = { renderQuotePdf, renderInvoicePdf, renderReceiptPdf };
