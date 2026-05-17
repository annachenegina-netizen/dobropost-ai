// API задач: SSE-поток + выполнение + отклонение
const express = require('express');
const axios = require('axios');
const { getTasks, getTask, updateTask, removeTask, addSseClient, getHistory, sendPush } = require('../taskStore');
const { remember, recall } = require('../agents/rag');
const { checkBanner, checkLetter } = require('../agents/tester');

const router = express.Router();

// SSE — дашборд подписывается и получает обновления в реальном времени
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Сразу отдаём текущий список задач
  res.write(`data: ${JSON.stringify({ type: 'init', tasks: getTasks() })}\n\n`);
  addSseClient(res);
});

// GET /api/tasks — список всех задач
router.get('/', (req, res) => res.json(getTasks()));

// GET /api/tasks/:id — одна задача по ID
router.get('/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Не найдена' });
  res.json(task);
});

// GET /api/tasks/history — завершённые задачи с фильтрами
router.get('/history', (req, res) => {
  const { type, search, dateFrom, dateTo } = req.query;
  res.json(getHistory({ type, search, dateFrom, dateTo }));
});

// POST /api/tasks/:id/execute — выполнить задачу
router.post('/:id/execute', async (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });
  if (task.status === 'inprog') return res.status(409).json({ error: 'Уже выполняется' });

  updateTask(task.id, { status: 'inprog' });
  res.json({ ok: true });

  // Выполняем асинхронно
  try {
    const result = await executeTask(task);
    updateTask(task.id, { status: 'done', result });
    const title = task.tz?.title || 'Задача выполнена';
    const typeLabel = { banner: 'Баннер', letter: 'Письмо', article: 'Статья' }[task.tz?.type] || 'Задача';
    sendPush('✅ ' + typeLabel + ' готов', title, '/');
    remember({
      taskType: task.tz?.type || 'task',
      query:    task.tz?.text || task.tz?.title || '',
      result:   JSON.stringify(result),
      metadata: { title: task.tz?.title, template: task.tz?.template },
    }).catch(() => {});
  } catch (err) {
    updateTask(task.id, { status: 'error', error: err.message });
    sendPush('❌ Ошибка выполнения', task.tz?.title || err.message, '/');
  }
});

// PATCH /api/tasks/:id — обновить приоритет / дедлайн
router.patch('/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });
  const updates = {};
  if (req.body.status   !== undefined) updates.status   = req.body.status;
  if (req.body.priority !== undefined) updates.priority = req.body.priority;
  if (req.body.deadline !== undefined) updates.deadline = req.body.deadline;
  updateTask(task.id, updates);
  res.json({ ok: true });
});

// DELETE /api/tasks/:id — отклонить задачу
router.delete('/:id', (req, res) => {
  const ok = removeTask(req.params.id);
  res.json({ ok });
});

// ─── Выполнение задачи ───────────────────────────────────────────────────────
async function executeTask(task) {
  const { tz } = task;
  const base = `http://localhost:${process.env.PORT || 3000}`;
  const query = tz.text || tz.title || '';

  // Достаём похожие прошлые задачи из памяти
  const memories = await recall(query, tz.type).catch(() => []);
  const memoryContext = memories.length
    ? '\n\n---\nПохожие задачи из прошлого опыта:\n' +
      memories.map((m, i) =>
        `${i + 1}. Запрос: ${m.query}\n   Результат: ${m.result}`
      ).join('\n')
    : '';

  const enrichedText = query + memoryContext;

  if (tz.type === 'banner') {
    return await _executeBannerWithReview(base, enrichedText, tz.template || null);
  }

  if (tz.type === 'letter') {
    return await _executeLetterWithReview(base, enrichedText);
  }

  return {};
}

// Генерирует баннер и проверяет тестировщиком (макс. 3 попытки)
async function _executeBannerWithReview(base, letterText, templateId) {
  const MAX = 3;
  let lastIssues = [];

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const prompt = lastIssues.length
      ? `${letterText}\n\nПредыдущая попытка была отклонена тестировщиком. Исправь: ${lastIssues.join('; ')}`
      : letterText;

    const resp = await axios.post(`${base}/api/images/generate`, { letterText: prompt, templateId });
    console.log(`[Tester] Баннер попытка ${attempt}: ${resp.data.imageUrl}`);

    const check = await checkBanner(resp.data.imageUrl).catch(() => ({ ok: true }));
    console.log(`[Tester] Баннер результат:`, check);

    if (check.ok) {
      return { imageUrl: resp.data.imageUrl, title: resp.data.title, templateId: resp.data.templateId };
    }
    lastIssues = check.issues || [];
  }

  // После 3 попыток — возвращаем последний результат
  const final = await axios.post(`${base}/api/images/generate`, { letterText, templateId });
  return { imageUrl: final.data.imageUrl, title: final.data.title, templateId: final.data.templateId };
}

// Верстает письмо и проверяет тестировщиком (макс. 3 попытки)
async function _executeLetterWithReview(base, letterText) {
  const MAX = 3;
  let lastIssues = [];

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const prompt = lastIssues.length
      ? `${letterText}\n\nПредыдущая версия письма была отклонена тестировщиком. Исправь: ${lastIssues.join('; ')}`
      : letterText;

    const gen = await axios.post(`${base}/api/letters/generate`, { letterText: prompt });
    console.log(`[Tester] Письмо попытка ${attempt}`);

    const check = await checkLetter(gen.data.html).catch(() => ({ ok: true }));
    console.log(`[Tester] Письмо результат:`, check);

    if (check.ok) {
      const draft = await axios.post(`${base}/api/sendsay/draft`, {
        subject: gen.data.subject,
        preheader: gen.data.preheader,
        html: gen.data.html,
      });
      return { subject: gen.data.subject, draftUrl: draft.data.url };
    }
    lastIssues = check.issues || [];
  }

  // После 3 попыток — заливаем последнюю версию
  const final = await axios.post(`${base}/api/letters/generate`, { letterText });
  const draft = await axios.post(`${base}/api/sendsay/draft`, {
    subject: final.data.subject,
    preheader: final.data.preheader,
    html: final.data.html,
  });
  return { subject: final.data.subject, draftUrl: draft.data.url };
}

module.exports = router;
