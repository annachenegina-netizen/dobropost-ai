// Генерация HTML-вёрстки писем: AI заполняет шаблон → отдаём готовый HTML
const express = require('express');
const { generateEmailHtml } = require('../agents/claude');

const router = express.Router();

// POST /api/letters/generate
// Тело: { letterText }
// Ответ: { html, subject, preheader }
router.post('/generate', async (req, res) => {
  try {
    const { letterText, bannerUrl } = req.body;
    if (!letterText) return res.status(400).json({ error: 'Нет текста письма' });

    console.log('📧 Генерирую вёрстку письма...');
    const result = await generateEmailHtml(letterText, bannerUrl || null);
    console.log(`✅ Тема: "${result.subject}"`);

    res.json(result);
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
