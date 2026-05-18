const express = require('express');
const router  = express.Router();
const OpenAI  = require('openai');
const { addReminder, getReminders, deleteReminder, markDone } = require('../agents/reminders');
require('dotenv').config();

const getClient = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// GET /api/reminders
router.get('/', (req, res) => {
  res.json(getReminders());
});

// POST /api/reminders/parse — NL текст → напоминание
router.post('/parse', async (req, res) => {
  const { text, chatId } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const nowMoscow = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

  let parsed;
  try {
    const resp = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Сейчас: ${nowMoscow} (Москва, UTC+3).
Из сообщения извлеки текст напоминания и точную дату+время.
Сообщение: "${text}"

Ответь ТОЛЬКО JSON без пояснений:
{"text": "краткое описание напоминания", "datetime": "YYYY-MM-DDTHH:MM:00+03:00"}

Правила: если время не указано — 10:00. Если дата не указана — сегодня. "Завтра" = следующий день.
Если не можешь распознать напоминание: {"error": "не могу определить"}`
      }]
    });

    const raw = resp.choices[0].message.content.trim()
      .replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    parsed = JSON.parse(raw);
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка парсинга: ' + e.message });
  }

  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const reminder = addReminder(parsed.text, parsed.datetime, chatId || '');
  res.json({ reminder, parsed });
});

// POST /api/reminders — создать напрямую (из дашборда)
router.post('/', (req, res) => {
  const { text, datetime, chatId } = req.body;
  if (!text || !datetime) return res.status(400).json({ error: 'text and datetime required' });
  const reminder = addReminder(text, datetime, chatId || '');
  res.json(reminder);
});

// DELETE /api/reminders/:id
router.delete('/:id', (req, res) => {
  const ok = deleteReminder(req.params.id);
  res.json({ ok });
});

// PATCH /api/reminders/:id/done
router.patch('/:id/done', (req, res) => {
  const ok = markDone(req.params.id);
  res.json({ ok });
});

module.exports = router;
