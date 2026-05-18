// Обёртка для анализа писем через AI
// Сейчас используем OpenAI, потом переключимся на Claude (раскомментировать ниже)
const OpenAI = require('openai');
// const Anthropic = require('@anthropic-ai/sdk'); // <- Claude (включить позже)
require('dotenv').config();

const getClient = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Надёжный парсер JSON из ответа AI: убирает markdown-обёртку и берёт первый объект
function _parseJson(raw) {
  let s = raw.replace(/^```[a-z]*\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`JSON parse error: ${e.message} | raw: ${s.slice(0, 200)}`);
  }
}
// const getClient = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); // <- Claude

// Описания шаблонов — AI выбирает из этого списка
const TEMPLATES = {
  'nahodki-1':        'Находки / подборка товаров (жёлтый, мужчина с цветными пакетами)',
  'nahodki-2':        'Находки / подарки / посылки (жёлтый, подарочные коробки)',
  'nahodki-3':        'Находки / шопинг (жёлтый, девушка с пакетами)',
  'nahodki-4':        'Находки / кешбэк / карта (жёлтый, девушка с картой и пакетами)',
  'nahodki-5':        'Находки / монеты / бонусы (оранжевый, монеты и сумка на ладони)',
  'nahodki-6':        'Находки / приложение / заказы (оранжевый, телефон с магазином)',
  'nahodki-7':        'Находки / товары DobroPost (оранжевый, кроссовки + телефон + сумка)',
  'nahodki-prazdnik': 'Находки праздничные / Новый год (оранжевый, ёлка + подарки)',
  'community-1':      'Комьюнити / общение / отзывы (жёлтый, мужчина с речевым пузырём)',
  'community-2':      'Комьюнити / диалог / обсуждение (оранжевый, двое с пузырями)',
  'community-3':      'Комьюнити / сообщество / мир (оранжевый, руки обнимают глобус)',
  'community-4':      'Комьюнити / рассылка / письмо (оранжевый, бумажный самолётик)',
  'gayd-1':           'Гайд / обучение / инструкция (оранжевый, тех-иллюстрация с иконками)',
  'prazdnik-1':       'Праздник / Хэллоуин / акция (оранжевый, игровые элементы + %)',
  'novinka-1':        'Новинка / новая функция / обновление (тёмный, ноутбук + покупки)',
  'polezno-1':        'Полезно / лайфхак / как сэкономить (жёлтый, бейдж Полезно)',
  'akciya-1':         'Акция / быстрая доставка / спецпредложение (оранжевый, бегущий курьер)',
  'akciya-2':         'Акция / скидка / распродажа (оранжевый, ценник % + молния)',
  'akciya-3':         'Акция / шопинг / телефон (жёлтый, смартфоны с пакетами + %)',
  'stil-1':           'Стиль / мода / одежда (светлый фон, вешалка с вещами)',
};

// Анализирует текст письма и возвращает параметры для баннера.
// forcedTemplateId — если передан, AI только генерирует текст, шаблон не выбирает.
async function analyzeLetter(letterText, forcedTemplateId = null, maxTitleWords = 6, maxSubWords = 10) {
  let prompt;

  if (forcedTemplateId) {
    prompt = `Ты получаешь текст email-письма для интернет-магазина DobroPost.
Твоя задача — вытащить из него заголовок и подзаголовок для баннера.

Правила:
- Заголовок: максимум ${maxTitleWords} слов, точно из смысла письма, без выдумок
- Подзаголовок: максимум ${maxSubWords} слов, уточняет заголовок, без выдумок

Текст письма:
${letterText}

Верни ТОЛЬКО JSON без пояснений и markdown:
{"title": "...", "subtitle": "..."}`;
  } else {
    const templateList = Object.entries(TEMPLATES)
      .map(([id, desc]) => `- ${id}: ${desc}`)
      .join('\n');

    prompt = `Ты получаешь текст email-письма для интернет-магазина DobroPost.
Твоя задача — вытащить из него заголовок и подзаголовок для баннера, и выбрать подходящий шаблон.

Правила:
- Заголовок: максимум ${maxTitleWords} слов, точно из смысла письма, без выдумок
- Подзаголовок: максимум ${maxSubWords} слов, уточняет заголовок, без выдумок
- Выбери один шаблон из списка по смыслу письма

Доступные шаблоны:
${templateList}

Текст письма:
${letterText}

Верни ТОЛЬКО JSON без пояснений и markdown:
{"templateId": "...", "title": "...", "subtitle": "..."}`;
  }

  const message = await getClient().chat.completions.create({
    model: process.env.MODEL_MAIN || 'gpt-4o-mini',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = message.choices[0].message.content.trim();
  const result = _parseJson(raw);

  if (forcedTemplateId) {
    result.templateId = forcedTemplateId;
  } else if (!TEMPLATES[result.templateId]) {
    throw new Error(`Неизвестный шаблон: ${result.templateId}`);
  }

  return result;
}

// Генерирует контент HTML-письма из произвольного текста.
// Возвращает { html, subject, preheader }
async function generateEmailHtml(letterText, bannerUrl = null) {
  const prompt = `Ты получаешь текст email-письма для интернет-магазина DobroPost.
Разбери его на структурированные данные для HTML-вёрстки.

Правила:
- subject: тема письма, до 60 символов
- preheader: короткий превью-текст, до 90 символов
- intro: вступительная фраза письма, 1–2 предложения
- blocks: массив 2–4 контент-блоков, каждый:
  - type: "dark" (важный/featured блок, тёмный фон) или "light" (обычный, белый фон)
  - badge: короткий ярлык вверху, до 3 слов (пустая строка если не нужен)
  - title: заголовок блока, до 40 символов
  - text: текст блока, 1–3 предложения
  - cta_text: текст кнопки внутри блока, до 20 символов (пустая строка если не нужна)
  - cta_url: ссылка кнопки внутри блока ("#" если нет)
- cta_text: главная кнопка CTA внизу письма, до 20 символов
- cta_url: главная ссылка CTA из письма ("#" если нет)

Текст письма:
${letterText}

Верни ТОЛЬКО JSON без пояснений и markdown:
{"subject":"...","preheader":"...","intro":"...","blocks":[{"type":"dark","badge":"","title":"...","text":"...","cta_text":"","cta_url":"#"}],"cta_text":"...","cta_url":"..."}`;

  const message = await getClient().chat.completions.create({
    model: process.env.MODEL_MAIN || 'gpt-4o-mini',
    max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.choices[0].message.content.trim();
  const data = _parseJson(raw);

  const html = _buildEmailTemplate(data, bannerUrl);
  return { html, subject: data.subject, preheader: data.preheader };
}

function _buildEmailTemplate({ subject, preheader, intro, blocks = [], cta_text, cta_url }, bannerUrl = null) {
  const blocksHtml = blocks.map(b => {
    const isDark = b.type === 'dark';
    const bg        = isDark ? '#171717' : '#FFFFFF';
    const titleClr  = isDark ? '#FFFFFF' : '#171717';
    const textClr   = isDark ? '#CCCCCC' : '#555555';

    const badgeHtml = b.badge ? `
              <tr>
                <td align="left" style="font:400 14px/18px 'Roboto', Arial, Helvetica, sans-serif; color:#FDBD40; text-transform:uppercase; letter-spacing:1px;">
                  ${b.badge}
                </td>
              </tr>
              <tr><td height="12" style="height:12px;"></td></tr>` : '';

    const btnHtml = b.cta_text ? `
              <tr><td height="16" style="height:16px;"></td></tr>
              <tr>
                <td align="left">
                  <a href="${b.cta_url || '#'}" target="_blank" style="display:inline-block; background-color:#FDBD40; color:#171717; font:700 16px/20px 'Montserrat', Arial, sans-serif; text-decoration:none; padding:12px 24px; border-radius:10px;">
                    ${b.cta_text}
                  </a>
                </td>
              </tr>` : '';

    return `
            <tr>
              <td bgcolor="${bg}" style="padding:28px 24px; background-color:${bg}; border-radius:20px;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tbody>
                    ${badgeHtml}
                    <tr>
                      <td align="left" style="font:700 22px/28px 'Roboto', Arial, Helvetica, sans-serif; color:${titleClr};">
                        ${b.title}
                      </td>
                    </tr>
                    <tr><td height="16" style="height:16px;"></td></tr>
                    <tr>
                      <td align="left" style="font:400 16px/24px 'Roboto', Arial, Helvetica, sans-serif; color:${textClr};">
                        ${b.text}
                      </td>
                    </tr>
                    ${btnHtml}
                  </tbody>
                </table>
              </td>
            </tr>
            <tr><td height="24" style="height:24px;"></td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv="content-type" content="text/html; charset=utf-8">
<link href="https://fonts.googleapis.com" rel="preconnect">
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap" rel="stylesheet">
<title>${subject}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style type="text/css">
  a { outline: none; color: #0056ff; text-decoration: underline; }
  a:hover { text-decoration: none !important; }
  a img { border: none; }
  b, strong { font-weight: 700; }
  p { margin: 0; }
  th { padding: 0; }
  table td { mso-line-height-rule: exactly; }
  [style*="Montserrat"] { font-family: 'Montserrat', Verdana, Roboto, Geneva, sans-serif !important; }
  @media only screen and (max-width:617px) {
    .w-100p { width: 100% !important; }
    .plr-20 { padding-left: 20px !important; padding-right: 20px !important; }
    .tflex { display: block !important; width: 100% !important; }
    .ta-c { text-align: center !important; }
    .fs { font: 700 20px/24px 'Montserrat' !important; }
    .fs-18 { font-size: 18px !important; line-height: 22px !important; }
  }
  @media (prefers-dark-interface) { body { -apple-color-filter: none; } }
</style>
</head>
<body style="background: rgb(237, 237, 237); margin: 0px; padding: 0px; text-size-adjust: 100%;">
  <!-- preview text start -->
  <div style="display: none; max-height: 0px; overflow: hidden;">${preheader}</div>
  <div style="display: none; max-height: 0px; overflow: hidden;">⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀</div>
  <!-- preview text stop -->

  <table cellpadding="0" cellspacing="0" style="background: #EDEDED; min-width: 320px;" width="100%">
    <tbody>
      <tr>
        <td>
          <table align="center" cellpadding="0" cellspacing="0" class="w-100p" style="background: #FFFFFF; max-width: 600px;" width="600">
            <tbody>

              <!-- HEADER -->
              <tr>
                <td style="background: #ffffff; padding: 14px 30px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tbody>
                      <tr>
                        <th class="tflex" width="195" align="left" style="vertical-align: top; padding: 0;">
                          <a rel="noreferrer" style="text-decoration: none;" href="https://dobropost.com/">
                            <img src="http://eimage.sendsay.ru/image/x_1738046276570567/zip/7262011738935065/logo1.png" width="70" style="vertical-align: top; border: none;" alt="DobroPost">
                          </a>
                        </th>
                        <th class="tflex" width="1" height="10"></th>
                        <th class="tflex" align="left">
                          <table align="right" cellpadding="0" cellspacing="0">
                            <tbody>
                              <tr>
                                <td align="center" style="font: 600 12px/17px 'Montserrat', Verdana, Roboto, Geneva, sans-serif;">
                                  <a rel="noreferrer" href="https://dobropost.com/#tariffs" style="text-decoration: none;">
                                    <img alt="Тарифы и сроки" src="http://eimage.sendsay.ru/image/x_1738046276570567/zip/7262011738935065/logo2.png" style="padding-left: 30px; width: 149px; vertical-align: top;" width="149">
                                  </a>
                                </td>
                                <td width="25"></td>
                                <td align="center" style="font: 600 12px/17px 'Montserrat', Verdana, Roboto, Geneva, sans-serif;">
                                  <a rel="noopener noreferrer" href="https://sklad.dobropost.com/login" style="text-decoration: none;">
                                    <img alt="Личный кабинет" src="http://eimage.sendsay.ru/image/x_1738046276570567/zip/7262011738935065/logo3.png" style="width: 173px; vertical-align: top;" width="173">
                                  </a>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </th>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>

              <!-- BANNER -->
              <tr>
                <td style="padding: 0;">
                  ${bannerUrl
                    ? `<img src="${bannerUrl}" width="600" alt="${subject}" style="width:100%;max-width:600px;height:auto;display:block;border:none;">`
                    : `<table width="100%" cellpadding="0" cellspacing="0"><tbody><tr>
                        <td bgcolor="#F9E758" style="background-color:#F9E758;padding:32px 40px;">
                          <span style="font:700 30px/36px 'Montserrat',Arial,sans-serif;color:#1D2B37;">${subject}</span>
                        </td>
                       </tr></tbody></table>`
                  }
                </td>
              </tr>

              <!-- BODY -->
              <tr>
                <td class="plr-20" bgcolor="#F9FAFB" style="padding:40px; background-color:#F9FAFB;">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tbody>

                      <tr>
                        <td align="left" style="font:400 18px/26px 'Roboto', Arial, Helvetica, sans-serif; color:#171717;">
                          ${intro}
                        </td>
                      </tr>

                      <tr><td height="32" style="height:32px;"></td></tr>

                      ${blocksHtml}

                      <tr>
                        <td align="center">
                          <a href="${cta_url || '#'}" target="_blank" style="display:inline-block; background-color:#FDBD40; color:#171717; font:700 18px/22px 'Montserrat', Arial, sans-serif; text-decoration:none; padding:16px 32px; border-radius:12px;">
                            ${cta_text}
                          </a>
                        </td>
                      </tr>

                    </tbody>
                  </table>
                </td>
              </tr>

              <!-- FOOTER -->
              <tr>
                <td bgcolor="#1D1D1D" style="background: #1D1D1D; padding: 30px 0;">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tbody>
                      <tr>
                        <td class="fs" bgcolor="#F9E758" align="center" valign="top" style="background-color: #F9E758; font: 700 37px/40px Montserrat, Verdana, Roboto, Geneva, sans-serif; color: #1D2B37; padding: 15px 0 10px;">
                          DobroPost<br>
                          <span class="fs-18" style="font: 500 20px/24px 'Montserrat', Verdana, Roboto, Geneva, sans-serif; color: #1D2B37;">Самая быстрая доставка посылок из Китая</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 15px 30px 0;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tbody>
                              <tr>
                                <td style="padding: 0 0 30px;">
                                  <table width="100%" cellpadding="0" cellspacing="0">
                                    <tbody>
                                      <tr>
                                        <th class="tflex" width="269" align="left" style="vertical-align: top;">
                                          <table width="100%" cellpadding="0" cellspacing="0">
                                            <tbody>
                                              <tr>
                                                <td align="center" style="font: 700 20px/24px 'Montserrat', Verdana, Roboto, Geneva, sans-serif; color: #ffffff; padding: 30px 0 20px;">МЫ В СОЦИАЛЬНЫХ СЕТЯХ</td>
                                              </tr>
                                              <tr>
                                                <td style="padding: 0 0 30px;">
                                                  <table style="margin: 0 auto;" cellspacing="0" cellpadding="0" align="center">
                                                    <tbody>
                                                      <tr>
                                                        <td><a href="https://t.me/dobropostcom" style="text-decoration: none;"><img src="http://eimage.sendsay.ru/image/x_1738046276570567/zip/7262011738935065/icon-tg.png" style="vertical-align: top;" alt="tg" width="32"></a></td>
                                                        <td width="8"></td>
                                                        <td><a href="https://www.youtube.com/@dobropost" style="text-decoration: none;"><img src="http://eimage.sendsay.ru/image/x_1738046276570567/zip/7262011738935065/Icon-youtube.png" style="vertical-align: top;" alt="youtube" width="32"></a></td>
                                                        <td width="8"></td>
                                                        <td><a href="https://vk.com/dbrpst" style="text-decoration: none;"><img src="http://eimage.sendsay.ru/image/x_1738046276570567/zip/7262011738935065/icon-vk.png" style="vertical-align: top;" alt="vk" width="32"></a></td>
                                                        <td width="8"></td>
                                                        <td><a href="https://instagram.com/dobropostcom" style="text-decoration: none;"><img src="http://eimage.sendsay.ru/image/x_1738046276570567/zip/7262011738935065/icon-inst.png" style="vertical-align: top;" alt="inst" width="32"></a></td>
                                                      </tr>
                                                    </tbody>
                                                  </table>
                                                </td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        </th>
                                        <th class="tflex" width="2" height="20"></th>
                                        <th class="tflex" width="269" align="left" style="vertical-align: top;">
                                          <table width="100%" cellpadding="0" cellspacing="0">
                                            <tbody>
                                              <tr>
                                                <td align="center" style="font: 700 20px/24px 'Montserrat', Verdana, Roboto, Geneva, sans-serif; color: #ffffff; padding: 30px 0 4px;">ПОЛЕЗНЫЕ ССЫЛКИ</td>
                                              </tr>
                                              <tr>
                                                <td align="center" style="font: 400 20px/20px 'Montserrat', Verdana, Roboto, Geneva, sans-serif; color: #ffb421; padding: 5px 0;"><a style="display: block; text-decoration: none; color: #ffb421;" href="https://dobropost.com/">Сайт DobroPost</a></td>
                                              </tr>
                                              <tr>
                                                <td align="center" style="font: 400 20px/20px 'Montserrat', Verdana, Roboto, Geneva, sans-serif; color: #ffb421; padding: 5px 0;"><a style="display: block; text-decoration: none; color: #ffb421;" href="https://sklad.dobropost.com/login">Личный кабинет</a></td>
                                              </tr>
                                              <tr>
                                                <td align="center" style="font: 400 20px/20px 'Montserrat', Verdana, Roboto, Geneva, sans-serif; color: #ffb421; padding: 5px 0;"><a style="display: block; text-decoration: none; color: #ffb421;" href="https://dobropost.com/baza_main">База знаний</a></td>
                                              </tr>
                                              <tr>
                                                <td align="center" style="font: 400 20px/20px 'Montserrat', Verdana, Roboto, Geneva, sans-serif; color: #ffb421; padding: 5px 0;"><a style="display: block; text-decoration: none; color: #ffb421;" href="https://calc.dobropost.com/">Калькулятор доставки</a></td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        </th>
                                      </tr>
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="font: 400 13px/18px 'Montserrat', Verdana, Roboto, Geneva, sans-serif; color: #ffffff; padding-bottom: 20px;">
                          Вы получили это сообщение, потому что выразили свое согласие получать письма от <a href="mailto:info@dobropost.com" style="color: #ffffff !important; text-decoration: underline;">info@dobropost.com</a>.<br>
                          Если Вы хотите отказаться от получения, нажмите <a href="[% param.url_unsub %]" style="color: #ffffff !important; text-decoration: underline;">здесь</a>.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>

            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;
}

// Разбирает текст DOCX-статьи на структурированный JSON для CRM.
// Возвращает { title, excerpt, category, tags, reading_time, meta_description, sections }
async function parseArticle(rawText) {
  const prompt = `Ты получаешь текст статьи для интернет-магазина DobroPost.
Разбери его на структурированные поля для CRM.

Правила:
- title: точное название статьи
- excerpt: краткое описание для превью, 1–2 предложения
- category: категория (выбери из: "Обзоры", "Гайды", "Новинки", "Жизнь с домашними животными", "Здоровье", "Советы")
- tags: массив из 3–6 коротких тегов
- reading_time: примерное время чтения в минутах (число)
- meta_description: SEO-описание до 155 символов
- sections: массив разделов [{"heading": "...", "content": "..."}]

Текст статьи:
${rawText.slice(0, 4000)}

Верни ТОЛЬКО JSON без пояснений и markdown:
{"title":"...","excerpt":"...","category":"...","tags":["..."],"reading_time":3,"meta_description":"...","sections":[{"heading":"...","content":"..."}]}`;

  const message = await getClient().chat.completions.create({
    model: process.env.MODEL_MAIN || 'gpt-4o-mini',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.choices[0].message.content.trim();
  return JSON.parse(raw);
}

// Парсит сообщение и ВСЕГДА возвращает структурированное ТЗ.
// Типы: banner | letter | article | task
async function parseTzFromMessage(text) {
  const templateList = Object.entries(TEMPLATES)
    .map(([id, desc]) => `${id}: ${desc}`)
    .join('\n');

  const prompt = `Ты опытный менеджер проектов DobroPost. Тебе пришло сообщение — задача, просьба или поручение.
Составь чёткое техническое задание (ТЗ) на основе этого сообщения.

Сообщение:
"""
${text}
"""

Шаг 1. Определи тип задачи:
- banner: нужен баннер, изображение, картинка для рассылки или соцсетей
- letter: нужна рассылка, письмо, email-кампания
- article: нужна статья, гайд, обзор, текст для блога/сайта
- task: всё остальное — поручение, вопрос, операционная задача, любая просьба

Шаг 2. Составь ТЗ и верни JSON:
{
  "type": "banner | letter | article | task",
  "title": "суть задачи в 4–7 словах — конкретно и по делу",
  "template": "id шаблона (только для banner) или null",
  "subtitle": "подзаголовок (только для banner) или null",
  "text": "текст/контент для генерации (для banner/letter/article) или null",
  "goal": "что именно нужно сделать — конкретно, 1–2 предложения без воды",
  "requirements": ["конкретное требование 1", "конкретное требование 2"],
  "priority": "high | normal | low",
  "deadline": "дедлайн если упомянут, иначе null"
}

Правила:
- goal: опиши конечный результат, а не процесс. Что будет сделано?
- requirements: вытащи все явные и неявные требования из сообщения (формат, тон, тема, ограничения)
  Если требований нет — напиши хотя бы 1-2 стандартных для этого типа задачи
- priority: high если срочно/важно/асап, low если «когда-нибудь», иначе normal
- template (только для banner):
  акция/скидка → akciya-1..3 | находки/подборка → nahodki-1..7
  новинка → novinka-1 | комьюнити → community-1..4
  гайд → gayd-1 | стиль → stil-1 | полезное → polezno-1
  хэллоуин → prazdnik-1 | новый год → nahodki-prazdnik

Доступные шаблоны баннеров:
${templateList}

Верни ТОЛЬКО JSON без пояснений и markdown-блоков.`;

  try {
    const response = await getClient().chat.completions.create({
      model: process.env.MODEL_MAIN || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 600,
    });
    const raw = response.choices[0].message.content.trim();
    return _parseJson(raw);
  } catch (err) {
    console.error('[parseTz] Ошибка:', err.message);
    return { type: 'task', title: 'Задача', template: null, subtitle: null, text,
      goal: text, requirements: [], priority: 'normal', deadline: null };
  }
}

module.exports = { analyzeLetter, generateEmailHtml, parseArticle, parseTzFromMessage };
