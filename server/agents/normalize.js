// Нормализация DOCX-статей через mammoth + AI — порт логики из popup.js расширения
const mammoth = require('mammoth');
const OpenAI = require('openai');
require('dotenv').config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `Ты — нормализатор структуры статей для CMS.
Тебе дают HTML, сконвертированный из DOCX (могут быть разные форматы от разных копирайтеров).
Твоя задача — извлечь данные и вернуть СТРОГО валидный JSON без markdown-блоков, без пояснений.

ПРАВИЛА ИЗВЛЕЧЕНИЯ:
- meta.title: ищи строки вида "Title:", "**Title:**", "Title :" — берёшь значение после двоеточия
- meta.description: ищи "Description:", "**Description:**" — берёшь значение
- h1: ищи "H1:", "**H1:**" — если нет, берёшь текст первого <h1> или самый первый жирный заголовок статьи
- slug: ищи "URL:", "**URL:**" — берёшь только последний сегмент пути (без слэшей). Например из "/top-10-myshy" берёшь "top-10-myshy"
- category: на основе содержания статьи выбери ОДНУ категорию строго из этого списка: "Маркетплейсы/магазины", "Гайды", "Тренды", "Рейтинги", "Полезное". Правила: Алиэкспресс/Таобао/Гуфиш/маркетплейсы → "Маркетплейсы/магазины"; ТОП-10/рейтинг/лучшие → "Рейтинги"; как выбрать/руководство/гайд → "Гайды"; тренды/новинки → "Тренды"; остальное → "Полезное"
- faq: массив {question, answer} — ОБЯЗАТЕЛЬНО ищи секцию FAQ / "Часто задаваемые вопросы". Помещай ТОЛЬКО в faq[], НЕ в blocks.
- blocks: массив блоков контента (без мета-тегов, без FAQ)

ТИПЫ БЛОКОВ:
- {"type":"title","text":"...","level":2} — h2/h3 заголовки и жирные параграфы-заголовки разделов
- {"type":"paragraph","text":"..."} — обычный текст
- {"type":"list","items":["...", "..."]} — маркированные/нумерованные списки. items — массив строк
- {"type":"divider"} — вставляй АВТОМАТИЧЕСКИ перед каждым title-блоком, кроме первого
- {"type":"image","src":"__IMG_0__","alt":"..."} — ВАЖНО: в HTML есть <img src="__IMG_0__">, <img src="__IMG_1__"> и т.д. Каждый такой тег ОБЯЗАТЕЛЬНО превращай в image-блок. Плейсхолдер в src не изменяй.
- {"type":"conversion"} — вставь ОДИН РАЗ примерно в середине статьи, после divider перед title
- {"type":"contact_form"} — вставь ОДИН РАЗ последним элементом в blocks

ВАЖНО:
- Мета-параграфы (Title:, Description:, H1:, URL:) → НЕ включать в blocks
- Сохраняй ВСЕ текстовые блоки полностью, ничего не обрезай
- ИГНОРИРУЙ: glvrd.ru, turgenev.ashmanov.com, text.ru, istio.com и строки "Читаемость/Частота/Уникальность https://..."
- Отвечай ТОЛЬКО валидным JSON без пояснений.

СТРУКТУРА:
{
  "h1": "...",
  "slug": "...",
  "category": "...",
  "meta": {"title": "...", "description": "..."},
  "faq": [{"question": "...", "answer": "..."}],
  "blocks": [...]
}`;

function extractImages(html) {
  const imageMap = {};
  let idx = 0;
  const result = html.replace(/<img([^>]*)src="(data:[^"]+)"([^>]*)>/gi, (match, before, src, after) => {
    const alt = (match.match(/alt="([^"]*)"/) || [])[1] || '';
    const placeholder = `__IMG_${idx}__`;
    imageMap[placeholder] = { src, alt };
    idx++;
    return `<img${before}src="${placeholder}"${after}>`;
  });
  return { strippedHtml: result, imageMap };
}

function cleanupHtml(html) {
  let h = html;
  h = h.replace(/<a[^>]*href="[^"]*(?:glvrd|turgenev|text\.ru|istio|antiplagiat)[^"]*"[^>]*>.*?<\/a>/gi, '');
  h = h.replace(/<p[^>]*>https?:\/\/\S+<\/p>/gi, '');
  h = h.replace(/<p[^>]*>\s*(?:Читаемость|Частота|Уникальность)\s+https?:\/\/.*?<\/p>/gi, '');
  h = h.replace(/<p[^>]*>\s*<\/p>/gi, '');
  return h;
}

function restoreImages(data, imageMap) {
  if (!imageMap || !Object.keys(imageMap).length) return;
  const blocks = data.blocks || [];
  const used = new Set();

  for (const block of blocks) {
    if (block.type === 'image' && imageMap[block.src]) {
      const entry = imageMap[block.src];
      used.add(block.src);
      block.src = entry.src;
      block.alt = block.alt || entry.alt;
    }
    if ((block.type === 'paragraph' || block.type === 'title') && block.text) {
      const m = block.text.match(/(__IMG_\d+__)/);
      if (m && imageMap[m[1]]) {
        used.add(m[1]);
        block.type = 'image';
        block.src  = imageMap[m[1]].src;
        block.alt  = imageMap[m[1]].alt || '';
        delete block.text;
        delete block.level;
      }
    }
  }

  const remaining = Object.keys(imageMap)
    .filter(p => !used.has(p))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);

  const step = Math.max(1, Math.floor(blocks.length / (remaining.length + 1)));
  for (let i = remaining.length - 1; i >= 0; i--) {
    const pos = Math.min((i + 1) * step, blocks.length);
    blocks.splice(pos, 0, { type: 'image', src: imageMap[remaining[i]].src, alt: imageMap[remaining[i]].alt || '' });
  }
  data.blocks = blocks;
  data.content = blocks;
}

function fixFaqFromBlocks(data) {
  const blocks = data.blocks || [];
  let faqIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const t = (blocks[i].text || '').toLowerCase();
    if (t === 'faq' || t.includes('часто задаваемые') || t.includes('вопросы и ответы')) { faqIdx = i; break; }
  }
  if (faqIdx === -1) return;
  const faqContent = blocks.splice(faqIdx, blocks.length - faqIdx).slice(1);
  const items = [];
  let q = '';
  for (const b of faqContent) {
    const t = b.text || '';
    if (!t.trim()) continue;
    if (!q) { q = t; } else { items.push({ question: q, answer: t }); q = ''; }
  }
  if (q) items.push({ question: q, answer: '—' });
  if (items.length) data.faq = [...(data.faq || []), ...items];
  data.content = blocks;
  data.blocks  = blocks;
}

function tryFixJson(text) {
  let braces = 0, brackets = 0, inStr = false, esc = false;
  for (const ch of text) {
    if (esc)  { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"')  { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') braces++; else if (ch === '}') braces--;
    else if (ch === '[') brackets++; else if (ch === ']') brackets--;
  }
  let fixed = text.trimEnd().replace(/,\s*$/, '');
  if (inStr) fixed += '"';
  for (let i = 0; i < brackets; i++) fixed += ']';
  for (let i = 0; i < braces; i++) fixed += '}';
  return fixed;
}

async function normalizeDocx(buffer) {
  // 1. mammoth → HTML с base64 картинками
  const { value: rawHtml } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.inline(async img => {
        const b64 = await img.read('base64');
        return { src: `data:${img.contentType};base64,${b64}` };
      })
    }
  );

  if (!rawHtml.trim()) throw new Error('DOCX пустой или нечитаемый');

  // 2. Извлекаем картинки, чистим HTML
  const { strippedHtml, imageMap } = extractImages(rawHtml);
  const cleanHtml = cleanupHtml(strippedHtml);

  console.log(`  📝 HTML: ${rawHtml.length} симв., картинок: ${Object.keys(imageMap).length}`);

  // 3. AI нормализация
  const inputHtml = cleanHtml.length > 40000 ? cleanHtml.slice(0, 40000) + '\n<!-- ОБРЕЗАНО -->' : cleanHtml;

  const message = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 16000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Нормализуй этот HTML статьи:\n\n${inputHtml}` }
    ],
    response_format: { type: 'json_object' }
  });

  let raw = (message.choices[0].message.content || '').trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { try { parsed = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); }
    catch { try { parsed = JSON.parse(tryFixJson(raw)); }
      catch { throw new Error('AI вернул невалидный JSON'); }
    }
  }

  parsed.h1      = parsed.h1 || '';
  parsed.slug    = parsed.slug || '';
  parsed.meta    = parsed.meta || { title: '', description: '' };
  parsed.faq     = Array.isArray(parsed.faq)    ? parsed.faq    : [];
  parsed.blocks  = Array.isArray(parsed.blocks) ? parsed.blocks : [];
  parsed.content = parsed.blocks;

  // 4. Восстанавливаем картинки + фиксим FAQ
  restoreImages(parsed, imageMap);
  fixFaqFromBlocks(parsed);

  const imgCount = (parsed.blocks || []).filter(b => b.type === 'image').length;
  console.log(`  ✅ Нормализовано: ${parsed.blocks.length} блоков, ${parsed.faq.length} FAQ, ${imgCount} картинок`);

  return parsed;
}

module.exports = { normalizeDocx };
