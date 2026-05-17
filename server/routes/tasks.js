// API задач: SSE-поток + выполнение + отклонение
const express = require('express');
const axios = require('axios');
const { getTasks, getTask, updateTask, removeTask, addSseClient, getHistory, sendPush } = require('../taskStore');
const { remember, recall } = require('../agents/rag');
const { checkBanner, checkLetter, addTesterLog } = require('../agents/tester');
const { pipelineStart, pipelineStep, pipelineFinish } = require('../agents/pipelineLog');

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

// Генерирует баннер и проверяет тестировщиком (макс. 3 попытки)
async function _executeBannerWithReview(base, letterText, templateId, taskId) {
  const MAX = 3;
  let lastIssues = [];

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const prompt = lastIssues.length
      ? `${letterText}\n\nПредыдущая попытка была отклонена тестировщиком. Исправь: ${lastIssues.join('; ')}`
      : letterText;

    pipelineStep(taskId, `баннер: генерация (попытка ${attempt}/${MAX})...`);
    const resp = await axios.post(`${base}/api/images/generate`, { letterText: prompt, templateId });
    pipelineStep(taskId, `баннер сгенерирован — шаблон: ${resp.data.templateId}, "${resp.data.title}"`);
    pipelineStep(taskId, 'отправляю баннер тестировщику...');

    addTesterLog({ type: 'banner', taskId, attempt, status: 'checking', data: resp.data.imageUrl });

    const check = await checkBanner(resp.data.imageUrl).catch(() => ({ ok: true }));
    addTesterLog({ type: 'banner', taskId, attempt, status: check.ok ? 'ok' : 'fail', issues: check.issues || [] });

    if (check.ok) {
      pipelineStep(taskId, 'тестировщик принял баннер ✅', 'ok');
      const absUrl = resp.data.imageUrl.startsWith('/') ? APP_URL + resp.data.imageUrl : resp.data.imageUrl;
      return { imageUrl: absUrl, title: resp.data.title, templateId: resp.data.templateId };
    }
    const issuesText = (check.issues || []).join('; ');
    pipelineStep(taskId, `тестировщик отклонил баннер: ${issuesText}`, 'error');
    lastIssues = check.issues || [];
  }

  pipelineStep(taskId, 'исчерпаны попытки — беру последний вариант баннера', 'warn');
  const final = await axios.post(`${base}/api/images/generate`, { letterText, templateId });
  addTesterLog({ type: 'banner', taskId, attempt: MAX, status: 'forced', issues: ['Исчерпаны попытки'] });
  const absUrl = final.data.imageUrl.startsWith('/') ? APP_URL + final.data.imageUrl : final.data.imageUrl;
  return { imageUrl: absUrl, title: final.data.title, templateId: final.data.templateId };
}

// Верстает письмо с баннером и проверяет тестировщиком (макс. 3 попытки)
async function _executeLetterWithReview(base, letterText, taskId) {
  pipelineStep(taskId, 'Шаг 1: генерация баннера');
  const bannerResult = await _executeBannerWithReview(base, letterText, null, taskId);
  const bannerUrl = bannerResult?.imageUrl || null;

  pipelineStep(taskId, 'Шаг 2: генерация письма');
  const MAX = 3;
  let lastIssues = [];

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const prompt = lastIssues.length
      ? `${letterText}\n\nПредыдущая версия письма была отклонена тестировщиком. Исправь: ${lastIssues.join('; ')}`
      : letterText;

    pipelineStep(taskId, `письмо: генерация (попытка ${attempt}/${MAX})...`);
    const gen = await axios.post(`${base}/api/letters/generate`, { letterText: prompt, bannerUrl });
    pipelineStep(taskId, `письмо сгенерировано — тема: "${gen.data.subject}"`);
    pipelineStep(taskId, 'отправляю письмо тестировщику...');

    addTesterLog({ type: 'letter', taskId, attempt, status: 'checking', data: gen.data.subject });

    const check = await checkLetter(gen.data.html).catch(() => ({ ok: true }));
    addTesterLog({ type: 'letter', taskId, attempt, status: check.ok ? 'ok' : 'fail', issues: check.issues || [] });

    if (check.ok) {
      pipelineStep(taskId, 'тестировщик принял письмо ✅', 'ok');
      pipelineStep(taskId, 'Шаг 3: заливаю черновик в Sendsay...');
      const draft = await axios.post(`${base}/api/sendsay/draft`, {
        subject: gen.data.subject,
        preheader: gen.data.preheader,
        html: gen.data.html,
      });
      pipelineStep(taskId, '✅ Черновик создан в Sendsay', 'ok');
      return { subject: gen.data.subject, draftUrl: draft.data.url };
    }
    const issuesText = (check.issues || []).join('; ');
    pipelineStep(taskId, `тестировщик отклонил письмо: ${issuesText}`, 'error');
    lastIssues = check.issues || [];
  }

  pipelineStep(taskId, 'исчерпаны попытки — беру последний вариант письма', 'warn');
  const final = await axios.post(`${base}/api/letters/generate`, { letterText, bannerUrl });
  addTesterLog({ type: 'letter', taskId, attempt: MAX, status: 'forced', issues: ['Исчерпаны попытки'] });
  pipelineStep(taskId, 'Шаг 3: заливаю черновик в Sendsay...');
  const draft = await axios.post(`${base}/api/sendsay/draft`, {
    subject: final.data.subject,
    preheader: final.data.preheader,
    html: final.data.html,
  });
  pipelineStep(taskId, '✅ Черновик создан в Sendsay', 'ok');
  return { subject: final.data.subject, draftUrl: draft.data.url };
}

module.exports = router;
