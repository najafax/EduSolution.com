// Best-effort heuristic for pulling something useful — ideally the full
// transaction description, but a labeled reference number if that's all
// the slip actually has — out of raw OCR text scanned from a bank slip —
// used by components/ScanPaymentSlip.jsx (see that file for why this
// needed to be its own pure, dependency-free function: it's the one piece
// of the scan feature that's actually unit-testable without a browser or a
// real image).
//
// Three passes, tried in this order, returning as soon as one hits:
// 1. A line containing one of the common "this is the description" keywords
//    (description, particulars, remarks, narration, purpose, details, memo,
//    note, or "for") — takes that line's own trailing text plus every real
//    line immediately below it (see findDescription() below), joined with
//    a space. This is tried FIRST, ahead of a labeled reference/transaction
//    ID, on a deliberate business call: on a real reported slip (Bank of
//    Maldives) the "Reference"/"Transaction ID" fields were just the bank's
//    own opaque internal code (identical to each other, meaningless for
//    reconciling a payment against an invoice), while "Description" carried
//    the actual client name and invoice codes — exactly what staff need to
//    match the payment. A slip with no real description at all (blank
//    label, or no description keyword on the slip) simply falls through to
//    tier 2 below, same as always.
// 2. No usable description found — falls back to a labeled reference/
//    transaction-number keyword (ref, reference, txn, transaction, trans
//    no, confirmation, receipt no) and takes the token right after it.
// 3. Neither label found at all — falls back to the longest alphanumeric
//    token in the whole text that's at least MIN_FALLBACK_LENGTH
//    characters and contains at least one digit (so a stray English word
//    from the slip's letterhead, e.g. "TRANSFER", never gets picked over a
//    real reference just for being long).
// Every tier is still just a guess — this is why the caller always leaves
// the field editable and never treats the result as final.
//
// The reference keyword itself is followed by an optional "No"/"No."/
// "Number"/"#" suffix (`Reference No:`, `Transaction No.`, `Receipt No.`,
// `Confirmation#` are all common real-slip label shapes) — this used to be
// handled ad hoc per-keyword (only `trans(?:\s*no)?`/`receipt\s*no`
// accounted for it) and nowhere else, so a slip labeling its reference
// "Reference No: 123456" or "Transaction No: 123456" silently fell through
// to the fallback tier. Sharing one optional suffix across every keyword
// closes that gap for all of them at once, not just the two that happened
// to have it hardcoded.
//
// The reference regex is matched **one line at a time**, not against the
// whole raw text in one go — a bare `\s*` (used to allow flexible spacing
// around the label's own colon/dash) also matches a newline, so matching
// against the whole text let a *blank* reference field's own trailing
// whitespace reach straight past the line break and capture the next
// line's own label as if it were the value (a real bug report: a slip
// with an empty "Reference:" field followed by a "Date:" line came back
// with "date" filled in as the detected reference). Confining each match
// attempt to a single line at a time makes that structurally impossible —
// there is no newline character inside the string being matched for it to
// cross. A reference number is always short enough to fit on one printed
// line, unlike a description (see findDescription() below), so this
// single-line confinement stays deliberate for this tier specifically.
//
// The captured reference value's own character class includes a literal
// backslash alongside the forward slash/hyphen it already allowed — some
// bank reference numbers are themselves compound, slash- or backslash-
// separated codes (e.g. `FT26242CWFLC\MV1`, a real one reported back), and
// without it the match stopped dead at the backslash and only
// "FT26242CWFLC" got captured, silently dropping the rest of the real
// reference.
const REFERENCE_KEYWORD_RE = /\b(?:ref(?:erence)?|txn|transaction|trans|confirmation|receipt)\b\.?[ \t]*(?:no\.?|number|#)?[ \t]*[:#-]?[ \t]*([A-Za-z0-9][A-Za-z0-9/\\-]{3,})/i;
const DESCRIPTION_KEYWORD_RE = /\b(?:description|particulars?|remarks?|narration|purpose|details?|memo|note|for)\b\.?[ \t]*[:#-]?[ \t]*(.+)/i;
const MIN_FALLBACK_LENGTH = 6;
// A joined multi-line description (see findDescription()'s own MAX_DESCRIPTION_LINES)
// can legitimately run well past a single reference code's length — a real
// reported slip's own description block, "R. ATOLL SCHOOL BLAZ1IQ8FLR1N5H69
// GS18/BML/2026/08", is already 50 characters on its own — so this is sized
// with real headroom above that rather than the much shorter single-token
// cap a bare reference number would need.
const MAX_DESCRIPTION_LENGTH = 160;
// How many real content lines (inline + continuation) findDescription()
// will collect and join for one description block — bounded so a
// genuinely unlabeled slip further down the page can't be mistaken for
// more of the same description.
const MAX_DESCRIPTION_LINES = 5;

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

// A description is often too long — or split across several distinct
// details (a client name, an invoice code, a batch reference) — to fit on
// a single printed line the way a reference number does, so this collects
// EVERY real content line starting from the label, not just the first one:
// the label's own trailing text (if any) plus each following line, up to
// MAX_DESCRIPTION_LINES, stopping the moment a line reads as another
// field's own label (LABEL_LINE_RE) rather than a continuation. This used
// to return as soon as it found one real line — including the inline text
// right after the label — so a description that continued onto further
// lines below (a real reported case: "Description" followed by three
// separate lines — a client name, then two more codes — only the first of
// which was ever picked up) silently lost everything after that first
// line. Collecting the whole block and joining it is what actually answers
// "pick up every detail in description," not just the first fragment of it.
function findDescription(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(DESCRIPTION_KEYWORD_RE);
    if (!match) continue;

    const collected = [];
    const inline = match[1]?.trim();
    if (isRealValue(inline)) collected.push(inline);

    for (let j = i + 1; j < lines.length && collected.length < MAX_DESCRIPTION_LINES; j++) {
      const next = lines[j].trim();
      if (!next) {
        if (collected.length > 0) break; // a blank line after real content marks the end of this block
        continue; // still looking for the block's first real line
      }
      if (LABEL_LINE_RE.test(next)) break; // the next real line is another field, not a continuation
      if (!isRealValue(next)) break;
      collected.push(next);
    }

    if (collected.length > 0) return collected.join(' ');
  }
  return null;
}

// Returns `{ value, source }` — `source` is 'description' | 'reference' |
// 'fallback', so the caller can word its notice accurately — or `null`
// when nothing at all was found.
export function extractReference(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;

  const description = findDescription(rawText);
  if (description) return { value: description.slice(0, MAX_DESCRIPTION_LENGTH), source: 'description' };

  const reference = matchPerLine(rawText, REFERENCE_KEYWORD_RE);
  if (reference) return { value: reference, source: 'reference' };

  const candidates = rawText.match(/[A-Za-z0-9][A-Za-z0-9/\\-]{5,}/g) || [];
  const withDigits = candidates.filter((c) => /\d/.test(c) && isRealValue(c));
  if (withDigits.length === 0) return null;

  const longest = withDigits.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.length >= MIN_FALLBACK_LENGTH ? { value: longest, source: 'fallback' } : null;
}
