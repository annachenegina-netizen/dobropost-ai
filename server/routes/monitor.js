const express = require('express');
const os = require('os');
const { execSync } = require('child_process');
const axios = require('axios');
const { getTasks, getHistory } = require('../taskStore');

const router = express.Router();

// GET /api/monitor — агрегированный статус системы
router.get('/', async (req, res) => {
  const result = {};

  // ── Сервер ────────────────────────────────────────────────────────────
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  result.server = {
    ramUsed:  totalMem - freeMem,
    ramTotal: totalMem,
    uptime:   os.uptime(),
    loadAvg:  os.loadavg()[0],
  };

  try {
    const df = execSync('df -B1 / 2>/dev/null | tail -1').toString().trim().split(/\s+/);
    result.server.diskUsed  = parseInt(df[2]);
    result.server.diskTotal = parseInt(df[1]);
  } catch (_) {}

  // ── Активность из SQLite ──────────────────────────────────────────────
  try {
    const active  = getTasks();
    const history = getHistory({});
    const all     = [...active, ...history];

    const byType = {};
    all.forEach(t => {
      const type = t.tz?.type || 'other';
      byType[type] = (byType[type] || 0) + 1;
    });

    // активность за 7 дней (done/error задачи)
    const week = Date.now() - 7 * 86400000;
    const weekly = history.filter(t => t.createdAt >= week);
    const weeklyByDay = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      weeklyByDay[key] = { letter: 0, banner: 0, article: 0 };
    }
    weekly.forEach(t => {
      const key = new Date(t.createdAt).toISOString().slice(0, 10);
      if (weeklyByDay[key] && t.tz?.type) {
        weeklyByDay[key][t.tz.type] = (weeklyByDay[key][t.tz.type] || 0) + 1;
      }
    });

    result.activity = {
      total:      all.length,
      active:     active.length,
      done:       history.filter(t => t.status === 'done').length,
      byType,
      weeklyByDay,
    };
  } catch (_) {
    result.activity = null;
  }

  // ── Telegram бот ──────────────────────────────────────────────────────
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const r = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 5000 });
      result.telegram = { ok: true, username: r.data.result.username };
    } else {
      result.telegram = { ok: false };
    }
  } catch (_) {
    result.telegram = { ok: false };
  }

  // ── OpenAI баланс ─────────────────────────────────────────────────────
  try {
    const r = await axios.get('https://api.openai.com/v1/dashboard/billing/credit_grants', {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeout: 8000,
    });
    const d = r.data;
    result.openai = {
      total:     d.total_granted,
      used:      d.total_used,
      remaining: d.total_available,
    };
  } catch (_) {
    result.openai = null;
  }

  res.json(result);
});

module.exports = router;
