// Small display helpers shared by the Inbox page and its compose modal.

// Times are stored as UTC "YYYY-MM-DD HH:MM:SS"; show them in Maldives time.
export function when(sqlTime, { short = false } = {}) {
  if (!sqlTime) return '';
  const d = new Date(`${sqlTime.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return sqlTime;
  const opts = short
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
    : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
  return d.toLocaleString('en-GB', { timeZone: 'Indian/Maldives', ...opts });
}

export function senderLabel(m) {
  return m.from_name || m.from_email || 'Unknown sender';
}

export function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Mirrors backend/src/lib/outbox.js, so a too-big attachment is refused
// before it is uploaded rather than only after a round trip.
export const MAX_ATTACH_FILES = 10;
export const MAX_ATTACH_BYTES = 5 * 1024 * 1024;

// A File -> { filename, content_type, data (base64), size }.
export function readAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read "${file.name}"`));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve({
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        data: result.slice(result.indexOf(',') + 1),
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}
