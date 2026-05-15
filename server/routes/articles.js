// Статьи: нормализация DOCX + заливка в CRM
const express  = require('express');
const multer   = require('multer');
const { normalizeDocx } = require('../agents/normalize');
const { fillCRM }       = require('../agents/blog');

const router = express.Router();

// Хранилище нормализованных статей в памяти (UUID → данные)
const articlesStore = new Map();
const TTL = 2 * 60 * 60 * 1000; // 2 часа

function storeArticle(id, data) {
  articlesStore.set(id, { data, createdAt: Date.now() });
  // Авто-очистка через TTL
  setTimeout(() => articlesStore.delete(id), TTL);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Multer в памяти — принимаем до 10 DOCX-файлов по 20MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.includes('document.wordprocessingml') || file.originalname.endsWith('.docx');
    ok ? cb(null, true) : cb(new Error('Только DOCX файлы'));
  },
});

// ── POST /api/articles/normalize ─────────────────────────────────
// body: multipart/form-data, поле "docx" (один файл)
// ответ: { id, name, preview: { h1, slug, category, blocksCount, faqCount, imagesCount } }
router.post('/normalize', upload.single('docx'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Нет файла' });

  console.log(`📄 Нормализую: ${req.file.originalname}`);
  try {
    const result = await normalizeDocx(req.file.buffer);
    const id = genId();
    storeArticle(id, result);

    const preview = {
      h1:          result.h1 || '(без заголовка)',
      slug:        result.slug || '',
      category:    result.category || '',
      blocksCount: (result.blocks || []).length,
      faqCount:    (result.faq    || []).length,
      imagesCount: (result.blocks || []).filter(b => b.type === 'image').length,
    };

    console.log(`✅ Нормализовано: "${preview.h1}"`);
    res.json({ id, name: req.file.originalname, preview });
  } catch (err) {
    console.error('❌ Normalize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/articles/fill-crm/:id ───────────────────────────────
// SSE-поток прогресса заливки статьи в CRM
router.get('/fill-crm/:id', (req, res) => {
  const entry = articlesStore.get(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'Статья не найдена или истёк TTL (2 ч)' });
    return;
  }

  // Открываем SSE
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  send({ msg: '🚀 Запускаю Puppeteer...' });

  fillCRM(entry.data, (msg) => send({ msg }))
    .then(result => {
      send({ done: true, url: result.url });
      res.end();
    })
    .catch(err => {
      send({ error: err.message });
      res.end();
    });
});

// ── Старый endpoint разбора (оставляем для совместимости) ─────────
const mammoth      = require('mammoth');
const { parseArticle } = require('../agents/claude');
const uploadLegacy = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/parse', uploadLegacy.single('docx'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Нет файла' });
    const { value: rawText } = await mammoth.extractRawText({ buffer: req.file.buffer });
    if (!rawText.trim()) return res.status(400).json({ error: 'Файл пустой' });
    const result = await parseArticle(rawText);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
