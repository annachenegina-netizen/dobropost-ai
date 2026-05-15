// Отправка уведомлений Владу в Telegram
// Требует: TELEGRAM_BOT_TOKEN + TELEGRAM_VLAD_CHAT_ID в .env
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

let _bot = null;

function getBot() {
  if (_bot) return _bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  _bot = new TelegramBot(token); // без polling — только отправка
  return _bot;
}

async function sendTelegramMessage(text, chatId) {
  const bot = getBot();
  const chat = chatId || process.env.TELEGRAM_VLAD_CHAT_ID;
  if (!bot || !chat) {
    console.log('[Telegram] Пропускаем: нет TELEGRAM_BOT_TOKEN или TELEGRAM_VLAD_CHAT_ID в .env');
    return;
  }
  try {
    await bot.sendMessage(chat, text, { parse_mode: 'HTML' });
    console.log('[Telegram] Отправлено');
  } catch (err) {
    console.error('[Telegram] Ошибка:', err.message);
  }
}

module.exports = { sendTelegramMessage };
