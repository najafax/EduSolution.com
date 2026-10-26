// Test harness: boots the real API against a throwaway SQLite file (never
// the real database) and gives tests a tiny HTTP client.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');

async function startServer(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-test-'));
  const dbPath = path.join(dir, 'test.sqlite3');
  const env = {
    ...process.env,
    DB_PATH: dbPath,
    PORT: String(port),
    JWT_SECRET: 'test-secret',
    CLIENT_ORIGIN: 'http://localhost:5173',
    // Make sure nothing outbound is ever configured.
    SMTP_HOST: '',
    RESEND_API_KEY: '',
    BACKUP_S3_BUCKET: '',
    ANTHROPIC_API_KEY: '',
    FACEBOOK_PAGE_ACCESS_TOKEN: '',
    BUSINESS_TIMEZONE: 'Indian/Maldives',
  };
  const mk = spawnSync('node', ['scripts/create-user.js', '--name', 'Boss', '--email', 'boss@test.com', '--password', 'Test12345', '--role', 'super_admin'], { cwd: ROOT, env });
  if (mk.status !== 0) throw new Error(`create-user failed: ${mk.stderr}`);
  const child = spawn('node', ['src/index.js'], { cwd: ROOT, env, stdio: 'ignore' });
  const base = `http://localhost:${port}/api`;
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${base}/auth/me`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const api = async (method, p, body, token) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data };
  };
  const login = async (email, password) => (await api('POST', '/auth/login', { email, password })).data.token;
  const db = () => new Database(dbPath);
  const stop = () => {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { api, login, db, stop, base };
}

module.exports = { startServer };
