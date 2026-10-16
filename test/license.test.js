const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { clientIp, destinationUrl, freeIssueWindow, generateKey } = require('../lib/license');
const { database } = require('../lib/cloud');
const { fromStoredSettings, sanitizeSettings, toStoredSettings } = require('../lib/settings');
const createFreeKey = require('../api/license/free');
const verifyLicense = require('../api/license/verify');
const createVipKeys = require('../api/license/keys');

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; }
  };
}

function mockFetch(handler) {
  const previous = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = previous; };
}

function setEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('server-side srv.json values are used for deployment secrets and env wins over file', () => {
  const srvPath = path.join(__dirname, '..', 'srv.json');
  const previousContent = fs.existsSync(srvPath) ? fs.readFileSync(srvPath, 'utf8') : null;
  const previousEnv = { ADMIN_TOKEN: process.env.ADMIN_TOKEN, PUBLIC_APP_URL: process.env.PUBLIC_APP_URL };

  try {
    fs.writeFileSync(srvPath, JSON.stringify({ cloud: { adminToken: 'srv-admin-token', publicAppUrl: 'https://srv.example' } }, null, 2));
    delete require.cache[require.resolve('../lib/app-config')];
    const { getConfigValue } = require('../lib/app-config');

    assert.equal(getConfigValue('ADMIN_TOKEN'), 'srv-admin-token');
    process.env.ADMIN_TOKEN = 'env-admin-token';
    assert.equal(getConfigValue('ADMIN_TOKEN'), 'env-admin-token');
    assert.equal(getConfigValue('PUBLIC_APP_URL'), 'https://srv.example');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousContent === null) fs.unlinkSync(srvPath);
    else fs.writeFileSync(srvPath, previousContent);
    delete require.cache[require.resolve('../lib/app-config')];
  }
});

test('generated keys are 30 random hexadecimal characters', () => {
  const first = generateKey();
  const second = generateKey();
  assert.match(first, /^[a-f0-9]{30}$/);
  assert.notEqual(first, second);
});

test('free issuance is limited to fixed 12-hour UTC windows', () => {
  assert.equal(freeIssueWindow(new Date('2026-10-15T11:59:59Z')).toISOString(), '2026-10-15T00:00:00.000Z');
  assert.equal(freeIssueWindow(new Date('2026-10-15T12:00:00Z')).toISOString(), '2026-10-15T12:00:00.000Z');
});

test('license settings round-trip and reject malformed keys', () => {
  const parsed = sanitizeSettings({ licenseKey: 'abc_123' });
  assert.equal(parsed.value.licenseKey, 'abc_123');
  assert.equal(fromStoredSettings(toStoredSettings(parsed.value)).licenseKey, 'abc_123');
  assert.ok(sanitizeSettings({ licenseKey: 'contains spaces' }).error);
});

test('verification binds the first valid IP and accepts only a returned active row', async () => {
  const restoreEnv = setEnv({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'db-secret' });
  let requestUrl;
  let requestBody;
  const restoreFetch = mockFetch(async (url, options) => {
    requestUrl = new URL(url);
    requestBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => [{ key_type: 'free', expires_at: '2026-10-16T00:00:00Z' }] };
  });
  try {
    const req = { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.20, 10.0.0.1' }, body: { key: 'a'.repeat(30) } };
    const res = response();
    await verifyLicense(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).valid, true);
    assert.equal(requestBody.bound_ip, '198.51.100.20');
    assert.equal(requestUrl.searchParams.get('or'), '(bound_ip.is.null,bound_ip.eq.198.51.100.20)');
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test('verification rejects a key already bound to another IP', async () => {
  const restoreEnv = setEnv({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'db-secret' });
  const restoreFetch = mockFetch(async () => ({ ok: true, status: 200, json: async () => [] }));
  try {
    const req = { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.10' }, body: { key: 'b'.repeat(30) } };
    const res = response();
    await verifyLicense(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).valid, false);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test('free-key endpoint stores a 12-hour key and returns a Link4m URL', async () => {
  const restoreEnv = setEnv({
    SUPABASE_URL: 'https://db.example',
    SUPABASE_SERVICE_ROLE_KEY: 'db-secret',
    LINK4M_API_KEY: 'link-secret',
    PUBLIC_APP_URL: 'https://bot.example'
  });
  const calls = [];
  const restoreFetch = mockFetch(async (url, options) => {
    const address = new URL(url);
    calls.push({ address, options });
    if (address.hostname === 'link4m.co') {
      return { ok: true, status: 200, json: async () => ({ status: 'success', shortenedUrl: 'https://link4m.com/abc123' }) };
    }
    if (address.pathname.endsWith('/license_free_issues')) {
      return { ok: true, status: 201, json: async () => [{ ip: '192.0.2.5' }] };
    }
    return { ok: true, status: 201, json: async () => [] };
  });
  try {
    const startedAt = Date.now();
    const res = response();
    await createFreeKey({ method: 'POST', headers: { 'x-forwarded-for': '192.0.2.5' } }, res);
    const result = JSON.parse(res.body);
    assert.equal(res.statusCode, 201);
    assert.match(result.key, /^[a-f0-9]{30}$/);
    assert.ok(Math.abs(Date.parse(result.expiresAt) - startedAt - 12 * 60 * 60 * 1000) < 2000);
    assert.equal(result.shortUrl, 'https://link4m.com/abc123');
    const shortenCall = calls.find((call) => call.address.hostname === 'link4m.co');
    assert.equal(shortenCall.address.searchParams.get('api'), 'link-secret');
    assert.equal(new URL(shortenCall.address.searchParams.get('url')).searchParams.get('key'), result.key);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test('free-key endpoint rate-limits duplicate IP issuance in the same window', async () => {
  const restoreEnv = setEnv({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'db-secret' });
  let calls = 0;
  const restoreFetch = mockFetch(async () => { calls++; return { ok: true, status: 201, json: async () => [] }; });
  try {
    const res = response();
    await createFreeKey({ method: 'POST', headers: { 'x-forwarded-for': '192.0.2.6' } }, res);
    assert.equal(res.statusCode, 429);
    assert.equal(calls, 1);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test('VIP key creation requires admin token and stores the selected expiry', async () => {
  const restoreEnv = setEnv({ ADMIN_TOKEN: 'admin-secret', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'db-secret' });
  let stored;
  const restoreFetch = mockFetch(async (url, options) => {
    if (String(url).startsWith('https://db.example')) stored = JSON.parse(options.body);
    return { ok: true, status: 201, json: async () => [] };
  });
  try {
    const req = { method: 'POST', headers: { authorization: 'Bearer admin-secret' }, body: { durationHours: 48 } };
    const res = response();
    await createVipKeys(req, res);
    const result = JSON.parse(res.body);
    assert.equal(res.statusCode, 201);
    assert.equal(stored.key_type, 'vip');
    assert.equal(Date.parse(result.expiresAt) - Date.parse(result.createdAt), 48 * 60 * 60 * 1000);

    const unauthorized = response();
    await createVipKeys({ method: 'POST', headers: {}, body: { durationHours: 48 } }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test('generated destination links require the configured HTTPS origin', () => {
  const restoreEnv = setEnv({ PUBLIC_APP_URL: 'https://bot.example' });
  try {
    assert.equal(destinationUrl({ headers: {} }, 'c'.repeat(30)), `https://bot.example/license.html?key=${'c'.repeat(30)}`);
    process.env.PUBLIC_APP_URL = 'http://bot.example';
    assert.throws(() => destinationUrl({ headers: {} }, 'c'.repeat(30)), /HTTPS/);
  } finally {
    restoreEnv();
  }
});

test('client IP uses the first forwarded address and validates it', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '192.0.2.12, 10.0.0.4' } }), '192.0.2.12');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': 'not-an-ip' }, socket: { remoteAddress: '::1' } }), '');
});

test('Supabase handles successful empty return-minimal responses', async () => {
  const restoreEnv = setEnv({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'db-secret' });
  const restoreFetch = mockFetch(async () => ({ ok: true, status: 201, text: async () => '' }));
  try {
    assert.equal(await database('bot_settings', { method: 'POST', body: '{}' }), null);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});