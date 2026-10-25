const test = require('node:test');
const assert = require('node:assert');

test('Gmail API mailer builds a MIME message and posts it with a refreshed token', async () => {
  process.env.GMAIL_CLIENT_ID = 'id';
  process.env.GMAIL_CLIENT_SECRET = 'secret';
  process.env.GMAIL_REFRESH_TOKEN = 'refresh';
  process.env.SMTP_FROM = 'Edu <info@edusolutionsmv.com>';
  delete process.env.MAIL_REPLY_TO;
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    }
    return { ok: true, json: async () => ({ id: 'm1' }) };
  };
  try {
    const { sendMail, isEmailConfigured } = require('../src/lib/mailer');
    assert.equal(isEmailConfigured(), true);
    await sendMail({
      to: 'client@example.com',
      subject: 'Invoice INV-1',
      html: '<p>Hi</p>',
      attachments: [{ filename: 'inv.pdf', content: Buffer.from('%PDF-1.4') }],
    });
    await sendMail({ to: 'client@example.com', subject: 'Second', html: '<p>x</p>' });
    assert.equal(calls.filter((c) => String(c.url).includes('oauth2')).length, 1, 'token cached');
    const send = calls.find((c) => String(c.url).includes('messages/send'));
    assert.equal(send.opts.headers.Authorization, 'Bearer tok');
    const mime = Buffer.from(JSON.parse(send.opts.body).raw, 'base64url').toString();
    assert.match(mime, /To: client@example.com/);
    assert.match(mime, /Reply-To: info@edusolutionsmv.com/);
    assert.match(mime, /Subject: Invoice INV-1/);
    assert.match(mime, /filename="?inv\.pdf"?/);
  } finally {
    global.fetch = realFetch;
  }
});

test('Gmail API errors surface a readable message', async () => {
  const realFetch = global.fetch;
  global.fetch = async (url) =>
    String(url).includes('oauth2')
      ? { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Token expired' }) }
      : { ok: true, json: async () => ({}) };
  try {
    delete require.cache[require.resolve('../src/lib/mailer')];
    const { sendMail } = require('../src/lib/mailer');
    await assert.rejects(() => sendMail({ to: 'a@b.com', subject: 's', html: 'h' }), /Gmail authorisation failed: Token expired/);
  } finally {
    global.fetch = realFetch;
  }
});

test('Gmail failure alerts the operator via Telegram (throttled) and still throws', async () => {
  process.env.GMAIL_CLIENT_ID = 'id';
  process.env.GMAIL_CLIENT_SECRET = 'secret';
  process.env.GMAIL_REFRESH_TOKEN = 'refresh';
  process.env.TELEGRAM_BOT_TOKEN = 'tg-token';
  process.env.TELEGRAM_ALLOWED_USER_IDS = '111, 222';
  const realFetch = global.fetch;
  const telegram = [];
  global.fetch = async (url, opts) => {
    if (String(url).includes('api.telegram.org')) {
      telegram.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({}) };
    }
    return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Token expired' }) };
  };
  try {
    delete require.cache[require.resolve('../src/lib/opsAlert')];
    delete require.cache[require.resolve('../src/lib/mailer')];
    const { sendMail } = require('../src/lib/mailer');
    await assert.rejects(() => sendMail({ to: 'a@b.com', subject: 's', html: 'h' }), /Gmail authorisation failed/);
    await assert.rejects(() => sendMail({ to: 'a@b.com', subject: 's', html: 'h' }), /Gmail authorisation failed/);
    assert.equal(telegram.length, 2, 'one alert per chat id, second failure throttled');
    assert.match(telegram[0].body.text, /Gmail send failed/);
    assert.ok(!telegram[0].body.text.includes('secret'));
  } finally {
    global.fetch = realFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
  }
});
