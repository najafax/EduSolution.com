// Best-effort reconstruction of "which clients didn't get this campaign
// email" for a campaign sent BEFORE the campaign_failures table existed
// (see routes/campaigns.js/db/index.js) — for any campaign sent after that
// fix, the failed recipients are already recorded and viewable/resendable
// straight from the Campaigns page, no script needed.
//
// For an older campaign, the exact list of who was targeted was never
// stored (only a recipient_count number) — only *successful* sends were
// ever recorded, in email_log (type: 'campaign', entity_id: client id).
// So this can't recover the failed list with certainty; it approximates it
// as "every client with an email on file today that has no successful
// email_log entry for this campaign's exact subject" — which is a
// superset of the real failures, since it also includes any client who
// was legitimately never targeted in the first place (e.g. excluded on
// purpose, like Licenses.jsx's "Notify price increase" excluding clients
// with a cancelled license — or a client created after the send). Clients
// currently on a cancelled license are called out separately for that
// reason — cross-check against how the original campaign was sent before
// treating them as real failures.
//
// Usage:
//   node scripts/find-campaign-failures.js               # lists sent campaigns to pick from
//   node scripts/find-campaign-failures.js --id=<id>      # reconstructs the likely-missed list for one
require('dotenv').config();
const db = require('../src/db');

const idArg = process.argv.find((a) => a.startsWith('--id='));

function listCampaigns() {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC, id DESC').all();
  if (campaigns.length === 0) {
    console.log('No campaigns have been sent yet.');
    return;
  }
  console.log('Sent campaigns (newest first) — re-run with --id=<id> for the one you want:\n');
  for (const c of campaigns) {
    const flag = c.failed_count > 0 ? `  <-- ${c.failed_count} failed` : '';
    console.log(`  #${c.id}  ${c.created_at}  "${c.subject}"  (sent ${c.sent_count}/${c.recipient_count})${flag}`);
  }
}

function reconstruct(id) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!campaign) {
    console.error(`No campaign found with id ${id}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Campaign #${campaign.id}: "${campaign.subject}"`);
  console.log(`Sent ${campaign.created_at} by ${campaign.sent_by_name || 'unknown'} — recorded ${campaign.sent_count} sent, ${campaign.failed_count} failed, out of ${campaign.recipient_count} targeted.\n`);

  if (campaign.failed_count === 0) {
    console.log('This campaign has no recorded failures — nothing to reconstruct.');
    return;
  }

  const failureRows = db.prepare('SELECT * FROM campaign_failures WHERE campaign_id = ?').all(campaign.id);
  if (failureRows.length > 0) {
    console.log('This campaign already has real failure records — no need to guess. Use the Campaigns page "view" link instead:\n');
    for (const f of failureRows) {
      console.log(`  ${f.client_name}  <${f.client_email}>  — ${f.error}`);
    }
    return;
  }

  const successes = db
    .prepare("SELECT DISTINCT entity_id FROM email_log WHERE type = 'campaign' AND subject = ? AND entity_id IS NOT NULL")
    .all(campaign.subject)
    .map((r) => r.entity_id);

  if (successes.length !== campaign.sent_count) {
    console.log(
      `Note: found ${successes.length} successful sends logged under this exact subject, but the campaign recorded ${campaign.sent_count}. ` +
        `If this subject was reused by more than one campaign, this list may not be exact.\n`,
    );
  }

  const allClients = db.prepare("SELECT id, name, email FROM clients WHERE TRIM(COALESCE(email, '')) != ''").all();
  const successSet = new Set(successes);
  const missing = allClients.filter((c) => !successSet.has(c.id));

  const cancelledClientIds = new Set(
    db.prepare("SELECT DISTINCT client_id FROM licenses WHERE status = 'cancelled'").all().map((r) => r.client_id),
  );

  const likelyFailed = missing.filter((c) => !cancelledClientIds.has(c.id));
  const likelyExcluded = missing.filter((c) => cancelledClientIds.has(c.id));

  console.log(`${likelyFailed.length} client(s) likely failed to receive this email (no cancelled license, no successful send on record):\n`);
  for (const c of likelyFailed) {
    console.log(`  ${c.name}  <${c.email}>`);
  }

  if (likelyExcluded.length > 0) {
    console.log(
      `\n${likelyExcluded.length} more client(s) also have no successful send on record, but currently have a cancelled license — ` +
        `if this campaign was sent via "Notify price increase" (which deliberately excludes those), they were probably never targeted at all, not real failures:\n`,
    );
    for (const c of likelyExcluded) {
      console.log(`  ${c.name}  <${c.email}>`);
    }
  }

  console.log(
    `\nThis is a best-effort reconstruction, not a certainty — it can't tell "failed to send" apart from "wasn't targeted" for a campaign sent before failure tracking existed. Use these names in Campaigns → New campaign → Select clients to resend.`,
  );
}

if (idArg) {
  reconstruct(Number(idArg.split('=')[1]));
} else {
  listCampaigns();
}
