const ExcelJS = require('exceljs');

// Shared XLSX serializer — the .xlsx counterpart to lib/csv.js's toCsv(),
// same `columns` shape ({ label, key } or { label, value: fn }) so every
// GET /export.xlsx route can reuse the exact same rows/columns its
// GET /export.csv sibling already defines, with no risk of the two formats
// drifting apart. Unlike toCsv (which stringifies everything, since CSV has
// no cell types), values here keep their real JS type — a number stays a
// numeric cell, not text — so Excel/Sheets render money/quantity columns as
// real, sortable/summable numbers. No CSV-injection guard is needed here:
// toCsv's leading "'" prefix exists because a CSV field is just re-parsed
// text that a spreadsheet app might reinterpret as a formula, but exceljs
// writes a plain string assignment as an explicit string-typed cell, which
// Excel never reinterprets as a formula regardless of its leading character.
async function toXlsxBuffer(rows, columns, sheetName = 'Sheet1') {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key || c.label.replace(/\s+/g, '_').toLowerCase(),
    width: Math.max(12, c.label.length + 4),
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const record = {};
    columns.forEach((c) => {
      const key = c.key || c.label.replace(/\s+/g, '_').toLowerCase();
      const value = typeof c.value === 'function' ? c.value(row) : row[c.key];
      record[key] = value === null || value === undefined ? '' : value;
    });
    sheet.addRow(record);
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { toXlsxBuffer };
