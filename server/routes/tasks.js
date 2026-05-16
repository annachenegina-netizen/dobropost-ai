// API задач: SSE-поток + выполнение + отклонение
const express = require('express');
const axios = require('axios');
const { getTasks, getTask, updateTask, removeTask, addSseClient, getHistory } = require('../taskStore');

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
  } catch (err) {
    updateTask(task.id, { status: 'error', error: err.message });
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

  if (tz.type === 'banner') {
    const resp = await axios.post(`${base}/api/images/generate`, {
      letterText: tz.text || tz.title,
      templateId: tz.template || null,
    });
    return { imageUrl: resp.data.imageUrl, title: resp.data.title, templateId: resp.data.templateId };
  }

  if (tz.type === 'letter') {
    const gen = await axios.post(`${base}/api/letters/generate`, {
      letterText: tz.text || tz.title,
    });
    await axios.post(`${base}/api/sendsay/draft`, {
      subject: gen.data.subject,
      preheader: gen.data.preheader,
      html: gen.data.html,
    });
    return { subject: gen.data.subject };
  }

  return {};
}

module.exports = router;
