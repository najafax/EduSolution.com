// Best-effort heuristic for pulling something useful — ideally a payment
// reference/transaction number, but a transaction description if that's
// all the slip actually has — out of raw OCR text scanned from a bank
// slip — used by components/ScanPaymentSlip.jsx (see that file for why
// this needed to be its own pure, dependency-free function: it's the one
// piece of the scan feature that's actually unit-testable without a
// browser or a real image).
//
// Three passes, in order of confidence — returns as soon as one hits:
// 1. A line containing one of the common "this is the reference" keywords
//    (ref, reference, txn, transaction, trans no, confirmation, receipt no)
//    — the token right after the keyword (and an optional colon/#) is taken
//    as the reference. This is the common case: a bank slip almost always
//    labels its own reference number explicitly.
// 2. No reference keyword found — real slips reported back with no
//    reference actually printed on them at all (a simple till receipt, a
//    slip that only records what the payment was *for*), so falling
//    straight through to "couldn't detect anything" left staff typing the
//    whole thing in by hand even though the slip still had text worth
//    reading. Falls back to a *description*-style keyword instead
//    (description, particulars, remarks, narration, purpose, details,
//    memo, note, or "for") and takes the rest of that line — a short
//    phrase rather than a single code, capped at MAX_DESCRIPTION_LENGTH so
//    a long narration line doesn't blow out the Reference field.
// 3. Neither label found at all — falls back to the longest alphanumeric
//    token in the whole text that's at least MIN_FALLBACK_LENGTH
//    characters and contains at least one digit (so a stray English word
//    from the slip's letterhead, e.g. "TRANSFER", never gets picked over a
//    real reference just for being long).
// Every tier is still just a guess — this is why the caller always leaves
// the field editable and never treats the result as final.
//
// The keyword itself is followed by an optional "No"/"No."/"Number"/"#"
// suffix (`Reference No:`, `Transaction No.`, `Receipt No.`, `Confirmation#`
// are all common real-slip label shapes) — this used to be handled ad hoc
// per-keyword (only `trans(?:\s*no)?`/`receipt\s*no` accounted for it) and
// nowhere else, so a slip labeling its reference "Reference No: 123456" or
// "Transaction No: 123456" silently fell through: "No" got swallowed into
// the *value* capture attempt (breaking on the colon right after it) rather
// than recognized as part of the label, so the whole keyword match failed
// and this was left to the much less reliable fallback tier below. Sharing
// one optional suffix across every keyword closes that gap for all of them
// at once, not just the two that happened to have it hardcoded already.
const REFERENCE_KEYWORD_RE = /\b(?:ref(?:erence)?|txn|transaction|trans|confirmation|receipt)\b\.?\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/-]{3,})/i;
const DESCRIPTION_KEYWORD_RE = /\b(?:description|particulars?|remarks?|narration|purpose|details?|memo|note|for)\b\.?\s*[:#-]?\s*(.+)/i;
const MIN_FALLBACK_LENGTH = 6;
const MAX_DESCRIPTION_LENGTH = 60;

// Returns `{ value, source }` — `source` is 'reference' | 'description' |
// 'fallback', so the caller can word its notice accurately (a real
// reference reads differently from "no reference on this slip, here's the
// description instead") — or `null` when nothing at all was found.
export function extractReference(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;

  const referenceMatch = rawText.match(REFERENCE_KEYWORD_RE);
  if (referenceMatch) {
    return { value: referenceMatch[1].trim(), source: 'reference' };
  }

  const descriptionMatch = rawText.match(DESCRIPTION_KEYWORD_RE);
  if (descriptionMatch) {
    const value = descriptionMatch[1].trim().slice(0, MAX_DESCRIPTION_LENGTH);
    if (value) return { value, source: 'description' };
  }

  const candidates = rawText.match(/[A-Za-z0-9][A-Za-z0-9/-]{5,}/g) || [];
  const withDigits = candidates.filter((c) => /\d/.test(c));
  if (withDigits.length === 0) return null;

  const longest = withDigits.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.length >= MIN_FALLBACK_LENGTH ? { value: longest, source: 'fallback' } : null;
}
