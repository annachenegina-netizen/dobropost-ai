// Раздел напоминаний

(function () {

  // ── Загрузка и рендер списка ────────────────────────────────────────────────
  async function loadReminders() {
    var list = document.getElementById('rem-list');
    if (!list) return;
    list.innerHTML = '<div style="color:var(--txt3);font-size:13px;padding:20px 0">Загрузка…</div>';
    try {
      var r = await fetch('/api/reminders');
      var data = await r.json();
      renderReminders(data);
    } catch (e) {
      list.innerHTML = '<div style="color:var(--red);font-size:13px">Ошибка загрузки</div>';
    }
  }

  var SLOT_LABELS = {
    '3d':  '−3д',
    '1d':  '−1д',
    '0':   'В день',
    '+1h': '+1ч',
    '+4h': '+4ч',
  };

  function renderReminders(items) {
    var list = document.getElementById('rem-list');
    if (!list) return;
    if (!items || !items.length) {
      list.innerHTML = '<div style="color:var(--txt3);font-size:13px;padding:20px 0;text-align:center">Напоминаний пока нет.<br>Напишите боту или добавьте выше.</div>';
      return;
    }

    list.innerHTML = items.map(function (r) {
      var dt = new Date(r.datetime).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      var created = new Date(r.createdAt).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      });

      var slots = Object.keys(SLOT_LABELS).map(function (key) {
        var val = r.sent && r.sent[key];
        var cls = val === undefined ? 'rem-slot-pending' : val === -1 ? 'rem-slot-skip' : 'rem-slot-sent';
        return '<span class="rem-slot ' + cls + '">' + SLOT_LABELS[key] + '</span>';
      }).join('');

      var doneCls = r.done ? ' rem-card-done' : '';
      return '<div class="rem-card' + doneCls + '" id="rem-' + r.id + '">' +
        '<div class="rem-card-top">' +
          '<span class="rem-text">' + escHtml(r.text) + '</span>' +
          '<button class="rem-del-btn" onclick="deleteReminder(\'' + r.id + '\')" title="Удалить">✕</button>' +
        '</div>' +
        '<div class="rem-dt"><i class="ti ti-calendar" style="font-size:12px"></i>' + dt + '</div>' +
        '<div class="rem-slots-row">' + slots + '</div>' +
        '<div class="rem-meta">Добавлено ' + created + (r.done ? ' · <span style="color:var(--green)">✓ выполнено</span>' : '') + '</div>' +
      '</div>';
    }).join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Добавить напоминание из формы дашборда ───────────────────────────────────
  async function addReminderFromForm(btn) {
    var textEl = document.getElementById('rem-form-text');
    var dtEl   = document.getElementById('rem-form-dt');
    var text   = textEl ? textEl.value.trim() : '';
    var dt     = dtEl   ? dtEl.value          : '';
    if (!text) { showToast('Введите текст напоминания'); return; }
    if (!dt)   { showToast('Укажите дату и время');      return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Добавляю…'; }
    try {
      var r = await fetch('/api/reminders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: text, datetime: new Date(dt).toISOString() }),
      });
      if (!r.ok) throw new Error(await r.text());
      if (textEl) textEl.value = '';
      showToast('Напоминание добавлено');
      await loadReminders();
    } catch (e) {
      showToast('Ошибка: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Добавить'; }
    }
  }

  // ── Удалить напоминание ──────────────────────────────────────────────────────
  async function deleteReminder(id) {
    var card = document.getElementById('rem-' + id);
    if (card) card.style.opacity = '0.4';
    try {
      await fetch('/api/reminders/' + id, { method: 'DELETE' });
      showToast('Напоминание удалено');
      await loadReminders();
    } catch (e) {
      if (card) card.style.opacity = '1';
      showToast('Ошибка удаления');
    }
  }

  window.loadReminders      = loadReminders;
  window.addReminderFromForm = addReminderFromForm;
  window.deleteReminder      = deleteReminder;

})();
