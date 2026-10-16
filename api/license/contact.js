const { sendJson } = require('../../lib/cloud');
const { getConfigValue } = require('../../lib/app-config');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  }
  const configured = process.env.VIP_CONTACT_URL || '';
  if (!configured) return sendJson(res, 200, { url: '' });
  try {
    const url = new URL(configured);
    const allowedHosts = new Set(['discord.gg', 'discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com']);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
      return sendJson(res, 500, { error: 'VIP_CONTACT_URL phải là link HTTPS của Discord.' });
    }
    return sendJson(res, 200, { url: url.toString() });
  } catch (_) {
    return sendJson(res, 500, { error: 'VIP_CONTACT_URL không hợp lệ.' });
  }
};