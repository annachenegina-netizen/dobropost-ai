// Авторизация: логин / логаут
const express = require('express');
const router = express.Router();

const USERNAME = process.env.ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD;

// POST /api/auth/login
router.post('/login', (req, res) => {
  if (!PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD не задан в .env' });
  }
  const { username, password } = req.body;
  if (username === USERNAME && password === PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  // Одинаковая задержка чтобы нельзя было угадать что именно неверно
  setTimeout(() => res.status(401).json({ error: 'Неверный логин или пароль' }), 800);
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/check — проверить сессию (для SPA)
router.get('/check', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

module.exports = router;
