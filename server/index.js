// Точка входа — Express сервер
const express = require('express');
const session = require('express-session');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

// Настройки из settings.json перекрывают .env (меняются через дашборд)
require('./settings').apply();

const app = express();
const PORT = process.env.PORT || 3000;

// Парсим JSON и форм-данные в запросах
app.use(express.json());

// ── Сессии ───────────────────────────────────────────────────────────────────
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change-me-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,      // JS на странице не может прочитать cookie
    sameSite: 'strict',  // защита от CSRF
    secure: process.env.NODE_ENV === 'production', // HTTPS в проде
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
  },
}));

// ── Авторизация ───────────────────────────────────────────────────────────────
// Пути без проверки сессии
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/api/auth/login']);

app.use((req, res, next) => {
  // Служебные пути — всегда открыты
  if (PUBLIC_PATHS.has(req.path)) return next();
  // Service worker — нужен браузеру без куки для push-уведомлений
  if (req.path === '/sw.js') return next();

  // Есть сессия — пропускаем
  if (req.session && req.session.authenticated) return next();

  // API → 401 (не делаем редирект, чтобы не ломать fetch-запросы)
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  // Всё остальное → редирект на страницу логина
  return res.redirect('/login');
});

// ── Auth роуты (должны быть ДО статики) ─────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));

// ── Страница логина ───────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../client/login.html'));
});

// ── Статика и API (только для авторизованных — middleware выше уже проверил) ──
app.use(express.static(path.join(__dirname, '../client')));

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

// Быстрый статус сервисов
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
  require('./bot/index').startBot();
});
