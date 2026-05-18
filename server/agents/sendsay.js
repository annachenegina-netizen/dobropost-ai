// Sendsay REST API: загрузка файлов + создание черновиков
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
require('dotenv').config();

const BANNERS_DIR = path.join(__dirname, '../../client/images/output');

const API_BASE = 'https://api.sendsay.ru/general/api/v100/json';

let _cachedSession = null;

async function _apiLogin() {
  const body = `apiversion=100&json=1&request=${encodeURIComponent(JSON.stringify({
    action: 'login',
    login:  process.env.SENDSAY_LOGIN,
    passwd: process.env.SENDSAY_PASSWORD,
  }))}`;
  const res = await axios.post(`${API_BASE}/`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const data = res.data;
  if (data.errors || !data.session) {
    throw new Error(`Sendsay login: ${JSON.stringify(data.errors || data)}`);
  }
  console.log('✅ Sendsay API: авторизация прошла');
  return data.session;
}

async function _getSession() {
  if (!_cachedSession) _cachedSession = await _apiLogin();
  return _cachedSession;
}

function _accountId(session) {
  return session.split('/')[0];
}

// Универсальный вызов API с автоматическим ре-логином при протухшей сессии
async function _apiCall(action, params = {}) {
  let session = await _getSession();
  const account = _accountId(session);

  const requestJson = JSON.stringify({ action, ...params });
  const body = `apiversion=100&json=1&request=${encodeURIComponent(requestJson)}`;

  const res = await axios.post(`${API_BASE}/${account}`, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `sendsay session=${session}`,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const data = res.data;

  if (data.errors) {
    const errId = (data.errors[0] || {}).id || '';
    if (errId.includes('session') || errId.includes('auth')) {
      _cachedSession = null;
      return _apiCall(action, params);
    }
    throw new Error(`Sendsay ${action}: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

async function uploadToSendsay(filePath, originalName) {
  const account  = _accountId(await _getSession());
  const fileName = originalName || path.basename(filePath);
  const uploadPath = `/banners/${fileName}`;

  const fileBuffer = fs.readFileSync(filePath);
  console.log(`📤 Загружаю ${fileName}: ${fileBuffer.length} байт`);

  const ext = path.extname(fileName).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
  const mimeType = mimeMap[ext] || 'image/jpeg';

  const data = await _apiCall('rfs.file.put', {
    domain: 'image',
    path:   uploadPath,
    'content-type': mimeType,
    encoding: 'base64',
    data: fileBuffer.toString('base64'),
  });

  const cdnUrl = data.url || `https://eimage.sendsay.ru/image/${account}${uploadPath}`;
  console.log(`✅ Загружено: ${cdnUrl}`);
  return cdnUrl;
}

// Создаёт черновик Email через API (два вызова issue.draft.set)
async function createDraftInSendsay(html, subject, preheader) {
  const ts   = new Date().toLocaleString('ru', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  const base = subject || 'Новый выпуск';
  const name = `${base} (${ts})`;

  // Шаг 1: создаём черновик (relref:9 = тип Email)
  console.log('📨 Создаю черновик в Sendsay...');
  const created = await _apiCall('issue.draft.set', {
    obj: {
      name,
      mark6: -3000,
      dictnode: '',
      relref: 9,
      reltype: -1000,
      letter: { message: { html: '<!-- EMPTY -->' } },
    },
    return_fresh_obj: '1',
  });

  const draftId = created.obj?.id;
  if (!draftId) throw new Error('Sendsay не вернул ID черновика');
  console.log(`📄 Черновик создан, ID: ${draftId}`);

  // Шаг 2: записываем HTML (relref:8 = HTML-редактор)
  await _apiCall('issue.draft.set', {
    id: String(draftId),
    obj: {
      name,
      mark6: -3000,
      dictnode: null,
      docstor: null,
      relref: 8,
      reltype: -1000,
      letter: { message: { html } },
      info: { preheader: preheader || null },
      'dkim.id': null,
      mark5: 0,
    },
    return_fresh_obj: '1',
  });

  const draftUrl = `https://app.sendsay.ru/campaigns/issues/draft-${draftId}`;
  console.log(`✅ Черновик готов: ${draftUrl}`);
  return { ok: true, url: draftUrl };
}

// Принимает относительный URL баннера (/images/output/banner_xxx.png),
// загружает файл в Sendsay CDN и возвращает публичную ссылку
async function uploadBannerToSendsay(imageUrl) {
  const filename = path.basename(imageUrl.split('?')[0]);
  const filePath = path.join(BANNERS_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Баннер не найден на диске: ${filePath}`);
  return uploadToSendsay(filePath, filename);
}

function resetSession() { _cachedSession = null; }

module.exports = { uploadToSendsay, uploadBannerToSendsay, createDraftInSendsay, resetSession };
