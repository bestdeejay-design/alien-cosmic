// R3-A: GO на Этап 2 — статус в issue #1 (Task 52)
import { execSync } from 'node:child_process';

const token = execSync('git config --get remote.origin.url', { encoding: 'utf8' })
  .trim().replace(/^https:\/\//, '').replace(/@github\.com.*$/, '');
const api = (path, opts = {}) => fetch(`https://api.github.com/repos/bestdeejay-design/alien-cosmic${path}`, {
  ...opts,
  headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
}).then(async r => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
});

const body = `**R3-A · владелец утвердил решения 1–5 → координатор выдал GO на Этап 2** (\`design/ZAI_MAILBOX.md\`, main \`10e2893\`)

Скоуп финализирован: **T1–T15** (T12–T15 добавлены из находок аудита A-02/A-07/A-08/A-09). Решения: D1=C, D2=B, D3=B, D4=B, D5=B, long-press (T8) подтверждён владельцем.

**Новые правила ветвления (от владельца, переданы Арене дословно):**
- синхронизация: \`git fetch origin && git merge origin/main\` в свою ветку перед стартом;
- задачи живут только на \`main\` (\`ZAI_MAILBOX.md\` — канон v2 + вердикт + GO);
- вся работа — **только в \`arena/3e494e43-alien-cosmic\`**; в main не пушить, **PR не открывать**;
- приёмку, проверку и перенос в main делает координатор сам.

Регресс на сдачу: check.mjs, 16 sim, smoke, F1–F6 e2e, 4 позиции панели × 3 вьюпорта, ≥4 hasTouch-флоу с трейсами, миникарта 3 аспекта, RU/EN 1:1, окна 320/720/1280, бейдж N, инварианты P1/G.6/R2-C/R2-D.

Следующее событие — сдача Этапа 2 от Арены в её ветке → приёмка координатора.`;

const c = await api('/issues/1/comments', { method: 'POST', body: JSON.stringify({ body }) });
console.log('issue comment:', c.id);
