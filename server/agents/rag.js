// RAG — векторная память задач через Supabase + pgvector
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

const getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Превращаем текст в вектор через OpenAI
async function embed(text) {
  const res = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000), // лимит токенов
  });
  return res.data[0].embedding;
}

// Сохраняем выполненную задачу в память
async function remember({ taskType, query, result, metadata = {} }) {
  if (!process.env.SUPABASE_URL) return;
  const embedding = await embed(query);
  const { error } = await getSupabase()
    .from('task_memories')
    .insert({ task_type: taskType, query, result, metadata, embedding });
  if (error) console.error('[RAG] Ошибка сохранения:', error.message);
  else console.log(`[RAG] Запомнил задачу: ${taskType} — ${query.slice(0, 60)}`);
}

// Ищем похожие прошлые задачи
async function recall(query, taskType = null, limit = 3) {
  if (!process.env.SUPABASE_URL) return [];
  const embedding = await embed(query);

  const { data, error } = await getSupabase().rpc('match_task_memories', {
    query_embedding: embedding,
    match_threshold: 0.5,
    match_count: limit,
  });

  if (error) { console.error('[RAG] Ошибка поиска:', error.message); return []; }

  // Фильтруем по типу задачи если указан
  const results = taskType ? data.filter(r => r.task_type === taskType) : data;
  console.log(`[RAG] Найдено похожих задач: ${results.length}`);
  return results;
}

module.exports = { embed, remember, recall };
