// Downscales and re-encodes an image file client-side before it becomes a
// data URI for upload. Every image field in this app (Settings' logo/
// signature/stamp, Website's team/gallery photos, MyAccount's avatar, the
// client portal's payment-proof upload) stores the result as base64 text —
// in SQLite for the first three, see db/index.js — with no separate file
// storage service, so an unresized phone photo (often several MB, and a
// third bigger again once base64-encoded) both risks tripping a backend
// size cap outright and bloats every future response that carries it back
// down. Runs through an offscreen <canvas> rather than a library — no new
// dependency, the same "a browser API already does the job" call this app
// already makes for lib/csv.js's own hand-rolled parser.
//
// PNG is kept as PNG (logos/stamps are routinely transparent, and
// flattening that onto white would be a visible regression) — only the
// pixel dimensions shrink, still a real win for an oversized export. Every
// other raster type re-encodes as JPEG, since a photo has no transparency
// to protect and JPEG compresses far better at a size nobody can tell
// apart from the original on screen.
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.85;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read the selected image.'));
    };
    img.src = objectUrl;
  });
}

// Resolves to a resized data URI, or rejects with a friendly message. Not
// every caller wants this — a scanned PDF (payment proofs also accept
// application/pdf) can't be canvas-rendered this way, so callers that
// accept non-image files should skip straight to a plain FileReader for
// those instead of calling this.
export async function resizeImage(file, { maxDimension = DEFAULT_MAX_DIMENSION, quality = DEFAULT_QUALITY } = {}) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    throw new Error('That file is not a supported image.');
  }
  const img = await loadImage(file);
  const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const keepPng = file.type === 'image/png';
  if (!keepPng) {
    // JPEG has no alpha channel — flatten onto white first so a
    // transparent source doesn't silently render black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
}

// Decoded byte length of a base64 data URI — mirrors every backend
// validator's own `Math.ceil((base64.length * 3) / 4)` calc (see
// routes/settings.js, routes/website.js, routes/clientPortal.js), so a
// frontend pre-upload size check always agrees with what the server will
// actually enforce.
export function dataUriByteLength(dataUri) {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  return Math.ceil((base64.length * 3) / 4);
}
