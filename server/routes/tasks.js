// API задач: SSE-поток + выполнение + отклонение
const express = require('express');
const axios = require('axios');
const { getTasks, getTask, updateTask, removeTask, addSseClient, getHistory, sendPush } = require('../taskStore');
const { remember, recall } = require('../agents/rag');
const { checkBanner, checkLetter } = require('../agents/tester');
const { pipelineStart, pipelineStep, pipelineFinish } = require('../agents/pipelineLog');
const { runWithTester } = require('../agents/generator');

const APP_URL = process.env.APP_URL || 'https://vladaiproject123.ru';

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
    pipelineFinish(task.id, true);
    remember({
      taskType: task.tz?.type || 'task',
      query:    task.tz?.text || task.tz?.title || '',
      result:   JSON.stringify(result),
      metadata: { title: task.tz?.title, template: task.tz?.template },
    }).catch(() => {});
  } catch (err) {
    updateTask(task.id, { status: 'error', error: err.message });
    sendPush('❌ Ошибка выполнения', task.tz?.title || err.message, '/');
    pipelineFinish(task.id, false);
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

  pipelineStart(task.id, task.num, tz.type, tz.title || query.slice(0, 50));
  pipelineStep(task.id, `Задача принята, тип: ${tz.type}`);

  pipelineStep(task.id, 'Ищу похожие задачи в памяти...');
  const memories = await recall(query, tz.type).catch(() => []);
  pipelineStep(task.id, `В памяти найдено: ${memories.length} похожих задач`);

  const memoryContext = memories.length
    ? '\n\n---\nПохожие задачи из прошлого опыта:\n' +
      memories.map((m, i) =>
        `${i + 1}. Запрос: ${m.query}\n   Результат: ${m.result}`
      ).join('\n')
    : '';

  const enrichedText = query + memoryContext;

  if (tz.type === 'banner') {
    return await _executeBannerWithReview(base, enrichedText, tz.template || null, task.id);
  }

  if (tz.type === 'letter') {
    return await _executeLetterWithReview(base, enrichedText, task.id);
  }

  pipelineFinish(task.id, true);
  return {};
}

async function _executeBannerWithReview(base, letterText, templateId, taskId) {
  const data = await runWithTester(
    'banner', taskId,
    async (prompt) => {
      const r = await axios.post(`${base}/api/images/generate`, { letterText: prompt, templateId });
      return r.data;
    },
    async (d) => checkBanner(d.imageUrl),
    letterText,
    pipelineStep
  );
  const absUrl = data.imageUrl.startsWith('/') ? APP_URL + data.imageUrl : data.imageUrl;
  return { ...data, imageUrl: absUrl };
}

async function _executeLetterWithReview(base, letterText, taskId) {
  pipelineStep(taskId, 'Шаг 1: генерация баннера');
  const bannerResult = await _executeBannerWithReview(base, letterText, null, taskId);
  const bannerUrl = bannerResult?.imageUrl || null;

  pipelineStep(taskId, 'Шаг 2: генерация письма');
  const letterData = await runWithTester(
    'letter', taskId,
    async (prompt) => {
      const r = await axios.post(`${base}/api/letters/generate`, { letterText: prompt, bannerUrl });
      return r.data;
    },
    async (d) => checkLetter(d.html),
    letterText,
    pipelineStep
  );

  pipelineStep(taskId, 'Шаг 3: заливаю черновик в Sendsay...');
  const draft = await axios.post(`${base}/api/sendsay/draft`, {
    subject: letterData.subject,
    preheader: letterData.preheader,
    html: letterData.html,
  });
  pipelineStep(taskId, '✅ Черновик создан в Sendsay', 'ok');
  return { subject: letterData.subject, draftUrl: draft.data.url };
}

module.exports = router;
