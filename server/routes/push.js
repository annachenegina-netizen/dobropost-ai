const express = require('express');
const { addPushSubscription, removePushSubscription, sendPush } = require('../taskStore');

const router = express.Router();

// GET /api/push/vapid-public-key — фронтенд забирает публичный ключ
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// POST /api/push/subscribe — сохранить подписку устройства
router.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  addPushSubscription(sub);
  res.json({ ok: true });
});

// POST /api/push/unsubscribe — удалить подписку
router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  removePushSubscription(endpoint);
  res.json({ ok: true });
});

// POST /api/push/test — тестовое уведомление
router.post('/test', (req, res) => {
  sendPush('🧪 Тест DobroPost AI', 'Push-уведомления работают!', '/');
  res.json({ ok: true });
});

module.exports = router;
