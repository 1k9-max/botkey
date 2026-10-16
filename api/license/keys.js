const { database, requireToken, requestBody, sendJson } = require('../../lib/cloud');
const { generateKey } = require('../../lib/license');

module.exports = async function handler(req, res) {
  if (!requireToken(req, res, 'ADMIN_TOKEN')) return;
  try {
    if (req.method === 'GET') {
      const rows = await database('license_keys?select=key,key_type,status,created_at,expires_at,created_ip,bound_ip&order=created_at.desc&limit=200');
      return sendJson(res, 200, { keys: rows });
    }

    const body = requestBody(req);
    if (req.method === 'POST') {
      const durationHours = Number(body.durationHours);
      if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 87600) {
        return sendJson(res, 400, { error: 'Thời hạn VIP phải từ 1 đến 87600 giờ.' });
      }
      const key = generateKey();
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + durationHours * 60 * 60 * 1000);
      await database('license_keys', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ key, key_type: 'vip', status: 'active', created_at: createdAt.toISOString(), expires_at: expiresAt.toISOString() })
      });
      return sendJson(res, 201, { key, type: 'vip', createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() });
    }

    if (req.method === 'DELETE') {
      const key = String(body.key || '').trim();
      if (!/^[a-f0-9]{30}$/i.test(key)) return sendJson(res, 400, { error: 'Key không hợp lệ.' });
      const rows = await database(`license_keys?key=eq.${key}&status=eq.active`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'revoked' })
      });
      return sendJson(res, rows && rows.length ? 200 : 404, { ok: !!(rows && rows.length) });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
};