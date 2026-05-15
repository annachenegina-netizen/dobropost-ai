// Web Push уведомления (PWA)
// Для активации:
//   1. npm install web-push
//   2. Сгенерировать ключи: node -e "const wp=require('web-push');console.log(wp.generateVAPIDKeys())"
//   3. Добавить в .env: VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_EMAIL=mailto:you@domain.com
//   4. Клиент подписывается через /api/push/subscribe и передаёт subscription объект
require('dotenv').config();

let webpush = null;

function getWebPush() {
  if (webpush) return webpush;
  if (!process.env.VAPID_PUBLIC_KEY) return null;
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL || 'mailto:admin@dobropost.ru',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
  } catch {
    console.log('[Push] web-push не установлен: npm install web-push');
    webpush = null;
  }
  return webpush;
}

// Подписки хранятся в памяти (для прода — заменить на БД)
const subscriptions = new Set();

function addSubscription(sub) {
  subscriptions.add(JSON.stringify(sub));
}

function removeSubscription(sub) {
  subscriptions.delete(JSON.stringify(sub));
}

// Отправить push всем подписанным
// payload: { title, body, url? }
async function sendPushNotification({ title, body, url }) {
  const wp = getWebPush();
  if (!wp || subscriptions.size === 0) {
    console.log('[Push] Пропускаем: нет web-push или нет подписок');
    return;
  }
  const payload = JSON.stringify({ title, body, url });
  for (const subStr of subscriptions) {
    try {
      await wp.sendNotification(JSON.parse(subStr), payload);
    } catch (err) {
      if (err.statusCode === 410) subscriptions.delete(subStr); // подписка истекла
    }
  }
  console.log(`[Push] Отправлено ${subscriptions.size} подписчикам`);
}

module.exports = { addSubscription, removeSubscription, sendPushNotification };
