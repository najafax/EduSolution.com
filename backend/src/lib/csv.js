// Minimal CSV serializer: quotes any field containing a comma, quote, or
// newline, doubling embedded quotes per RFC 4180. No external dependency
// needed for output this simple.
function toCsv(rows, columns) {
  const escape = (val) => {
    const str = val === null || val === undefined ? '' : String(val);
    // Guard against CSV/formula injection: a field starting with =, +, -, or @
    // is interpreted as a formula by Excel/Sheets when the export is opened.
    // Free-text fields (client/expense/quote/invoice names and notes) are
    // attacker-controllable by any staff member with just that module's
    // `manage` permission, so prefix with a leading quote to force text mode.
    const guarded = /^[=+\-@]/.test(str) ? `'${str}` : str;
    return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escape(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','),
  );
  return [header, ...lines].join('\r\n');
}

// Parses RFC-4180-ish CSV text (the counterpart to toCsv, above) into an
// array of row objects keyed by the header row. Handles quoted fields
// containing commas/newlines/escaped quotes, and both \r\n and \n line
// endings — matches what Excel/Google Sheets export, not just what toCsv
// produces. Blank trailing lines are skipped.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
    } else if (char === ',') {
      pushField();
      i += 1;
    } else if (char === '\r') {
      // Swallow bare \r and \r\n alike; the following \n (if any) is skipped next iteration.
      if (text[i + 1] === '\n') i += 1;
      pushRow();
      i += 1;
    } else if (char === '\n') {
      pushRow();
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }
  // Final field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) pushRow();

  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return [];

  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
}

module.exports = { toCsv, parseCsv };
