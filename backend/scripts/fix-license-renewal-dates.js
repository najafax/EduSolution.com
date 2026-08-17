// One-off correction for license_renewals rows (and the license's current
// expiry_date) written by the old, buggy renewLicense() — which advanced a
// renewal from whichever was later, the license's expiry_date or *today*,
// instead of always from the license's own expiry_date. That meant renewing
// a lapsed license landed the new expiry on today's day-of-month instead of
// the license's real billing day (see lib/licenseRenewal.js's current
// doc comment and CLAUDE.md's "The core action" section for the fixed
// behavior this script retroactively applies to old data).
//
// Safe by construction, not a blind bulk UPDATE: for each license, walks its
// license_renewals chronologically from the first row's previous_expiry_date
// (a trustworthy snapshot — it was written from the license's real state
// before any bug-affected computation ever ran, never itself computed by the
// buggy code) and recomputes what each new_expiry_date *should* have been
// with today's advanceExpiry(). The moment a row's own recorded
// previous_expiry_date doesn't match what the (possibly-corrected) prior
// step produced, that license's chain is left alone from that point
// forward and reported as NEEDS MANUAL REVIEW instead of guessed at — that
// mismatch means something this script can't safely explain happened
// in between (most plausibly a deliberate manual edit to expiry_date),
// so overwriting it would risk destroying real, intentional data instead
// of fixing a bug.
//
// Usage:
//   node scripts/fix-license-renewal-dates.js            # dry run, reports only
//   node scripts/fix-license-renewal-dates.js --apply     # writes the fixes
//
// Take a fresh backup first (`npm run backup`, or just copy data.sqlite3 if
// running locally/self-hosted) — this writes to real license/renewal rows.
require('dotenv').config();
const db = require('../src/db');
const { advanceExpiry } = require('../src/lib/licenseRenewal');

const APPLY = process.argv.includes('--apply');

function planForLicense(license, renewals) {
  // No renewal history at all — nothing this script touches.
  if (renewals.length === 0) return null;

  const rowFixes = [];
  // Two parallel trackers walked step by step:
  //  - rawPrev: what was *actually* recorded/lived as the license's expiry
  //    after each renewal (bug and all) — used only to confirm renewal N+1
  //    really is the direct successor of renewal N, with nothing else
  //    (e.g. a manual expiry_date edit) happening in between.
  //  - correctedPrev: the "chain of truth" — what the expiry *should* have
  //    been at each step had the bug never run — used both to compute what
  //    each renewal's new_expiry_date should actually have been, and (for
  //    every row after the first) to also correct that row's own
  //    previous_expiry_date — otherwise a downstream row would keep citing
  //    the old buggy value as its starting point, leaving the log
  //    internally inconsistent (and making a future re-run of this script
  //    misread the now-corrected chain as a fresh discontinuity).
  // The first row's previous_expiry_date seeds both: it's a trustworthy
  // snapshot of the license's real state before any renewal (and thus any
  // bug) ever touched it, so it's never itself rewritten.
  let rawPrev = renewals[0].previous_expiry_date;
  let correctedPrev = rawPrev;
  let clean = true;

  renewals.forEach((row, index) => {
    if (!clean) return;
    if (row.previous_expiry_date !== rawPrev) {
      clean = false;
      return;
    }
    const expected = advanceExpiry(correctedPrev, license.billing_cycle);
    const previousFix = index > 0 && row.previous_expiry_date !== correctedPrev ? correctedPrev : null;
    const newFix = row.new_expiry_date !== expected ? expected : null;
    if (previousFix || newFix) {
      rowFixes.push({
        id: row.id,
        previousFrom: row.previous_expiry_date,
        previousTo: previousFix,
        newFrom: row.new_expiry_date,
        newTo: newFix,
      });
    }
    rawPrev = row.new_expiry_date;
    correctedPrev = expected;
  });

  if (!clean) {
    return { status: 'manual-review', reason: 'renewal chain has a gap not explained by billing_cycle math (likely a manual expiry_date edit between renewals)' };
  }
  if (rowFixes.length === 0) {
    return { status: 'ok' };
  }

  // Only safe to also correct the license's *current* expiry_date if
  // nothing has touched it since the last renewal in this chain — i.e. it
  // still equals exactly what that (buggy) last renewal actually wrote
  // (rawPrev, after the loop, is that value). If it doesn't match,
  // someone/something changed it afterward and we don't know what to
  // trust, so we fix the history log only and leave the live expiry_date
  // for a human to check.
  const expiryUntouchedSinceLastRenewal = license.expiry_date === rawPrev;

  return {
    status: 'fix',
    rowFixes,
    correctedExpiry: correctedPrev,
    updateLicenseExpiry: expiryUntouchedSinceLastRenewal,
  };
}

function run() {
  const licenses = db.prepare('SELECT id, name, billing_cycle, expiry_date FROM licenses').all();
  const renewalsByLicense = new Map();
  for (const row of db.prepare('SELECT * FROM license_renewals ORDER BY license_id, renewed_at ASC, id ASC').all()) {
    if (!renewalsByLicense.has(row.license_id)) renewalsByLicense.set(row.license_id, []);
    renewalsByLicense.get(row.license_id).push(row);
  }

  let okCount = 0;
  let fixCount = 0;
  let reviewCount = 0;
  const apply = db.transaction((fixes) => {
    for (const fix of fixes) {
      for (const rowFix of fix.rowFixes) {
        if (rowFix.newTo) {
          db.prepare('UPDATE license_renewals SET new_expiry_date = ? WHERE id = ?').run(rowFix.newTo, rowFix.id);
        }
        if (rowFix.previousTo) {
          db.prepare('UPDATE license_renewals SET previous_expiry_date = ? WHERE id = ?').run(rowFix.previousTo, rowFix.id);
        }
      }
      if (fix.updateLicenseExpiry) {
        db.prepare(`UPDATE licenses SET expiry_date = ?, updated_at = datetime('now') WHERE id = ?`).run(fix.correctedExpiry, fix.licenseId);
      }
    }
  });

  const toApply = [];

  for (const license of licenses) {
    const renewals = renewalsByLicense.get(license.id) || [];
    const plan = planForLicense(license, renewals);
    if (!plan) continue;

    if (plan.status === 'ok') {
      okCount += 1;
      continue;
    }
    if (plan.status === 'manual-review') {
      reviewCount += 1;
      console.log(`[REVIEW] License #${license.id} "${license.name}" — ${plan.reason}. Not touched.`);
      continue;
    }

    fixCount += 1;
    console.log(`[FIX] License #${license.id} "${license.name}" (${license.billing_cycle}):`);
    for (const rowFix of plan.rowFixes) {
      if (rowFix.newTo) console.log(`   renewal #${rowFix.id}: new_expiry_date ${rowFix.newFrom} -> ${rowFix.newTo}`);
      if (rowFix.previousTo) console.log(`   renewal #${rowFix.id}: previous_expiry_date ${rowFix.previousFrom} -> ${rowFix.previousTo}`);
    }
    if (plan.updateLicenseExpiry) {
      console.log(`   license.expiry_date: ${license.expiry_date} -> ${plan.correctedExpiry}`);
    } else {
      console.log(
        `   license.expiry_date left as-is (${license.expiry_date}) — doesn't match the last renewal's recorded new_expiry_date (${renewals[renewals.length - 1].new_expiry_date}), so it was likely edited since; check it manually.`,
      );
    }
    toApply.push({ ...plan, licenseId: license.id });
  }

  console.log('');
  console.log(`${okCount} already correct, ${fixCount} to fix, ${reviewCount} need manual review.`);

  if (!APPLY) {
    console.log('\nDry run only — nothing was written. Re-run with --apply to write these fixes.');
    return;
  }
  if (toApply.length === 0) {
    console.log('\nNothing to apply.');
    return;
  }
  apply(toApply);
  console.log(`\nApplied ${toApply.length} license fix(es).`);
}

run();
