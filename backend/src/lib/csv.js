// Minimal CSV serializer: quotes any field containing a comma, quote, or
// newline, doubling embedded quotes per RFC 4180. No external dependency
// needed for output this simple.
function toCsv(rows, columns) {
  const escape = (val) => {
    const str = val === null || val === undefined ? '' : String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escape(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','),
  );
  return [header, ...lines].join('\r\n');
}

module.exports = { toCsv };
