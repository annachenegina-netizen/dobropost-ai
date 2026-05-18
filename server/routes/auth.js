// Авторизация: логин / логаут
const USERNAME = process.env.ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD;

function loginHandler(req, res) {
  if (!PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD не задан в .env' });
  }
  const { username, password } = req.body;
  if (username === USERNAME && password === PASSWORD) {
    req.session.authenticated = true;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: 'Ошибка сессии' });
      return res.json({ ok: true });
    });
    return;
  }
  // Фиксированная задержка — нельзя угадать что именно неверно
  setTimeout(() => res.status(401).json({ error: 'Неверный логин или пароль' }), 800);
}

function logoutHandler(req, res) {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
}

function checkHandler(req, res) {
  res.json({ authenticated: !!req.session.authenticated });
}

module.exports = { loginHandler, logoutHandler, checkHandler };
