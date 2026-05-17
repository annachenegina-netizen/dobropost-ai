// Точка входа — Express сервер
const express = require('express');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

// Настройки из settings.json перекрывают .env (меняются через дашборд)
require('./settings').apply();

const app = express();
const PORT = process.env.PORT || 3000;

// Парсим JSON в запросах
app.use(express.json());

// Раздаём статику (дашборд + картинки)
app.use(express.static(path.join(__dirname, '../client')));

// Маршруты API
app.use('/api/images',   require('./routes/images'));
app.use('/api/letters',  require('./routes/letters'));
app.use('/api/articles', require('./routes/articles'));
app.use('/api/sendsay',  require('./routes/sendsay'));
app.use('/api/tasks',    require('./routes/tasks'));
app.use('/api/monitor',  require('./routes/monitor'));
app.use('/api/push',     require('./routes/push'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/ai',       require('./routes/ai').router);

// Версия — последний git коммит
const REPO = path.join(__dirname, '..');
app.get('/api/version', (req, res) => {
  try {
    const hash = execSync(`git -C "${REPO}" rev-parse --short HEAD`).toString().trim();
    const msg  = execSync(`git -C "${REPO}" log -1 --format=%s`).toString().trim();
    const date = execSync(`git -C "${REPO}" log -1 --format=%ci`).toString().trim().slice(0, 16);
    res.json({ hash, msg, date });
  } catch (_) {
    res.json({ hash: '—', msg: 'git недоступен', date: '' });
  }
});

// Быстрый статус сервисов (без внешних запросов, только проверка ключей)
app.get('/api/status', (req, res) => {
  res.json({
    server:   true,
    openai:   !!process.env.OPENAI_API_KEY,
    sendsay:  !!process.env.SENDSAY_LOGIN,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
  });
});

// Главная страница — дашборд
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
  // Telegram бот — запускается только если есть токен в .env
  require('./bot/index').startBot();
});
