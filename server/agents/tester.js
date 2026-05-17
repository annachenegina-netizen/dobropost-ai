// Тестировщик — проверяет качество баннеров и писем перед отправкой
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const getClient = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Проверяет баннер через GPT-4o Vision
// imageUrl — путь вида /images/banner_xxx.png (относительно client/)
async function checkBanner(imageUrl) {
  const absPath = path.join(__dirname, '../../client', imageUrl);

  let imageData;
  try {
    const buffer = fs.readFileSync(absPath);
    imageData = buffer.toString('base64');
  } catch {
    return { ok: false, issues: ['Не удалось прочитать файл баннера'] };
  }

  const res = await getClient().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Ты тестировщик баннеров для email-рассылки DobroPost.
Проверь баннер и найди проблемы:
- Опечатки или грамматические ошибки в тексте
- Текст обрезан или выходит за границы
- Некрасивые переносы слов
- Текст нечитаемый (плохой контраст, слишком мелкий)
- Смысл заголовка не соответствует подзаголовку

Ответь ТОЛЬКО JSON без пояснений:
{"ok": true} — если всё хорошо
{"ok": false, "issues": ["проблема 1", "проблема 2"]} — если есть проблемы`
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${imageData}` }
        }
      ]
    }]
  });

  const raw = res.choices[0].message.content.trim()
    .replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(raw);
  } catch {
    return { ok: true }; // если не смог распарсить — пропускаем
  }
}

// Проверяет HTML письма на качество текста
async function checkLetter(html) {
  // Вытаскиваем текст из HTML для анализа
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);

  const res = await getClient().chat.completions.create({
    model: process.env.MODEL_MAIN || 'gpt-4o-mini',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Ты тестировщик email-рассылок DobroPost.
Проверь текст письма и найди проблемы:
- Опечатки или грамматические ошибки
- Вода, пустые фразы, шаблонные слова без смысла
- Текст обрывается на полуслове или явно незакончен
- Тема письма не соответствует содержанию
- Повторяющиеся фразы или блоки

Текст письма:
${text}

Ответь ТОЛЬКО JSON без пояснений:
{"ok": true} — если всё хорошо
{"ok": false, "issues": ["проблема 1", "проблема 2"]} — если есть проблемы`
    }]
  });

  const raw = res.choices[0].message.content.trim()
    .replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(raw);
  } catch {
    return { ok: true };
  }
}

// Лог проверок — последние 100 записей, доступен из любого роута
const testerLog = [];
const testerSseClients = [];

function addTesterLog(entry) {
  const record = { ...entry, ts: new Date().toLocaleTimeString('ru') };
  testerLog.unshift(record);
  if (testerLog.length > 100) testerLog.pop();
  testerSseClients.forEach(res => {
    try { res.write(`data: ${JSON.stringify(record)}\n\n`); } catch (_) {}
  });
}

function getTesterLog() { return testerLog; }
function addTesterSseClient(res) { testerSseClients.push(res); }
function removeTesterSseClient(res) {
  const i = testerSseClients.indexOf(res);
  if (i !== -1) testerSseClients.splice(i, 1);
}

module.exports = { checkBanner, checkLetter, addTesterLog, getTesterLog, addTesterSseClient, removeTesterSseClient };
