const { database, sendJson } = require('../../lib/cloud');
const { clientIp, destinationUrl, freeIssueWindow, generateKey, shortenUrl } = require('../../lib/license');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  }

  const ip = clientIp(req);
  if (!ip) return sendJson(res, 400, { error: 'Không xác định được IP.' });

  let issueReserved = false;
  let key = '';
  try {
    const windowStart = freeIssueWindow();
    const reservation = await database('license_free_issues?on_conflict=ip,window_start', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ ip, window_start: windowStart.toISOString() })
    });
    if (!reservation || reservation.length === 0) {
      return sendJson(res, 429, { error: 'IP này đã nhận key miễn phí trong chu kỳ hiện tại.' });
    }
    issueReserved = true;

    key = generateKey();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    await database('license_keys', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        key,
        key_type: 'free',
        status: 'active',
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        created_ip: ip
      })
    });

    const destination = destinationUrl(req, key);
    let shortUrl = '';
    let warning = '';
    try { shortUrl = await shortenUrl(destination); }
    catch (err) { warning = `Không rút gọn được link: ${err.message}`; }
    return sendJson(res, 201, { key, type: 'free', expiresAt: expiresAt.toISOString(), destinationUrl: destination, shortUrl, warning });
  } catch (err) {
    if (issueReserved) {
      try {
        await database(`license_free_issues?ip=eq.${encodeURIComponent(ip)}&window_start=eq.${encodeURIComponent(freeIssueWindow().toISOString())}`, { method: 'DELETE' });
        if (key) await database(`license_keys?key=eq.${key}`, { method: 'DELETE' });
      } catch (_) {}
    }
    return sendJson(res, 500, { error: err.message });
  }
};