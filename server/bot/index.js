// Telegram-бот DobroPost AI
// Слушает рабочие чаты → формирует ТЗ → присылает Владу на одобрение
// Влад пишет/пересылает/голосовые → бот сразу разбирает задачу
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
const { OpenAI, toFile } = require('openai');
const { parseTzFromMessage } = require('../agents/claude');
const { addTask, updateTask, removeTask, getTask } = require('../taskStore');
const { uploadBannerToSendsay } = require('../agents/sendsay');
require('dotenv').config();

let bot = null;

// Задачи ожидающие одобрения: taskId → { tz, fromName, sourceChatTitle }
const pendingTasks = new Map();

// Батчинг входящих сообщений: chatId → { timer, texts[], msg }
// Ждём 2.5 сек после последнего сообщения, потом склеиваем в одно ТЗ
const msgBatch = new Map();
const BATCH_DELAY = 2500;

function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('⚠️  TG бот: нет TELEGRAM_BOT_TOKEN, пропускаем');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });
  const vladId = process.env.TELEGRAM_VLAD_CHAT_ID;

  // /start — покажем chat ID
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `👋 Привет! Я бот <b>DobroPost AI</b>.\n\n` +
      `Твой chat ID: <code>${msg.chat.id}</code>\n\n` +
      `Добавь в .env:\n<code>TELEGRAM_VLAD_CHAT_ID=${msg.chat.id}</code>`,
      { parse_mode: 'HTML' },
    );
  });

  // /status
  bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, '✅ Сервер DobroPost AI работает');
  });

  // /help
  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      '📋 <b>Команды:</b>\n' +
      '/start — твой chat ID\n' +
      '/status — статус сервера\n' +
      '/help — это сообщение\n\n' +
      '<b>Как работать:</b>\n' +
      '• Напиши мне задачу или перешли сообщение клиента\n' +
      '• Голосовое — расшифрую автоматически (Whisper)\n' +
      '• В рабочем чате — слежу за задачами, присылаю ТЗ тебе в личку',
      { parse_mode: 'HTML' },
    );
  });

  // Все сообщения (кроме команд)
  bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return;

    const chatId = msg.chat.id;
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    const isVlad = vladId && String(chatId) === String(vladId);

    // Голосовое — принимаем только от Влада или в личке
    if (msg.voice) {
      if (isGroup) return;
      await handleVoice(msg, chatId, vladId);
      return;
    }

    const text = msg.text || msg.caption || '';
    if (!text || text.length < 8) return;

    if (isGroup) {
      addToBatch(chatId, text, msg, vladId, 'group');
    } else if (isVlad || msg.chat.type === 'private') {
      addToBatch(chatId, text, msg, vladId, 'direct');
    }
  });

  // Кнопки inline keyboard
  bot.on('callback_query', async (query) => {
    const parts = (query.data || '').split(':');
    const action = parts[0];
    const taskId = parts[1];
    const task = pendingTasks.get(taskId);

    if (!task) {
      bot.answerCallbackQuery(query.id, { text: 'Задача не найдена или уже выполнена' });
      return;
    }

    if (action === 'accept') {
      bot.answerCallbackQuery(query.id, { text: '✅ Добавлено в очередь' });
      updateTask(taskId, { status: 'pending' });
      bot.editMessageText(
        `📋 <b>Задача в очереди</b> — открой дашборд и нажми «Сделать»\n\n${formatTz(task.tz)}`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } },
      );
      pendingTasks.delete(taskId);
    } else if (action === 'reject') {
      bot.answerCallbackQuery(query.id, { text: '❌ Отклонено' });
      bot.editMessageText(
        `❌ <b>Задача отклонена</b>\n\n${formatTz(task.tz)}`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } },
      );
      removeTask(taskId);
      pendingTasks.delete(taskId);
    } else if (action === 'execute') {
      bot.answerCallbackQuery(query.id, { text: '🤖 Запускаю...' });
      pendingTasks.delete(taskId);
      executeTask(getTask(taskId), query.message, taskId);
    }
  });

  bot.on('polling_error', (err) => console.error('[Bot] Ошибка polling:', err.message));
  console.log('🤖 Telegram бот запущен (polling)');
  return bot;
}

// ─── Батчинг: собираем сообщения 2.5 сек, потом склеиваем ───────────────────
function addToBatch(chatId, text, msg, vladId, mode) {
  const key = String(chatId);
  const existing = msgBatch.get(key);

  if (existing) {
    clearTimeout(existing.timer);
    existing.texts.push(text);
  } else {
    msgBatch.set(key, { texts: [text], msg, vladId, mode });
  }

  const batch = msgBatch.get(key);
  batch.timer = setTimeout(async () => {
    msgBatch.delete(key);
    const combined = batch.texts.join('\n\n');
    if (batch.mode === 'group') {
      await handleGroupMessage(batch.msg, combined, batch.vladId);
    } else {
      await handleDirectMessage(batch.msg, combined, chatId, batch.vladId);
    }
  }, BATCH_DELAY);
}

// ─── Голосовое сообщение ────────────────────────────────────────────────────
async function handleVoice(msg, chatId, vladId) {
  const statusMsg = await bot.sendMessage(chatId, '🎤 Расшифровываю голосовое...');
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const fileInfo = await bot.getFile(msg.voice.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
    const { data: audioData } = await axios.get(fileUrl, { responseType: 'arraybuffer' });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const audioFile = await toFile(Buffer.from(audioData), 'voice.ogg', { type: 'audio/ogg' });
    const transcript = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'ru',
    });

    const text = transcript.text;
    await bot.editMessageText(
      `🎤 <i>${text}</i>\n\n⏳ Анализирую задачу...`,
      { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' },
    );

    await processText(text, msg, chatId, vladId, statusMsg.message_id);
  } catch (err) {
    console.error('[Bot] Ошибка голосового:', err.message);
    bot.editMessageText('❌ Не удалось расшифровать голосовое', {
      chat_id: chatId,
      message_id: statusMsg.message_id,
    });
  }
}

// ─── Сообщение из группы ────────────────────────────────────────────────────
async function handleGroupMessage(msg, text, vladId) {
  if (!vladId) return;

  const tz = await parseTzFromMessage(text);

  const task = addTask({
    tz,
    fromName: msg.from?.first_name || 'Неизвестно',
    sourceChatTitle: msg.chat.title || 'группа',
  });
  pendingTasks.set(task.id, { tz, fromName: msg.from?.first_name || 'Неизвестно' });

  const header = `👥 Задача из <b>${msg.chat.title || 'группы'}</b>\nОт: ${msg.from?.first_name || '?'}`;
  sendTzCard(vladId, tz, task.id, header);
}

// ─── Личное сообщение или пересланное ───────────────────────────────────────
async function handleDirectMessage(msg, text, chatId, vladId) {
  if (/напомни|напоминани|поставь.{0,25}напомн/i.test(text)) {
    return handleReminderMessage(msg, text, chatId);
  }
  const statusMsg = await bot.sendMessage(chatId, '⏳ Анализирую задачу...');
  await processText(text, msg, chatId, vladId, statusMsg.message_id);
}

// ─── Напоминание из личного чата ────────────────────────────────────────────
async function handleReminderMessage(msg, text, chatId) {
  const statusMsg = await bot.sendMessage(chatId, '⏰ Разбираю напоминание…');
  try {
    const PORT = process.env.PORT || 3000;
    const resp = await axios.post(`http://localhost:${PORT}/api/reminders/parse`, {
      text,
      chatId: String(chatId),
    });
    const { reminder, parsed } = resp.data;
    const dt = new Date(reminder.datetime).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit',
    });
    bot.editMessageText(
      `✅ <b>Напоминание установлено</b>\n\n📌 ${parsed.text}\n📅 ${dt}\n\n🔔 Напомню за 3 дня, за 1 день, в день события, через 1 и 4 часа после.`,
      { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' },
    ).catch(() => {});
  } catch (err) {
    const errText = err.response?.data?.error || err.message;
    bot.editMessageText(
      `❌ Не смог разобрать напоминание: ${errText}`,
      { chat_id: chatId, message_id: statusMsg.message_id },
    ).catch(() => {});
  }
}

// ─── Парсинг текста → ТЗ ────────────────────────────────────────────────────
async function processText(text, msg, chatId, vladId, editMsgId) {
  const tz = await parseTzFromMessage(text);

  if (editMsgId) bot.deleteMessage(chatId, editMsgId).catch(() => {});

  // Кладём в общий стор (для дашборда)
  const task = addTask({ tz, fromName: msg.from?.first_name || '?', sourceChatTitle: null });
  pendingTasks.set(task.id, { tz, fromName: msg.from?.first_name || '?' });

  // Если пишет не Влад — шлём в личку Владу, иначе прямо в чат
  const targetChatId = vladId && String(chatId) !== String(vladId) ? vladId : chatId;
  sendTzCard(targetChatId, tz, task.id);
}

// ─── Отправить карточку ТЗ с кнопками ───────────────────────────────────────
function sendTzCard(chatId, tz, taskId, header = '') {
  const text = (header ? header + '\n\n' : '') + formatTz(tz);
  bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Принять', callback_data: `accept:${taskId}` },
        { text: '❌ Отклонить', callback_data: `reject:${taskId}` },
        { text: '🤖 Отправить ИИ', callback_data: `execute:${taskId}` },
      ]],
    },
  }).then(sent => {
    // Сохраняем ID Telegram-сообщения чтобы обновлять его из дашборда
    updateTask(taskId, { telegramChatId: chatId, telegramMsgId: sent.message_id });
  }).catch(() => {});
}

// ─── Форматирование ТЗ в текст ───────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatTz(tz) {
  if (!tz) return '(нет данных)';
  const emoji = { banner: '🖼', letter: '📧', article: '📝' }[tz.type] || '📋';
  const name  = { banner: 'Баннер', letter: 'Письмо', article: 'Статья' }[tz.type] || 'Задача';

  const lines = [`${emoji} <b>${escHtml(name)}</b>`];
  if (tz.title)    lines.push(`📌 ${escHtml(tz.title)}`);
  if (tz.template) lines.push(`🎨 Шаблон: <code>${escHtml(tz.template)}</code>`);
  if (tz.subtitle) lines.push(`💬 ${escHtml(tz.subtitle)}`);
  if (tz.text) {
    const t = tz.text.slice(0, 250);
    lines.push(`\n<i>${escHtml(t)}${tz.text.length > 250 ? '…' : ''}</i>`);
  }

  return lines.join('\n');
}

// ─── Выполнение задачи после одобрения ──────────────────────────────────────
async function executeTask(task, callbackMsg, taskId) {
  const { tz } = task;
  const chatId = callbackMsg.chat.id;
  const PORT = process.env.PORT || 3000;
  const base = `http://localhost:${PORT}`;

  // Убираем кнопки с исходной карточки ТЗ
  bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
    chat_id: chatId,
    message_id: callbackMsg.message_id,
  }).catch(() => {});

  // Отдельное сообщение со статусом — будем его обновлять
  const statusMsg = await bot.sendMessage(chatId, '✅ Принял задачу, начинаю...', { parse_mode: 'HTML' });

  const setStatus = (text) => bot.editMessageText(text, {
    chat_id: chatId,
    message_id: statusMsg.message_id,
    parse_mode: 'HTML',
  }).catch(() => {});

  updateTask(taskId, { status: 'inprog' });
  try {
    if (tz.type === 'banner') {
      await executeBanner(tz, chatId, base, setStatus);
    } else if (tz.type === 'letter') {
      await executeLetter(tz, chatId, base, setStatus);
    } else if (tz.type === 'article') {
      await setStatus('📝 ТЗ сформировано.\nСтатьи заливаются через дашборд — открой вкладку «Статьи».');
    } else {
      await setStatus(`✅ Задача принята в работу:\n<b>${tz.title}</b>`);
    }
    updateTask(taskId, { status: 'done' });
  } catch (err) {
    console.error('[Bot] Ошибка выполнения:', err.message);
    setStatus(`❌ Ошибка при выполнении:\n<code>${err.message}</code>`);
    updateTask(taskId, { status: 'error', error: err.message });
  }

  pendingTasks.delete(taskId);
}

async function executeBanner(tz, chatId, base, setStatus) {
  await setStatus('🎨 Анализирую текст и выбираю шаблон...');

  const resp = await axios.post(`${base}/api/images/generate`, {
    letterText: tz.text || tz.title,
    templateId: tz.template || null,
  });

  await setStatus(`🖼 Рендерю баннер — шаблон <code>${resp.data.templateId}</code>...`);

  const fs = require('fs');
  const absPath = path.join(__dirname, '../../client', resp.data.imageUrl);

  await bot.sendPhoto(chatId, fs.readFileSync(absPath), {
    caption:
      `✅ Баннер готов\n` +
      `🎨 ${resp.data.templateId}\n` +
      `📌 ${resp.data.title} — ${resp.data.subtitle}`,
  });

  await setStatus('✅ Баннер сгенерирован и отправлен выше ☝️');
}

async function executeLetter(tz, chatId, base, setStatus) {
  // Сначала генерируем баннер
  await setStatus('🎨 Генерирую баннер для письма...');
  const bannerResp = await axios.post(`${base}/api/images/generate`, {
    letterText: tz.text || tz.title,
    templateId: tz.template || null,
  });
  await setStatus('☁️ Загружаю баннер в Sendsay CDN...');
  const bannerUrl = bannerResp.data.imageUrl
    ? await uploadBannerToSendsay(bannerResp.data.imageUrl).catch(() => null)
    : null;
  await setStatus(`🖼 Баннер готов — шаблон <code>${bannerResp.data.templateId}</code>\n📝 Верстаю письмо...`);

  const genResp = await axios.post(`${base}/api/letters/generate`, {
    letterText: tz.text || tz.title,
    bannerUrl,
  });

  await setStatus('📤 Создаю черновик в Sendsay...');

  await axios.post(`${base}/api/sendsay/draft`, {
    subject: genResp.data.subject,
    preheader: genResp.data.preheader,
    html: genResp.data.html,
  });

  await setStatus(
    `✅ <b>Письмо готово</b>\n\n` +
    `🖼 Баннер: ${bannerResp.data.templateId}\n` +
    `📧 Тема: ${genResp.data.subject}\n` +
    `💌 Черновик создан в Sendsay`,
  );
}

module.exports = { startBot, getBot: () => bot };
