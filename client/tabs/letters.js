// Логика вкладки «Письма» — генерация HTML-вёрстки из текста письма
let currentLetterHtml = null;
let currentSubject = null;
let currentPreheader = null;

async function layoutLetter() {
  const letterText = document.getElementById('letter-text-email').value.trim();
  if (!letterText) {
    showToast('Вставь текст письма');
    return;
  }

  const btn = document.getElementById('layout-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Верстаю…';

  try {
    const bannerUrl = document.getElementById('letter-banner-url').value.trim();
    const body = { letterText };
    if (bannerUrl) body.bannerUrl = bannerUrl;

    const res = await fetch('/api/letters/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка сервера');
    }

    const data = await res.json();
    currentLetterHtml = data.html;
    currentSubject = data.subject;
    currentPreheader = data.preheader;

    document.getElementById('letter-subject').textContent = data.subject;
    document.getElementById('letter-preheader').textContent = data.preheader;

    // Вставляем HTML в iframe через srcdoc
    const iframe = document.getElementById('letter-preview');
    iframe.srcdoc = data.html;

    document.getElementById('letter-result-card').style.display = 'block';
    document.getElementById('letter-result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    showToast('Ошибка: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Сверстать письмо <i class="ti ti-arrow-right" style="font-size:13px"></i>';
  }
}

function copyLetterHtml() {
  if (!currentLetterHtml) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(currentLetterHtml).then(() => showToast('HTML скопирован'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = currentLetterHtml;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('HTML скопирован');
  }
}

async function uploadBannerToSendsay(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const btn = document.getElementById('sendsay-upload-btn');
  btn.disabled = true;
  btn.innerHTML = 'Загружаю…';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/sendsay/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');

    document.getElementById('letter-banner-url').value = data.url;
    showToast('Баннер загружен в Sendsay');
  } catch (err) {
    showToast('Ошибка: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload" style="font-size:13px"></i>';
  }
}

async function loadDraftToSendsay() {
  if (!currentLetterHtml) return;

  const btn = document.getElementById('sendsay-draft-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Создаю черновик…';

  try {
    const res = await fetch('/api/sendsay/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: currentLetterHtml, subject: currentSubject, preheader: currentPreheader }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
    showToast('Черновик создан в Sendsay');
  } catch (err) {
    showToast('Ошибка: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-cloud-upload" style="font-size:12px"></i>Создать черновик в Sendsay';
  }
}

function downloadLetterHtml() {
  if (!currentLetterHtml) return;
  const blob = new Blob([currentLetterHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `letter_${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
