// Best-effort heuristic for pulling a payment reference/transaction number
// out of raw OCR text scanned from a bank slip — used by
// components/ScanPaymentSlip.jsx (see that file for why this needed to be
// its own pure, dependency-free function: it's the one piece of the scan
// feature that's actually unit-testable without a browser or a real image).
//
// Two passes, in order of confidence:
// 1. A line containing one of the common "this is the reference" keywords
//    (ref, reference, txn, transaction, trans no, confirmation, receipt no)
//    — the token right after the keyword (and an optional colon/#) is taken
//    as the reference. This is the common case: a bank slip almost always
//    labels its own reference number explicitly.
// 2. No keyword match at all — fall back to the longest alphanumeric token
//    in the whole text that's at least MIN_FALLBACK_LENGTH characters and
//    contains at least one digit (so a stray English word from the slip's
//    letterhead, e.g. "TRANSFER", never gets picked over a real reference
//    just for being long). Still just a guess — this is why the caller
//    always leaves the field editable and never treats this as final.
const KEYWORD_RE = /\b(?:ref(?:erence)?|txn|transaction|trans(?:\s*no)?|confirmation|receipt\s*no)\b\.?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/-]{3,})/i;
const MIN_FALLBACK_LENGTH = 6;

export function extractReference(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;

  const keywordMatch = rawText.match(KEYWORD_RE);
  if (keywordMatch) {
    return keywordMatch[1].trim();
  }

  const candidates = rawText.match(/[A-Za-z0-9][A-Za-z0-9/-]{5,}/g) || [];
  const withDigits = candidates.filter((c) => /\d/.test(c));
  if (withDigits.length === 0) return null;

  return withDigits.reduce((longest, c) => (c.length > longest.length ? c : longest), '').length >= MIN_FALLBACK_LENGTH
    ? withDigits.reduce((longest, c) => (c.length > longest.length ? c : longest))
    : null;
}
