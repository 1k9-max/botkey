const { database, getSettings, requireToken, requestBody, sendJson } = require('../lib/cloud');
const { fromStoredSettings, sanitizeSettings, toStoredSettings } = require('../lib/settings');

module.exports = async function handler(req, res) {
  if (!requireToken(req, res, 'ADMIN_TOKEN')) return;
  try {
    if (req.method === 'GET') {
      return sendJson(res, 200, fromStoredSettings(await getSettings()));
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
    }

    const result = sanitizeSettings(requestBody(req));
    if (result.error) return sendJson(res, 400, { error: result.error });
    await database('bot_settings?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(toStoredSettings(result.value))
    });
    return sendJson(res, 200, { ok: true, ...result.value });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
};