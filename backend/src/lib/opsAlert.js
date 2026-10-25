// Fire-and-forget operator alert via the Telegram bot already used for ops
// monitoring (same TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_USER_IDS env vars).
// Never throws and never blocks the caller. Each `key` is throttled to one
// alert per hour so a failing mail run doesn't flood the chat. No-op when
// Telegram isn't configured. Messages must never contain secrets.
const THROTTLE_MS = 60 * 60 * 1000;
const lastSent = new Map();

function sendOpsAlert(text, key = 'default') {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const ids = (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!token || ids.length === 0) return;
    const now = Date.now();
    if (now - (lastSent.get(key) || 0) < THROTTLE_MS) return;
    lastSent.set(key, now);
    for (const chat_id of ids) {
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text: String(text).slice(0, 3500) }),
      }).catch(() => {});
    }
  } catch {
    // alerting must never break the caller
  }
}

module.exports = { sendOpsAlert };
