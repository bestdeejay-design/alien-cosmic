// ============================================================
// lore.js — структура кодекса «Легенда» (пакет I).
// Тексты вкладок/записей живут в locales/*.js (раздел codex) —
// здесь только стабильные id, порядок вкладок и unlockAfter
// (игровая логика: sim_codex проверяет их поведение).
// Листовой модуль: импортирует только i18n (без циклов).
// ============================================================

import { t, tMaybe } from './i18n.js?v=10262511';

// Структура кодекса: id вкладки → раздел codex.<id> в локали.
// unlockAfter: -1 = открыта всегда; иначе номер миссии-ключа
// (победа в №N, т.е. saveProgress(N+1), открывает всё с unlockAfter N).
export const CODEX = [
  { id: 'world', unlockAfter: -1 },  // завязка — открыта всегда
  { id: 'helios', unlockAfter: -1 },
  { id: 'kharid', unlockAfter: 1 },  // рой раскрывается после «Ночи штырей»
  { id: 'flag', unlockAfter: 5 },    // мятеж — с акта II
  { id: 'planets', unlockAfter: -1 },
  { // П8: Хроника растёт по saveProgress — запись №N после победы в №N.
    id: 'war', unlockAfter: -1,
    items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => ({ unlockAfter: n })),
  },
  { // П8: Герои и места — дословно из LORE.md §5. Открываются миссией,
    // где герой централен (после победы в ней).
    id: 'heroes', unlockAfter: -1,
    items: [
      { unlockAfter: 0 }, { unlockAfter: 1 }, { unlockAfter: 4 }, { unlockAfter: 6 },
      { unlockAfter: 7 }, { unlockAfter: 8 }, { unlockAfter: 9 }, { unlockAfter: 11 },
      { unlockAfter: 12 }, { unlockAfter: 13 }, { unlockAfter: 14 },
    ],
  },
  { // П8: Арсенал — построчно из LORE.md §6. Открывается вместе с юнитом
    // (unlockAfter = UNLOCK_AT типа).
    id: 'arsenal', unlockAfter: -1,
    items: [
      { unlockAfter: -1 }, { unlockAfter: 0 }, { unlockAfter: 2 }, { unlockAfter: 2 },
      { unlockAfter: 8 }, { unlockAfter: 6 }, { unlockAfter: 7 }, { unlockAfter: 2 },
      { unlockAfter: 1 },
      { unlockAfter: -1 }, { unlockAfter: 0 }, { unlockAfter: 2 }, { unlockAfter: 2 },
      { unlockAfter: 8 }, { unlockAfter: 6 }, { unlockAfter: 7 }, { unlockAfter: 2 },
      { unlockAfter: 1 }, { unlockAfter: 1 },
    ],
  },
];

// Запись открыта, когда прогресс ушёл дальше миссии-ключа:
// победа в №N (saveProgress(N+1)) открывает всё с unlockAfter N.
export function codexOpen(progress, unlockAfter) {
  return progress > (unlockAfter === undefined ? -1 : unlockAfter);
}

// Тело вкладки как СТРУКТУРА безопасных частей (никакого HTML-словаря):
//   { type:'h2'|'h3', text } — заголовки;
//   { type:'para', text }    — абзац (только <b>/<br> разрешены рендером);
//   { type:'item', title, body } — строка «имя — описание»;
//   { type:'locked', text }  — закрытая запись.
// Рендер в DOM — ui.js (textContent + разрешённые узлы); сим читает
// части как данные (без DOM) — scripts/sim_codex.mjs.
export function codexEntryParts(entry, progress) {
  const base = 'codex.' + entry.id;
  const parts = [{ type: 'h2', text: t(base + '.title') }];
  if (!codexOpen(progress, entry.unlockAfter)) {
    parts.push({ type: 'locked', text: t('codex.locked') });
    return parts;
  }
  if (entry.items) {
    let g = null;
    entry.items.forEach((it, i) => {
      const itemBase = base + '.items.' + i;
      // Группа опциональна: t() при отсутствии ключа вернёт заглушку,
      // поэтому проверяем через tMaybe (настоящий undefined).
      const gk = tMaybe(itemBase + '.group');
      if (gk !== undefined && gk !== g) { g = gk; parts.push({ type: 'h3', text: gk }); }
      if (codexOpen(progress, it.unlockAfter)) {
        parts.push({ type: 'item', title: t(itemBase + '.title'), body: t(itemBase + '.body') });
      } else {
        parts.push({ type: 'locked', text: t('codex.locked') });
      }
    });
    return parts;
  }
  const body = t(base + '.body');
  for (const p of body) parts.push({ type: 'para', text: p });
  return parts;
}

// Подпись вкладки (кнопка) — из локали.
export function codexTabLabel(entry) {
  return t('codex.' + entry.id + '.tab');
}
