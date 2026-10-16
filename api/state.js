const { database, getSettings, requireToken, sendJson } = require('../lib/cloud');

module.exports = async function handler(req, res) {
  if (!requireToken(req, res, 'ADMIN_TOKEN')) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  }
  try {
    const [settings, rows] = await Promise.all([
      getSettings(),
      database('bot_status?id=eq.1&select=online,logged_in,updated_at&limit=1')
    ]);
    const status = rows[0];
    const fresh = status && Date.now() - Date.parse(status.updated_at) < 30000;
    return sendJson(res, 200, {
      online: !!(fresh && status.online),
      loggedIn: !!(fresh && status.logged_in),
      hasUsername: !!settings.username
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
};