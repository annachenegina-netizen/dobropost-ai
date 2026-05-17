// Хранит историю шагов pipeline для каждой задачи, рассылает SSE
const entries = [];   // [{ taskId, taskNum, type, title, ts, steps, status }]
const byId = {};
const clients = [];

function pipelineStart(taskId, taskNum, type, title) {
  const entry = { taskId, taskNum, type, title, ts: _now(), steps: [], status: 'running' };
  byId[taskId] = entry;
  entries.unshift(entry);
  if (entries.length > 50) entries.pop();
  _emit({ event: 'start', taskId, taskNum, type, title, ts: entry.ts });
}

function pipelineStep(taskId, msg, level) {
  const e = byId[taskId];
  if (!e) return;
  const step = { ts: _now(), msg, level: level || 'info' };
  e.steps.push(step);
  _emit({ event: 'step', taskId, step });
}

function pipelineFinish(taskId, ok) {
  const e = byId[taskId];
  if (e) e.status = ok ? 'done' : 'error';
  _emit({ event: 'finish', taskId, ok: !!ok });
}

function getEntries() { return entries; }
function addClient(res) { clients.push(res); }
function removeClient(res) {
  const i = clients.indexOf(res);
  if (i !== -1) clients.splice(i, 1);
}

function _now() { return new Date().toLocaleTimeString('ru'); }
function _emit(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(r => { try { r.write(msg); } catch (_) {} });
}

module.exports = { pipelineStart, pipelineStep, pipelineFinish, getEntries, addClient, removeClient };
