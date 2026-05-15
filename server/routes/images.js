// Генерация баннеров: AI выбирает шаблон → Puppeteer рисует картинку
const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
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

module.exports = router;
