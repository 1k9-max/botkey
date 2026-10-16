const { sendJson } = require('../../lib/cloud');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  }
  const configured = process.env.VIP_CONTACT_URL || '';
  if (!configured) return sendJson(res, 200, { url: '' });
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || !['discord.gg', 'discord.com', 'www.discord.com'].includes(url.hostname)) {
      return sendJson(res, 500, { error: 'VIP_CONTACT_URL phải là link HTTPS của Discord.' });
    }
    return sendJson(res, 200, { url: url.toString() });
  } catch (_) {
    return sendJson(res, 500, { error: 'VIP_CONTACT_URL không hợp lệ.' });
  }
};