// Central error recording. Server crashes, failed requests (5xx), scheduled-job
// failures and browser errors all land in `error_log`, de-duplicated by a
// fingerprint so one bug that fires 500 times is one row with count = 500.
// The first sighting of a fingerprint (and a recurrence after it was marked
// resolved) also pings Telegram through opsAlert. Recording must never throw.
const crypto = require('crypto');
const db = require('../db');
const { sendOpsAlert } = require('./opsAlert');

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_FIELD = 300;

const clip = (v, n) => (v == null ? '' : String(v).slice(0, n));

// Strip query strings / long digit runs / hex ids so the same bug on different
// records groups together.
function normalise(s) {
  return String(s || '')
    .replace(/\?.*$/gm, '')
    .replace(/\b[0-9a-f]{16,}\b/gi, ':id')
    .replace(/\d{3,}/g, 'N');
}

function fingerprint(source, message, stack) {
  const firstFrame = (String(stack || '').split('\n').find((l) => /\s+at |@/.test(l)) || '').trim();
  return crypto
    .createHash('sha1')
    .update(`${source}|${normalise(message)}|${normalise(firstFrame)}`)
    .digest('hex')
    .slice(0, 16);
}

function recordError({ source, message, stack, url, method, userAgent, userId, userName } = {}) {
  try {
    const src = ['server', 'job', 'browser'].includes(source) ? source : 'server';
    const msg = clip(message || 'Unknown error', MAX_MESSAGE);
    const stk = clip(stack, MAX_STACK);
    const fp = fingerprint(src, msg, stk);
    const existing = db.prepare('SELECT id, resolved FROM error_log WHERE fingerprint = ?').get(fp);
    if (existing) {
      db.prepare(
        `UPDATE error_log SET count = count + 1, last_seen_at = datetime('now'), resolved = 0,
           url = ?, user_name = ? WHERE id = ?`
      ).run(clip(url, MAX_FIELD), clip(userName, MAX_FIELD), existing.id);
    } else {
      db.prepare(
        `INSERT INTO error_log (fingerprint, source, message, stack, url, method, user_agent, user_id, user_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(fp, src, msg, stk, clip(url, MAX_FIELD), clip(method, 10), clip(userAgent, MAX_FIELD), userId || null, clip(userName, MAX_FIELD));
    }
    if (!existing || existing.resolved) {
      const where = url ? ` @ ${clip(url, 120)}` : '';
      sendOpsAlert(`⚠️ ${src} error${where}\n${msg.slice(0, 300)}`, `err:${fp}`);
    }
    return fp;
  } catch (e) {
    console.error('[errorLog] could not record error:', e.message);
    return null;
  }
}

// Keep the table small: drop resolved rows after 30 days and anything older than 90.
function pruneErrorLog() {
  db.prepare("DELETE FROM error_log WHERE (resolved = 1 AND last_seen_at < datetime('now','-30 days')) OR last_seen_at < datetime('now','-90 days')").run();
}

module.exports = { recordError, pruneErrorLog, fingerprint };
