// Точка входа — Express сервер
const express = require('express');
const session = require('express-session');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

require('./settings').apply();

const app = express();
const PORT = process.env.PORT || 3000;

// Сервер за nginx — доверяем первому прокси (нужно для secure cookies и IP)
app.set('trust proxy', 1);

// ── Security заголовки (helmet) ───────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"], // дашборд использует inline-скрипты
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'"],
      frameAncestors: ["'none'"], // запрещает встраивать в iframe
    },
  },
}));
app.disable('x-powered-by'); // скрываем "X-Powered-By: Express"

// ── Парсинг тела запросов ─────────────────────────────────────────────────────
app.use(express.json());

// ── Rate limit на логин — не более 10 попыток за 15 минут с одного IP ─────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Подождите 15 минут.' },
  skipSuccessfulRequests: true, // успешный логин не считается
});

// ── Сессии ────────────────────────────────────────────────────────────────────
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change-me-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,     // JS не может прочитать cookie
    sameSite: 'strict', // защита от CSRF
    secure: process.env.NODE_ENV === 'production', // только HTTPS в проде
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
  },
}));

// ── Auth роут — ДО middleware проверки сессии, с rate limit ──────────────────
app.post('/api/auth/login', loginLimiter, require('./routes/auth').loginHandler);
app.post('/api/auth/logout', require('./routes/auth').logoutHandler);
app.get('/api/auth/check',  require('./routes/auth').checkHandler);

// ── Проверка сессии — закрывает всё приложение ────────────────────────────────
const PUBLIC_PATHS = new Set(['/login', '/login.html']);

app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.path === '/sw.js')      return next(); // service worker для push

  if (req.session && req.session.authenticated) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  return res.redirect('/login');
});

// ── Страница логина ───────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../client/login.html'));
});

// ── Статика и API ─────────────────────────────────────────────────────────────
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

app.get('/api/status', (req, res) => {
  res.json({
    server:   true,
    openai:   !!process.env.OPENAI_API_KEY,
    sendsay:  !!process.env.SENDSAY_LOGIN,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
  require('./bot/index').startBot();
});
