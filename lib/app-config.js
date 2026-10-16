const fs = require('node:fs');
const path = require('node:path');

const appConfigPath = path.join(__dirname, '..', 'config.json');
const serverConfigPath = path.join(__dirname, '..', 'srv.json');

let appConfig = {};
try {
  const raw = fs.readFileSync(appConfigPath, 'utf8');
  if (raw.trim()) appConfig = JSON.parse(raw);
} catch (_error) {
  appConfig = {};
}

let serverConfig = {};
try {
  const raw = fs.readFileSync(serverConfigPath, 'utf8');
  if (raw.trim()) serverConfig = JSON.parse(raw);
} catch (_error) {
  serverConfig = {};
}

const FIELDS = {
  WEB_HOST: ['web', 'host'],
  WEB_PORT: ['web', 'port'],
  MC_HOST: ['server', 'host'],
  MC_PORT: ['server', 'port'],
  MC_VERSION: ['server', 'version'],
  BOT_API_URL: ['cloud', 'botApiUrl'],
  BOT_TOKEN: ['cloud', 'botToken'],
  LICENSE_API_URL: ['cloud', 'licenseApiUrl'],
  ADMIN_TOKEN: ['cloud', 'adminToken'],
  SUPABASE_URL: ['cloud', 'supabaseUrl'],
  SUPABASE_SERVICE_ROLE_KEY: ['cloud', 'supabaseServiceRoleKey'],
  LINK4M_API_KEY: ['cloud', 'link4mApiKey'],
  PUBLIC_APP_URL: ['cloud', 'publicAppUrl'],
  VIP_CONTACT_URL: ['cloud', 'vipContactUrl']
};

function readNestedValue(source, fieldPath) {
  if (!source || !fieldPath) return undefined;
  const group = source[fieldPath[0]];
  if (!group || group[fieldPath[1]] === undefined) return undefined;
  return group[fieldPath[1]];
}

function getConfigValue(name) {
  const environmentValue = process.env[name];
  if (environmentValue !== undefined && environmentValue !== '') return environmentValue;

  const fieldPath = FIELDS[name];
  if (!fieldPath) return undefined;

  const serverValue = readNestedValue(serverConfig, fieldPath);
  if (serverValue !== undefined && serverValue !== '') return serverValue;

  const localValue = readNestedValue(appConfig, fieldPath);
  if (localValue !== undefined && localValue !== '') return localValue;

  return undefined;
}

module.exports = { appConfig, getConfigValue, serverConfig };
