// ── Вкладка «Статьи» — очередь DOCX → нормализация → заливка в CRM ──

const articlesQueue = []; // { id?, name, file, status, preview, log }

// ── СТАТУСЫ ────────────────────────────────────────────────────
const STATUS = {
  PENDING:      'pending',
  NORMALIZING:  'normalizing',
  NORMALIZED:   'normalized',
  FILLING:      'filling',
  DONE:         'done',
  ERROR:        'error',
};

const STATUS_LABELS = {
  pending:     '⏳ Ожидает',
  normalizing: '🔄 Нормализую...',
  normalized:  '✅ Нормализован',
  filling:     '🤖 Заливаю в CRM...',
  done:        '🎉 Готово',
  error:       '❌ Ошибка',
};

const STATUS_COLORS = {
  pending:     '#6B7280',
  normalizing: '#F59E0B',
  normalized:  '#10B981',
  filling:     '#3B82F6',
  done:        '#059669',
  error:       '#EF4444',
};

// ── ВЫБОР ФАЙЛОВ ─────────────────────────────────────────────────
function onDocxSelected(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;

  for (const file of files) {
    articlesQueue.push({ id: null, name: file.name, file, status: STATUS.PENDING, preview: null, log: [] });
  }

  input.value = ''; // сбрасываем input чтобы можно было добавить ещё
  renderQueue();
  document.getElementById('articles-run-btn').disabled = false;
}

// ── РЕНДЕР ОЧЕРЕДИ ───────────────────────────────────────────────
function renderQueue() {
  const container = document.getElementById('articles-queue');
  if (!articlesQueue.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = articlesQueue.map((item, idx) => {
    const color = STATUS_COLORS[item.status];
    const label = STATUS_LABELS[item.status];

    let previewHtml = '';
    if (item.preview) {
      previewHtml = `
        <div class="aq-preview">
          <span class="aq-prev-row"><b>H1:</b> ${esc(item.preview.h1)}</span>
          <span class="aq-prev-row"><b>Slug:</b> ${esc(item.preview.slug || '—')}</span>
          <span class="aq-prev-row"><b>Категория:</b> ${esc(item.preview.category || '—')}</span>
          <span class="aq-prev-row"><b>Блоков:</b> ${item.preview.blocksCount} / FAQ: ${item.preview.faqCount} / Картинок: ${item.preview.imagesCount}</span>
        </div>`;
    }

    let logHtml = '';
    if (item.log.length && (item.status === STATUS.FILLING || item.status === STATUS.DONE || item.status === STATUS.ERROR)) {
      const last5 = item.log.slice(-5);
      logHtml = `<div class="aq-log">${last5.map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
    }

    let errorHtml = '';
    if (item.status === STATUS.ERROR && item.errorMsg) {
      errorHtml = `<div class="aq-error">${esc(item.errorMsg)}</div>`;
    }

    let doneLink = '';
    if (item.status === STATUS.DONE && item.url) {
      doneLink = `<a href="${item.url}" target="_blank" class="aq-link">Открыть в CRM ↗</a>`;
    }

    return `
      <div class="aq-item" data-idx="${idx}">
        <div class="aq-header">
          <span class="aq-name">${esc(item.name)}</span>
          <span class="aq-status" style="color:${color}">${label}</span>
        </div>
        ${previewHtml}
        ${logHtml}
        ${errorHtml}
        ${doneLink}
      </div>`;
  }).join('');
}

// ── ЗАПУСК ВСЕЙ ОЧЕРЕДИ ──────────────────────────────────────────
async function runArticlesQueue() {
  const btn = document.getElementById('articles-run-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:13px;height:13px;border-width:2px"></div> Работаю...';

  for (let i = 0; i < articlesQueue.length; i++) {
    const item = articlesQueue[i];
    if (item.status === STATUS.DONE) continue; // уже залит

    try {
      // ── Шаг 1: нормализация ──────────────────────────────────
      item.status = STATUS.NORMALIZING;
      renderQueue();

      const formData = new FormData();
      formData.append('docx', item.file);

      const normRes = await fetch('/api/articles/normalize', { method: 'POST', body: formData });
      if (!normRes.ok) {
        const err = await normRes.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${normRes.status}`);
      }

      const { id, preview } = await normRes.json();
      item.id      = id;
      item.preview = preview;
      item.status  = STATUS.NORMALIZED;
      renderQueue();

      await new Promise(r => setTimeout(r, 300));

      // ── Шаг 2: заливка в CRM через SSE ───────────────────────
      item.status = STATUS.FILLING;
      item.log    = [];
      renderQueue();

      await new Promise((resolve, reject) => {
        const es = new EventSource(`/api/articles/fill-crm/${id}`);

        es.onmessage = (e) => {
          const data = JSON.parse(e.data);
          if (data.msg) {
            item.log.push(data.msg);
            renderQueue();
          }
          if (data.done) {
            item.status = STATUS.DONE;
            item.url    = data.url || '';
            renderQueue();
            es.close();
            resolve();
          }
          if (data.error) {
            es.close();
            reject(new Error(data.error));
          }
        };

        es.onerror = () => {
          es.close();
          reject(new Error('Потеряно соединение с сервером'));
        };
      });

    } catch (err) {
      item.status   = STATUS.ERROR;
      item.errorMsg = err.message;
      renderQueue();
    }
  }

  // Проверяем, остались ли ещё не обработанные (ошибки можно повторить)
  const remaining = articlesQueue.filter(i => i.status !== STATUS.DONE);
  if (remaining.length) {
    btn.innerHTML = '<i class="ti ti-player-play" style="font-size:13px"></i>Продолжить';
    btn.disabled = false;
  } else {
    btn.innerHTML = '<i class="ti ti-check" style="font-size:13px"></i>Всё готово';
    btn.disabled = true;
  }
}

function clearArticlesQueue() {
  articlesQueue.length = 0;
  renderQueue();
  const btn = document.getElementById('articles-run-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-player-play" style="font-size:13px"></i>Запустить все';
}

// ── УТИЛИТА ───────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
