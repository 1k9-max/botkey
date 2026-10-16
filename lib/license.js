const { randomBytes } = require('node:crypto');
const { isIP } = require('node:net');
const { getConfigValue } = require('./app-config');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const candidate = (typeof forwarded === 'string' ? forwarded.split(',')[0] : '') || req.socket?.remoteAddress || '';
  let ip = candidate.trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return isIP(ip) ? ip : '';
}

function generateKey() {
  return randomBytes(15).toString('hex');
}

function destinationUrl(req, key) {
  const configured = getConfigValue('PUBLIC_APP_URL');
  if (!configured) throw new Error('Chưa cấu hình PUBLIC_APP_URL.');
  const url = new URL(configured);
  if (url.protocol !== 'https:') throw new Error('PUBLIC_APP_URL phải dùng HTTPS.');
  url.pathname = '/license.html';
  url.search = '';
  url.searchParams.set('key', key);
  return url.toString();
}

async function shortenUrl(destination) {
  const apiKey = getConfigValue('LINK4M_API_KEY');
  if (!apiKey) throw new Error('Chưa cấu hình LINK4M_API_KEY.');
  const url = new URL('https://link4m.co/api-shorten/v2');
  url.searchParams.set('api', apiKey);
  url.searchParams.set('url', destination);
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Link4m trả về HTTP ${response.status}.`);
  const result = await response.json();
  if (result.status !== 'success' || typeof result.shortenedUrl !== 'string') {
    throw new Error('Link4m không tạo được link rút gọn.');
  }
  const shortened = new URL(result.shortenedUrl);
  if (shortened.protocol !== 'https:') throw new Error('Link4m trả về URL không an toàn.');
  return shortened.toString();
}

function freeIssueWindow(now = new Date()) {
  const startHour = now.getUTCHours() < 12 ? 0 : 12;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), startHour));
}

module.exports = { clientIp, destinationUrl, freeIssueWindow, generateKey, shortenUrl };