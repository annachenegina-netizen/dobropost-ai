const express = require('express');
const { get, save } = require('../settings');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(get());
});

router.post('/', (req, res) => {
  try {
    save(req.body);
    if (req.body.SENDSAY_LOGIN || req.body.SENDSAY_PASSWORD) {
      try { require('../agents/sendsay').resetSession(); } catch (_) {}
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
