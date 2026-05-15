// Загрузка файлов в Sendsay через Puppeteer
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadToSendsay, createDraftInSendsay } = require('../agents/sendsay');

const router = express.Router();

const tmpDir = path.join(__dirname, '../../.tmp-uploads');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({ dest: tmpDir });

// POST /api/sendsay/upload
// Body: multipart/form-data, поле "file"
// Ответ: { url }
router.post('/upload', upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не передан' });

    console.log(`📤 Загружаю в Sendsay: ${req.file.originalname}`);
    const url = await uploadToSendsay(tmpPath, req.file.originalname);
    console.log(`✅ Загружено: ${url}`);

    res.json({ url });
  } catch (err) {
    console.error('❌ Ошибка Sendsay:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// POST /api/sendsay/draft
// Body: { html, subject, preheader }
// Ответ: { ok, url }
router.post('/draft', express.json(), async (req, res) => {
  const { html, subject, preheader } = req.body;
  if (!html) return res.status(400).json({ error: 'HTML не передан' });

  try {
    console.log(`📨 Создаю черновик в Sendsay: "${subject}"`);
    const result = await createDraftInSendsay(html, subject || '', preheader || '');
    res.json(result);
  } catch (err) {
    console.error('❌ Ошибка создания черновика:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
