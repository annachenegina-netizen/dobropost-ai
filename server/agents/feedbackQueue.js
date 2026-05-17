// Очередь ручной обратной связи от пользователя во время генерации
let queue = [];

function pushFeedback(message) {
  queue.push({ message, ts: new Date().toISOString() });
}

function popAllFeedback() {
  const items = [...queue];
  queue = [];
  return items.map(i => i.message);
}

module.exports = { pushFeedback, popAllFeedback };
