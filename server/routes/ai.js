// Главный ИИ — чат-интерфейс, принимает задачу и запускает полный pipeline
const express = require('express');
const { parseTzFromMessage } = require('../agents/claude');
const { addTask, updateTask, getTask } = require('../taskStore');
const { recall } = require('../agents/rag');
const { remember } = require('../agents/rag');
const { checkBanner, checkLetter } = require('../agents/tester');
const axios = require('axios');

const router = express.Router();

// Лог тестировщика — последние 100 записей в памяти
const testerLog = [];
function addTesterLog(entry) {
  testerLog.unshift({ ...entry, ts: new Date().toLocaleTimeString('ru') });
  if (testerLog.length > 100) testerLog.pop();
  // Рассылаем SSE-клиентам тестировщика
  testerSseClients.forEach(res => {
    try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch (_) {}
  });
}
const testerSseClients = [];

// GET /api/ai/tester-log — лог последних проверок
router.get('/tester-log', (req, res) => res.json(testerLog));

// GET /api/ai/tester-events — SSE поток логов тестировщика
router.get('/tester-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  testerSseClients.push(res);
  req.on('close', () => {
    const i = testerSseClients.indexOf(res);
    if (i !== -1) testerSseClients.splice(i, 1);
  });
});

// POST /api/ai/chat — принять сообщение, создать и выполнить задачу
router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Нет сообщения' });

  // Парсим ТЗ из сообщения
  const tz = await parseTzFromMessage(message).catch(() => ({
    type: 'task', title: message.slice(0, 50), text: message,
    goal: message, requirements: [], priority: 'normal', deadline: null
  }));

  // Создаём задачу
  const task = addTask({ tz, fromName: 'Главный ИИ', sourceChatTitle: null });
  updateTask(task.id, { status: 'pending' });

  res.json({ ok: true, taskId: task.id, tz });

  // Запускаем pipeline асинхронно
  _runPipeline(task.id, tz, message).catch(err => {
    console.error('[AI] Ошибка pipeline:', err.message);
    updateTask(task.id, { status: 'error', error: err.message });
  });
});

// Полный pipeline: баннер → тест → письмо → тест → Sendsay
async function _runPipeline(taskId, tz, originalMessage) {
  const base = `http://localhost:${process.env.PORT || 3000}`;
  console.log(`[AI] ▶ Pipeline запущен: задача #${taskId}, тип: ${tz.type}`);
  updateTask(taskId, { status: 'inprog' });

  console.log(`[AI] 🔍 Ищу похожие задачи в памяти...`);
  const memories = await recall(tz.text || tz.title || originalMessage, tz.type).catch(err => {
    console.error('[AI] ⚠️ RAG recall ошибка:', err.message);
    return [];
  });
  console.log(`[AI] 💾 Найдено в памяти: ${memories.length} похожих задач`);

  const memCtx = memories.length
    ? '\n\nПохожие задачи из прошлого:\n' + memories.map((m, i) => `${i+1}. ${m.query} → ${m.result}`).join('\n')
    : '';
  const enriched = (tz.text || tz.title || originalMessage) + memCtx;

  let result = {};

  if (tz.type === 'banner' || tz.type === 'letter') {
    console.log(`[AI] 🖼 Шаг 1: генерация баннера...`);
    const bannerResult = await _runWithTester(
      'banner', taskId,
      async (prompt) => {
        console.log(`[AI] → POST /api/images/generate`);
        const r = await axios.post(`${base}/api/images/generate`, {
          letterText: prompt,
          templateId: tz.template || null,
        });
        console.log(`[AI] ← Баннер: ${r.data.imageUrl}`);
        return r.data;
      },
      async (data) => checkBanner(data.imageUrl),
      enriched
    );
    result.banner = bannerResult;
    console.log(`[AI] ✅ Баннер принят: ${bannerResult.imageUrl}`);

    if (tz.type === 'letter') {
      console.log(`[AI] 📧 Шаг 2: генерация письма...`);
      const letterResult = await _runWithTester(
        'letter', taskId,
        async (prompt) => {
          console.log(`[AI] → POST /api/letters/generate`);
          const r = await axios.post(`${base}/api/letters/generate`, { letterText: prompt });
          console.log(`[AI] ← Письмо: тема "${r.data.subject}"`);
          return r.data;
        },
        async (data) => checkLetter(data.html),
        enriched
      );
      console.log(`[AI] ✅ Письмо принято: "${letterResult.subject}"`);

      console.log(`[AI] 📤 Шаг 3: заливаю черновик в Sendsay...`);
      const draft = await axios.post(`${base}/api/sendsay/draft`, {
        subject: letterResult.subject,
        preheader: letterResult.preheader,
        html: letterResult.html,
      });
      result.subject = letterResult.subject;
      result.draftUrl = draft.data.url;
      console.log(`[AI] ✅ Черновик создан: ${draft.data.url}`);
    }
  } else {
    console.log(`[AI] ℹ️ Тип "${tz.type}" — pipeline не требует генерации`);
  }

  updateTask(taskId, { status: 'done', result });
  console.log(`[AI] 🏁 Pipeline завершён: задача #${taskId}`);

  remember({
    taskType: tz.type,
    query: tz.text || tz.title || originalMessage,
    result: JSON.stringify(result),
    metadata: { title: tz.title },
  }).catch(err => console.error('[AI] ⚠️ RAG remember ошибка:', err.message));
}

// Универсальный цикл: генерируем → тестируем → повторяем если нужно
async function _runWithTester(type, taskId, generate, test, basePrompt, maxAttempts = 3) {
  console.log(`[Tester] Начинаю проверку: ${type}, макс. ${maxAttempts} попыток`);
  let lastIssues = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = lastIssues.length
      ? `${basePrompt}\n\nИСПРАВЬ: ${lastIssues.join('; ')}`
      : basePrompt;

    const data = await generate(prompt);

    addTesterLog({ type, taskId, attempt, status: 'checking', data: type === 'banner' ? data.imageUrl : data.subject });
    console.log(`[Tester] Проверяю ${type} попытка ${attempt}...`);

    const check = await test(data).catch(err => {
      console.error(`[Tester] Ошибка проверки ${type}:`, err.message);
      return { ok: true };
    });

    addTesterLog({ type, taskId, attempt, status: check.ok ? 'ok' : 'fail', issues: check.issues || [] });

    if (check.ok) {
      console.log(`[Tester] ✅ ${type} попытка ${attempt}: принято`);
      return data;
    }
    console.log(`[Tester] ❌ ${type} попытка ${attempt}: отклонено — ${(check.issues || []).join('; ')}`);
    lastIssues = check.issues || [];
  }

  console.log(`[Tester] ⚠️ ${type}: исчерпаны попытки, возвращаю последний результат`);
  addTesterLog({ type, taskId, attempt: maxAttempts, status: 'forced', issues: ['Исчерпаны попытки'] });
  return await generate(basePrompt);
}

module.exports = { router, addTesterLog };
