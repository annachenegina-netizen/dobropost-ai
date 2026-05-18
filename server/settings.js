const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'settings.json');

const KEYS = [
  'OPENAI_API_KEY',
  'SENDSAY_LOGIN',
  'SENDSAY_PASSWORD',
  'TELEGRAM_BOT_TOKEN',
  'MODEL_MAIN',
  'MODEL_QA',
];

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (_) { return {}; }
}

function apply() {
  const s = load();
  for (const [key, val] of Object.entries(s)) {
    if (val) process.env[key] = val;
  }
}

// Чувствительные ключи — маскируем при выдаче в API
const SENSITIVE = new Set(['OPENAI_API_KEY', 'SENDSAY_PASSWORD', 'TELEGRAM_BOT_TOKEN']);

function _mask(val) {
  if (!val || val.length < 8) return val ? '••••••••' : '';
  return val.slice(0, 6) + '••••••••' + val.slice(-4);
}

function get() {
  const s = load();
  const result = {};
  for (const key of KEYS) {
    const raw = s[key] || process.env[key] || '';
    result[key] = SENSITIVE.has(key) ? _mask(raw) : raw;
  }
  return result;
}

// Проверяем что значение не является нашей маской (т.е. пользователь реально что-то изменил)
function _isMasked(val) {
  return typeof val === 'string' && val.includes('••••••••');
}

function save(updates) {
  const current = load();
  for (const key of KEYS) {
    const val = updates[key];
    // Пропускаем пустые значения и маски — значит пользователь ничего не менял
    if (val == null || val === '' || _isMasked(val)) continue;
    current[key] = val;
    process.env[key] = val;
  }
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return current;
}

module.exports = { load, apply, get, save, KEYS, SENSITIVE };
