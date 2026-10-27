// Спасение WIP Этапа 2 — статус в issue #1 (Task 56)
import { execSync } from 'node:child_process';
const token = execSync('git config --get remote.origin.url', { encoding: 'utf8' })
  .trim().replace(/^https:\/\//, '').replace(/@github\.com.*$/, '');
const api = (path, opts = {}) => fetch(`https://api.github.com/repos/bestdeejay-design/alien-cosmic${path}`, {
  ...opts, headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
}).then(async r => {
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(b).slice(0, 300)}`);
  return b;
});
const body = `**Спасение несданного Этапа 2 из прерванной сессии Арены**

Владелец экспортировал патч рабочей копии погибшей сессии. Восстановлено: база экспорта — \`d0c45d5\`, применён чисто; дельта против \`fab677f\` = **несданный WIP Этапа 2** (~794 строки: \`input.js\` +183 — арбитраж тач-жестов/пинч/long-press, \`ui.js\` +383 — cancel/миникарта/end-home, \`style.css\` +170, \`index.html\` +35, локали RU/EN +15/+15, тесты). Синтаксис js — OK, патч накладывается на \`main\` чисто.

Опубликовано: \`design/salvage/r3a_phase2_wip.patch\` + \`README\` с картой покрытия (T2/T3, T5–T8, T10–T15 по маркерам) и правилами восстановления. Утеряно: скриншоты/трейсы \`design/shots/r3a/phase2/\` (без бинарного payload в экспорте).

Новая сессия Арены получает bootstrap + инструкцию восстановления. Статус задачи не меняется: Этап 2 в работе, приёмка координатора после сдачи.`;
const c = await api('/issues/1/comments', { method: 'POST', body: JSON.stringify({ body }) });
console.log('issue comment:', c.id);
