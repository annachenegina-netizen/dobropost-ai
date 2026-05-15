// Puppeteer-агент для заливки статей в CRM stgpr-crm.dobropost.com
const puppeteer = require('puppeteer');
const path = require('path');
const fs   = require('fs');
require('dotenv').config();

const SESSION_DIR = path.join(__dirname, '../../.crm-session');
const TMP_DIR     = path.join(__dirname, '../../.tmp-uploads');
const LOGIN_URL   = 'https://stgpr-crm.dobropost.com/login';
const BLOG_URL    = 'https://stgpr-crm.dobropost.com/blog';
const CRM_EMAIL   = 'creator@dobropost.com';
const CRM_PASS    = '123qweasd';

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Нативный клик через Puppeteer CDP (trusted event, работает с Vue) ──
async function clickTab(page, text) {
  const tabs = await page.$$('.builder-tab-btn');
  for (const tab of tabs) {
    const t = await tab.evaluate(el => el.textContent.trim());
    if (t.includes(text)) { await tab.click(); return true; }
  }
  return false;
}

async function clickSidebarBtn(page, text) {
  const btns = await page.$$('.builder-element-btn');
  for (const btn of btns) {
    const t = await btn.evaluate(el => el.textContent.trim());
    if (t.includes(text)) { await btn.click(); return true; }
  }
  return false;
}

// ── ЛОГИН ────────────────────────────────────────────────────────
async function _login(page) {
  console.log('🔐 Авторизация в CRM...');
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await page.waitForSelector('input[type="email"],input[type="text"]', { timeout: 10_000 });

  const emailInp = await page.$('input[type="email"]') || await page.$('input[type="text"]');
  const passInp  = await page.$('input[type="password"]');
  if (!emailInp || !passInp) throw new Error('Форма входа в CRM не найдена');

  await emailInp.click({ clickCount: 3 });
  await emailInp.type(CRM_EMAIL, { delay: 30 });
  await passInp.click({ clickCount: 3 });
  await passInp.type(CRM_PASS,   { delay: 30 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }),
    passInp.press('Enter'),
  ]);
  console.log('✅ Авторизован в CRM');
}

// ── ЗАПОЛНЕНИЕ CONTENT BLOCKS ─────────────────────────────────────
async function _fillBuilder(page, data, imageQueue, log) {
  const D = 400;

  await clickTab(page, 'Content');
  await sleep(D);

  // H1
  if (data.h1) {
    await page.evaluate((h1) => {
      const inp = document.querySelector('#page-title');
      if (!inp) return;
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(inp, h1);
      inp.dispatchEvent(new Event('input',  { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, data.h1);
    log(`✅ H1: ${data.h1.slice(0, 60)}`);
  }

  // Description (Quill)
  const desc = data.meta?.description || data.description || '';
  if (desc) {
    await page.evaluate((text) => {
      const ed = document.querySelector('.ql-editor');
      if (!ed) return;
      ed.focus();
      ed.innerHTML = `<p>${text}</p>`;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      const c = ed.closest('.ql-container');
      if (c?.__quill) { c.__quill.root.innerHTML = `<p>${text}</p>`; c.__quill.update(); }
    }, desc);
    log('✅ Description заполнен');
  }
  await sleep(D);

  // ── БЛОКИ ────────────────────────────────────────────────────
  const blocks = (data.content?.length ? data.content : data.blocks) || [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (!block || !block.type) continue;

    // ── DIVIDER ──
    if (block.type === 'divider') {
      await clickSidebarBtn(page, 'Divider');
      await sleep(D);
      continue;
    }

    // ── TITLE ──
    if (block.type === 'title') {
      if (!block.text?.trim()) continue;
      await clickSidebarBtn(page, 'Title');
      await sleep(D * 1.5);
      await page.evaluate((text) => {
        const all = document.querySelectorAll(
          '.builder-canvas-inner input[type="text"],.builder-canvas-inner input:not([type])'
        );
        const inp = all[all.length - 1];
        if (!inp) return;
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        s.call(inp, text);
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }, block.text);
      log(`✅ Title: ${block.text.slice(0, 50)}`);
      continue;
    }

    // ── PARAGRAPH ──
    if (block.type === 'paragraph') {
      if (!block.text?.trim()) continue;
      await clickSidebarBtn(page, 'Paragraph');
      await sleep(D * 1.5);
      await page.evaluate((text) => {
        const all = document.querySelectorAll('.builder-canvas-inner textarea');
        const ta  = all[all.length - 1];
        if (!ta) return;
        const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        s.call(ta, text);
        ta.dispatchEvent(new Event('input',  { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }, block.text);
      log(`✅ Paragraph: ${block.text.slice(0, 50)}`);
      continue;
    }

    // ── LIST ──
    if (block.type === 'list') {
      const items = Array.isArray(block.items)
        ? block.items.filter(i => typeof i === 'string' && i.trim())
        : (block.text || '').split('\n').filter(i => i.trim());
      if (!items.length) continue;

      const before = await page.evaluate(
        () => document.querySelectorAll('.builder-canvas-inner .builder-block').length
      );
      await clickSidebarBtn(page, 'List');
      await sleep(500);

      // Ждём появления нового блока
      for (let i = 0; i < 20; i++) {
        const count = await page.evaluate(
          () => document.querySelectorAll('.builder-canvas-inner .builder-block').length
        );
        if (count > before) break;
        await sleep(150);
      }

      // Кликаем на блок через Puppeteer native click
      const allBlocks = await page.$$('.builder-canvas-inner .builder-block');
      if (allBlocks.length === 0) { log(`⚠️ List: блок не появился (bi=${bi})`); continue; }
      await allBlocks[allBlocks.length - 1].click();
      await sleep(400);

      // Заполняем items через evaluate (только установка значений — trusted event не нужен)
      const panelResult = await page.evaluate(async (items) => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const sI = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        let panel = null;
        for (let i = 0; i < 15; i++) {
          panel = document.querySelector('.inline-props-panel');
          if (panel?.querySelector('.list-item-row')) break;
          await sleep(150);
        }
        if (!panel?.querySelector('.list-item-row')) return 'no-panel';

        const fillItem = (idx, text) => {
          const rows = panel.querySelectorAll('.list-item-row');
          const inp  = rows[idx]?.querySelector('input[type="text"]');
          if (!inp) return false;
          sI.call(inp, text);
          inp.dispatchEvent(new Event('input',  { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };

        fillItem(0, items[0]);
        const addBtn = panel.querySelector('.list-action-add');
        for (let i = 1; i < items.length; i++) {
          if (!addBtn) break;
          addBtn.click();
          await sleep(150);
          fillItem(i, items[i]);
        }
        return 'ok';
      }, items);

      log(`✅ List: ${items.length} пунктов (${panelResult})`);
      continue;
    }

    // ── CONVERSION ──
    if (block.type === 'conversion') {
      await clickSidebarBtn(page, 'Conversion');
      await sleep(D);
      log('✅ Conversion добавлен');
      continue;
    }

    // ── CONTACT FORM ──
    if (block.type === 'contact_form') {
      await clickSidebarBtn(page, 'Contact Form');
      await sleep(D);
      log('✅ Contact Form добавлен');
      continue;
    }

    // ── IMAGE ──
    if (block.type === 'image') {
      if (!block.src || block.src === '__SKIP_IMG__') continue;

      const before = await page.evaluate(
        () => document.querySelectorAll('.builder-canvas-inner .builder-block').length
      );
      await clickSidebarBtn(page, 'Image');
      await sleep(500);

      for (let i = 0; i < 20; i++) {
        const count = await page.evaluate(
          () => document.querySelectorAll('.builder-canvas-inner .builder-block').length
        );
        if (count > before) break;
        await sleep(200);
      }

      const blockIdx = await page.evaluate(
        () => document.querySelectorAll('.builder-canvas-inner .builder-block').length - 1
      );
      imageQueue.push({ blockIndex: blockIdx, src: block.src, alt: block.alt || '' });
      log(`📌 Image #${blockIdx} добавлен`);
      continue;
    }

    await sleep(D * 0.3);
  }
}

// ── ЗАГРУЗКА КАРТИНОК (второй проход) ────────────────────────────
async function _uploadImages(page, imageQueue, log) {
  if (!imageQueue.length) return;
  log(`⏳ Заливаю ${imageQueue.length} картинок...`);
  const tmpFiles = [];

  for (const item of imageQueue) {
    const allBlocks = await page.$$('.builder-canvas-inner .builder-block');
    const targetBlock = allBlocks[item.blockIndex];
    if (!targetBlock) { log(`⚠️ Блок #${item.blockIndex} не найден`); continue; }

    await targetBlock.click();
    await sleep(400);

    let fileInputHandle = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      fileInputHandle = await page.$('.inline-props-panel input[type="file"][accept*="image"]')
                     || await page.$('input[type="file"][accept*="image"]');
      if (fileInputHandle) break;
      await sleep(150);
    }
    if (!fileInputHandle) { log(`⚠️ File input для блока #${item.blockIndex} не найден`); continue; }

    try {
      const base64 = item.src.split(',')[1];
      const mime   = item.src.match(/data:([^;]+);/)?.[1] || 'image/png';
      const ext    = mime.split('/')[1] || 'png';
      const tmpPath = path.join(TMP_DIR, `blog_img_${Date.now()}_${item.blockIndex}.${ext}`);
      fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
      tmpFiles.push(tmpPath);
      await fileInputHandle.uploadFile(tmpPath);
      await sleep(2000);
      log(`✅ Image #${item.blockIndex} залит`);
    } catch (e) {
      log(`⚠️ Image #${item.blockIndex}: ${e.message}`);
    }
  }

  for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) {} }
}

// ── SETTINGS ──────────────────────────────────────────────────────
async function _fillSettings(page, data, log) {
  await clickTab(page, 'Settings');
  await sleep(500);

  if (data.slug) {
    await page.evaluate((slug) => {
      const inp = document.querySelector('.slug-input');
      if (!inp) return;
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(inp, slug);
      inp.dispatchEvent(new Event('input',  { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, data.slug);
    log(`✅ Slug: ${data.slug}`);
  }

  if (data.category) {
    await page.evaluate((category) => {
      const sel = document.querySelector('.settings-section select.form-input');
      if (!sel) return;
      for (const opt of sel.querySelectorAll('option')) {
        if (opt.value === category || opt.textContent.trim() === category) {
          const s = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          s.call(sel, opt.value);
          sel.dispatchEvent(new Event('input',  { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }, data.category);
    log(`✅ Категория: ${data.category}`);
  }
}

// ── FAQ ───────────────────────────────────────────────────────────
async function _fillFaq(page, faq, log) {
  if (!faq?.length) return;

  await clickTab(page, 'FAQ');
  await sleep(600);

  await page.evaluate(async (faqItems) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const sI  = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,   'value').set;
    const sTA = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;

    const getAddBtn = () =>
      document.querySelector('.faq-list')?.closest('.card')?.querySelector('.card-header .btn-primary')
      || document.querySelector('.card-header .btn-primary');

    const initialCount = document.querySelectorAll('.faq-item').length;
    const needToAdd = Math.max(0, faqItems.length - initialCount);

    for (let a = 0; a < needToAdd; a++) {
      const btn = getAddBtn();
      if (!btn) break;
      btn.click();
      for (let w = 0; w < 15; w++) {
        await sleep(150);
        if (document.querySelectorAll('.faq-item').length >= initialCount + a + 1) break;
      }
    }
    await sleep(300);

    const allItems = document.querySelectorAll('.faq-item');
    for (let i = 0; i < faqItems.length; i++) {
      const item = allItems[i];
      if (!item) continue;
      const qInp = item.querySelector('input.form-input[placeholder="Enter question..."]');
      const aTA  = item.querySelector('textarea.form-textarea[placeholder="Enter answer..."]');
      if (qInp) { sI.call(qInp,  faqItems[i].question); qInp.dispatchEvent(new Event('input', { bubbles: true })); }
      if (aTA)  { sTA.call(aTA,  faqItems[i].answer);   aTA.dispatchEvent(new Event('input',  { bubbles: true })); }
    }
  }, faq);

  log(`✅ FAQ: ${faq.length} вопросов`);
}

// ── METADATA ──────────────────────────────────────────────────────
async function _fillMeta(page, meta, log) {
  if (!meta) return;

  await clickTab(page, 'Metadata');
  await sleep(500);

  await page.evaluate((meta) => {
    const sI  = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,   'value').set;
    const sTA = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const fill = (sel, val) => {
      if (!val) return;
      const el = document.querySelector(sel);
      if (!el) return;
      if (el.tagName === 'TEXTAREA') { sTA.call(el, val); } else { sI.call(el, val); }
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    fill('input[placeholder="SEO Title tag"]',             meta.title);
    fill('textarea[placeholder="SEO Description tag"]',    meta.description);
    fill('input[placeholder="Open Graph Title"]',          meta.title);
    fill('textarea[placeholder="Open Graph Description"]', meta.description);
    fill('input[placeholder="Facebook Title"]',            meta.title);
    fill('textarea[placeholder="Facebook Description"]',   meta.description);
    fill('input[placeholder="Twitter Title"]',             meta.title);
    fill('textarea[placeholder="Twitter Description"]',    meta.description);
  }, meta);

  log('✅ Metadata заполнена');
}

// ── SAVE DRAFT ────────────────────────────────────────────────────
async function _saveArticle(page, log) {
  const saved = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const draft = btns.find(b => /save\s*draft/i.test(b.textContent.trim()) && !b.disabled);
    if (draft) { draft.click(); return draft.textContent.trim(); }
    for (const t of ['Save', 'Сохранить']) {
      const btn = btns.find(b => b.textContent.trim().includes(t) && !b.disabled);
      if (btn) { btn.click(); return btn.textContent.trim(); }
    }
    return null;
  });

  if (saved) { await sleep(1500); log(`✅ Сохранено: "${saved}"`); }
  else log('⚠️ Кнопка "Save draft" не найдена');
}

// ── ГЛАВНАЯ ФУНКЦИЯ ───────────────────────────────────────────────
async function fillCRM(articleData, onProgress) {
  const log = msg => { console.log('[blog]', msg); if (onProgress) onProgress(msg); };
  const imageQueue = [];

  function findChrome() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    if (process.platform === 'win32') {
      const candidates = [
        process.env.PROGRAMFILES  + '\\Google\\Chrome\\Application\\chrome.exe',
        process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
        (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
      ];
      for (const p of candidates) if (p && require('fs').existsSync(p)) return p;
    }
    return undefined;
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: findChrome(),
    userDataDir: SESSION_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();

  try {
    await page.goto(BLOG_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
    if (!page.url().includes('/blog')) {
      await _login(page);
      await page.goto(BLOG_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
    }

    log('📋 Нажимаю "Create Blog Page"...');
    const navPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => null);
    const clicked = await page.evaluate(() => {
      for (const b of document.querySelectorAll('button.btn-primary')) {
        if (b.textContent.trim().includes('Create Blog Page')) { b.click(); return true; }
      }
      return false;
    });
    if (!clicked) throw new Error('Кнопка "Create Blog Page" не найдена');

    await navPromise;
    await sleep(2000);

    const builderUrl = page.url();
    log(`🏗️ Builder: ${builderUrl}`);
    if (!builderUrl.includes('/builder')) {
      await page.waitForSelector('.builder-tab-btn, #page-title', { timeout: 10_000 });
    }

    await _fillBuilder(page, articleData, imageQueue, log);
    await sleep(400);

    await _uploadImages(page, imageQueue, log);
    await _fillSettings(page, articleData, log);
    await _fillFaq(page, articleData.faq || [], log);
    await _fillMeta(page, articleData.meta || null, log);
    await _saveArticle(page, log);

    log('🎉 Статья залита в CRM!');
    return { success: true, url: page.url() };

  } catch (err) {
    log(`❌ Ошибка: ${err.message}`);
    throw err;
  } finally {
    await sleep(1000);
    await browser.close();
  }
}

module.exports = { fillCRM };
