// Хранилище + планировщик напоминаний
const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'reminders.json');

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

// Расписание уведомлений относительно datetime напоминания
const SLOTS = [
  { key: '3d',  ms: -3 * 24 * 60 * 60 * 1000, label: '⏰ Через 3 дня:\n\n'  },
  { key: '1d',  ms: -1 * 24 * 60 * 60 * 1000, label: '⏰ Завтра:\n\n'        },
  { key: '0',   ms: 0,                          label: '🔔 Время пришло!\n\n' },
  { key: '+1h', ms:  1 * 60 * 60 * 1000,        label: '🔔 1 час назад:\n\n'  },
  { key: '+4h', ms:  4 * 60 * 60 * 1000,        label: '🔔 4 часа назад:\n\n' },
];

// Уведомление считается устаревшим если опоздали >6ч — пропускаем без отправки
const MAX_LATE_MS = 6 * 60 * 60 * 1000;

let reminders = [];

try {
  reminders = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log(`⏰ Напоминания загружены: ${reminders.length}`);
} catch (_) {}

function _save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(reminders, null, 2)); } catch (_) {}
}

function _id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _fmt(isoStr) {
  return new Date(isoStr).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });
}

function addReminder(text, datetime, chatId) {
  const r = {
    id:        _id(),
    text,
    datetime:  new Date(datetime).toISOString(),
    chatId:    String(chatId),
    createdAt: new Date().toISOString(),
    sent:      {},   // { slotKey: epochMs|-1(skipped) }
    done:      false,
  };
  reminders.unshift(r);
  if (reminders.length > 300) reminders.pop();
  _save();
  return r;
}

function getReminders()        { return reminders; }
function deleteReminder(id)    {
  const i = reminders.findIndex(r => r.id === id);
  if (i === -1) return false;
  reminders.splice(i, 1); _save(); return true;
}
function markDone(id) {
  const r = reminders.find(r => r.id === id);
  if (!r) return false;
  r.done = true; _save(); return true;
}

async function checkAndSend(bot) {
  if (!bot) return;
  const now = Date.now();
  let changed = false;

  for (const r of reminders) {
    if (r.done) continue;
    const dt = new Date(r.datetime).getTime();

    for (const slot of SLOTS) {
      if (r.sent[slot.key] !== undefined) continue; // уже обработан
      const fireAt = dt + slot.ms;
      if (fireAt > now) continue; // ещё не пришло

      if (now - fireAt > MAX_LATE_MS) {
        r.sent[slot.key] = -1; // пропущен — слишком поздно
        changed = true;
        continue;
      }

      try {
        const msg = `${slot.label}📌 <b>${r.text}</b>\n📅 ${_fmt(r.datetime)}`;
        await bot.sendMessage(r.chatId, msg, { parse_mode: 'HTML' });
        r.sent[slot.key] = now;
        changed = true;
      } catch (e) {
        console.error('❌ Reminder send:', e.message);
      }
    }

    if (SLOTS.every(s => r.sent[s.key] !== undefined)) {
      r.done = true; changed = true;
    }
  }

  if (changed) _save();
}

let _timer = null;

function startScheduler(bot) {
  if (_timer) return;
  checkAndSend(bot);
  _timer = setInterval(() => checkAndSend(bot), 60 * 1000);
  console.log('⏰ Планировщик напоминаний запущен');
}

module.exports = { addReminder, getReminders, deleteReminder, markDone, startScheduler, SLOTS };
