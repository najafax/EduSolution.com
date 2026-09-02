// Mirrors backend/src/routes/website.js's own extractDriveFileId — pulls the
// file id out of any real Google Drive share-link shape (/file/d/<id>/...,
// ?id=<id>) so the frontend can build a thumbnail URL without a round trip
// to the backend for one. Kept as its own small duplicated copy rather than
// a shared package, same acceptable-duplication precedent this app already
// follows between routes/licenses.js and lib/scheduler.js for EXPIRY_WARNING_DAYS.
const DRIVE_FILE_ID_RE = /(?:\/file\/d\/|[?&]id=)([\w-]{10,})/;

export function extractDriveFileId(url) {
  const match = DRIVE_FILE_ID_RE.exec(url || '');
  return match ? match[1] : null;
}

// Google's own public thumbnail endpoint for a shared Drive file — this is
// a still image only, not a video stream; see components/VideoThumbnail.jsx
// for why a real auto-playing preview isn't achievable from a Drive link.
export function driveThumbnailUrl(url, size = 800) {
  const id = extractDriveFileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w${size}` : null;
}
