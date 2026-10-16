const { database, requestBody, sendJson } = require('../../lib/cloud');
const { clientIp } = require('../../lib/license');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  }

  const ip = clientIp(req);
  if (!ip) return sendJson(res, 400, { error: 'Không xác định được IP của bot.' });
  try {
    const key = String(requestBody(req).key || '').trim();
    if (!/^[a-f0-9]{30}$/i.test(key)) return sendJson(res, 400, { error: 'Key phải gồm 30 ký tự.' });

    const now = new Date().toISOString();
    const filters = new URLSearchParams({
      key: `eq.${key}`,
      status: 'eq.active',
      expires_at: `gt.${now}`,
      or: `(bound_ip.is.null,bound_ip.eq.${ip})`,
      select: 'key,key_type,expires_at,bound_ip'
    });
    const rows = await database(`license_keys?${filters}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ bound_ip: ip, bound_at: now, last_verified_at: now })
    });
    if (!rows || rows.length === 0) {
      return sendJson(res, 403, { valid: false, error: 'Key không hợp lệ, đã hết hạn, bị thu hồi hoặc đang gắn với IP khác.' });
    }
    return sendJson(res, 200, { valid: true, type: rows[0].key_type, expiresAt: rows[0].expires_at });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
};