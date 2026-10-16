const { database, getControl, getSettings, requireToken, requestBody, sendJson } = require('../lib/cloud');
const { fromStoredSettings } = require('../lib/settings');

module.exports = async function handler(req, res) {
  if (!requireToken(req, res, 'BOT_TOKEN')) return;
  try {
    if (req.method === 'GET') {
      const [settings, control] = await Promise.all([getSettings(), getControl()]);
      return sendJson(res, 200, { settings: fromStoredSettings(settings), reconnectToken: control.reconnect_token || '' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
    }

    const body = requestBody(req);
    const status = body.status && typeof body.status === 'object' ? body.status : {};
    await database('bot_status?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: 1,
        online: status.online === true,
        logged_in: status.loggedIn === true,
        updated_at: new Date().toISOString()
      })
    });

    const logs = Array.isArray(body.logs) ? body.logs.slice(0, 100) : [];
    const cleanLogs = logs.map((entry) => ({
      t: String(entry.t || '').slice(0, 16),
      kind: ['chat', 'err', 'ok', 'warn'].includes(entry.kind) ? entry.kind : 'info',
      msg: String(entry.msg || '').slice(0, 2000)
    }));
    if (cleanLogs.length) {
      await database('bot_logs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(cleanLogs)
      });
    }

    const [settings, control] = await Promise.all([getSettings(), getControl()]);
    return sendJson(res, 200, { settings: fromStoredSettings(settings), reconnectToken: control.reconnect_token || '' });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
};