const REQUIRED_LIBS = ['mineflayer'];

const missingLibs = REQUIRED_LIBS.filter((name) => {
  try { require.resolve(name); return false; } catch (_) { return true; }
});
if (missingLibs.length) {
  console.log('Chưa cài đủ thư viện. Cần cài:');
  missingLibs.forEach((name) => console.log('  - ' + name));
  console.log('\nChạy lệnh:  npm install ' + missingLibs.join(' '));
  process.exit(1);
}

const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { sanitizeSettings } = require('./lib/settings');

const stdoutWrite = process.stdout.write.bind(process.stdout);
const print = (msg) => stdoutWrite(msg + '\n');

const isNoiseError = (err) => {
  const m = (err && err.message) || '';
  return m.includes('Chunk size') || m.includes('PartialReadError');
};

const CONFIG_PATH = path.join(__dirname, 'config.json');
const WEB_HOST = process.env.WEB_HOST || '127.0.0.1';
const WEB_PORT = parseInt(process.env.WEB_PORT || '3000', 10);
const BOT_API_URL = String(process.env.BOT_API_URL || '').replace(/\/+$/, '');
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const LICENSE_API_URL = String(process.env.LICENSE_API_URL || BOT_API_URL || '').replace(/\/+$/, '');
const remoteLogQueue = [];

const config = {
  server: {
    host: process.env.MC_HOST || '',
    port: Number.parseInt(process.env.MC_PORT || '19000', 10),
    version: process.env.MC_VERSION || '1.21.4',
    username: '',
    password: ''
  },
  licenseKey: '',

  party: {
    inviteName: '',
    afterInviteDelayMs: 2000
  },

  friends: [],

  accept: {
    enabled: true,
    titleContains: '',
    itemType: 'lime_wool',
    itemNameContains: 'chấp nhận',
    fixedSlot: 11,
    minDelayMs: 500,
    maxDelayMs: 1250,
    maxAttempts: 6,
    closeAfterClick: true,
    closeDelayMs: 150
  },

  debug: false,

  watchdog: {
    checkIntervalMs: 10000,
    maxSilentMs: 30000
  },
  reconnect: {
    baseDelayMs: 10000,
    maxDelayMs: 120000,
    stableAfterMs: 60000
  }
};

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m'
};
const ts = () => new Date().toTimeString().slice(0, 8);

const logBuf = [];
let logSeq = 0;
let remoteSyncBusy = false;
let remoteSyncFailed = false;
let remoteReconnectToken = null;
let licenseValid = false;
let licenseCheckBusy = false;
const LOG_KIND = { [C.blue]: 'chat', [C.red]: 'err', [C.green]: 'ok', [C.yellow]: 'warn' };
const log = (color, msg) => {
  const entry = { id: ++logSeq, t: ts(), kind: LOG_KIND[color] || 'info', msg: String(msg) };
  logBuf.push(entry);
  if (BOT_API_URL && BOT_TOKEN) {
    remoteLogQueue.push(entry);
    if (remoteLogQueue.length > 500) remoteLogQueue.shift();
  }
  if (logBuf.length > 1000) logBuf.shift();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randBetween = (min, max) => min + Math.floor(Math.random() * (Math.max(min, max) - min + 1));

let ChatMessage = null;
function reasonToText(reason, bot) {
  if (reason === undefined || reason === null) return 'không rõ lý do';
  try {
    if (!ChatMessage) ChatMessage = require('prismarine-chat')(bot.registry);
    let r = reason;
    if (typeof r === 'string') {
      try { r = JSON.parse(r); } catch (_) { return r; }
    }
    const msg = (r && r.type !== undefined && r.value !== undefined) ? ChatMessage.fromNotch(r) : new ChatMessage(r);
    return msg.toString() || JSON.stringify(reason);
  } catch (_) {
    try { return typeof reason === 'string' ? reason : JSON.stringify(reason); } catch (e) { return String(reason); }
  }
}

const SMALL_CAPS = {
  'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j',
  'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ǫ': 'q', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't',
  'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z'
};
const normalize = (s) =>
  String(s || '').replace(/[ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡʏᴢ]/g, (c) => SMALL_CAPS[c]).toLowerCase().normalize('NFC');

function componentText(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(componentText).join('');
  if (typeof node !== 'object') return '';

  if (typeof node.type === 'string' && 'value' in node) {
    if (node.type === 'string') return String(node.value);
    if (node.type === 'compound') return componentText(node.value);
    if (node.type === 'list') return componentText(node.value && node.value.value);
    return '';
  }

  let s = '';
  if (node.text !== undefined) s += componentText(node.text);
  else if (node.translate !== undefined) s += componentText(node.translate);
  if (node.extra !== undefined) s += componentText(node.extra);
  return s;
}

function loreText(data) {
  if (!data) return '';
  let lines = data;
  if (data.type === 'list' && data.value) lines = data.value.value;
  if (!Array.isArray(lines)) return componentText(data);
  return lines.map(componentText).join(' ');
}

function itemLabel(item) {
  let name = '';
  try { name = componentText(item.customName); } catch (_) {}
  return name || item.displayName || item.name || '';
}

function itemLore(item) {
  try { return loreText(item.customLore); } catch (_) { return ''; }
}

function loreHasName(lore, name) {
  const esc = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\w.])' + esc + '($|[^\\w.])').test(lore);
}

function matchesAccept(item) {
  const cfg = config.accept;
  if (!item) return false;

  const wantType = cfg.itemType;
  const wantName = normalize(cfg.itemNameContains);
  if (!wantType && !wantName) return false;

  if (wantType && item.name !== wantType) return false;
  if (wantName && !normalize(itemLabel(item)).includes(wantName)) return false;

  const friends = activeFriends();
  if (friends.length > 0) {
    const lore = normalize(itemLore(item));
    if (!friends.some((n) => loreHasName(lore, n))) return false;
  }
  return true;
}

function findAcceptSlot(window) {
  const cfg = config.accept;
  const containerEnd = (typeof window.inventoryStart === 'number') ? window.inventoryStart : window.slots.length;

  if (cfg.fixedSlot >= 0 && cfg.fixedSlot < containerEnd && matchesAccept(window.slots[cfg.fixedSlot])) {
    return cfg.fixedSlot;
  }
  for (let i = 0; i < containerEnd; i++) {
    if (i === cfg.fixedSlot) continue;
    if (matchesAccept(window.slots[i])) return i;
  }
  return -1;
}

function dumpWindow(window) {
  const containerEnd = (typeof window.inventoryStart === 'number') ? window.inventoryStart : window.slots.length;
  log(C.gray, `[GUI] "${String(window.title)}" - ${containerEnd} slot`);
  for (let i = 0; i < containerEnd; i++) {
    const it = window.slots[i];
    if (!it) continue;
    const lore = itemLore(it);
    log(C.gray, `   slot ${i}: ${it.name} | "${itemLabel(it)}"${lore ? ` | lore: ${lore}` : ''}`);
  }
}

function handleWindow(session, window) {
  const cfg = config.accept;
  if (!cfg.enabled || session.ended) return;
  const bot = session.bot;

  if (cfg.titleContains && !normalize(String(window.title)).includes(normalize(cfg.titleContains))) return;

  let attempts = 0;
  const schedule = (fn) => setTimeout(fn, randBetween(cfg.minDelayMs, cfg.maxDelayMs));

  const tryOnce = async () => {

    if (session.ended || bot.currentWindow !== window) return;
    attempts++;

    if (config.debug && attempts === 1) dumpWindow(window);

    const slot = findAcceptSlot(window);
    if (slot < 0) {
      if (attempts < cfg.maxAttempts) schedule(tryOnce);
      else if (config.debug) log(C.gray, `[GUI] Không thấy nút chấp nhận sau ${attempts} lần thử.`);
      return;
    }

    const item = window.slots[slot];
    const lore = itemLore(item);
    log(C.green, `[✓] Bấm "${itemLabel(item)}" ở slot ${slot}${lore ? ` (${lore})` : ''}`);

    try {
      await bot.clickWindow(slot, 0, 0);
    } catch (err) {
      if (config.debug) log(C.gray, `clickWindow: ${err.message}`);
    }

    if (cfg.closeAfterClick) {
      await sleep(cfg.closeDelayMs);
      if (!session.ended && bot.currentWindow === window) {
        try { bot.closeWindow(window); } catch (_) {}
      }
    }
  };

  schedule(tryOnce);
}

let current = null;
let reconnectTimer = null;
let failStreak = 0;

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!licenseValid) return;
  const { baseDelayMs, maxDelayMs } = config.reconnect;
  const delay = Math.min(baseDelayMs * Math.max(failStreak, 1), maxDelayMs);
  log(C.yellow, `[~] Tự động vào lại sau ${Math.round(delay / 1000)} giây...`);
  reconnectTimer = setTimeout(createBot, delay);
}

async function remoteRequest(method, body) {
  const response = await fetch(`${BOT_API_URL}/api/agent`, {
    method,
    headers: {
      Authorization: `Bearer ${BOT_TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function disableLicense(reason) {
  const wasValid = licenseValid;
  licenseValid = false;
  clearTimeout(reconnectTimer);
  if (wasValid) log(C.red, `[license] ${reason}`);
  const session = current;
  if (session && !session.ended) {
    session.restart = false;
    endSession(session, 'license không hợp lệ');
  }
}

async function requestLicenseVerification(key) {
  if (!LICENSE_API_URL) return { valid: false, error: 'Thiếu LICENSE_API_URL.' };
  if (!key) return { valid: false, error: 'Chưa có license key trong cấu hình.' };
  const licenseUrl = new URL(LICENSE_API_URL);
  if (licenseUrl.protocol !== 'https:') return { valid: false, error: 'LICENSE_API_URL phải dùng HTTPS.' };
  const response = await fetch(`${LICENSE_API_URL}/api/license/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || result.valid !== true) return { valid: false, error: result.error || 'Key hết hạn hoặc không hợp lệ.' };
  return { valid: true, expiresAt: result.expiresAt };
}

async function verifyLicense() {
  if (licenseCheckBusy) return licenseValid;
  licenseCheckBusy = true;
  try {
    const result = await requestLicenseVerification(config.licenseKey);
    if (!result.valid) {
      disableLicense(result.error);
      return false;
    }
    licenseValid = true;
    return true;
  } catch (err) {
    log(C.yellow, `[license] Chưa kiểm tra được key: ${err.message}`);
    return false;
  } finally {
    licenseCheckBusy = false;
  }
}

async function syncRemote() {
  if (!BOT_API_URL || !BOT_TOKEN || remoteSyncBusy) return;
  remoteSyncBusy = true;
  const batch = remoteLogQueue.splice(0, 100);
  try {
    const session = current;
    const result = await remoteRequest('POST', {
      status: {
        online: !!(session && !session.ended && session.bot && session.bot.entity),
        loggedIn: !!(session && session.loggedIn)
      },
      logs: batch
    });
    const parsed = sanitizeSettings(result.settings);
    if (parsed.error) throw new Error(parsed.error);

    const previous = [config.server.username, config.server.password, config.party.inviteName].join('\0');
    const previousLicenseKey = config.licenseKey;
    applySettings(parsed.value);
    const changed = previous !== [config.server.username, config.server.password, config.party.inviteName].join('\0');
    const licenseChanged = previousLicenseKey !== config.licenseKey;
    const reconnectRequested = remoteReconnectToken !== null
      && result.reconnectToken
      && result.reconnectToken !== remoteReconnectToken;
    remoteReconnectToken = result.reconnectToken || '';

    if (licenseChanged) {
      if (await verifyLicense()) {
        if (current && !current.ended) reconnectNow();
        else if (config.server.username) createBot();
      }
    } else if (changed || reconnectRequested) {
      if (licenseValid && current && !current.ended) reconnectNow();
      else if (licenseValid && config.server.username) createBot();
    }
    remoteSyncFailed = false;
  } catch (err) {
    remoteLogQueue.unshift(...batch);
    if (remoteLogQueue.length > 500) remoteLogQueue.length = 500;
    if (!remoteSyncFailed) log(C.red, `[cloud] Không đồng bộ được: ${err.message}`);
    remoteSyncFailed = true;
  } finally {
    remoteSyncBusy = false;
  }
}

async function loadRemoteSettings() {
  const result = await remoteRequest('GET');
  const parsed = sanitizeSettings(result.settings);
  if (parsed.error) throw new Error(parsed.error);
  applySettings(parsed.value);
  remoteReconnectToken = result.reconnectToken || '';
}

function endSession(session, why) {
  if (session.ended) return;
  log(C.red, `[!] Đóng kết nối: ${why}`);
  try { session.bot.end(); } catch (_) {
    try { session.bot._client.destroy(); } catch (e) {}
  }
}

function createBot() {
  clearTimeout(reconnectTimer);
  if (!licenseValid) {
    log(C.red, '[license] Chưa xác minh key, bot chưa kết nối.');
    return;
  }
  if (!config.server.host) {
    log(C.red, '[X] Chưa cấu hình MC_HOST hoặc server.host trong config.json.');
    return;
  }
  if (!config.server.username) {
    current = null;
    log(C.yellow, BOT_API_URL
      ? '[!] Chưa có tên bot. Nhập thông tin trên dashboard Vercel rồi bấm Lưu.'
      : `[!] Chưa có tên bot. Mở web (http://localhost:${WEB_PORT}) > Setting để nhập rồi bấm Lưu.`);
    return;
  }
  log(C.gray, '=========================================');
  log(C.cyan, `[+] Đang kết nối: ${config.server.username} -> ${config.server.host}:${config.server.port} (${config.server.version})...`);

  const session = {
    bot: null,
    loggedIn: false,
    ended: false,
    restart: false,
    spawnedAt: 0,
    lastPacketAt: Date.now(),
    loginSentAt: 0,
    watchdog: null
  };
  current = session;

  let bot;
  try {
    bot = mineflayer.createBot({
      host: config.server.host,
      port: config.server.port,
      username: config.server.username,
      version: config.server.version,
      viewDistance: 'tiny',
      checkTimeoutInterval: 60 * 1000
    });
  } catch (err) {
    log(C.red, `[X] Không tạo được bot: ${err.message}`);
    session.ended = true;
    failStreak++;
    scheduleReconnect();
    return;
  }
  session.bot = bot;

  if (bot._client) bot._client.on('packet', () => { session.lastPacketAt = Date.now(); });

  session.watchdog = setInterval(() => {
    if (session.ended) return;
    const silent = Date.now() - session.lastPacketAt;
    if (silent > config.watchdog.maxSilentMs) {
      log(C.red, `[WATCHDOG] ${Math.round(silent / 1000)}s không nhận được packet nào từ server -> làm mới kết nối.`);
      endSession(session, 'watchdog');
    }
  }, config.watchdog.checkIntervalMs);

  bot.on('spawn', () => {
    if (!session.spawnedAt) session.spawnedAt = Date.now();
    log(C.yellow, '[+] Bot đã spawn vào game!');
  });

  bot.on('windowOpen', (window) => handleWindow(session, window));

  bot.on('message', async (msg) => {
    if (session.ended) return;
    const cleanMsg = msg.toString().trim();
    if (!cleanMsg) return;

    log(C.blue, `[SERVER CHAT] ${cleanMsg}`);
    const text = normalize(cleanMsg);

    const welcomeBack = text.includes('chào mừng đạo hữu đã quay trở lại');
    if (!session.loggedIn && !welcomeBack && (text.includes('login') || text.includes('chào mừng') || text.includes('đăng nhập'))) {
      const now = Date.now();
      if (now - session.loginSentAt > 5000) {
        session.loginSentAt = now;
        log(C.yellow, '[+] Phát hiện yêu cầu đăng nhập -> gửi /login');
        await sleep(1500);
        if (!session.ended && !session.loggedIn) {
          if (config.server.password) bot.chat(`/login ${config.server.password}`);
          else log(C.red, '[X] Chưa nhập mật khẩu bot - vào web > Setting để nhập.');
        }
      }
    }

    if (!session.loggedIn && text.includes('chào mừng đạo hữu đã quay trở lại')) {
      session.loggedIn = true;
      log(C.green, '[✓] Đã đăng nhập!');
      await sleep(2000);
      if (session.ended) return;

      const invitee = config.party.inviteName;
      if (invitee) {
        log(C.cyan, `[+] Mời tổ đội: /todoi moi ${invitee}`);
        bot.chat(`/todoi moi ${invitee}`);
        await sleep(config.party.afterInviteDelayMs);
        if (session.ended) return;
      }
    }
  });

  bot.on('error', (err) => {
    if (isNoiseError(err)) return;
    log(C.red, `[X] Lỗi Minecraft Bot: ${err && err.message}`);
    endSession(session, `lỗi: ${err && err.message}`);
  });

  bot.on('kicked', (reason) => {
    log(C.red, `[X] Bot bị kick: ${reasonToText(reason, bot)}`);
  });

  bot.on('end', (reason) => {
    if (session.ended) return;
    session.ended = true;
    clearInterval(session.watchdog);

    const lived = session.spawnedAt ? Date.now() - session.spawnedAt : 0;
    log(C.red, `[-] Bot ngắt kết nối (${reason || 'không rõ lý do'}) sau ${Math.round(lived / 1000)}s trong game.`);

    if (session.restart) {
      failStreak = 0;
      reconnectTimer = setTimeout(createBot, 1500);
      return;
    }

    if (lived >= config.reconnect.stableAfterMs) failStreak = 0; else failStreak++;
    scheduleReconnect();
  });
}

const activeFriends = () => config.friends.filter((f) => f.enabled && f.name).map((f) => f.name);

function applySettings(v) {
  config.server.username = v.username;
  config.server.password = v.password;
  config.party.inviteName = v.inviteName;
  config.licenseKey = v.licenseKey;
  config.friends = v.friends;
}

function saveConfig() {
  const data = {
    server: { ...config.server },
    licenseKey: config.licenseKey,
    party: { inviteName: config.party.inviteName },
    friends: config.friends
  };
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}

function loadConfig() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      saveConfig();
      log(C.gray, '[i] Chưa có config.json -> đã tạo file mặc định.');
    } else {
      log(C.red, `[X] Không đọc được config.json (${err.message}) -> dùng mặc định.`);
    }
    return;
  }

  const s = (raw && raw.server) || {};
  if (typeof s.host === 'string' && s.host.trim()) config.server.host = s.host.trim();
  const port = parseInt(s.port, 10);
  if (port > 0 && port < 65536) config.server.port = port;
  if (typeof s.version === 'string' && s.version.trim()) config.server.version = s.version.trim();

  const r = sanitizeSettings({
    username: s.username,
    password: s.password,
    licenseKey: raw && raw.licenseKey,
    inviteName: raw && raw.party && raw.party.inviteName,
    friends: raw && raw.friends
  });
  if (r.error) log(C.red, `[X] config.json: ${r.error} -> bỏ qua phần tên/mật khẩu/mời/bạn bè.`);
  else applySettings(r.value);
}

const PANEL_HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AFK Bot</title>
<style>
:root{--bg:#f4f5f8;--card:#fff;--text:#1d2330;--muted:#6b7385;--line:#dde1e9;--accent:#2f6feb;--accent-text:#fff;--danger:#d64545;--ok:#1f9d55;--off:#c3c9d6;--warn:#b7791f}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--card:#1d222b;--text:#e8ebf1;--muted:#98a1b3;--line:#2d3440;--accent:#5b92ff;--accent-text:#0e1117;--danger:#ef6b6b;--ok:#3ccf7e;--off:#465063;--warn:#e0b04a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
h1{font-size:20px;margin:0}
.status{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--off)}
.dot.on{background:var(--ok)}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}
.tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--muted);padding:10px 14px;font:inherit;cursor:pointer}
.tab.active{color:var(--text);border-bottom-color:var(--accent);font-weight:600}
.panel{display:none}.panel.active{display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
label.field{display:block;margin-bottom:14px}
label.field>span{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}
input[type=text],input[type=password]{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:-1px}
.inline{display:flex;gap:8px;align-items:center}
.check{font-size:13px;color:var(--muted);display:flex;gap:6px;align-items:center;margin-top:6px}
.hint{color:var(--muted);font-size:13px;margin:0 0 12px}
.row{display:flex;gap:10px;align-items:center;margin-bottom:8px}
.row input[type=text]{flex:1}
.switch{position:relative;width:42px;height:24px;flex:none;cursor:pointer}
.switch input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.switch span{position:absolute;inset:0;background:var(--off);border-radius:12px;transition:background .15s}
.switch span::after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}
.switch input:checked+span{background:var(--ok)}
.switch input:checked+span::after{transform:translateX(18px)}
.switch input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
button{font:inherit;cursor:pointer}
.icon{width:34px;height:34px;flex:none;border:1px solid var(--line);background:none;color:var(--muted);border-radius:8px}
.icon.danger:hover{color:var(--danger);border-color:var(--danger)}
.add{width:100%;margin-top:4px;padding:8px;border:1px dashed var(--line);background:none;color:var(--accent);border-radius:8px;font-size:18px;line-height:1}
.add:hover{border-color:var(--accent)}
.actions{display:flex;gap:10px;margin-top:16px}
.btn{padding:10px 16px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text);font-weight:600}
.note{font-size:12px;color:var(--muted);margin-top:10px}
.tools{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:13px;color:var(--muted)}
.tools label{display:flex;gap:6px;align-items:center;cursor:pointer}
.tools .btn{padding:5px 10px;font-size:13px;margin-left:auto}
.logbox{height:420px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;word-break:break-word}
.ln .t{color:var(--muted);margin-right:6px}
.k-chat{color:var(--accent)}.k-err{color:var(--danger)}.k-ok{color:var(--ok)}.k-warn{color:var(--warn)}
.empty{color:var(--muted)}
.intro h2{font-size:15px;margin:18px 0 4px}
.intro h2:first-child{margin-top:0}
.intro p{margin:0 0 6px;color:var(--muted)}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:var(--ok);color:#fff;padding:10px 16px;border-radius:8px;opacity:0;pointer-events:none;transition:all .2s;max-width:90%}
.toast.show{opacity:1;transform:translateX(-50%)}
.toast.bad{background:var(--danger)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>AFK Bot</h1>
    <div class="status"><span class="dot" id="dot"></span><span id="statusText">...</span></div>
  </header>

  <div class="tabs">
    <button class="tab active" data-tab="setting" type="button">Setting</button>
    <button class="tab" data-tab="friend" type="button">Friend</button>
    <button class="tab" data-tab="log" type="button">Log</button>
    <button class="tab" data-tab="intro" type="button">Giới thiệu</button>
  </div>

  <section class="panel active" id="panel-setting">
    <div class="card">
      <label class="field"><span>Tên bot</span>
        <input type="text" id="username" maxlength="32" autocomplete="off" spellcheck="false">
      </label>
      <label class="field"><span>Mật khẩu bot</span>
        <input type="password" id="password" maxlength="100" autocomplete="off">
        <span class="check"><input type="checkbox" id="showPass"> Hiện mật khẩu</span>
      </label>
      <label class="field" style="margin-bottom:0"><span>Tên mời tổ đội khi vào game (để trống = không mời)</span>
        <input type="text" id="inviteName" maxlength="24" autocomplete="off" spellcheck="false" placeholder="Tên người chơi">
      </label>
      <label class="field" style="margin-top:14px;margin-bottom:0"><span>License key</span>
        <input type="text" id="licenseKey" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Nhập key 30 ký tự">
      </label>
    </div>
  </section>

  <section class="panel" id="panel-friend">
    <div class="card">
      <p class="hint">Chỉ chấp nhận lời mời tổ đội từ những tên đang bật. Để trống hoặc tắt hết = chấp nhận từ bất kỳ ai.</p>
      <div id="friends"></div>
      <button class="add" id="addFriend" type="button" title="Thêm tên">+</button>
    </div>
  </section>

  <section class="panel" id="panel-log">
    <div class="card">
      <div class="tools">
        <label><input type="checkbox" id="logScroll" checked> Tự cuộn xuống cuối</label>
        <label><input type="checkbox" id="logChatOnly"> Chỉ chat của server</label>
        <button class="btn" id="logClear" type="button">Xóa màn hình</button>
      </div>
      <div class="logbox" id="logbox"></div>
    </div>
  </section>

  <section class="panel intro" id="panel-intro">
    <div class="card">
      <h2>Tự đăng nhập</h2>
      <p>Khi server yêu cầu đăng nhập, bot tự gửi <b>/login</b> với mật khẩu nhập ở tab Setting (tối đa 1 lần mỗi 5 giây, dừng khi đã đăng nhập).</p>
      <h2>Mời tổ đội</h2>
      <p>Sau khi đăng nhập, bot gửi <b>/todoi moi &lt;tên&gt;</b> cho người chơi bạn nhập ở Setting. Để trống thì không mời.</p>
      <h2>Tự chấp nhận tổ đội</h2>
      <p>Mỗi khi có GUI mở ra, bot tìm nút len xanh lá "chấp nhận", bấm rồi đóng GUI (có độ trễ ngẫu nhiên cho giống người).</p>
      <h2>Lọc theo bạn bè</h2>
      <p>Ở tab Friend, chỉ những tên đang bật mới được chấp nhận (so khớp nguyên tên). Để trống hoặc tắt hết thì chấp nhận từ bất kỳ ai.</p>
      <h2>Tự kết nối lại</h2>
      <p>Bị kick hoặc rớt mạng thì bot tự vào lại, thời gian chờ tăng dần nếu bị văng liên tục. Nếu 30 giây không nhận được gì từ server, bot tự làm mới kết nối.</p>
      <h2>Lưu cấu hình</h2>
      <p>Mọi thiết lập lưu trong <b>config.json</b>, chưa có file thì tự tạo (tên và mật khẩu để trống).</p>
    </div>
  </section>

  <div id="actions">
    <div class="actions">
      <button class="btn primary" id="save" type="button">Lưu</button>
      <button class="btn" id="reconnect" type="button">Kết nối lại</button>
    </div>
    <p class="note">Danh sách bạn bè áp dụng ngay khi lưu. Tên/mật khẩu bot và tên mời tổ đội áp dụng ở lần kết nối kế tiếp — bấm "Kết nối lại" để áp dụng luôn.</p>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
(function () {
  var dead = false;
  function kick() {
    if (dead) return;
    dead = true;
    try { navigator.sendBeacon('/api/debug', ''); } catch (e) {}
    try { window.stop(); } catch (e) {}
    document.documentElement.innerHTML = '';
    location.replace('about:blank');
  }
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('keydown', function (e) {
    var k = String(e.key || '').toLowerCase();
    var devKey = e.key === 'F12'
      || ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === 'i' || k === 'j' || k === 'c'))
      || (e.metaKey && e.altKey && (k === 'i' || k === 'j' || k === 'u'))
      || (e.ctrlKey && k === 'u');
    if (devKey) { e.preventDefault(); kick(); }
  });
  setInterval(function () {
    var t = performance.now();
    debugger;
    if (performance.now() - t > 100) kick();
  }, 1000);
})();
</script>
<script>
var friends = [];
function $(id) { return document.getElementById(id); }

function toast(msg, bad) {
  var t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { t.className = 'toast'; }, 3000);
}

function api(method, url, body) {
  return fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (r) {
    return r.json().then(function (j) {
      if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra');
      return j;
    });
  });
}

function renderFriends() {
  var box = $('friends');
  box.textContent = '';
  if (!friends.length) {
    var p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Chưa có tên nào. Bấm + để thêm.';
    box.appendChild(p);
  }
  friends.forEach(function (f, i) {
    var row = document.createElement('div');
    row.className = 'row';

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Tên người chơi';
    inp.maxLength = 24;
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.value = f.name;
    inp.addEventListener('input', function () { f.name = inp.value; });

    var sw = document.createElement('label');
    sw.className = 'switch';
    sw.title = 'Bật / tắt';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = f.enabled;
    cb.addEventListener('change', function () { f.enabled = cb.checked; });
    sw.appendChild(cb);
    sw.appendChild(document.createElement('span'));

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon danger';
    del.textContent = '\\u2715';
    del.title = 'Xóa';
    del.addEventListener('click', function () { friends.splice(i, 1); renderFriends(); });

    row.appendChild(inp);
    row.appendChild(sw);
    row.appendChild(del);
    box.appendChild(row);
  });
}

function load() {
  api('GET', '/api/config').then(function (c) {
    $('username').value = c.username;
    $('password').value = c.password;
    $('inviteName').value = c.inviteName;
    $('licenseKey').value = new URLSearchParams(location.search).get('key') || c.licenseKey || '';
    if (location.search) history.replaceState(null, '', location.pathname);
    friends = c.friends;
    renderFriends();
  }).catch(function (e) { toast(e.message, true); });
}

function refreshStatus() {
  api('GET', '/api/status').then(function (s) {
    $('dot').className = 'dot' + (s.online ? ' on' : '');
    $('statusText').textContent = s.online
      ? (s.loggedIn ? 'Online - đã đăng nhập' : 'Online')
      : (s.hasUsername ? 'Offline / đang kết nối' : 'Chưa nhập tên bot');
  }).catch(function () {
    $('dot').className = 'dot';
    $('statusText').textContent = 'Mất kết nối tới chương trình';
  });
}

function save() {
  return api('POST', '/api/config', {
    username: $('username').value,
    password: $('password').value,
    inviteName: $('inviteName').value,
    licenseKey: $('licenseKey').value,
    friends: friends
  }).then(function (r) {
    friends = r.friends;
    renderFriends();
    return r;
  });
}

document.querySelectorAll('.tab').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + btn.dataset.tab); });
    var t = btn.dataset.tab;
    $('actions').style.display = (t === 'setting' || t === 'friend') ? '' : 'none';
    if (t === 'log') scrollLog(true);
  });
});

$('showPass').addEventListener('change', function () { $('password').type = this.checked ? 'text' : 'password'; });

$('addFriend').addEventListener('click', function () {
  friends.push({ name: '', enabled: true });
  renderFriends();
  var inputs = document.querySelectorAll('#friends input[type=text]');
  inputs[inputs.length - 1].focus();
});

$('save').addEventListener('click', function () {
  save().then(function () { toast('Đã lưu vào config.json'); refreshStatus(); })
        .catch(function (e) { toast(e.message, true); });
});

$('reconnect').addEventListener('click', function () {
  save().then(function () { return api('POST', '/api/reconnect'); })
        .then(function () { toast('Đã lưu và đang kết nối lại...'); })
        .catch(function (e) { toast(e.message, true); });
});

var lastLogId = 0;

function scrollLog(force) {
  var box = $('logbox');
  if (force || $('logScroll').checked) box.scrollTop = box.scrollHeight;
}

function applyLogFilter() {
  var only = $('logChatOnly').checked;
  document.querySelectorAll('#logbox .ln').forEach(function (el) {
    el.style.display = (only && !el.classList.contains('k-chat')) ? 'none' : '';
  });
}

function addLogLine(l) {
  var box = $('logbox');
  var el = document.createElement('div');
  el.className = 'ln k-' + l.kind;
  var t = document.createElement('span');
  t.className = 't';
  t.textContent = l.t;
  el.appendChild(t);
  el.appendChild(document.createTextNode(l.msg));
  if ($('logChatOnly').checked && l.kind !== 'chat') el.style.display = 'none';
  box.appendChild(el);
  while (box.childNodes.length > 1000) box.removeChild(box.firstChild);
}

function pollLogs() {
  api('GET', '/api/logs?after=' + lastLogId).then(function (r) {
    if (r.last < lastLogId) {
      lastLogId = 0;
      $('logbox').textContent = '';
      return;
    }
    if (!r.logs.length) return;
    r.logs.forEach(addLogLine);
    lastLogId = r.last;
    scrollLog(false);
  }).catch(function () {});
}

$('logClear').addEventListener('click', function () { $('logbox').textContent = ''; });
$('logChatOnly').addEventListener('change', function () { applyLogFilter(); scrollLog(false); });

load();
refreshStatus();
pollLogs();
setInterval(refreshStatus, 3000);
setInterval(pollLogs, 1500);
</script>
</body>
</html>`;

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Dữ liệu quá lớn.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function reconnectNow() {
  clearTimeout(reconnectTimer);
  const s = current;
  if (s && !s.ended) {
    s.restart = true;
    endSession(s, 'kết nối lại theo yêu cầu từ web');
  } else {
    failStreak = 0;
    createBot();
  }
}

function startWebServer() {
  const loopbackOnly = WEB_HOST === '127.0.0.1' || WEB_HOST === 'localhost';

  const server = http.createServer(async (req, res) => {
    try {

      const hostName = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
      if (loopbackOnly && !['localhost', '127.0.0.1', '[::1]'].includes(hostName)) {
        return sendJson(res, 403, { error: 'Host không hợp lệ.' });
      }
      const url = req.url.split('?')[0];
      if (url.startsWith('/api/') && url !== '/api/debug' && req.headers['x-panel'] !== '1') {
        return sendJson(res, 403, { error: 'Không hợp lệ.' });
      }

      if (req.method === 'GET' && url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(PANEL_HTML);
      }
      if (req.method === 'GET' && url === '/api/config') {
        return sendJson(res, 200, {
          username: config.server.username,
          password: config.server.password,
          inviteName: config.party.inviteName,
          licenseKey: config.licenseKey,
          friends: config.friends
        });
      }
      if (req.method === 'POST' && url === '/api/debug') {
        const origin = req.headers.origin;
        if (origin) {
          try { if (new URL(origin).host !== req.headers.host) return sendJson(res, 403, { error: 'Origin không hợp lệ.' }); }
          catch (_) { return sendJson(res, 403, { error: 'Origin không hợp lệ.' }); }
        }
        config.licenseKey = '';
        saveConfig();
        disableLicense('Phát hiện Web DevTools; key đã được xóa khỏi config.json.');
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url === '/api/logs') {
        const after = parseInt(new URL(req.url, 'http://localhost').searchParams.get('after') || '0', 10) || 0;
        return sendJson(res, 200, { logs: logBuf.filter((l) => l.id > after), last: logSeq });
      }
      if (req.method === 'GET' && url === '/api/status') {
        const s = current;
        return sendJson(res, 200, {
          online: !!(s && !s.ended && s.bot && s.bot.entity),
          loggedIn: !!(s && s.loggedIn),
          hasUsername: !!config.server.username
        });
      }

      if (req.method === 'POST' && (url === '/api/config' || url === '/api/reconnect')) {

        const origin = req.headers.origin;
        if (origin) {
          let ok = false;
          try { ok = new URL(origin).host === req.headers.host; } catch (_) {}
          if (!ok) return sendJson(res, 403, { error: 'Origin không hợp lệ.' });
        }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          return sendJson(res, 415, { error: 'Cần Content-Type: application/json.' });
        }
        const body = await readBody(req);

        if (url === '/api/reconnect') {
          if (!licenseValid && !(await verifyLicense())) {
            return sendJson(res, 403, { error: 'Cần license key hợp lệ để kết nối.' });
          }
          log(C.yellow, '[web] Yêu cầu kết nối lại.');
          reconnectNow();
          return sendJson(res, 200, { ok: true });
        }

        let data;
        try { data = JSON.parse(body || '{}'); } catch (_) { return sendJson(res, 400, { error: 'JSON không hợp lệ.' }); }
        const r = sanitizeSettings(data);
        if (r.error) return sendJson(res, 400, { error: r.error });

        const hadName = !!config.server.username;
        const previousLicenseKey = config.licenseKey;
        const licenseKeyChanged = previousLicenseKey !== r.value.licenseKey;
        if (licenseKeyChanged) {
          let check;
          try { check = await requestLicenseVerification(r.value.licenseKey); }
          catch (err) { return sendJson(res, 503, { error: `Không kiểm tra được key: ${err.message}` }); }
          if (!check.valid) return sendJson(res, 403, { error: check.error });
        }
        applySettings(r.value);
        try { saveConfig(); } catch (err) { return sendJson(res, 500, { error: `Không ghi được config.json: ${err.message}` }); }
        log(C.green, `[web] Đã lưu config.json (bạn bè đang bật: ${activeFriends().length}/${config.friends.length}).`);

        if (licenseKeyChanged) {
          licenseValid = true;
          if (current && !current.ended) reconnectNow();
          else if (config.server.username) createBot();
        } else if (!licenseValid) {
          if (await verifyLicense()) {
            if (current && !current.ended) reconnectNow();
            else if (config.server.username) createBot();
          }
        } else if (!hadName && config.server.username && !current && licenseValid) createBot();

        return sendJson(res, 200, { ok: true, friends: config.friends, licenseKey: config.licenseKey });
      }

      sendJson(res, 404, { error: 'Không tìm thấy.' });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });

  server.on('error', (err) => {
    log(C.red, `[X] Không mở được trang web ở ${WEB_HOST}:${WEB_PORT}: ${err.message} (đổi cổng bằng biến môi trường WEB_PORT).`);
    print(`Không mở được trang web ở ${WEB_HOST}:${WEB_PORT}: ${err.message}\nĐổi cổng bằng biến môi trường WEB_PORT.`);
  });
  server.listen(WEB_PORT, WEB_HOST, () => {
    log(C.cyan, `[web] Mở trang quản lý: http://${loopbackOnly ? 'localhost' : WEB_HOST}:${WEB_PORT}`);
    print(`Mở trang quản lý: http://${loopbackOnly ? 'localhost' : WEB_HOST}:${WEB_PORT}`);
  });
}

async function main() {
  process.stdout.write = () => true;
  process.stderr.write = () => true;

  process.on('unhandledRejection', (err) => {
    if (isNoiseError(err)) return;
    log(C.red, `[X] Unhandled Rejection: ${(err && err.message) || err}`);
  });
  process.on('uncaughtException', (err) => {
    if (isNoiseError(err)) return;
    log(C.red, `[X] Uncaught Exception: ${(err && err.message) || err}`);
  });

  if (!!BOT_API_URL !== !!BOT_TOKEN) {
    print('Cần cấu hình đồng thời BOT_API_URL và BOT_TOKEN, hoặc bỏ cả hai để chạy local.');
    return;
  }

  if (BOT_API_URL) {
    try {
      await loadRemoteSettings();
    } catch (err) {
      log(C.red, `[cloud] Chưa tải được cấu hình: ${err.message}`);
    }
    setInterval(syncRemote, 10000);
  } else {
    loadConfig();
    startWebServer();
  }
  if (await verifyLicense()) createBot();
  else log(C.red, '[license] Bot đang dừng cho đến khi nhập key hợp lệ.');
  setInterval(async () => {
    const wasValid = licenseValid;
    if (await verifyLicense() && !wasValid && !current && config.server.username) createBot();
  }, 60000);
}

if (require.main === module) {
  main();
} else {

  module.exports = { config, normalize, componentText, loreText, itemLabel, itemLore, matchesAccept, findAcceptSlot, sanitizeSettings, activeFriends };
}