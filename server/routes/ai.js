// Главный ИИ — чат-интерфейс, принимает задачу и запускает полный pipeline
const express = require('express');
const { parseTzFromMessage } = require('../agents/claude');
const { addTask, updateTask, getTask } = require('../taskStore');
const { recall, remember } = require('../agents/rag');
const { checkBanner, checkLetter, getTesterLog, addTesterSseClient, removeTesterSseClient } = require('../agents/tester');
const { pipelineStart, pipelineStep, pipelineFinish, getEntries, addClient, removeClient } = require('../agents/pipelineLog');
const { runWithTester } = require('../agents/generator');
const { pushFeedback } = require('../agents/feedbackQueue');
const axios = require('axios');

const router = express.Router();

// Абсолютный URL для изображений в письмах (email-клиенты не понимают относительные пути)
const APP_URL = process.env.APP_URL || 'https://vladaiproject123.ru';

// POST /api/ai/tester-feedback — живой комментарий в процессе генерации
router.post('/tester-feedback', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Нет сообщения' });
  pushFeedback(message);
  res.json({ ok: true });
});

// GET /api/ai/tester-log
router.get('/tester-log', (req, res) => res.json(getTesterLog()));

// GET /api/ai/tester-events — SSE поток логов тестировщика
router.get('/tester-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  addTesterSseClient(res);
  req.on('close', () => removeTesterSseClient(res));
});

// GET /api/ai/pipeline-log — история pipeline
router.get('/pipeline-log', (req, res) => res.json(getEntries()));

// GET /api/ai/pipeline-events — SSE поток шагов pipeline
router.get('/pipeline-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  addClient(res);
  req.on('close', () => removeClient(res));
});

// POST /api/ai/chat — принять сообщение, создать и выполнить задачу
router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Нет сообщения' });

  const tz = await parseTzFromMessage(message).catch(() => ({
    type: 'task', title: message.slice(0, 50), text: message,
    goal: message, requirements: [], priority: 'normal', deadline: null
  }));

  const task = addTask({ tz, fromName: 'Главный ИИ', sourceChatTitle: null });
  updateTask(task.id, { status: 'pending' });

  res.json({ ok: true, taskId: task.id, taskNum: task.num, tz });

  _runPipeline(task.id, task.num, tz, message).catch(err => {
    console.error('[AI] Ошибка pipeline:', err.message);
    updateTask(task.id, { status: 'error', error: err.message });
    pipelineFinish(task.id, false);
  });
});

// ─── Полный pipeline: баннер → тест → письмо → тест → Sendsay ───────────────
async function _runPipeline(taskId, taskNum, tz, originalMessage) {
  const base = `http://localhost:${process.env.PORT || 3000}`;

  pipelineStart(taskId, taskNum, tz.type, tz.title || originalMessage.slice(0, 50));
  pipelineStep(taskId, `Задача принята, тип: ${tz.type}`);
  updateTask(taskId, { status: 'inprog' });

  pipelineStep(taskId, 'Ищу похожие задачи в памяти...');
  const memories = await recall(tz.text || tz.title || originalMessage, tz.type).catch(err => {
    pipelineStep(taskId, `Память недоступна: ${err.message}`, 'warn');
    return [];
  });
  pipelineStep(taskId, `В памяти найдено: ${memories.length} похожих задач`);

  const memCtx = memories.length
    ? '\n\nПохожие задачи из прошлого:\n' + memories.map((m, i) => `${i+1}. ${m.query} → ${m.result}`).join('\n')
    : '';
  const enriched = (tz.text || tz.title || originalMessage) + memCtx;

  let result = {};

  if (tz.type === 'banner' || tz.type === 'letter') {
    pipelineStep(taskId, 'Шаг 1: генерация баннера');
    const bannerData = await runWithTester(
      'banner', taskId,
      async (prompt) => {
        const r = await axios.post(`${base}/api/images/generate`, {
          letterText: prompt,
          templateId: tz.template || null,
        });
        return r.data;
      },
      async (data) => checkBanner(data.imageUrl),
      enriched,
      pipelineStep
    );
    // Делаем URL абсолютным для email-клиентов
    const bannerAbsUrl = bannerData.imageUrl.startsWith('/') ? APP_URL + bannerData.imageUrl : bannerData.imageUrl;
    result.banner = { ...bannerData, imageUrl: bannerAbsUrl };
    pipelineStep(taskId, `✅ Баннер принят — шаблон: ${bannerData.templateId}, заголовок: ${bannerData.title}`, 'ok');

    if (tz.type === 'letter') {
      pipelineStep(taskId, 'Шаг 2: генерация письма');
      const letterData = await runWithTester(
        'letter', taskId,
        async (prompt) => {
          const r = await axios.post(`${base}/api/letters/generate`, { letterText: prompt, bannerUrl: bannerAbsUrl });
          return r.data;
        },
        async (data) => checkLetter(data.html),
        enriched,
        pipelineStep
      );
      pipelineStep(taskId, `✅ Письмо принято — тема: "${letterData.subject}"`, 'ok');

      pipelineStep(taskId, 'Шаг 3: заливаю черновик в Sendsay...');
      const draft = await axios.post(`${base}/api/sendsay/draft`, {
        subject: letterData.subject,
        preheader: letterData.preheader,
        html: letterData.html,
      });
      result.subject  = letterData.subject;
      result.draftUrl = draft.data.url;
      pipelineStep(taskId, `✅ Черновик создан в Sendsay`, 'ok');
    }
  } else {
    pipelineStep(taskId, `Тип "${tz.type}" — pipeline не требует генерации`);
  }

  updateTask(taskId, { status: 'done', result });
  pipelineFinish(taskId, true);
  pipelineStep(taskId, '🏁 Всё готово!', 'ok');

  remember({
    taskType: tz.type,
    query: tz.text || tz.title || originalMessage,
    result: JSON.stringify(result),
    metadata: { title: tz.title },
  }).catch(err => pipelineStep(taskId, `Память: не удалось сохранить — ${err.message}`, 'warn'));
}


module.exports = { router };
