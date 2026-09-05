// The two format-agnostic PDFKit helpers lib/modReportPdf.js needs —
// extracted from the main EduSolution app's own lib/pdf.js, which carries a
// lot more (quote/invoice page geometry, business branding) that has no
// place in this standalone app. Kept as their own file rather than inlined
// into modReportPdf.js so that file's own header comment (documenting which
// parts of the main app's lib/pdf.js it does and doesn't reuse) still holds
// true here unchanged.
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

function decodeImageDataUri(dataUri) {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUri || '');
  return match ? Buffer.from(match[2], 'base64') : null;
}

module.exports = { docToBuffer, decodeImageDataUri };
