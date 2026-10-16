const { timingSafeEqual } = require('node:crypto');
const { getConfigValue } = require('./app-config');

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function authorized(req, envName) {
  const expected = getConfigValue(envName) || '';
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function requireToken(req, res, envName) {
  if (authorized(req, envName)) return true;
  sendJson(res, 401, { error: 'Token không hợp lệ.' });
  return false;
}

async function database(path, options = {}) {
  const url = getConfigValue('SUPABASE_URL');
  const key = getConfigValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.');

  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${response.status}: ${message.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  if (typeof response.text === 'function') {
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }
  return response.json();
}

function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return {};
}

async function getSettings() {
  const rows = await database('bot_settings?id=eq.1&select=username,password,invite_name,friends&limit=1');
  return rows[0] || { username: '', password: '', invite_name: '', friends: [] };
}

async function getControl() {
  const rows = await database('bot_control?id=eq.1&select=reconnect_token&limit=1');
  return rows[0] || { reconnect_token: '' };
}

module.exports = { database, getControl, getSettings, requireToken, requestBody, sendJson };