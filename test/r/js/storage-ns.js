// storage-ns.js — ИЗОЛЯЦИЯ ХРАНИЛИЩА ПОЛИГОНА r/ ОТ S1.
//
// Находка аудита (25.10.2026): код S1 и полигона разделён честно (разные файлы,
// разные страницы, r/ ничего не импортирует из корня), НО localStorage у них
// ОДИН НА ДОМЕН: localStorage живёт на origin, а не на пути. Полигон лежит на
// том же домене (/r/), поэтому он читал и перезаписывал ключи основной игры:
//   terranrts.progress     — прогресс кампании S1 (!)  → «миссии открылись/сбросились»
//   terranrts.quickBattle  — быстрый бой S1
//   terranrts.profile      — профиль S1
//   terranrts.panel/language/muted — настройки S1
// То есть игра в полигоне незаметно меняла сохранение основной игры, и наоборот.
//
// Решение: прозрачное пространство имён. Этот модуль патчит localStorage так,
// что любой ключ terranrts.* внутри r/ уходит в «acr.terranrts.*». Ни одного
// изменения в движке не требуется — все существующие вызовы продолжают работать.
//
// Переносится только «мягкий» выбор игрока (язык, звук): прогресс, быстрый бой и
// профиль полигон НЕ наследует от S1 — иначе рейды начинались бы с чужими
// миссиями и чужим профилем.
const PREFIX = 'acr.';
const INHERIT = new Set(['terranrts.language', 'terranrts.muted']);

function install() {
  try {
    const ls = window.localStorage;
    if (!ls || ls.__acrPatched) return;
    // Оригинальные методы запоминаем ДО подмены (работает и в браузере, и в
    // node-симах, где Storage-конструктора нет).
    const raw = {
      getItem: ls.getItem.bind(ls),
      setItem: ls.setItem.bind(ls),
      removeItem: ls.removeItem.bind(ls),
      key: typeof ls.key === 'function' ? ls.key.bind(ls) : () => null,
    };
    const mapKey = (k) => (typeof k === 'string' && k.startsWith('terranrts.') ? PREFIX + k : k);

    // Одноразовый перенос «мягких» настроек, если своих ещё нет.
    for (const k of INHERIT) {
      try {
        if (raw.getItem(PREFIX + k) === null) {
          const v = raw.getItem(k);
          if (v !== null) raw.setItem(PREFIX + k, v);
        }
      } catch { /* приватный режим */ }
    }

    const api = {
      getItem: (k) => raw.getItem(mapKey(k)),
      setItem: (k, v) => raw.setItem(mapKey(k), v),
      removeItem: (k) => raw.removeItem(mapKey(k)),
      key: (i) => raw.key(i),
      clear: () => {
        // Чистим ТОЛЬКО свои ключи: чужой прогресс S1 не имеем права стирать.
        const doomed = [];
        for (let i = 0; i < ls.length; i++) {
          const k = raw.key(i);
          if (k && k.startsWith(PREFIX)) doomed.push(k);
        }
        for (const k of doomed) raw.removeItem(k);
      },
      get length() { return Number(ls.length) || 0; },
    };
    for (const m of ['getItem', 'setItem', 'removeItem', 'key', 'clear']) {
      try { ls[m] = api[m]; } catch { /* некоторые движки запрещают запись */ }
    }
    ls.__acrPatched = true;
    console.log('[r] хранилище изолировано: terranrts.* → acr.terranrts.* (S1 не затрагивается)');
  } catch (e) {
    console.warn('[r] не удалось изолировать localStorage — прогресс S1 и полигона может пересекаться', e);
  }
}

install();

// Хелпер для кода полигона: реальное имя ключа (для отладки и сервера).
export const storageKey = (k) => (String(k).startsWith('terranrts.') ? PREFIX + k : String(k));
export const STORAGE_PREFIX = PREFIX;
