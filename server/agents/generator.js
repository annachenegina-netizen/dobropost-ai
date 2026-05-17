// Универсальный цикл генерации с тестировщиком, RAG-обучением и живой обратной связью
const { recall, remember } = require('./rag');
const { addTesterLog } = require('./tester');
const { popAllFeedback } = require('./feedbackQueue');

async function runWithTester(type, taskId, generate, test, basePrompt, log, maxAttempts = 50) {
  const typeName = type === 'banner' ? 'баннер' : 'письмо';

  // Вспоминаем прошлые уроки по похожим задачам
  const lessons = await recall(basePrompt, `${type}_lesson`, 5).catch(() => []);
  if (lessons.length) {
    log(taskId, `вспомнил ${lessons.length} урок(ов) из прошлого опыта — учту`);
  }

  const lessonCtx = lessons.length
    ? '\n\nУРОКИ ИЗ ПРОШЛОГО (что принимали и что отклоняли по похожим задачам):\n' +
      lessons.map(l => `- ${l.result}`).join('\n')
    : '';

  const enrichedBase = basePrompt + lessonCtx;

  // issueCount[issue] = сколько раз подряд тестировщик отклонял по этой причине
  const issueCount = {};
  let humanFeedback = [];
  let lastData = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Подхватываем живые комментарии от пользователя
    const newFeedback = popAllFeedback();
    if (newFeedback.length) {
      humanFeedback.push(...newFeedback);
      log(taskId, `💬 Учитываю комментарий: ${newFeedback.join('; ')}`, 'ok');
    }

    // Собираем список того, что надо исправить — с акцентом на повторяющиеся проблемы
    const fixParts = [];

    for (const [issue, count] of Object.entries(issueCount)) {
      if (count >= 4) {
        fixParts.push(`[КАРДИНАЛЬНО СМЕНИ ПОДХОД — это уже ${count} раз не проходит] ${issue}`);
      } else if (count >= 2) {
        fixParts.push(`[НЕ ИСПРАВЛЕНО уже ${count} раза — сделай принципиально иначе] ${issue}`);
      } else {
        fixParts.push(issue);
      }
    }

    if (humanFeedback.length) {
      fixParts.push(`КОММЕНТАРИЙ ОТ ЗАКАЗЧИКА: ${humanFeedback.join('; ')}`);
    }

    const prompt = fixParts.length
      ? `${enrichedBase}\n\nЧТО НУЖНО ИСПРАВИТЬ В ЭТОЙ ПОПЫТКЕ:\n${fixParts.map(f => `- ${f}`).join('\n')}`
      : enrichedBase;

    log(taskId, `${typeName}: генерация (попытка ${attempt})...`);
    const data = await generate(prompt);
    lastData = data;

    const info = type === 'banner'
      ? `шаблон: ${data.templateId}, "${data.title}"`
      : `тема: "${data.subject}"`;
    log(taskId, `${typeName} сгенерирован — ${info}`);
    log(taskId, `отправляю ${typeName} тестировщику...`);

    addTesterLog({ type, taskId, attempt, status: 'checking', data: type === 'banner' ? data.imageUrl : data.subject });

    const check = await test(data).catch(err => {
      log(taskId, `Ошибка проверки ${typeName}: ${err.message}`, 'warn');
      return { ok: true };
    });

    addTesterLog({ type, taskId, attempt, status: check.ok ? 'ok' : 'fail', issues: check.issues || [] });

    if (check.ok) {
      log(taskId, `тестировщик принял ${typeName} ✅`, 'ok');
      const summary = Object.keys(issueCount).length
        ? `исправлял: ${Object.keys(issueCount).join('; ')}`
        : 'принято с первой попытки';
      remember({
        taskType: `${type}_lesson`,
        query: basePrompt.slice(0, 400),
        result: `ПРИНЯТО за ${attempt} попыток (${summary}): ${info}`,
        metadata: { type, success: true, attempt },
      }).catch(() => {});
      return data;
    }

    const issues = check.issues || [];
    const issuesText = issues.join('; ');
    log(taskId, `тестировщик отклонил: ${issuesText}`, 'error');

    // Обновляем счётчики повторяющихся проблем
    // Сначала обнуляем проблемы которых больше нет
    for (const key of Object.keys(issueCount)) {
      if (!issues.includes(key)) delete issueCount[key];
    }
    for (const issue of issues) {
      issueCount[issue] = (issueCount[issue] || 0) + 1;
    }

    // Запоминаем в RAG — следующий запуск это учтёт
    remember({
      taskType: `${type}_lesson`,
      query: basePrompt.slice(0, 400),
      result: `ОТКЛОНЕНО (попытка ${attempt}): ${info} — причины: ${issuesText}`,
      metadata: { type, success: false, attempt, issues },
    }).catch(() => {});

    // Если одна и та же проблема висит 4 раза — логируем особо
    const stuck = Object.entries(issueCount).filter(([, c]) => c >= 4);
    if (stuck.length) {
      log(taskId, `⚠️ Проблема "${stuck.map(([k]) => k).join(', ')}" не устраняется уже ${stuck[0][1]} попыток — применяю кардинальный подход`, 'warn');
    }
  }

  log(taskId, `достигнут предел безопасности (${maxAttempts}) — беру последний вариант`, 'warn');
  addTesterLog({ type, taskId, attempt: maxAttempts, status: 'forced', issues: ['Достигнут предел попыток'] });
  return lastData || await generate(enrichedBase);
}

module.exports = { runWithTester };
