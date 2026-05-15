// Общее хранилище задач — связывает Telegram-бота и дашборд
// SSE клиенты получают обновления в реальном времени
const tasks = [];
const sseClients = [];

function addTask({ tz, fromName, sourceChatTitle, telegramChatId, telegramMsgId }) {
  const task = {
    id: Date.now().toString(),
    tz,
    fromName: fromName || '?',
    sourceChatTitle: sourceChatTitle || null,
    telegramChatId: telegramChatId || null,
    telegramMsgId: telegramMsgId || null,
    status: 'analyzing', // analyzing | pending | inprog | done | error | rejected
    error: null,
    result: null,
    createdAt: Date.now(),
  };
  tasks.push(task);
  broadcast({ type: 'add', task });
  return task;
}

function updateTask(id, updates) {
  const task = tasks.find(t => t.id === id);
  if (!task) return null;
  Object.assign(task, updates);
  broadcast({ type: 'update', task });
  return task;
}

function removeTask(id) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  broadcast({ type: 'remove', id });
  return true;
}

function getTask(id) { return tasks.find(t => t.id === id) || null; }
function getTasks()  { return [...tasks]; }

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

module.exports = { addTask, updateTask, removeTask, getTask, getTasks, addSseClient };
