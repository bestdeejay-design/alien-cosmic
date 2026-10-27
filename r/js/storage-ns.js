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

// Сырые (непатченные) методы Storage: нужны «выходу», чтобы найти и удалить
// ключи по РЕАЛЬНЫМ именам (включая acr.*-префикс) без двойного маппинга.
let rawRef = null;

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
    rawRef = raw;
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

// П-4 (выход = полная очистка): список ВСЕХ ключей профиля и данных полигона.
// Всё, что перечислено, удаляется при выходе из профиля; ключи S1 (без acr.)
// и настройки языка/звука остаются — это «мягкие» настройки устройства.
export const PROFILE_KEYS = Object.freeze([
  // идентичность и канал
  'ac_save_nick', 'ac_save_pin', 'ac_save_player_id', 'ac_save_ext_api', 'ac_save_pat',
  // данные игры
  'terranrts.progress', 'terranrts.quickBattle', 'terranrts.profile', 'terranrts.panel',
  'ac_raid_session_v1',
  // капсулы, настройки полигона, админский токен сессии
  'ac_chest_state_v1', 'ac_birthday_v1', 'ac_home_raid_cfg', 'ac_econ_scale', 'ac_admin_token',
  'ac_admin_pin', 'ac_vv_hint_v1',
]);

// Стереть все ключи профиля (с учётом пространства имён). Возвращает число
// удалённых ключей — нужно и для лога, и для проверки в гейте.
// Правило: уходит ВСЁ, что принадлежит полигону/профилю (ac_*, acr.*), кроме
// «мягких» настроек устройства (язык, звук) и ключей S1 (без acr.-префикса).
export function purgeProfileKeys() {
  const keep = new Set(['terranrts.language', 'terranrts.muted']);
  const strip = (k) => (k.startsWith(PREFIX) ? k.slice(PREFIX.length) : k);
  const doomed = new Set();
  for (const k of PROFILE_KEYS) if (!keep.has(k)) doomed.add(k);

  const ls = (() => { try { return window.localStorage; } catch { return null; } })();
  const raw = rawRef || (ls ? {
    getItem: (k) => ls.getItem(k),
    removeItem: (k) => ls.removeItem(k),
    key: (i) => (typeof ls.key === 'function' ? ls.key(i) : null),
  } : null);

  if (raw && ls) {
    try {
      const keys = [];
      for (let i = 0; i < (Number(ls.length) || 0); i++) {
        const k = raw.key(i);
        if (k) keys.push(k);
      }
      for (const k of keys) {
        const logical = strip(k);
        if (keep.has(logical)) continue;
        if (k.startsWith(PREFIX) || logical.startsWith('ac_') || /^(ac_|acr\.)/.test(logical)) doomed.add(k.startsWith(PREFIX) ? k : logical);
      }
    } catch { /* приватный режим: чистим по списку */ }
  }

  let n = 0;
  for (const k of doomed) {
    const real = k.startsWith(PREFIX) ? k : (String(k).startsWith('terranrts.') ? PREFIX + k : k);
    try {
      if (raw ? raw.getItem(real) !== null : true) n++;
      if (raw) raw.removeItem(real); else localStorage.removeItem(k);
    } catch { /* приватный режим */ }
  }
  return n;
}
