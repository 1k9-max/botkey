const NAME_RE = /^[.\w]{1,24}$/;
const USER_RE = /^[.\w]{1,32}$/;

function sanitizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const username = String(src.username ?? '').trim();
  const password = String(src.password ?? '');
  const inviteName = String(src.inviteName ?? '').trim();
  const licenseKey = String(src.licenseKey ?? '').trim();

  if (username && !USER_RE.test(username)) return { error: 'Tên bot không hợp lệ (chỉ chữ, số, _ . và không có khoảng trắng).' };
  if (password.length > 100 || /[\r\n]/.test(password)) return { error: 'Mật khẩu không hợp lệ.' };
  if (licenseKey.length > 64 || !/^[a-zA-Z0-9_-]*$/.test(licenseKey)) return { error: 'License key không hợp lệ.' };
  if (inviteName && !NAME_RE.test(inviteName)) {
    return { error: `Tên mời tổ đội "${inviteName}" không hợp lệ (tối đa 24 ký tự: chữ, số, _ . và không có khoảng trắng).` };
  }

  const friends = [];
  const seen = new Set();
  for (const friend of Array.isArray(src.friends) ? src.friends : []) {
    const name = String((friend && friend.name) ?? '').trim();
    if (!name) continue;
    if (!NAME_RE.test(name)) {
      return { error: `Tên bạn bè "${name}" không hợp lệ (tối đa 24 ký tự: chữ, số, _ . và không có khoảng trắng).` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    friends.push({ name, enabled: !(friend && friend.enabled === false) });
  }
  return { value: { username, password, inviteName, licenseKey, friends } };
}

function toStoredSettings(value) {
  return {
    id: 1,
    username: value.username,
    password: value.password,
    invite_name: value.inviteName,
    license_key: value.licenseKey,
    friends: value.friends
  };
}

function fromStoredSettings(row) {
  return {
    username: row.username || '',
    password: row.password || '',
    inviteName: row.invite_name || '',
    licenseKey: row.license_key || '',
    friends: Array.isArray(row.friends) ? row.friends : []
  };
}

module.exports = { fromStoredSettings, sanitizeSettings, toStoredSettings };