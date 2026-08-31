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
//    a long narration line doesn't blow out the Reference field. Unlike a
//    reference number, a description is often too long to fit on the same
//    printed line as its own label — see findDescription() below, which
//    walks into the next line or two when the label's own line is blank
//    rather than giving up the moment that one line has nothing on it.
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
// "Transaction No: 123456" silently fell through to the fallback tier.
// Sharing one optional suffix across every keyword closes that gap for all
// of them at once, not just the two that happened to have it hardcoded.
//
// Both keyword regexes are matched **one line at a time**, not against the
// whole raw text in one go — a bare `\s*` (used to allow flexible spacing
// around the label's own colon/dash) also matches a newline, so matching
// against the whole text let a *blank* reference field's own trailing
// whitespace reach straight past the line break and capture the next
// line's own label as if it were the value (a real bug report: a slip
// with an empty "Reference:" field followed by a "Date:" line came back
// with "date" filled in as the detected reference). Confining each match
// attempt to a single line at a time makes that structurally impossible —
// there is no newline character inside the string being matched for it to
// cross.
const REFERENCE_KEYWORD_RE = /\b(?:ref(?:erence)?|txn|transaction|trans|confirmation|receipt)\b\.?[ \t]*(?:no\.?|number|#)?[ \t]*[:#-]?[ \t]*([A-Za-z0-9][A-Za-z0-9/-]{3,})/i;
const DESCRIPTION_KEYWORD_RE = /\b(?:description|particulars?|remarks?|narration|purpose|details?|memo|note|for)\b\.?[ \t]*[:#-]?[ \t]*(.+)/i;
const MIN_FALLBACK_LENGTH = 6;
const MAX_DESCRIPTION_LENGTH = 60;

// Common slip labels that must never themselves be accepted as a captured
// *value* — a second, cheap safety net alongside the per-line matching
// above, for the rarer case where a label and the next field's label both
// land on what OCR reads as one line (a layout quirk, not just a blank
// field before a line break).
const LABEL_STOPWORDS = new Set([
  'date', 'time', 'amount', 'status', 'branch', 'account', 'name', 'total',
  'balance', 'currency', 'bank', 'page', 'none', 'no', 'na', 'n/a',
]);

// A date written as e.g. 12/05/2026, 2026-05-12, or 5-12-26 is exactly the
// kind of thing that *looks* like a real value to these heuristics —
// several digits, a couple of separators — but is never a payment
// reference. Slips print a date on nearly every line grouping, so without
// this the tier-3 fallback (the least reliable tier already) regularly
// picked one up whenever a label's own value was blank.
const DATE_LIKE_RE = /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/;

function isRealValue(candidate) {
  return Boolean(candidate) && /[A-Za-z0-9]/.test(candidate) && !LABEL_STOPWORDS.has(candidate.toLowerCase()) && !DATE_LIKE_RE.test(candidate);
}

// A line that itself opens with a known label — a reference/description
// keyword, or one of the plain LABEL_STOPWORDS field names (Date, Amount,
// Status, ...) — is never treated as free-text continuation of the
// *previous* label's value; see findDescription() below for the one place
// that matters. Built from the same word lists used above rather than a
// separately hand-maintained one, so a keyword added to either can't be
// forgotten here.
const LABEL_LINE_RE = new RegExp(
  `^(?:ref(?:erence)?|txn|transaction|trans|confirmation|receipt|description|particulars?|remarks?|narration|purpose|details?|memo|note|for|${[...LABEL_STOPWORDS].join('|')})\\b`,
  'i',
);

// Runs `keywordRe` against `text` one line at a time, returning the first
// line's captured group that survives isRealValue() — never a value from a
// different line than the label that introduced it.
function matchPerLine(text, keywordRe) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(keywordRe);
    const value = match?.[1]?.trim();
    if (isRealValue(value)) return value;
  }
  return null;
}

// A description is often too long to fit on the same printed line as its
// own label, so the label's line is blank ("Description:" with nothing
// after it) and the actual text sits on the line(s) below — unlike a
// reference number, which is short enough that a real slip essentially
// always prints it inline. matchPerLine() alone can't recover this case by
// design (see that function's own note on why staying within one line is
// deliberate for the reference tier), so this walks forward from a
// label-only line into the next couple of lines looking for the first one
// that reads as real content rather than another field's own label —
// bounded to 2 lines ahead (not unlimited) so a genuinely label-less slip
// doesn't have some unrelated line further down mistaken for it.
function findDescription(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(DESCRIPTION_KEYWORD_RE);
    if (!match) continue;

    const inline = match[1]?.trim();
    if (isRealValue(inline)) return inline;

    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = lines[j].trim();
      if (!next) continue; // a stray blank OCR line — keep looking
      if (LABEL_LINE_RE.test(next)) break; // the very next real line is another field, not a continuation
      return isRealValue(next) ? next : null;
    }
  }
  return null;
}

// Returns `{ value, source }` — `source` is 'reference' | 'description' |
// 'fallback', so the caller can word its notice accurately (a real
// reference reads differently from "no reference on this slip, here's the
// description instead") — or `null` when nothing at all was found.
export function extractReference(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;

  const reference = matchPerLine(rawText, REFERENCE_KEYWORD_RE);
  if (reference) return { value: reference, source: 'reference' };

  const description = findDescription(rawText);
  if (description) return { value: description.slice(0, MAX_DESCRIPTION_LENGTH), source: 'description' };

  const candidates = rawText.match(/[A-Za-z0-9][A-Za-z0-9/-]{5,}/g) || [];
  const withDigits = candidates.filter((c) => /\d/.test(c) && isRealValue(c));
  if (withDigits.length === 0) return null;

  const longest = withDigits.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.length >= MIN_FALLBACK_LENGTH ? { value: longest, source: 'fallback' } : null;
}
