// QA агент: проверяет качество сгенерированного контента перед отдачей пользователю
// Используется опционально — вызывай checkBanner / checkEmail / checkArticle после AI-генерации

function checkBanner(templateId, title, subtitle) {
  const issues = [];

  if (!title || title.trim().length < 2) {
    issues.push('Заголовок пустой или слишком короткий');
  }
  if (title && title.length > 50) {
    issues.push(`Заголовок слишком длинный: ${title.length} симв. (норма ≤50)`);
  }
  if (!subtitle || subtitle.trim().length < 2) {
    issues.push('Подзаголовок пустой');
  }
  if (subtitle && subtitle.length > 100) {
    issues.push(`Подзаголовок слишком длинный: ${subtitle.length} симв. (норма ≤100)`);
  }
  if (title && subtitle && title.trim() === subtitle.trim()) {
    issues.push('Заголовок и подзаголовок одинаковые');
  }

  if (issues.length) console.warn('[QA] Баннер:', issues.join('; '));
  return { ok: issues.length === 0, issues };
}

function checkEmail(subject, html) {
  const issues = [];

  if (!subject || subject.trim().length < 3) issues.push('Тема письма пустая');
  if (subject && subject.length > 78) {
    issues.push(`Тема слишком длинная: ${subject.length} симв. (норма ≤78)`);
  }
  if (!html || html.length < 200) {
    issues.push('HTML письма слишком короткий — возможна ошибка генерации');
  }

  if (issues.length) console.warn('[QA] Письмо:', issues.join('; '));
  return { ok: issues.length === 0, issues };
}

function checkArticle(article) {
  const issues = [];

  if (!article.title) issues.push('Нет заголовка');
  if (!article.excerpt) issues.push('Нет описания');
  if (!article.sections || article.sections.length === 0) issues.push('Нет разделов');
  if (!article.tags || article.tags.length === 0) issues.push('Нет тегов');

  if (issues.length) console.warn('[QA] Статья:', issues.join('; '));
  return { ok: issues.length === 0, issues };
}

module.exports = { checkBanner, checkEmail, checkArticle };
