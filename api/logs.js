const { database, requireToken, sendJson } = require('../lib/cloud');

module.exports = async function handler(req, res) {
  if (!requireToken(req, res, 'ADMIN_TOKEN')) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  }
  try {
    const after = Math.max(0, parseInt(new URL(req.url, 'https://vercel.invalid').searchParams.get('after') || '0', 10) || 0);
    const rows = await database(`bot_logs?id=gt.${after}&select=id,t,kind,msg&order=id.asc&limit=1000`);
    const logs = rows.map((row) => ({ id: row.id, t: row.t, kind: row.kind, msg: row.msg }));
    return sendJson(res, 200, { logs, last: logs.length ? logs[logs.length - 1].id : after });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
};