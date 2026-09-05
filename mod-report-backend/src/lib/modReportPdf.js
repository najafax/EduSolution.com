// Renders a submitted Manager on Duty checklist as a PDF, matching a real
// resort's own exported MOD report template pixel-for-pixel (measured from
// a reference PDF supplied by the user — page size, margins, column
// widths, every color, row heights, and the exact row shapes for each
// section) rather than this app's own general PDF conventions. Because of
// that, this file deliberately does **not** share lib/pdf.js's page
// geometry (MARGIN/CONTENT_WIDTH/PAGE_BOTTOM are all A4-sized, this
// document is US Letter) — it only reuses that file's format-agnostic
// docToBuffer()/decodeImageDataUri() helpers, and builds its own
// PDFDocument with its own geometry constants below.
//
// Deliberately carries none of EduSolution's own branding — no
// business_settings name/logo, no business address/phone/email footer
// line (unlike every quote/invoice/receipt/report PDF in this app, which
// pull that from lib/pdf.js's addPageFooter — this document has no footer
// at all, matching the reference exactly). This is a standalone
// operations document for whichever resort is using the checklist, not a
// document issued *by* EduSolution to a client, so it shouldn't read as
// one. It does render its *own* optional branding — a name/logo an admin
// sets specifically for this module (routes/modReports.js's GET/PUT
// /settings, stored in db/index.js's mod_report_settings, a table
// entirely separate from business_settings) — renderModReportPdf takes
// { report, modSettings }, never the app's own settings.
const PDFDocument = require('pdfkit');
const { docToBuffer, decodeImageDataUri } = require('./pdf');

// US Letter (612x792pt), not this app's usual A4 — measured directly off
// the reference PDF's pixel dimensions (1700x2200px at 200dpi = 8.5x11in).
const PAGE_SIZE = 'LETTER';
const MARGIN = 20;
const CONTENT_WIDTH = 572;
const PAGE_BOTTOM = 770;

// The exact navy sampled from the reference PDF's section bands/column
// header row (RGB 12,35,64) — not this app's own indigo/lagoon accent,
// since this document's palette is the resort's own template, not
// EduSolution's.
const NAVY = '#0C2340';
const BORDER = '#000000';
const BORDER_W = 0.6;

// Column layout — widths measured directly off the reference PDF (a
// narrow blank "gutter" column first, used only for the odd numbered/
// labeled row — guest-interaction row numbers, a villa number — then
// Description, the three Yes/No/N/A checkboxes, then Comments).
const COL_INDENT_W = 23;
const COL_DESC_W = 308.5;
const COL_CHK_W = 26.5;
const COL_CHECKED_W = COL_CHK_W * 3;
const COL_COMMENTS_W = CONTENT_WIDTH - COL_INDENT_W - COL_DESC_W - COL_CHECKED_W;

const COL_INDENT_X = MARGIN;
const COL_DESC_X = COL_INDENT_X + COL_INDENT_W;
const COL_YES_X = COL_DESC_X + COL_DESC_W;
const COL_NO_X = COL_YES_X + COL_CHK_W;
const COL_NA_X = COL_NO_X + COL_CHK_W;
const COL_COMMENTS_X = COL_NA_X + COL_CHK_W;

const ROW_H = 14;
const HEADER_H = 65;

// "25-Aug-26" — the reference's own date format, not this app's usual
// "27 Aug 2026" (see lib/pdf.js's shared date formatting on every other
// PDF, which this file intentionally doesn't reuse).
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function newDoc() {
  return new PDFDocument({ size: PAGE_SIZE, margin: MARGIN, bufferPages: true });
}

// Logo (top-left, optional) + centered bold title, then a 2x2 MOD Name/
// Date/Weather/Time Started meta block reusing the same column grid as
// the rest of the table (col 1 = indent+Description merged for the
// "MOD Name:   <value>" / "Weather: <value>" text, col 2 = the three
// checkbox columns merged for the "Date:"/"Time Started:" label, col 3 =
// Comments width for the value) — redrawn on every page (see ensurePage
// below). No property-name subtitle line when a logo is set: the
// reference's own logo image already carries the resort's name
// graphically, so a separate typed line under the title would be
// redundant with it (and isn't present in the reference at all). Without
// a logo, an admin-set name still prints as a subtitle so a report isn't
// completely unbranded when no logo has been uploaded yet.
function drawHeaderBlock(doc, report, propertyName, logoBuffer) {
  let y = MARGIN;

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, MARGIN + 10, y + 8, { fit: [90, 50] });
    } catch (e) {
      /* a corrupt/unsupported logo just skips the image, not the whole document */
    }
  }

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000');
  if (logoBuffer || !propertyName) {
    doc.text('Manager on Duty Checklist', MARGIN, y + HEADER_H / 2 - 10, { width: CONTENT_WIDTH, align: 'center' });
  } else {
    doc.text('Manager on Duty Checklist', MARGIN, y + 16, { width: CONTENT_WIDTH, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor(NAVY).text(propertyName, MARGIN, y + 36, { width: CONTENT_WIDTH, align: 'center' });
  }

  doc.lineWidth(1).strokeColor(BORDER).rect(MARGIN, y, CONTENT_WIDTH, HEADER_H).stroke();
  y += HEADER_H;

  const metaRows = [
    ['MOD Name:', report.mod_name || '', 'Date:', fmtDate(report.report_date)],
    ['Weather:', report.weather || '', 'Time Started:', report.time_started || ''],
  ];
  metaRows.forEach((row, i) => {
    doc.lineWidth(BORDER_W).strokeColor(BORDER);
    doc.rect(COL_INDENT_X, y, COL_DESC_W + COL_INDENT_W, ROW_H).stroke();
    doc.rect(COL_YES_X, y, COL_CHECKED_W, ROW_H).stroke();
    doc.rect(COL_COMMENTS_X, y, COL_COMMENTS_W, ROW_H).stroke();

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text(row[0], COL_INDENT_X + 6, y + 3);
    if (i === 0) {
      // "MOD Name:" gets a wide tab-like gap before the value, matching
      // the reference's own spacing exactly — "Weather:" (below) doesn't.
      doc.font('Helvetica').fontSize(9).text(row[1], COL_INDENT_X + 86, y + 3, { width: COL_DESC_W + COL_INDENT_W - 92 });
    } else {
      const labelW = doc.widthOfString(`${row[0]} `);
      doc.font('Helvetica').fontSize(9).text(row[1], COL_INDENT_X + 6 + labelW, y + 3, { width: COL_DESC_W + COL_INDENT_W - 12 - labelW });
    }

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text(row[2], COL_YES_X, y + 3, { width: COL_CHECKED_W, align: 'center' });
    doc.font('Helvetica').fontSize(9).text(row[3], COL_COMMENTS_X, y + 3, { width: COL_COMMENTS_W, align: 'center' });
    y += ROW_H;
  });

  return y;
}

function drawCheckbox(doc, cx, cy, checked) {
  const s = 7;
  doc.lineWidth(0.6).strokeColor(BORDER).rect(cx - s / 2, cy - s / 2, s, s).stroke();
  if (checked) {
    doc.lineWidth(1).strokeColor(BORDER);
    doc.moveTo(cx - s * 0.32, cy).lineTo(cx - s * 0.06, cy + s * 0.28).stroke();
    doc.moveTo(cx - s * 0.06, cy + s * 0.28).lineTo(cx + s * 0.36, cy - s * 0.26).stroke();
  }
}

// Two-row column header — the reference's own exact shape, not a generic
// gray table head: row A is blank/white (just cell borders) except a
// navy-colored (not black) "Checked" label centered over the merged
// Yes/No/N/A width; row B is a solid navy band across Description through
// Comments (the indent column stays white in both rows) with white bold
// column labels.
function drawTableHead(doc, y) {
  doc.lineWidth(BORDER_W).strokeColor(BORDER);
  doc.rect(COL_INDENT_X, y, COL_INDENT_W, ROW_H).stroke();
  doc.rect(COL_DESC_X, y, COL_DESC_W, ROW_H).stroke();
  doc.rect(COL_YES_X, y, COL_CHECKED_W, ROW_H).stroke();
  doc.rect(COL_COMMENTS_X, y, COL_COMMENTS_W, ROW_H).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('Checked', COL_YES_X, y + 3, { width: COL_CHECKED_W, align: 'center' });
  y += ROW_H;

  doc.rect(COL_INDENT_X, y, COL_INDENT_W, ROW_H).stroke();
  doc.rect(COL_DESC_X, y, COL_DESC_W + COL_CHECKED_W + COL_COMMENTS_W, ROW_H).fillAndStroke(NAVY, BORDER);
  doc.lineWidth(BORDER_W).strokeColor(BORDER);
  doc.moveTo(COL_YES_X, y).lineTo(COL_YES_X, y + ROW_H).stroke();
  doc.moveTo(COL_NO_X, y).lineTo(COL_NO_X, y + ROW_H).stroke();
  doc.moveTo(COL_NA_X, y).lineTo(COL_NA_X, y + ROW_H).stroke();
  doc.moveTo(COL_COMMENTS_X, y).lineTo(COL_COMMENTS_X, y + ROW_H).stroke();

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
  doc.text('Description', COL_DESC_X + 6, y + 3, { width: COL_DESC_W - 10 });
  doc.text('Yes', COL_YES_X, y + 3, { width: COL_CHK_W, align: 'center' });
  doc.text('No', COL_NO_X, y + 3, { width: COL_CHK_W, align: 'center' });
  doc.text('N/A', COL_NA_X, y + 3, { width: COL_CHK_W, align: 'center' });
  doc.text('Comments', COL_COMMENTS_X + 6, y + 3, { width: COL_COMMENTS_W - 10, align: 'center' });
  return y + ROW_H;
}

function makeEnsurePage(doc, report, propertyName, logoBuffer) {
  return (y, neededH) => {
    if (y + neededH <= PAGE_BOTTOM) return y;
    doc.addPage();
    const headerBottom = drawHeaderBlock(doc, report, propertyName, logoBuffer);
    return drawTableHead(doc, headerBottom);
  };
}

function sectionRow(doc, y, title, ensurePage) {
  y = ensurePage(y, ROW_H);
  doc.lineWidth(BORDER_W).strokeColor(BORDER).rect(COL_INDENT_X, y, COL_INDENT_W, ROW_H).stroke();
  doc.rect(COL_DESC_X, y, CONTENT_WIDTH - COL_INDENT_W, ROW_H).fillAndStroke(NAVY, BORDER);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text(title, COL_DESC_X + 6, y + 3, { width: CONTENT_WIDTH - COL_INDENT_W - 12 });
  return y + ROW_H;
}

// Occupancy — indent blank, "Occupancy" in Description, the percentage
// centered across the merged Yes/No/N/A width, Comments blank; no
// checkboxes. Same 4-cell shape the reference's own Villa-number row uses
// (see villaHeaderRow below) — occupancyRow and villaHeaderRow are kept
// as separate functions since their content differs, not because the
// underlying cell shape does.
function fourCellRow(doc, y, descText, descBold, checkedText, comment, ensurePage) {
  const rowH = ROW_H;
  y = ensurePage(y, rowH);
  doc.lineWidth(BORDER_W).strokeColor(BORDER);
  doc.rect(COL_INDENT_X, y, COL_INDENT_W, rowH).stroke();
  doc.rect(COL_DESC_X, y, COL_DESC_W, rowH).stroke();
  doc.rect(COL_YES_X, y, COL_CHECKED_W, rowH).stroke();
  doc.rect(COL_COMMENTS_X, y, COL_COMMENTS_W, rowH).stroke();
  doc.font(descBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000000').text(descText, COL_DESC_X + 6, y + 3, { width: COL_DESC_W - 10 });
  if (checkedText) doc.font('Helvetica').fontSize(8.5).text(checkedText, COL_YES_X, y + 3, { width: COL_CHECKED_W, align: 'center' });
  if (comment) doc.font('Helvetica').fontSize(8.5).text(comment, COL_COMMENTS_X + 6, y + 3, { width: COL_COMMENTS_W - 10 });
  return y + rowH;
}

function occupancyRow(doc, y, report, ensurePage) {
  const val = report.occupancy_percent === null || report.occupancy_percent === undefined || report.occupancy_percent === '' ? '' : `${report.occupancy_percent}%`;
  return fourCellRow(doc, y, 'Occupancy', false, val, '', ensurePage);
}

// Villa number sub-header — "Villa Check" itself is a plain sectionRow
// (no villa number appended, matching the reference exactly), then this
// row names which villa the items below belong to.
function villaHeaderRow(doc, y, villaNumber, ensurePage) {
  return fourCellRow(doc, y, villaNumber || '—', true, '', '', ensurePage);
}

function itemRow(doc, y, label, itemState, ensurePage) {
  itemState = itemState || {};
  doc.font('Helvetica').fontSize(8.5);
  const descH = doc.heightOfString(label, { width: COL_DESC_W - 12 });
  const comment = itemState.comment || '';
  const commentH = comment ? doc.heightOfString(comment, { width: COL_COMMENTS_W - 12 }) : 0;
  const rowH = Math.max(descH, commentH, 8) + 6;
  const finalRowH = rowH > ROW_H ? rowH : ROW_H;
  y = ensurePage(y, finalRowH);

  doc.lineWidth(BORDER_W).strokeColor(BORDER);
  doc.rect(COL_INDENT_X, y, COL_INDENT_W, finalRowH).stroke();
  doc.rect(COL_DESC_X, y, COL_DESC_W, finalRowH).stroke();
  doc.rect(COL_YES_X, y, COL_CHK_W, finalRowH).stroke();
  doc.rect(COL_NO_X, y, COL_CHK_W, finalRowH).stroke();
  doc.rect(COL_NA_X, y, COL_CHK_W, finalRowH).stroke();
  doc.rect(COL_COMMENTS_X, y, COL_COMMENTS_W, finalRowH).stroke();

  doc.font('Helvetica').fontSize(8.5).fillColor('#000000').text(label, COL_DESC_X + 6, y + 3, { width: COL_DESC_W - 12 });
  if (comment) doc.text(comment, COL_COMMENTS_X + 6, y + 3, { width: COL_COMMENTS_W - 12 });

  const cy = y + finalRowH / 2;
  drawCheckbox(doc, COL_YES_X + COL_CHK_W / 2, cy, itemState.value === 'yes');
  drawCheckbox(doc, COL_NO_X + COL_CHK_W / 2, cy, itemState.value === 'no');
  drawCheckbox(doc, COL_NA_X + COL_CHK_W / 2, cy, itemState.value === 'na');

  return y + finalRowH;
}

// The reference's other row shape: indent (blank, or a row number) |
// Description-width cell | one merged cell spanning Yes+No+N/A+Comments
// together (no internal dividers at all here — confirmed against the
// reference pixel-by-pixel, unlike the 4-cell shape fourCellRow draws).
// Used for guest-interaction rows (text/text) and issue rows (photo/text)
// alike — `descContent`/`wideContent` are each either a plain string or a
// `{ photo }` object, drawn accordingly.
function wideRow(doc, y, indentLabel, descContent, wideContent, minH, ensurePage) {
  doc.font('Helvetica').fontSize(8.5);
  const descIsPhoto = descContent && typeof descContent === 'object';
  const wideIsPhoto = wideContent && typeof wideContent === 'object';
  const descH = descIsPhoto ? 90 : (descContent ? doc.heightOfString(descContent, { width: COL_DESC_W - 12 }) : 0);
  const wideW = COL_CHECKED_W + COL_COMMENTS_W;
  const wideH = wideIsPhoto ? 90 : (wideContent ? doc.heightOfString(wideContent, { width: wideW - 12 }) : 0);
  const rowH = Math.max(descH, wideH, minH || 0, 8) + 8;
  y = ensurePage(y, rowH);

  doc.lineWidth(BORDER_W).strokeColor(BORDER);
  doc.rect(COL_INDENT_X, y, COL_INDENT_W, rowH).stroke();
  doc.rect(COL_DESC_X, y, COL_DESC_W, rowH).stroke();
  doc.rect(COL_YES_X, y, wideW, rowH).stroke();

  if (indentLabel) doc.font('Helvetica').fontSize(8.5).fillColor('#000000').text(String(indentLabel), COL_INDENT_X, y + 4, { width: COL_INDENT_W, align: 'center' });

  if (descIsPhoto) {
    if (descContent.photo) {
      const buf = decodeImageDataUri(descContent.photo);
      if (buf) {
        try { doc.image(buf, COL_DESC_X + 6, y + 4, { fit: [COL_DESC_W - 12, Math.min(90, rowH - 8)] }); } catch (e) { /* skip a corrupt/unsupported image, not the whole document */ }
      }
    }
  } else if (descContent) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#000000').text(descContent, COL_DESC_X + 6, y + 4, { width: COL_DESC_W - 12 });
  }

  if (!wideIsPhoto && wideContent) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#000000').text(wideContent, COL_YES_X + 6, y + 4, { width: wideW - 12 });
  }

  return y + rowH;
}

function signatureRow(doc, y, signature, ensurePage) {
  const rowH = 20;
  y = ensurePage(y, rowH);
  doc.lineWidth(BORDER_W).strokeColor(BORDER).rect(COL_INDENT_X, y, CONTENT_WIDTH, rowH).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text('Signature:', COL_INDENT_X + 6, y + 6);
  const labelW = doc.widthOfString('Signature: ');
  doc.font('Helvetica').fontSize(9).text(signature || '', COL_INDENT_X + 6 + labelW, y + 6);
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
  sections.forEach((sec, idx) => {
    // The reference's own template has no title band for the very first
    // section (its items just start directly under Occupancy) — every
    // section after it gets one. Matched positionally, not by key, so it
    // still holds if SECTIONS is ever reordered.
    if (idx > 0) y = sectionRow(doc, y, sec.title, ensurePage);
    const answers = (report.sections_answers && report.sections_answers[sec.key]) || {};
    sec.items.forEach((label, i) => {
      y = itemRow(doc, y, label, answers[i], ensurePage);
    });
  });

  const villas = report.villas || [];
  if (villas.length > 0) {
    y = sectionRow(doc, y, 'Villa Check', ensurePage);
    villas.forEach((v) => {
      y = villaHeaderRow(doc, y, v.villaNumber, ensurePage);
      (report.villaItemLabels || []).forEach((label, i) => {
        y = itemRow(doc, y, label, (v.items || {})[i], ensurePage);
      });
    });
  }

  y = sectionRow(doc, y, 'Guest Interaction (Meet and talk to atleast 03 villas and inquire about their stay)', ensurePage);
  const guests = report.guestInteractions || [];
  if (guests.length === 0) {
    y = wideRow(doc, y, '', 'No guest interactions recorded.', '', 0, ensurePage);
  } else {
    guests.forEach((g, i) => {
      y = wideRow(doc, y, i + 1, g.villaGuest || '', g.comment || '', 0, ensurePage);
    });
  }

  y = sectionRow(doc, y, 'Any Issue/concern/complaint', ensurePage);
  const issues = report.issues || [];
  if (issues.length === 0) {
    y = wideRow(doc, y, '', 'No issues logged.', '', 0, ensurePage);
  } else {
    issues.forEach((iss) => {
      y = wideRow(doc, y, '', { photo: iss.photo }, iss.caption || '', 90, ensurePage);
    });
  }

  signatureRow(doc, y, report.signature, ensurePage);

  return docToBuffer(doc);
}

module.exports = { renderModReportPdf };
