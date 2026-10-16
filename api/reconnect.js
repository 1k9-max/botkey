const { randomUUID } = require('node:crypto');
const { database, requireToken, sendJson } = require('../lib/cloud');

module.exports = async function handler(req, res) {
  if (!requireToken(req, res, 'ADMIN_TOKEN')) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  }
  try {
    await database('bot_control?id=eq.1', {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ reconnect_token: randomUUID() })
    });
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
};