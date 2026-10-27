// R3-A Этап 1: статус-комментарий координатора в issue #1 (Task 51)
import { execSync } from 'node:child_process';

const token = execSync('git config --get remote.origin.url', { encoding: 'utf8' })
  .trim().replace(/^https:\/\//, '').replace(/@github\.com.*$/, '');
const auth = `token ${token}`;
const repo = 'bestdeejay-design/alien-cosmic';
const api = (path, opts = {}) => fetch(`https://api.github.com/repos/${repo}${path}`, {
  ...opts,
  headers: { Authorization: auth, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
}).then(async r => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
});

const body = `**R3-A · Этап 1 — статус (координатор)**

Пакет Этапа 1 от Арены (\`6b9cb46\`: \`R3A_AUDIT.md\` + \`R3A_RESEARCH.md\` + 43 скриншота; аудит по архиву \`main@ce01b41\`; diff без \`design/\` пуст — код не тронут) — **ПРИНЯТ**.

Аудит: 10 находок — 6×P1: A-01 отмена строительства недоступна пальцем, A-02 portrait-топбар за экраном (пауза/рестарт/выход) — **новая**, A-03 ландшафтная панель 191–206px, A-04 drag не панорамирует карту/миникарту, A-05 пинч зумит браузер, а не игру, A-10 нет «На главный экран»; 4×P2: A-06 миникарта letterbox, A-07 оверлей паузы под панелью, A-08 живой chrome под модалками, A-09 мелкие тач-таргеты и мышиное копи. Все баги владельца подтверждены с измерениями, RU/EN.

Ресерч: 5 решений × 3 варианта с оценкой риска; рекомендации Арены совпали с каноном v2 — координатор утвердил: **D1=C** (✕ у призрака + chip + смена типа), **D2=B** (компакт-полка в ландшафте, 4 позиции сохранены), **D3=B** (full-bleed миникарта, без литерала 176), **D4=B** (Home + «Ещё раз» + «Следующая» при кампании), **D5=B** (пинч с якорем, +/−, drag-панорама, box-select с юнита, long-press 450мс = T8).

Скоуп Этапа 2 расширен: **T12–T15** (топбар в портрете, оверлей паузы, chrome модалок, таргеты ≥44px + тач-копи; лендинг-навигация — отдельный вопрос владельцу, вне R3-A). Вопрос Арены №6 закрыт: отдельный тач-проход по victory/replay не нужен — входит в приёмку T11.

Вердикт запушен в \`design/ZAI_MAILBOX.md\` (fe57371). Условия Этапа 2 переданы: синхронизация с текущим main до первого код-коммита, гардрейлы 1–8 из ресерча приняты, полный регресс (check.mjs, 16 sim, smoke, F1–F6 e2e, 4 позиции × 3 вьюпорта, RU/EN, окна 320/720/1280).

**Ожидаю аппрув владельца по решениям 1–5 → команда GO на Этап 2.**`;

const c = await api('/issues/1/comments', { method: 'POST', body: JSON.stringify({ body }) });
console.log('issue comment:', c.id);
