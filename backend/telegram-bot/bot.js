// A Telegram bot for checking on and updating the droplet this backend runs
// on, from a phone, without SSHing in. Runs as its own systemd service,
// separate from the API process (see deploy/digitalocean/telegram-bot.service),
// but reuses the backend's own .env and, for business-data commands, its own
// lib/route modules directly — the same "shell/ops access is already a
// higher trust level than anything in-app" precedent backend/scripts/*.js
// already rely on (see scripts/create-user.js's own note on this), so these
// commands read the database directly rather than going through the
// permission system or an HTTP round trip to the API they're sitting next to.
//
// Every update is restricted to a fixed allowlist of Telegram user ids
// (TELEGRAM_ALLOWED_USER_IDS), checked once as global middleware — a
// message/button tap from anyone else is silently dropped (no reply at all),
// so a stranger who finds the bot learns nothing about it.
//
// Built on node-telegram-bot-api@2 (the "v2" from-scratch rewrite, zero
// runtime dependencies) rather than the older 0.x line, which is still
// widely used but drags in the long-deprecated `request` library and ships
// with known-vulnerable transitive dependencies (form-data/qs/tough-cookie) —
// `npm audit` flags those as critical/moderate. v2 has none of that.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { exec } = require('child_process');
const { promisify } = require('util');
const https = require('https');
const { Bot } = require('node-telegram-bot-api');
const { run: runBot } = require('node-telegram-bot-api/node');

const execAsync = promisify(exec);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_IDS = new Set(
  String(process.env.TELEGRAM_ALLOWED_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const API_DOMAIN = process.env.TELEGRAM_API_DOMAIN || 'api.edusolutionsmaldives.com';
const SERVICE_NAME = process.env.TELEGRAM_BACKEND_SERVICE || 'edusolution-backend';
const CERT_PATH =
  process.env.TELEGRAM_CERT_PATH || `/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem`;
const ALERT_INTERVAL_MINUTES = Number(process.env.TELEGRAM_ALERT_INTERVAL_MINUTES) || 5;
const DISK_ALERT_PERCENT = Number(process.env.TELEGRAM_DISK_ALERT_PERCENT) || 85;
const CERT_ALERT_DAYS = Number(process.env.TELEGRAM_CERT_ALERT_DAYS) || 14;

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not set in backend/.env — see backend/telegram-bot/README.md');
  process.exit(1);
}
if (ALLOWED_IDS.size === 0) {
  console.error('TELEGRAM_ALLOWED_USER_IDS is not set in backend/.env — see backend/telegram-bot/README.md');
  process.exit(1);
}

// Repo layout: this file lives at <repo>/backend/telegram-bot/bot.js.
const BACKEND_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Loaded after dotenv has configured DB_PATH above, so db/index.js (which
// reads process.env.DB_PATH at require time) opens the real production
// database rather than the local default.
const db = require(path.join(BACKEND_DIR, 'src', 'db'));
const { computeSummary } = require(path.join(BACKEND_DIR, 'src', 'routes', 'financials'));
const { computeDailyEarnings } = require(path.join(BACKEND_DIR, 'src', 'lib', 'dailyEarningsReport'));
const { isConfigured: backupsConfigured, listBackups } = require(path.join(
  BACKEND_DIR,
  'src',
  'lib',
  'backup',
));

const bot = new Bot(BOT_TOKEN);

function isAllowed(id) {
  return ALLOWED_IDS.has(String(id));
}

async function broadcast(text) {
  for (const id of ALLOWED_IDS) {
    // eslint-disable-next-line no-await-in-loop
    await bot.api.sendMessage({ chat_id: id, text, parse_mode: 'Markdown' }).catch(() => {});
  }
}

function currencySymbol() {
  const row = db.prepare('SELECT currency_symbol FROM business_settings WHERE id = 1').get();
  return row?.currency_symbol || '$';
}

function money(amount) {
  return `${currencySymbol()}${Number(amount || 0).toFixed(2)}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Telegram messages cap at 4096 chars — long command output (journalctl,
// multi-step deploy logs) gets split into chunks on whole lines rather than
// mid-word, so a single long command never silently fails to send.
async function sendLong(chatId, text) {
  const LIMIT = 3900;
  if (text.length <= LIMIT) {
    await bot.api.sendMessage({ chat_id: chatId, text });
    return;
  }
  const lines = text.split('\n');
  let chunk = '';
  for (const line of lines) {
    if ((chunk + line).length > LIMIT) {
      // eslint-disable-next-line no-await-in-loop
      await bot.api.sendMessage({ chat_id: chatId, text: chunk });
      chunk = '';
    }
    chunk += `${line}\n`;
  }
  if (chunk.trim()) await bot.api.sendMessage({ chat_id: chatId, text: chunk });
}

async function runCmd(cmd) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
    return { ok: true, output: (stdout || stderr || '').trim() };
  } catch (err) {
    return { ok: false, output: (err.stdout || err.stderr || err.message || String(err)).trim() };
  }
}

function humanizeDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

async function serviceState(serviceName) {
  const active = await runCmd(`systemctl is-active ${serviceName}`);
  const since = await runCmd(`systemctl show ${serviceName} -p ActiveEnterTimestamp --value`);
  let uptime = '';
  const ts = Date.parse(since.output);
  if (active.output === 'active' && !Number.isNaN(ts)) {
    uptime = ` (up ${humanizeDuration(Date.now() - ts)})`;
  }
  return { active: active.output, label: `${active.output}${uptime}` };
}

async function diskLine(mountPath) {
  const { ok, output } = await runCmd(`df -h ${mountPath} | tail -1`);
  if (!ok) return `${mountPath}: n/a`;
  const parts = output.trim().split(/\s+/);
  // df columns: Filesystem Size Used Avail Use% Mounted
  const usedPct = parts[4] || '?';
  const avail = parts[3] || '?';
  return { line: `${mountPath}: ${usedPct} used, ${avail} free`, pct: parseInt(usedPct, 10) || 0 };
}

async function certDaysLeft() {
  const { ok, output } = await runCmd(`openssl x509 -enddate -noout -in ${CERT_PATH}`);
  if (!ok) return null;
  const match = output.match(/notAfter=(.+)/);
  if (!match) return null;
  const expiry = new Date(match[1]);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.floor((expiry.getTime() - Date.now()) / 86400000);
}

function healthCheck() {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = https.get(`https://${API_DOMAIN}/api/auth/me`, { timeout: 10000 }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode, ms: Date.now() - start });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: null, ms: Date.now() - start });
    });
    req.on('error', () => resolve({ ok: false, status: null, ms: Date.now() - start }));
  });
}

async function buildStatusReport() {
  const [backend, nginx, health, cert, rootDisk, dataDisk] = await Promise.all([
    serviceState(SERVICE_NAME),
    serviceState('nginx'),
    healthCheck(),
    certDaysLeft(),
    diskLine('/'),
    diskLine('/var/data'),
  ]);

  const healthLine = health.ok ? `✅ reachable (HTTP ${health.status}, ${health.ms}ms)` : '❌ unreachable';
  const certLine = cert === null ? 'n/a' : cert < 0 ? `⚠️ EXPIRED ${Math.abs(cert)}d ago` : `${cert}d left`;

  return [
    `*${SERVICE_NAME}*: ${backend.active === 'active' ? '✅' : '❌'} ${backend.label}`,
    `*nginx*: ${nginx.active === 'active' ? '✅' : '❌'} ${nginx.label}`,
    `*Public API*: ${healthLine}`,
    `*TLS cert*: ${certLine}`,
    `*Disk /*: ${typeof rootDisk === 'string' ? rootDisk : rootDisk.line}`,
    `*Disk /var/data*: ${typeof dataDisk === 'string' ? dataDisk : dataDisk.line}`,
  ].join('\n');
}

async function buildTodayReport() {
  const summary = computeSummary();
  const earnings = computeDailyEarnings(todayStr());
  const pending = db.prepare("SELECT COUNT(*) AS n FROM quote_requests WHERE status = 'pending'").get().n;

  return [
    `*Bank balance*: ${money(summary.bankBalance)}`,
    `*Received today*: ${money(earnings.totalReceived)} (${earnings.payments.length} payment${earnings.payments.length === 1 ? '' : 's'})`,
    `*Expenses today*: ${money(earnings.totalExpenses)}`,
    `*Net today*: ${money(earnings.netEarning)}`,
    `*Overdue invoices*: ${summary.overdueCount} totaling ${money(summary.overdueAmount)}`,
    `*Pending quote requests*: ${pending}`,
  ].join('\n');
}

async function buildBackupReport() {
  if (!backupsConfigured()) return 'Backups aren’t configured (BACKUP_S3_* unset in .env).';
  const [daily, weekly] = await Promise.all([listBackups('backups/daily/'), listBackups('backups/weekly/')]);
  const latest = (list) => (list.length ? list[list.length - 1] : null);
  const latestDaily = latest(daily);
  const latestWeekly = latest(weekly);
  return [
    latestDaily
      ? `*Last daily*: ${latestDaily.LastModified.toISOString().replace('T', ' ').slice(0, 19)} UTC`
      : '*Last daily*: none yet',
    latestWeekly
      ? `*Last weekly*: ${latestWeekly.LastModified.toISOString().replace('T', ' ').slice(0, 19)} UTC`
      : '*Last weekly*: none yet',
    `${daily.length} daily / ${weekly.length} weekly backups on file.`,
  ].join('\n');
}

const HELP_TEXT = [
  '*EduSolution ops bot*',
  '',
  '/status — backend, nginx, disk, TLS cert, public API reachability',
  '/today — bank balance, today’s earnings, overdue invoices, pending quote requests',
  '/backup — last daily/weekly backup time',
  '/logs [n] — last n lines of backend logs (default 50, max 300)',
  '/restart — restart the backend service (asks to confirm)',
  '/deploy — pull latest main + restart (asks to confirm)',
].join('\n');

const CONFIRM_KEYBOARD = (confirmData, confirmLabel) => ({
  inline_keyboard: [[
    { text: confirmLabel, callback_data: confirmData },
    { text: 'Cancel', callback_data: 'cancel' },
  ]],
});

async function doRestart(chatId) {
  await bot.api.sendMessage({ chat_id: chatId, text: `Restarting ${SERVICE_NAME}…` });
  await runCmd(`systemctl restart ${SERVICE_NAME}`);
  await new Promise((r) => setTimeout(r, 2000));
  const state = await serviceState(SERVICE_NAME);
  await bot.api.sendMessage({ chat_id: chatId, text: `${state.active === 'active' ? '✅' : '❌'} ${state.label}` });
}

// Stops at the first failing step rather than pressing on — a non-fast-
// forward merge (someone pushed something this droplet's checkout can't
// cleanly take) is reported and left for a human to resolve by hand, never
// force-reset or auto-merged.
async function doDeploy(chatId) {
  await bot.api.sendMessage({ chat_id: chatId, text: 'Fetching latest `main`…', parse_mode: 'Markdown' });
  const steps = [
    { label: 'git fetch', cmd: `git -C "${REPO_ROOT}" fetch origin main` },
    { label: 'git checkout main', cmd: `git -C "${REPO_ROOT}" checkout main` },
    { label: 'git merge --ff-only', cmd: `git -C "${REPO_ROOT}" merge --ff-only origin/main` },
    { label: 'npm install', cmd: `cd "${BACKEND_DIR}" && npm install --omit=dev` },
  ];
  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    const { ok, output } = await runCmd(step.cmd);
    if (!ok) {
      // eslint-disable-next-line no-await-in-loop
      await sendLong(chatId, `❌ ${step.label} failed:\n${output}`);
      return;
    }
  }
  await bot.api.sendMessage({ chat_id: chatId, text: 'Deployed. Restarting…' });
  await doRestart(chatId);
}

// --- Auth gate, registered first so no command handler below it ever runs
// for a sender who isn't on the allowlist ("registration order wins"). ---
bot.use(async (ctx, next) => {
  if (!isAllowed(ctx.from?.id)) return;
  await next();
});

bot.catch((err, ctx) => {
  console.error('handler error:', err);
  const chatId = ctx.chatId;
  if (chatId) {
    bot.api.sendMessage({ chat_id: chatId, text: `Something went wrong: ${err.message}` }).catch(() => {});
  }
});

bot.command(['start', 'help'], (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' }));

bot.command('status', async (ctx) => ctx.reply(await buildStatusReport(), { parse_mode: 'Markdown' }));

bot.command('today', async (ctx) => ctx.reply(await buildTodayReport(), { parse_mode: 'Markdown' }));

bot.command('backup', async (ctx) => ctx.reply(await buildBackupReport(), { parse_mode: 'Markdown' }));

bot.command('logs', async (ctx) => {
  const n = Math.min(Number(ctx.match) || 50, 300);
  const { output } = await runCmd(`journalctl -u ${SERVICE_NAME} -n ${n} --no-pager`);
  await sendLong(ctx.chatId, output || '(no log output)');
});

bot.command('restart', (ctx) =>
  ctx.reply(`Restart ${SERVICE_NAME}?`, {
    reply_markup: CONFIRM_KEYBOARD('restart_confirm', 'Yes, restart'),
  }));

bot.command('deploy', (ctx) =>
  ctx.reply('Pull latest `main` and restart the backend?', {
    parse_mode: 'Markdown',
    reply_markup: CONFIRM_KEYBOARD('deploy_confirm', 'Yes, deploy'),
  }));

bot.on('callback_query', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  const chatId = ctx.chatId;
  const data = ctx.callbackQuery?.data;
  if (!chatId) return;
  if (data === 'cancel') {
    await bot.api.sendMessage({ chat_id: chatId, text: 'Cancelled.' });
  } else if (data === 'restart_confirm') {
    await doRestart(chatId);
  } else if (data === 'deploy_confirm') {
    await doDeploy(chatId);
  }
});

// --- Background alerts ---------------------------------------------------
// Polled on an interval rather than event-driven (nothing in this app pushes
// a "the backend just died" event) — each check only broadcasts on a state
// *transition* (good→bad, or bad→good for the up/down checks), so a
// problem that's still ongoing doesn't re-alert every single tick.
const alertState = { backendDown: false, nginxDown: false, healthDown: false, diskAlerted: false, certAlerted: false };

async function runAlertChecks() {
  const [backend, nginx, health, cert, rootDisk] = await Promise.all([
    serviceState(SERVICE_NAME),
    serviceState('nginx'),
    healthCheck(),
    certDaysLeft(),
    diskLine('/'),
  ]);

  const backendDown = backend.active !== 'active';
  if (backendDown !== alertState.backendDown) {
    alertState.backendDown = backendDown;
    await broadcast(backendDown ? `\u{1F6A8} *${SERVICE_NAME}* is ${backend.active}.` : `✅ *${SERVICE_NAME}* is back up.`);
  }

  const nginxDown = nginx.active !== 'active';
  if (nginxDown !== alertState.nginxDown) {
    alertState.nginxDown = nginxDown;
    await broadcast(nginxDown ? `\u{1F6A8} *nginx* is ${nginx.active}.` : `✅ *nginx* is back up.`);
  }

  const healthDown = !health.ok;
  if (healthDown !== alertState.healthDown) {
    alertState.healthDown = healthDown;
    await broadcast(healthDown ? `\u{1F6A8} Public API (${API_DOMAIN}) is unreachable.` : '✅ Public API is reachable again.');
  }

  if (typeof rootDisk !== 'string') {
    if (rootDisk.pct >= DISK_ALERT_PERCENT && !alertState.diskAlerted) {
      alertState.diskAlerted = true;
      await broadcast(`⚠️ Disk usage on / is at ${rootDisk.pct}%.`);
    } else if (rootDisk.pct < DISK_ALERT_PERCENT) {
      alertState.diskAlerted = false;
    }
  }

  if (cert !== null) {
    if (cert < CERT_ALERT_DAYS && !alertState.certAlerted) {
      alertState.certAlerted = true;
      await broadcast(`⚠️ TLS cert for ${API_DOMAIN} expires in ${cert} day${cert === 1 ? '' : 's'}.`);
    } else if (cert >= CERT_ALERT_DAYS) {
      alertState.certAlerted = false;
    }
  }
}

setInterval(() => {
  runAlertChecks().catch((err) => console.error('alert check failed:', err));
}, ALERT_INTERVAL_MINUTES * 60000);

console.log(`Telegram ops bot starting, alerting every ${ALERT_INTERVAL_MINUTES}m.`);
runBot(bot).catch((err) => {
  console.error('bot stopped:', err);
  process.exit(1);
});
