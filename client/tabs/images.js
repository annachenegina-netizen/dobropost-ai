// Все доступные шаблоны — порядок как в меню
const TEMPLATES = [
  { id: 'auto',             label: 'Авто',        preview: null },
  { id: 'nahodki-1',        label: 'Находки 1',   preview: '/images/templates/nahodki-1.jpg' },
  { id: 'nahodki-2',        label: 'Находки 2',   preview: '/images/templates/nahodki-2.jpg' },
  { id: 'nahodki-3',        label: 'Находки 3',   preview: '/images/templates/nahodki-3.jpg' },
  { id: 'nahodki-4',        label: 'Находки 4',   preview: '/images/templates/nahodki-4.jpg' },
  { id: 'nahodki-5',        label: 'Находки 5',   preview: '/images/templates/nahodki-5.jpg' },
  { id: 'nahodki-6',        label: 'Находки 6',   preview: '/images/templates/nahodki-6.jpg' },
  { id: 'nahodki-7',        label: 'Находки 7',   preview: '/images/templates/nahodki-7.jpg' },
  { id: 'nahodki-prazdnik', label: 'Находки НГ',  preview: '/images/templates/nahodki-prazdnik.jpg' },
  { id: 'community-1',      label: 'Комьюнити 1', preview: '/images/templates/community-1.jpg' },
  { id: 'community-2',      label: 'Комьюнити 2', preview: '/images/templates/community-2.jpg' },
  { id: 'community-3',      label: 'Комьюнити 3', preview: '/images/templates/community-3.jpg' },
  { id: 'community-4',      label: 'Комьюнити 4', preview: '/images/templates/community-4.jpg' },
  { id: 'gayd-1',           label: 'Гайд',        preview: '/images/templates/gayd-1.jpg' },
  { id: 'prazdnik-1',       label: 'Хэллоуин',    preview: '/images/templates/prazdnik-1.jpg' },
  { id: 'novinka-1',        label: 'Новинка',     preview: '/images/templates/novinka-1.jpg' },
  { id: 'polezno-1',        label: 'Полезно',     preview: '/images/templates/polezno-1.jpg' },
  { id: 'akciya-1',         label: 'Акция 1',     preview: '/images/templates/akciya-1.jpg' },
  { id: 'akciya-2',         label: 'Акция 2',     preview: '/images/templates/akciya-2.jpg' },
  { id: 'akciya-3',         label: 'Акция 3',     preview: '/images/templates/akciya-3.jpg' },
  { id: 'stil-1',           label: 'Стиль',       preview: '/images/templates/stil-1.jpg' },
];

let selectedTemplate = 'auto';
let currentImageUrl = null;

// Инициализация — рендерим пикер шаблонов
document.addEventListener('DOMContentLoaded', () => {
  renderTemplatePicker();
});

function renderTemplatePicker() {
  const container = document.getElementById('template-picker');
  if (!container) return;

  container.innerHTML = TEMPLATES.map(t => {
    const isAuto = t.id === 'auto';
    const isActive = t.id === selectedTemplate;

    const inner = isAuto
      ? `<div class="tpl-auto ${isActive ? 'active' : ''}">
           <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
           </svg>
           <span>Авто</span>
         </div>`
      : `<div class="tpl-thumb ${isActive ? 'active' : ''}">
           <img src="${t.preview}" alt="${t.label}" loading="lazy">
         </div>`;

    return `<div class="tpl-item" data-id="${t.id}" onclick="selectTemplate('${t.id}')">
      ${inner}
      <div class="tpl-label ${isActive ? 'active' : ''}">${t.label}</div>
    </div>`;
  }).join('');
}

function selectTemplate(id) {
  selectedTemplate = id;
  // Обновляем активные классы без полного перерендера
  document.querySelectorAll('.tpl-item').forEach(el => {
    const isActive = el.dataset.id === id;
    el.querySelector('.tpl-auto, .tpl-thumb')?.classList.toggle('active', isActive);
    el.querySelector('.tpl-label')?.classList.toggle('active', isActive);
  });
}

async function generateBanner() {
  const letterText = document.getElementById('letter-text').value.trim();
  if (!letterText) {
    showToast('Вставь текст письма');
    return;
  }

  const btn = document.getElementById('generate-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Генерирую…';

  try {
    const limits = typeof getLimits === 'function' ? getLimits() : {};
    const body = {
      letterText,
      maxTitleWords: limits.bannerTitle ? parseInt(limits.bannerTitle) : undefined,
      maxSubWords:   limits.bannerSub   ? parseInt(limits.bannerSub)   : undefined,
    };
    if (selectedTemplate !== 'auto') body.templateId = selectedTemplate;

    const res = await fetch('/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    currentImageUrl = data.imageUrl;

    document.getElementById('result-img').src = data.imageUrl + '?t=' + Date.now();
    document.getElementById('result-meta').innerHTML = `
      <div class="meta-row">
        <span class="meta-label">Шаблон</span>
        <span class="meta-value"><span class="badge">${data.templateId}</span></span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Заголовок</span>
        <span class="meta-value">${data.title}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Подпись</span>
        <span class="meta-value">${data.subtitle}</span>
      </div>
    `;

    // Сбрасываем блок Sendsay при новой генерации
    const urlBlock = document.getElementById('sendsay-url-block');
    const sendsayBtn = document.getElementById('upload-sendsay-btn');
    if (urlBlock) urlBlock.style.display = 'none';
    if (sendsayBtn) { sendsayBtn.disabled = false; sendsayBtn.textContent = 'В Sendsay ↑'; }

    const resultCard = document.getElementById('result-card');
    resultCard.style.display = 'block';
    setTimeout(() => resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

  } catch (err) {
    showToast('Ошибка: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-sparkles" style="font-size:13px"></i>Сгенерировать баннер';
  }
}

function downloadBanner() {
  if (!currentImageUrl) return;
  const a = document.createElement('a');
  a.href = currentImageUrl;
  a.download = 'banner.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Скачивается…');
}

async function uploadGeneratedBannerToSendsay() {
  console.log('uploadGeneratedBannerToSendsay:', currentImageUrl);
  if (!currentImageUrl) {
    showToast('Сначала сгенерируй баннер');
    return;
  }

  const btn = document.getElementById('upload-sendsay-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const imgRes = await fetch(currentImageUrl);
    if (!imgRes.ok) throw new Error('Не удалось получить изображение');
    const blob = await imgRes.blob();

    const fileName = 'banner_' + Date.now() + '.png';
    const formData = new FormData();
    formData.append('file', blob, fileName);

    const res = await fetch('/api/sendsay/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');

    // Показываем CDN-ссылку
    document.getElementById('sendsay-cdn-url').textContent = data.url;
    document.getElementById('sendsay-url-block').style.display = 'block';

    // Авто-заполняем поле баннера на вкладке Письма
    const bannerInput = document.getElementById('letter-banner-url');
    if (bannerInput) bannerInput.value = data.url;

    showToast('Загружено в Sendsay!');
    btn.textContent = '✓ Загружено';

  } catch (err) {
    showToast('Ошибка: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'В Sendsay ↑';
  }
}

function copySendsayUrl() {
  const url = document.getElementById('sendsay-cdn-url').textContent;
  navigator.clipboard.writeText(url).then(() => showToast('Ссылка скопирована!'));
}
