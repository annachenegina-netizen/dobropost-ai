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

function get() {
  const s = load();
  const result = {};
  for (const key of KEYS) {
    result[key] = s[key] || process.env[key] || '';
  }
  return result;
}

function save(updates) {
  const current = load();
  for (const key of KEYS) {
    if (updates[key] != null && updates[key] !== '') {
      current[key] = updates[key];
      process.env[key] = updates[key];
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return current;
}

module.exports = { load, apply, get, save, KEYS };
