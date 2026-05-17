const Database = require('better-sqlite3');
const path = require('path');
const webpush = require('web-push');

const db = new Database(path.join(__dirname, '..', 'tasks.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    num         INTEGER,
    tz          TEXT,
    fromName    TEXT DEFAULT '?',
    sourceChatTitle TEXT,
    telegramChatId  TEXT,
    telegramMsgId   TEXT,
    status      TEXT DEFAULT 'analyzing',
    error       TEXT,
    result      TEXT,
    priority    TEXT,
    deadline    TEXT,
    createdAt   INTEGER
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint    TEXT PRIMARY KEY,
    sub         TEXT NOT NULL,
    createdAt   INTEGER
  );
`);

// Миграция: добавляем num если его нет
try { db.exec('ALTER TABLE tasks ADD COLUMN num INTEGER'); } catch (_) {}

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@dobropost.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

const sseClients = [];

function rowToTask(row) {
  if (!row) return null;
  return {
    ...row,
    tz:     row.tz     ? JSON.parse(row.tz)     : null,
    result: row.result ? JSON.parse(row.result) : null,
  };
}

function _nextNum() {
  const row = db.prepare('SELECT MAX(num) as m FROM tasks').get();
  return (row?.m || 0) + 1;
}

function addTask({ tz, fromName, sourceChatTitle, telegramChatId, telegramMsgId }) {
  const task = {
    id: Date.now().toString(),
    num: _nextNum(),
    tz,
    fromName: fromName || '?',
    sourceChatTitle: sourceChatTitle || null,
    telegramChatId:  telegramChatId  ? String(telegramChatId)  : null,
    telegramMsgId:   telegramMsgId   ? String(telegramMsgId)   : null,
    status:   'analyzing',
    error:    null,
    result:   null,
    priority: tz?.priority || null,
    deadline: tz?.deadline || null,
    createdAt: Date.now(),
  };

  db.prepare(`
    INSERT INTO tasks
      (id, num, tz, fromName, sourceChatTitle, telegramChatId, telegramMsgId,
       status, error, result, priority, deadline, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    task.id, task.num, JSON.stringify(task.tz), task.fromName,
    task.sourceChatTitle, task.telegramChatId, task.telegramMsgId,
    task.status, task.error, null, task.priority, task.deadline, task.createdAt
  );

  broadcast({ type: 'add', task });
  const typeLabel = { banner: 'Баннер', letter: 'Письмо', article: 'Статья', task: 'Задача' }[task.tz?.type] || 'Задача';
  sendPush('📥 Новая задача: ' + typeLabel, task.tz?.title || task.fromName || 'Без названия', '/');
  return task;
}

function updateTask(id, updates) {
  const existing = getTask(id);
  if (!existing) return null;

  const setClauses = [];
  const values = [];

  for (const [key, val] of Object.entries(updates)) {
    setClauses.push(`${key} = ?`);
    values.push((key === 'tz' || key === 'result') && val != null
      ? JSON.stringify(val)
      : val ?? null);
  }
  values.push(id);

  db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

  const updated = { ...existing, ...updates };
  broadcast({ type: 'update', task: updated });
  return updated;
}

function removeTask(id) {
  const r = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (r.changes === 0) return false;
  broadcast({ type: 'remove', id });
  return true;
}

function getTask(id) {
  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function getTasks() {
  return db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC').all().map(rowToTask);
}

function getHistory({ type, search, dateFrom, dateTo } = {}) {
  let q = "SELECT * FROM tasks WHERE status IN ('done','error','rejected')";
  const p = [];
  if (type)     { q += ' AND json_extract(tz,\'$.type\') = ?'; p.push(type); }
  if (dateFrom) { q += ' AND createdAt >= ?'; p.push(new Date(dateFrom).getTime()); }
  if (dateTo)   { q += ' AND createdAt <= ?'; p.push(new Date(dateTo).getTime() + 86399999); }
  q += ' ORDER BY createdAt DESC LIMIT 200';
  let rows = db.prepare(q).all(...p).map(rowToTask);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(t => (t.tz?.title || '').toLowerCase().includes(s) || (t.fromName || '').toLowerCase().includes(s));
  }
  return rows;
}

function addSseClient(res) {
  sseClients.push(res);
  res.on('close', () => {
    const i = sseClients.indexOf(res);
    if (i !== -1) sseClients.splice(i, 1);
  });
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch (_) {} });
}

function addPushSubscription(sub) {
  db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (endpoint, sub, createdAt)
    VALUES (?, ?, ?)
  `).run(sub.endpoint, JSON.stringify(sub), Date.now());
}

function removePushSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

function sendPush(title, body, url) {
  if (!process.env.VAPID_PUBLIC_KEY) { console.log('[Push] Нет VAPID ключа, пропуск'); return; }
  const subs = db.prepare('SELECT sub FROM push_subscriptions').all();
  console.log(`[Push] Отправляю "${title}" → ${subs.length} подписчиков`);
  const payload = JSON.stringify({ title, body, url: url || '/', tag: 'dobropost-task' });
  subs.forEach(row => {
    const sub = JSON.parse(row.sub);
    const shortEndpoint = sub.endpoint.slice(0, 40) + '...';
    webpush.sendNotification(sub, payload)
      .then(() => console.log(`[Push] ✅ Доставлено: ${shortEndpoint}`))
      .catch(err => {
        console.log(`[Push] ❌ Ошибка ${err.statusCode}: ${shortEndpoint} — ${err.message}`);
        if (err.statusCode === 410 || err.statusCode === 404) {
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
          console.log(`[Push] 🗑 Удалена протухшая подписка`);
        }
      });
  });
}

module.exports = { addTask, updateTask, removeTask, getTask, getTasks, getHistory, addSseClient, addPushSubscription, removePushSubscription, sendPush };
