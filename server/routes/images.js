// Генерация баннеров: AI выбирает шаблон → Puppeteer рисует картинку
const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { analyzeLetter } = require('../agents/claude');

const router = express.Router();

const TEMPLATES_DIR = path.join(__dirname, '../../client/images/templates');
const OUTPUT_DIR    = path.join(__dirname, '../../client/images/output');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Автоматически ищет Chrome: сначала CHROME_PATH, потом Windows-пути, потом Puppeteer default
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'win32') {
    const candidates = [
      process.env.PROGRAMFILES  + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
      (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of candidates) if (p && fs.existsSync(p)) return p;
  }
  return undefined; // Puppeteer использует встроенный Chrome
}

// Один браузер на весь сервер — запускаем лениво при первом запросе
let browserInstance = null;
async function getBrowser() {
  if (browserInstance) {
    try { await browserInstance.pages(); return browserInstance; } catch (_) {}
  }
  const executablePath = findChrome();
  if (executablePath) console.log('🌐 Chrome:', executablePath);
  browserInstance = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  console.log('🌐 Браузер Puppeteer запущен');
  return browserInstance;
}

// Конфиг шаблона: цвет текста + запасной фон если файл не найден
const TEMPLATE_CONFIG = {
  'nahodki-1':        { bgColor: '#FFC33A', textColor: '#1C2B3A' },
  'nahodki-2':        { bgColor: '#FFC33A', textColor: '#1C2B3A' },
  'nahodki-3':        { bgColor: '#FFC33A', textColor: '#1C2B3A' },
  'nahodki-4':        { bgColor: '#FFC33A', textColor: '#1C2B3A' },
  'nahodki-5':        { bgColor: '#E77E2F', textColor: '#ffffff' },
  'nahodki-6':        { bgColor: '#E77E2F', textColor: '#ffffff' },
  'nahodki-7':        { bgColor: '#E77E2F', textColor: '#ffffff' },
  'nahodki-prazdnik': { bgColor: '#E77E2F', textColor: '#ffffff' },
  'community-1':      { bgColor: '#FFC33A', textColor: '#1C2B3A' },
  'community-2':      { bgColor: '#E77E2F', textColor: '#ffffff' },
  'community-3':      { bgColor: '#E77E2F', textColor: '#ffffff' },
  'community-4':      { bgColor: '#E77E2F', textColor: '#ffffff' },
  'gayd-1':           { bgColor: '#E77E2F', textColor: '#ffffff' },
  'prazdnik-1':       { bgColor: '#E77E2F', textColor: '#ffffff' },
  'novinka-1':        { bgColor: '#1C2B3A', textColor: '#ffffff' },
  'polezno-1':        { bgColor: '#FFC33A', textColor: '#1C2B3A' },
  'akciya-1':         { bgColor: '#E77E2F', textColor: '#ffffff' },
  'akciya-2':         { bgColor: '#E77E2F', textColor: '#ffffff' },
  'akciya-3':         { bgColor: '#FFC33A', textColor: '#1C2B3A' },
  'stil-1':           { bgColor: '#f5f0eb', textColor: '#1C2B3A' },
};

// Ищет файл шаблона (JPG или PNG), возвращает { data: base64, mime }
function templateToBase64(templateId) {
  for (const ext of ['.jpg', '.png']) {
    const filePath = path.join(TEMPLATES_DIR, `${templateId}${ext}`);
    if (fs.existsSync(filePath)) {
      const mime = ext === '.jpg' ? 'image/jpeg' : 'image/png';
      return { data: fs.readFileSync(filePath).toString('base64'), mime };
    }
  }
  return null;
}

// Строим HTML-страницу для Puppeteer
function buildHtml(templateId, title, subtitle) {
  const config = TEMPLATE_CONFIG[templateId];
  if (!config) throw new Error(`Нет конфига для шаблона: ${templateId}`);

  const bgResult = templateToBase64(templateId);

  // Фоновое изображение шаблона (без текста)
  const bgTag = bgResult
    ? `<img class="bg-img" src="data:${bgResult.mime};base64,${bgResult.data}">`
    : '';

  // Если шаблон не найден — сплошной цвет
  const fallbackBg = bgResult ? '' : `background-color:${config.bgColor};`;

  // Логотип рисуем только в fallback-режиме (в реальных шаблонах он уже вшит)
  const logoHtml = bgResult ? '' : `<div class="logo">DobroPost</div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 600px;
    height: 350px;
    overflow: hidden;
    font-family: Arial, 'Helvetica Neue', sans-serif;
  }

  .banner {
    position: relative;
    width: 600px;
    height: 350px;
    ${fallbackBg}
    overflow: hidden;
  }

  .bg-img {
    position: absolute;
    top: 0;
    left: 0;
    width: 600px;
    height: 350px;
    object-fit: cover;
  }

  .logo {
    position: absolute;
    top: 24px;
    left: 32px;
    font-size: 14px;
    font-weight: 700;
    color: ${config.textColor};
    letter-spacing: 0.2px;
    opacity: 0.9;
  }

  .text-block {
    position: absolute;
    top: 80px;
    left: 32px;
    width: 270px;
    max-height: 230px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .title {
    font-size: 36px;
    font-weight: 800;
    color: ${config.textColor};
    line-height: 1.15;
    letter-spacing: -0.5px;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  .subtitle {
    font-size: 16px;
    font-weight: 500;
    color: ${config.textColor};
    opacity: 0.9;
    line-height: 1.45;
    word-break: break-word;
    overflow-wrap: break-word;
  }
</style>
</head>
<body>
  <div class="banner">
    ${bgTag}
    ${logoHtml}
    <div class="text-block">
      <div class="title">${title}</div>
      <div class="subtitle">${subtitle}</div>
    </div>
  </div>
</body>
</html>`;
}

// POST /api/images/generate
router.post('/generate', async (req, res) => {
  try {
    const { letterText, templateId: forcedTemplateId, maxTitleWords, maxSubWords } = req.body;
    if (!letterText) return res.status(400).json({ error: 'Нет текста письма' });

    if (forcedTemplateId && !TEMPLATE_CONFIG[forcedTemplateId]) {
      return res.status(400).json({ error: `Неизвестный шаблон: ${forcedTemplateId}` });
    }

    console.log('📝 Анализирую письмо...');
    const { templateId, title, subtitle } = await analyzeLetter(
      letterText, forcedTemplateId || null, maxTitleWords || 6, maxSubWords || 10
    );

    console.log(`✅ Шаблон: ${templateId} | "${title}" | "${subtitle}"`);

    const html = buildHtml(templateId, title, subtitle);

    console.log('🎨 Рендерю баннер...');
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 600, height: 350, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });

      const filename = `banner_${Date.now()}.png`;
      const outputPath = path.join(OUTPUT_DIR, filename);
      await page.screenshot({ path: outputPath, type: 'png', clip: { x:0, y:0, width:600, height:350 } });
      console.log(`💾 Готово: ${filename}`);
      res.json({ imageUrl: `/images/output/${filename}`, templateId, title, subtitle });
    } finally {
      await page.close();
    }

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/images/templates
router.get('/templates', (req, res) => {
  res.json({ templates: Object.keys(TEMPLATE_CONFIG) });
});

// ── Баннер эфира ──────────────────────────────────────────────────────────────

const RU_MONTHS = ['января','февраля','марта','апреля','мая','июня',
                   'июля','августа','сентября','октября','ноября','декабря'];
const RU_DAYS   = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

function formatEfirDate(dateStr) {
  // dateStr: "2026-05-20"
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${d} ${RU_MONTHS[m - 1]}, ${RU_DAYS[dt.getDay()]}`;
}

// Размеры рендера: 688×384 CSS-пикселей × deviceScaleFactor:2 = 1376×768 PNG (нативный размер шаблона)
const EFIR_W = 688;
const EFIR_H = 384;

function buildEfirHtml(dateLabel, time, day) {
  const bgPath = path.join(TEMPLATES_DIR, 'efir-blank.png');
  const hasBg  = fs.existsSync(bgPath);

  // Шаблон — JPEG несмотря на расширение .png
  const bgData = hasBg
    ? `data:image/jpeg;base64,${fs.readFileSync(bgPath).toString('base64')}`
    : null;

  const bgImg = bgData ? `<img class="bg" src="${bgData}">` : '';

  // Fallback без шаблона — рисуем сами
  const fallbackContent = hasBg ? '' : `
  <div class="logo">DobroPost</div>
  <div class="static-title">Еженедельный<br>прямой эфир</div>
  <div class="tagline">Присоединяйтесь к нам!</div>`;

  // Позиции (CSS px при 688×384) подобраны по шаблону 1376×768
  const badgeTop   = hasBg ? 78  : 58;
  const badgeLeft  = hasBg ? 37  : 32;
  const dtTop      = hasBg ? 228 : 220;  // строка "Завтра/Сегодня в ЧЧ:ММ"
  const dtLeft     = hasBg ? 37  : 32;
  const dtFontSize = hasBg ? 32  : 34;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${EFIR_W}px; height:${EFIR_H}px; overflow:hidden;
         font-family:Arial,'Helvetica Neue',sans-serif; }
  .banner { position:relative; width:${EFIR_W}px; height:${EFIR_H}px;
            background:#182A44; overflow:hidden; }
  .bg { position:absolute; top:0; left:0; width:${EFIR_W}px; height:${EFIR_H}px; }

  /* Fallback */
  .logo { position:absolute; top:18px; left:32px; font-size:11px; font-weight:700;
          letter-spacing:0.8px; color:#fdbd40; text-transform:uppercase; }
  .static-title { position:absolute; top:140px; left:32px; width:300px;
                  font-size:30px; font-weight:900; color:#fff; line-height:1.18; }
  .tagline { position:absolute; bottom:28px; left:32px; font-size:12px;
             color:rgba(255,255,255,0.48); }

  /* Бейджи */
  .badges { position:absolute; top:${badgeTop}px; left:${badgeLeft}px;
            display:flex; gap:10px; align-items:center; }
  .badge { display:inline-flex; align-items:center; border-radius:20px;
           padding:4px 13px; font-size:12px; font-weight:600; white-space:nowrap; }
  .badge-date { background:rgba(255,255,255,0.13); border:0.5px solid rgba(255,255,255,0.28); color:#fff; }
  .badge-time { background:rgba(253,189,64,0.18); border:0.5px solid rgba(253,189,64,0.4); color:#fdbd40; }

  /* Прямоугольник закрывает "в" из шаблона */
  .cover-v { position:absolute; top:${dtTop}px; left:${dtLeft}px;
             width:60px; height:${dtFontSize + 10}px; background:#182A44; }

  /* Динамический текст поверх */
  .day-time { position:absolute; top:${dtTop}px; left:${dtLeft}px;
              font-size:${dtFontSize}px; font-weight:900; color:#fff;
              line-height:1; letter-spacing:-0.5px; white-space:nowrap; }
</style>
</head>
<body>
<div class="banner">
  ${bgImg}
  ${fallbackContent}
  <div class="badges">
    <span class="badge badge-date">${dateLabel}</span>
    <span class="badge badge-time">${time} МСК</span>
  </div>
  ${hasBg ? '<div class="cover-v"></div>' : ''}
  <div class="day-time">${day} в ${time}</div>
</div>
</body>
</html>`;
}

// POST /api/images/generate-efir
router.post('/generate-efir', async (req, res) => {
  try {
    const { date, time, day = 'Завтра' } = req.body;
    if (!date) return res.status(400).json({ error: 'Нет даты' });
    if (!time) return res.status(400).json({ error: 'Нет времени' });

    const dateLabel = formatEfirDate(date);
    const html = buildEfirHtml(dateLabel, time, day);

    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: EFIR_W, height: EFIR_H, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });

      const filename = `efir_${Date.now()}.png`;
      const outputPath = path.join(OUTPUT_DIR, filename);
      await page.screenshot({ path: outputPath, type: 'png', clip: { x:0, y:0, width:EFIR_W, height:EFIR_H } });

      res.json({ imageUrl: `/images/output/${filename}`, dateLabel, time });
    } finally {
      await page.close();
    }
  } catch (err) {
    console.error('❌ generate-efir:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/images/send-efir-telegram
router.post('/send-efir-telegram', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'Нет imageUrl' });

    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_VLAD_CHAT_ID;
    if (!token || !chatId) return res.status(500).json({ error: 'Telegram не настроен' });

    const filename = path.basename(imageUrl.split('?')[0]);
    const absPath  = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Файл не найден' });

    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', fs.createReadStream(absPath), { filename });
    form.append('caption', '🎙 Баннер эфира готов');

    await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, form, {
      headers: form.getHeaders(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ send-efir-telegram:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
