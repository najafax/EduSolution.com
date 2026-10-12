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

const fs = require('fs');
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
// A small droplet can intermittently choke under memory pressure well
// before disk/CPU would ever flag it — this is the single most useful new
// signal for the "API goes unreachable for a few minutes, then recovers on
// its own" failure mode, since that pattern matches memory pressure (swap
// thrashing, or the kernel briefly starving the process) far better than a
// clean crash would.
const MEMORY_ALERT_PERCENT = Number(process.env.TELEGRAM_MEMORY_ALERT_PERCENT) || 90;
// The daily backup cron (lib/backup.js) runs at 03:00 server time — 26h
// (not a flat 24h) gives an hour of slack before this is treated as
// "actually missed," so a backup that's merely running a little late on a
// slow day doesn't false-positive.
const BACKUP_STALE_HOURS = Number(process.env.TELEGRAM_BACKUP_STALE_HOURS) || 26;

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

// A cheap, cheap-to-run-every-poll liveness check against the exact same
// SQLite connection the backend process itself reads/writes (this bot
// requires db/index.js directly, see the top of this file) — a locked or
// corrupted database file would hang/fail this the same way it'd hang a
// real API request, so this is a genuine proxy for "can the backend
// actually serve a request right now," not just "is the process running."
// Deliberately NOT a PRAGMA integrity_check here — that walks the whole
// file and briefly locks it, fine for an on-demand /db check but too
// expensive/intrusive to run unconditionally every ALERT_INTERVAL_MINUTES.
function dbHealthCheck() {
  const start = Date.now();
  try {
    db.prepare('SELECT 1').get();
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err.message };
  }
}

// The real, thorough check — walks every page of the database file. Only
// ever called on demand (the /db command), never from the polling loop.
function dbIntegrityCheck() {
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    const results = rows.map((r) => r.integrity_check);
    return { ok: results.length === 1 && results[0] === 'ok', results };
  } catch (err) {
    return { ok: false, results: [err.message] };
  }
}

// `db.name` is better-sqlite3's own property for the path it was opened
// with — the exact same DB_PATH-or-local-default value db/index.js
// resolves, so no separate path-resolution copy is needed here. The `-wal`
// sibling only exists while SQLite is in WAL mode with pending,
// not-yet-checkpointed writes — a healthy app's WAL file should stay
// small/absent most of the time, so a large one can mean checkpointing
// isn't happening (e.g. a long-held read transaction somewhere).
function dbFileSizes() {
  let mainBytes = null;
  let walBytes = null;
  try {
    mainBytes = fs.statSync(db.name).size;
  } catch (err) {
    // leave null — reported as n/a
  }
  try {
    walBytes = fs.statSync(`${db.name}-wal`).size;
  } catch (err) {
    // no WAL file present — nothing pending, or not in WAL mode; not an error
  }
  return { mainBytes, walBytes };
}

function formatBytes(bytes) {
  if (bytes == null) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i += 1;
  } while (value >= 1024 && i < units.length - 1);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

// /proc/meminfo over a parsed `free` call — one less shell-output-format
// assumption to break across distros/locales. MemAvailable (not MemFree) is
// the modern, accurate "how much could actually be used right now" figure
// — it already accounts for reclaimable cache/buffers the way MemFree
// doesn't, so it won't false-positive on a box that's just using free RAM
// for disk cache the way Linux always does.
function memoryInfo() {
  try {
    const raw = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (key) => {
      const match = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
      return match ? Number(match[1]) * 1024 : null; // kB -> bytes
    };
    const total = get('MemTotal');
    const available = get('MemAvailable');
    if (total == null || available == null) return null;
    return { usedPct: Math.round(((total - available) / total) * 100), totalBytes: total, availBytes: available };
  } catch (err) {
    return null; // e.g. not running on Linux — just omit this line
  }
}

// systemd's own restart counter for the unit — bumped on every restart,
// deliberate (a manual /restart or /deploy) or not (a crash that
// Restart=on-failure brought back up before any poll ever caught it
// "down"). doRestart()/doDeploy() below resync alertState.lastRestartCount
// immediately after a deliberate restart specifically so this doesn't
// false-positive on the action the operator just asked for.
async function backendRestartCount() {
  const { ok, output } = await runCmd(`systemctl show ${SERVICE_NAME} -p NRestarts --value`);
  if (!ok) return null;
  const n = parseInt(output, 10);
  return Number.isNaN(n) ? null : n;
}

// Hours since the most recent daily backup object actually landed in the
// bucket — null (not 0, not Infinity) when backups aren't configured at
// all, so callers can tell "nothing to report" apart from "it's been 0
// hours."
async function latestDailyBackupAgeHours() {
  if (!backupsConfigured()) return null;
  const daily = await listBackups('backups/daily/');
  if (!daily.length) return null;
  const latest = daily[daily.length - 1];
  return (Date.now() - latest.LastModified.getTime()) / 3600000;
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
  const dbHealth = dbHealthCheck();
  const mem = memoryInfo();

  const healthLine = health.ok ? `✅ reachable (HTTP ${health.status}, ${health.ms}ms)` : '❌ unreachable';
  const dbLine = dbHealth.ok ? `✅ ok (${dbHealth.ms}ms)` : `❌ ${dbHealth.error}`;
  const memLine = mem ? `${mem.usedPct}% used${mem.usedPct >= MEMORY_ALERT_PERCENT ? ' ⚠️' : ''}` : 'n/a';
  const certLine = cert === null ? 'n/a' : cert < 0 ? `⚠️ EXPIRED ${Math.abs(cert)}d ago` : `${cert}d left`;

  return [
    `*${SERVICE_NAME}*: ${backend.active === 'active' ? '✅' : '❌'} ${backend.label}`,
    `*nginx*: ${nginx.active === 'active' ? '✅' : '❌'} ${nginx.label}`,
    `*Public API*: ${healthLine}`,
    `*Database*: ${dbLine}`,
    `*Memory*: ${memLine}`,
    `*TLS cert*: ${certLine}`,
    `*Disk /*: ${typeof rootDisk === 'string' ? rootDisk : rootDisk.line}`,
    `*Disk /var/data*: ${typeof dataDisk === 'string' ? dataDisk : dataDisk.line}`,
  ].join('\n');
}

// On-demand deep check — the thorough PRAGMA integrity_check (see
// dbIntegrityCheck's own note on why that stays out of the polling loop),
// file/WAL sizes, and backup freshness all in one place, for "something
// seems off with the database specifically" rather than the general
// /status sweep.
async function buildDbReport() {
  const health = dbHealthCheck();
  const { mainBytes, walBytes } = dbFileSizes();
  const integrity = dbIntegrityCheck();
  const backupAgeHours = await latestDailyBackupAgeHours();

  const lines = [
    `*Connectivity*: ${health.ok ? `✅ ok (${health.ms}ms)` : `❌ ${health.error}`}`,
    `*Integrity check*: ${integrity.ok ? '✅ ok' : `❌ ${integrity.results.join('; ')}`}`,
    `*File size*: ${formatBytes(mainBytes)}`,
  ];
  if (walBytes != null) lines.push(`*WAL size*: ${formatBytes(walBytes)}`);
  lines.push(
    backupAgeHours == null
      ? '*Last backup*: n/a (not configured)'
      : `*Last backup*: ${backupAgeHours < 1 ? '<1h' : `${Math.round(backupAgeHours)}h`} ago`,
  );
  return lines.join('\n');
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
  '/status — backend, nginx, database, memory, disk, TLS cert, public API reachability',
  '/db — deep database check: connectivity, integrity, file/WAL size, backup freshness',
  '/today — bank balance, today’s earnings, overdue invoices, pending quote requests',
  '/backup — last daily/weekly backup time',
  '/logs [n] — last n lines of backend logs (default 50, max 300)',
  '/restart — restart the backend service (asks to confirm)',
  '/deploy — pull latest main + restart (asks to confirm)',
  '',
  'Alerts fire automatically (no command needed) for: backend/nginx/API/',
  'database down, memory ≥90%, disk ≥85%, TLS cert <14d, an unexplained',
  'backend restart (crash loop), and a missed daily backup.',
].join('\n');

const CONFIRM_KEYBOARD = (confirmData, confirmLabel) => ({
  inline_keyboard: [[
    { text: confirmLabel, callback_data: confirmData },
    { text: 'Cancel', callback_data: 'cancel' },
  ]],
});

// Shared with the background alert loop below (declared here, ahead of
// doRestart()/doDeploy(), since both need to resync lastRestartCount right
// after a deliberate restart — otherwise the very next poll would read the
// bump from this intentional restart as an unexplained crash).
const alertState = {
  backendDown: false,
  nginxDown: false,
  healthDown: false,
  dbDown: false,
  diskAlerted: false,
  certAlerted: false,
  memoryAlerted: false,
  backupStaleAlerted: false,
  lastRestartCount: null,
};

async function doRestart(chatId) {
  await bot.api.sendMessage({ chat_id: chatId, text: `Restarting ${SERVICE_NAME}…` });
  await runCmd(`systemctl restart ${SERVICE_NAME}`);
  await new Promise((r) => setTimeout(r, 2000));
  const state = await serviceState(SERVICE_NAME);
  const restartCount = await backendRestartCount();
  if (restartCount !== null) alertState.lastRestartCount = restartCount;
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

bot.command('db', async (ctx) => ctx.reply(await buildDbReport(), { parse_mode: 'Markdown' }));

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
// (alertState itself is declared above, near doRestart() — both it and the
// restart-deploy actions need to share the same object.)

async function runAlertChecks() {
  const [backend, nginx, health, cert, rootDisk, restartCount, backupAgeHours] = await Promise.all([
    serviceState(SERVICE_NAME),
    serviceState('nginx'),
    healthCheck(),
    certDaysLeft(),
    diskLine('/'),
    backendRestartCount(),
    latestDailyBackupAgeHours(),
  ]);
  const dbHealth = dbHealthCheck();
  const mem = memoryInfo();

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

  const dbDown = !dbHealth.ok;
  if (dbDown !== alertState.dbDown) {
    alertState.dbDown = dbDown;
    await broadcast(dbDown ? `\u{1F6A8} *Database* query failed: ${dbHealth.error}` : '✅ Database is responding again.');
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

  if (mem) {
    if (mem.usedPct >= MEMORY_ALERT_PERCENT && !alertState.memoryAlerted) {
      alertState.memoryAlerted = true;
      await broadcast(`⚠️ Memory usage is at ${mem.usedPct}% — this can cause exactly the "unreachable for a few minutes" pattern.`);
    } else if (mem.usedPct < MEMORY_ALERT_PERCENT) {
      alertState.memoryAlerted = false;
    }
  }

  // Only ever compares against a count seen *while this bot was running* —
  // the first poll after a bot (re)start just records a baseline rather
  // than alerting, since there's no way to know whether an already-elevated
  // count reflects crashes from before the bot was watching.
  if (restartCount !== null) {
    if (alertState.lastRestartCount !== null && restartCount > alertState.lastRestartCount) {
      await broadcast(
        `\u{1F6A8} *${SERVICE_NAME}* restarted unexpectedly (restart count ${alertState.lastRestartCount} → ${restartCount}) — it may be crash-looping. Check /logs.`,
      );
    }
    alertState.lastRestartCount = restartCount;
  }

  if (backupAgeHours !== null) {
    if (backupAgeHours >= BACKUP_STALE_HOURS && !alertState.backupStaleAlerted) {
      alertState.backupStaleAlerted = true;
      await broadcast(`⚠️ No daily backup in ${Math.round(backupAgeHours)}h (expected one roughly every 24h).`);
    } else if (backupAgeHours < BACKUP_STALE_HOURS) {
      alertState.backupStaleAlerted = false;
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
