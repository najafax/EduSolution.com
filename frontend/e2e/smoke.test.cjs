// Browser smoke tests: boots the real API (throwaway SQLite file) and the
// production build, then drives them with Playwright. Run: npm run e2e
// (needs `npm run build` first and a Chromium install).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(__dirname, '.tmp-'));
const APP = 'http://localhost:4173';
const EMAIL = 'e2e@example.test';
const PASSWORD = 'password123';
let procs = [];
let browser;

const env = {
  ...process.env,
  DB_PATH: path.join(TMP, 'e2e.sqlite3'),
  JWT_SECRET: 'e2e-secret',
  PORT: '4000',
  CLIENT_ORIGIN: APP,
};

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not start`);
}

before(async () => {
  const mk = spawnSync('node', ['scripts/create-user.js', '--name', 'E2E', '--email', EMAIL, '--password', PASSWORD], {
    cwd: path.join(ROOT, 'backend'), env, encoding: 'utf8',
  });
  assert.equal(mk.status, 0, mk.stderr);
  const mk2 = spawnSync('node', ['scripts/create-user.js', '--name', 'MFA', '--email', 'mfa@example.test', '--password', PASSWORD], {
    cwd: path.join(ROOT, 'backend'), env, encoding: 'utf8',
  });
  assert.equal(mk2.status, 0, mk2.stderr);
  procs.push(spawn('node', ['src/index.js'], { cwd: path.join(ROOT, 'backend'), env, stdio: 'ignore' }));
  procs.push(spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: path.join(ROOT, 'frontend'), env, stdio: 'ignore' }));
  await waitFor('http://localhost:4000/api/auth/me');
  await waitFor(APP);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  procs.forEach((p) => p.kill());
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function login(page) {
  await page.goto(`${APP}/login`);
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
}

test('a wrong password is rejected', async () => {
  const page = await browser.newPage();
  await page.goto(`${APP}/login`);
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', 'nope-nope');
  await page.click('button[type=submit]');
  await page.getByText('Invalid email or password').waitFor();
  assert.match(page.url(), /\/login$/);
  await page.close();
});

test('desktop: log in, create a client, see it listed', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto(`${APP}/clients`);
  await page.getByRole('button', { name: /New client/ }).first().click();
  await page.getByLabel('Client name').fill('Smoke Test School');
  await page.getByLabel('Email').fill('school@example.test');
  await page.getByRole('button', { name: /^(Save|Create|Add)/ }).first().click();
  await page.getByText('Smoke Test School').first().waitFor();
  await page.goto(`${APP}/invoices`);
  await page.getByRole('heading', { name: 'Invoices' }).waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('phone: bottom nav shows, hides on scroll down, returns on scroll up', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await login(page);
  const nav = page.locator('nav[aria-label=Main]');
  const opacity = () => nav.evaluate((e) => getComputedStyle(e).opacity);
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.height = '4000px';
    document.body.appendChild(d);
  });
  assert.equal(await opacity(), '1');
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(700);
  assert.equal(await opacity(), '0');
  await page.evaluate(() => window.scrollTo(0, 540));
  await page.waitForTimeout(700);
  assert.equal(await opacity(), '1');
  await ctx.close();
});

test('desktop: every Website content tab renders and its form opens', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto(`${APP}/website-content`);
  for (const tab of ['News & announcements', 'Testimonials', 'Services', 'Team', 'Gallery', 'Videos']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^New |^Add / }).first().click();
    await page.getByRole('button', { name: 'Cancel' }).first().click();
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test('two-step verification: set up on My account, then required at login', async () => {
  const totp = require(path.join(ROOT, 'backend', 'src', 'lib', 'totp.js'));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${APP}/login`);
  await page.fill('input[type=email]', 'mfa@example.test');
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');

  await page.goto(`${APP}/account`);
  await page.getByRole('button', { name: 'Set up two-step verification' }).click();
  const secret = (await page.locator('p.font-mono').first().innerText()).trim();
  const step = totp.currentStep();
  await page.getByLabel('6-digit code').fill(totp.codeForStep(secret, step));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.getByText('Save your recovery codes now').waitFor();
  assert.equal(await page.locator('ul.font-mono li').count(), 10);
  await page.getByRole('button', { name: "I've saved them" }).click();

  // Fresh browser: the password alone must not be enough.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx.newPage();
  await p2.goto(`${APP}/login`);
  await p2.fill('input[type=email]', 'mfa@example.test');
  await p2.fill('input[type=password]', PASSWORD);
  await p2.click('button[type=submit]');
  await p2.getByRole('heading', { name: 'Two-step verification' }).waitFor();
  assert.match(p2.url(), /\/login$/);
  await p2.getByLabel('Code').fill('000000');
  await p2.getByRole('button', { name: 'Verify and log in' }).click();
  await p2.getByText('not valid').waitFor();
  await p2.getByLabel('Code').fill(totp.codeForStep(secret, step + 1));
  await p2.getByRole('button', { name: 'Verify and log in' }).click();
  await p2.waitForURL('**/dashboard');
  await ctx.close();
  await page.close();
});
