// Точка входа — Express сервер
const express = require('express');
const path = require('path');
require('dotenv').config();

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

// Главная страница — дашборд
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
  // Telegram бот — запускается только если есть токен в .env
  require('./bot/index').startBot();
});
