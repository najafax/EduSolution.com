// Renders a submitted Manager on Duty checklist as a PDF — a bordered
// table document (Description | Checked (Yes/No/N/A) | Comments), navy
// section bands, a repeating header/meta block on every page, a photo +
// caption row per logged issue, and a signature line. Shares lib/pdf.js's
// page geometry/palette/image helpers with every other PDF in this app
// (lib/reportPdf.js does the same for the sales/tax/P&L reports), but this
// is its own bordered-grid layout — nothing here looks like a quote/
// invoice/receipt or a plain tabular report, so it isn't built on either
// of those files' own row helpers.
//
// Deliberately carries none of EduSolution's own branding — no
// business_settings name/logo in the header, no business address/phone/
// email footer line (unlike every quote/invoice/receipt/report PDF, which
// all pull that from lib/pdf.js's addPageFooter). This is a standalone
// operations document for whichever resort is using the checklist, not a
// document issued *by* EduSolution to a client, so it shouldn't read as
// one. It does render its *own* optional branding — a name/logo an admin
// sets specifically for this module (routes/modReports.js's GET/PUT
// /settings, stored in db/index.js's mod_report_settings, a table
// entirely separate from business_settings) — renderModReportPdf takes
// { report, modSettings }, never the app's own settings.
const {
  MARGIN, CONTENT_WIDTH, PAGE_BOTTOM, COLORS,
  newDoc, docToBuffer, decodeImageDataUri,
} = require('./pdf');

const NAVY = '#1b2a49';
const HEADER_FILL = '#f2f2f2';

const COL_DESC_X = MARGIN;
const COL_DESC_W = 220;
const COL_CHK_W = 30;
const COL_YES_X = COL_DESC_X + COL_DESC_W;
const COL_NO_X = COL_YES_X + COL_CHK_W;
const COL_NA_X = COL_NO_X + COL_CHK_W;
const COL_CHECKED_W = COL_CHK_W * 3;
const COL_COMMENTS_X = COL_NA_X + COL_CHK_W;
const COL_COMMENTS_W = MARGIN + CONTENT_WIDTH - COL_COMMENTS_X;

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Title bar + a 2x2 MOD Name/Date/Weather/Time Started meta table —
// redrawn on every page (see ensurePage below). The optional logo/name in
// the title bar come from mod_report_settings (see this file's own
// top-of-file note), never from EduSolution's own business_settings — a
// report with no logo/name set there renders a plain centered title with
// no logo box at all, not a placeholder or an EduSolution fallback.
function drawHeaderBlock(doc, report, propertyName, logoBuffer) {
  let y = MARGIN;
  const headerH = 32;
  const logoSize = headerH;

  if (logoBuffer) {
    doc.image(logoBuffer, MARGIN + 4, y + 4, { fit: [logoSize - 8, logoSize - 8] });
  }

  const titleX = logoBuffer ? MARGIN + logoSize : MARGIN;
  const titleW = logoBuffer ? CONTENT_WIDTH - logoSize : CONTENT_WIDTH;
  if (propertyName) {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Manager on Duty Checklist', titleX, y + 4, { width: titleW, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).fillColor(NAVY).text(propertyName, titleX, y + 19, { width: titleW, align: 'center' });
  } else {
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000').text('Manager on Duty Checklist', titleX, y + 9, { width: titleW, align: 'center' });
  }

  doc.lineWidth(0.75).strokeColor('#000000').rect(MARGIN, y, CONTENT_WIDTH, headerH).stroke();
  if (logoBuffer) {
    doc.moveTo(MARGIN + logoSize, y).lineTo(MARGIN + logoSize, y + headerH).strokeColor('#000000').lineWidth(0.75).stroke();
  }
  y += headerH;

  const metaRowH = 20;
  const metaColW = [70, 178, 70, 177];
  const metaRows = [
    ['MOD Name:', report.mod_name || '', 'Date:', fmtDate(report.report_date)],
    ['Weather:', report.weather || '', 'Time Started:', report.time_started || ''],
  ];
  metaRows.forEach((row) => {
    let x = MARGIN;
    row.forEach((val, i) => {
      const w = metaColW[i];
      doc.lineWidth(0.75).strokeColor('#000000').rect(x, y, w, metaRowH).stroke();
      doc.font(i % 2 === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000000').text(String(val), x + 6, y + 6, { width: w - 10 });
      x += w;
    });
    y += metaRowH;
  });

  return y;
}

function drawCheckbox(doc, cx, cy, checked) {
  const s = 8;
  doc.lineWidth(0.75).strokeColor('#000000').rect(cx - s / 2, cy - s / 2, s, s).stroke();
  if (checked) {
    doc.lineWidth(1.3).strokeColor('#000000');
    doc.moveTo(cx - s * 0.32, cy).lineTo(cx - s * 0.06, cy + s * 0.28).stroke();
    doc.moveTo(cx - s * 0.06, cy + s * 0.28).lineTo(cx + s * 0.36, cy - s * 0.26).stroke();
  }
}

function drawTableHead(doc, y) {
  const h1 = 16;
  const h2 = 16;
  doc.lineWidth(0.75).strokeColor('#000000').fillColor(HEADER_FILL);
  doc.rect(COL_DESC_X, y, COL_DESC_W, h1 + h2).fillAndStroke(HEADER_FILL, '#000000');
  doc.rect(COL_YES_X, y, COL_CHECKED_W, h1).fillAndStroke(HEADER_FILL, '#000000');
  doc.rect(COL_COMMENTS_X, y, COL_COMMENTS_W, h1 + h2).fillAndStroke(HEADER_FILL, '#000000');

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
  doc.text('Description', COL_DESC_X + 6, y + 4, { width: COL_DESC_W - 10 });
  doc.text('Checked', COL_YES_X, y + 4, { width: COL_CHECKED_W, align: 'center' });
  doc.text('Comments', COL_COMMENTS_X + 6, y + 4, { width: COL_COMMENTS_W - 10 });

  doc.rect(COL_YES_X, y + h1, COL_CHK_W, h2).fillAndStroke(HEADER_FILL, '#000000');
  doc.rect(COL_NO_X, y + h1, COL_CHK_W, h2).fillAndStroke(HEADER_FILL, '#000000');
  doc.rect(COL_NA_X, y + h1, COL_CHK_W, h2).fillAndStroke(HEADER_FILL, '#000000');
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000');
  doc.text('Yes', COL_YES_X, y + h1 + 5, { width: COL_CHK_W, align: 'center' });
  doc.text('No', COL_NO_X, y + h1 + 5, { width: COL_CHK_W, align: 'center' });
  doc.text('N/A', COL_NA_X, y + h1 + 5, { width: COL_CHK_W, align: 'center' });

  return y + h1 + h2;
}

function makeEnsurePage(doc, report, propertyName, logoBuffer) {
  return (y, neededH) => {
    if (y + neededH <= PAGE_BOTTOM) return y;
    doc.addPage();
    const headerBottom = drawHeaderBlock(doc, report, propertyName, logoBuffer);
    return drawTableHead(doc, headerBottom);
  };
}

// The plain "Page X of Y" counterpart to lib/pdf.js's addPageFooter — no
// business name/address/phone/email line, since this document carries none
// of that branding (see this file's own top-of-file note). Silent on a
// single-page report, same as addPageFooter's own "nothing to say" case.
function addPlainPageFooter(doc) {
  const range = doc.bufferedPageRange();
  if (range.count <= 1) return;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - 30;
    doc.moveTo(MARGIN, footerY).lineTo(MARGIN + CONTENT_WIDTH, footerY).strokeColor(COLORS.border).lineWidth(1).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN, footerY + 8, { width: CONTENT_WIDTH, align: 'center' });
    doc.page.margins.bottom = bottomMargin;
  }
}

function sectionRow(doc, y, title, ensurePage) {
  const rowH = 18;
  y = ensurePage(y, rowH);
  doc.rect(COL_DESC_X, y, CONTENT_WIDTH, rowH).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text(title, COL_DESC_X + 6, y + 5, { width: CONTENT_WIDTH - 12 });
  return y + rowH;
}

function occupancyRow(doc, y, report, ensurePage) {
  const rowH = 16;
  y = ensurePage(y, rowH);
  doc.lineWidth(0.75).strokeColor('#000000');
  doc.rect(COL_DESC_X, y, COL_DESC_W, rowH).stroke();
  doc.rect(COL_YES_X, y, COL_CHECKED_W, rowH).stroke();
  doc.rect(COL_COMMENTS_X, y, COL_COMMENTS_W, rowH).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor('#000000').text('Occupancy', COL_DESC_X + 6, y + 4, { width: COL_DESC_W - 10 });
  const val = report.occupancy_percent === null || report.occupancy_percent === undefined ? '' : `${report.occupancy_percent}%`;
  doc.text(val, COL_YES_X, y + 4, { width: COL_CHECKED_W, align: 'center' });
  return y + rowH;
}

function itemRow(doc, y, label, itemState, ensurePage) {
  itemState = itemState || {};
  doc.font('Helvetica').fontSize(8.5);
  const descH = doc.heightOfString(label, { width: COL_DESC_W - 12 });
  const comment = itemState.comment || '';
  const commentH = comment ? doc.heightOfString(comment, { width: COL_COMMENTS_W - 12 }) : 0;
  const rowH = Math.max(descH, commentH, 12) + 8;
  y = ensurePage(y, rowH);

  doc.lineWidth(0.75).strokeColor('#000000');
  doc.rect(COL_DESC_X, y, COL_DESC_W, rowH).stroke();
  doc.rect(COL_YES_X, y, COL_CHK_W, rowH).stroke();
  doc.rect(COL_NO_X, y, COL_CHK_W, rowH).stroke();
  doc.rect(COL_NA_X, y, COL_CHK_W, rowH).stroke();
  doc.rect(COL_COMMENTS_X, y, COL_COMMENTS_W, rowH).stroke();

  doc.font('Helvetica').fontSize(8.5).fillColor('#000000').text(label, COL_DESC_X + 6, y + 4, { width: COL_DESC_W - 12 });
  if (comment) doc.text(comment, COL_COMMENTS_X + 6, y + 4, { width: COL_COMMENTS_W - 12 });

  const cy = y + rowH / 2;
  drawCheckbox(doc, COL_YES_X + COL_CHK_W / 2, cy, itemState.value === 'yes');
  drawCheckbox(doc, COL_NO_X + COL_CHK_W / 2, cy, itemState.value === 'no');
  drawCheckbox(doc, COL_NA_X + COL_CHK_W / 2, cy, itemState.value === 'na');

  return y + rowH;
}

function textRow(doc, y, label, comment, ensurePage) {
  const labelW = COL_DESC_W + COL_CHECKED_W;
  doc.font('Helvetica-Bold').fontSize(8.5);
  const labelH = doc.heightOfString(label || '—', { width: labelW - 12 });
  doc.font('Helvetica').fontSize(8.5);
  const commentH = comment ? doc.heightOfString(comment, { width: COL_COMMENTS_W - 12 }) : 0;
  const rowH = Math.max(labelH, commentH, 12) + 8;
  y = ensurePage(y, rowH);

  doc.lineWidth(0.75).strokeColor('#000000');
  doc.rect(COL_DESC_X, y, labelW, rowH).stroke();
  doc.rect(COL_COMMENTS_X, y, COL_COMMENTS_W, rowH).stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000').text(label || '—', COL_DESC_X + 6, y + 4, { width: labelW - 12 });
  if (comment) doc.font('Helvetica').fontSize(8.5).text(comment, COL_COMMENTS_X + 6, y + 4, { width: COL_COMMENTS_W - 12 });

  return y + rowH;
}

function issueRow(doc, y, issue, ensurePage) {
  const photoColW = COL_DESC_W + COL_CHK_W;
  const captionColW = CONTENT_WIDTH - photoColW;
  const photoH = 90;
  doc.font('Helvetica').fontSize(8.5);
  const captionH = issue.caption ? doc.heightOfString(issue.caption, { width: captionColW - 12 }) : 0;
  const rowH = Math.max(photoH + 8, captionH + 8, 24);
  y = ensurePage(y, rowH);

  doc.lineWidth(0.75).strokeColor('#000000');
  doc.rect(COL_DESC_X, y, photoColW, rowH).stroke();
  doc.rect(COL_DESC_X + photoColW, y, captionColW, rowH).stroke();

  if (issue.photo) {
    const buf = decodeImageDataUri(issue.photo);
    if (buf) {
      try {
        doc.image(buf, COL_DESC_X + 6, y + 4, { fit: [photoColW - 12, Math.min(photoH, rowH - 8)] });
      } catch (e) {
        /* a corrupt/unsupported image just skips the image, not the whole document */
      }
    }
  }
  if (issue.caption) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#000000').text(issue.caption, COL_DESC_X + photoColW + 6, y + 4, { width: captionColW - 12 });
  }

  return y + rowH;
}

function signatureRow(doc, y, signature, ensurePage) {
  const rowH = 26;
  y = ensurePage(y, rowH);
  doc.lineWidth(0.75).strokeColor('#000000').rect(COL_DESC_X, y, CONTENT_WIDTH, rowH).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text('Signature:', COL_DESC_X + 6, y + 9);
  const labelW = doc.widthOfString('Signature: ');
  doc.font('Helvetica').fontSize(9).text(signature || '—', COL_DESC_X + 6 + labelW, y + 9);
  return y + rowH;
}

function renderModReportPdf({ report, modSettings }) {
  const doc = newDoc();
  const propertyName = (modSettings && modSettings.business_name) || '';
  const logoBuffer = modSettings && modSettings.logo_image ? decodeImageDataUri(modSettings.logo_image) : null;

  const ensurePage = makeEnsurePage(doc, report, propertyName, logoBuffer);
  let y = drawHeaderBlock(doc, report, propertyName, logoBuffer);
  y = drawTableHead(doc, y);
  y = occupancyRow(doc, y, report, ensurePage);

  const sections = report.sections || [];
  sections.forEach((sec) => {
    y = sectionRow(doc, y, sec.title, ensurePage);
    const answers = (report.sections_answers && report.sections_answers[sec.key]) || {};
    sec.items.forEach((label, idx) => {
      y = itemRow(doc, y, label, answers[idx], ensurePage);
    });
  });

  const villas = report.villas || [];
  villas.forEach((v, i) => {
    y = sectionRow(doc, y, `Villa Check — ${v.villaNumber || `Villa ${i + 1}`}`, ensurePage);
    (report.villaItemLabels || []).forEach((label, idx) => {
      y = itemRow(doc, y, label, (v.items || {})[idx], ensurePage);
    });
  });

  y = sectionRow(doc, y, 'Guest Interaction (met and spoke with at least 3 villas)', ensurePage);
  const guests = (report.guestInteractions || []).filter((g) => g.villaGuest || g.comment);
  if (guests.length === 0) {
    y = textRow(doc, y, '—', 'No guest interactions recorded.', ensurePage);
  } else {
    guests.forEach((g) => {
      y = textRow(doc, y, g.villaGuest || '—', g.comment || '', ensurePage);
    });
  }

  y = sectionRow(doc, y, 'Any Issue / Concern / Complaint', ensurePage);
  const issues = report.issues || [];
  if (issues.length === 0) {
    y = textRow(doc, y, '—', 'No issues logged.', ensurePage);
  } else {
    issues.forEach((iss) => {
      y = issueRow(doc, y, iss, ensurePage);
    });
  }

  signatureRow(doc, y, report.signature, ensurePage);

  return docToBuffer(doc, (d) => addPlainPageFooter(d));
}

module.exports = { renderModReportPdf };
