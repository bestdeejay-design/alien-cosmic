// save-client.js — СОХРАНЕНИЕ ПРОГРЕССА ПОЛИГОНА r/ (Э2, 25.10.2026).
//
// Что было не так (жалобы владельца):
//   1) «сохранение есть, но пользоваться не получается» — клиент стучался на
//      http://<хост>:8790, что ломается на https-странице, на телефоне и в
//      предпросмотре (один порт). Теперь: сначала ТОТ ЖЕ origin /api/*,
//      и только если его нет — прямой :8790.
//   2) база рейда (ac_raid_session_v1) сохранялась отдельным кодом в raid-boot,
//      а кампания — здесь; два разных пути = пропуски. Теперь один путь и
//      один список ключей.
//   3) ник был регистрозависимым (BEST/best/BESt — три профиля). Теперь
//      сервер сравнивает ники без регистра, а клиент нормализует ввод.
//   4) не было видно, работает ли сервер. Теперь в панели профиля — статус,
//      размер и время каждой записи, кнопка «Синхронизировать».
//
// Идентификация: НИК + ПИН. Первый save под ником регистрирует его с пином;
// дальше тот же пин обязателен (403 на чужой). Без входа — анонимный id
// (прогресс живёт только в этом браузере).
// Э4: ключи полигона на сервере отделены от ключей S1 (см. r/js/storage-ns.js):
// localStorage внутри r/ уже переименован в acr.*, а на сервере прогресс рейдов
// лежит под r.progress / r.quickBattle, чтобы не перетирать сейвы основной игры.
// База рейда исторически лежит под ac_raid_session_v1 — этот ключ НЕ меняем,
// иначе у владельца «пропадёт» уже накопленная база.
const SYNC_KEYS = ['terranrts.progress', 'terranrts.quickBattle', 'ac_raid_session_v1'];
const STATS_KEY = 'ac_stats';
const SRV_KEY = {
  'terranrts.progress': 'r.progress',
  'terranrts.quickBattle': 'r.quickBattle',
  'ac_raid_session_v1': 'ac_raid_session_v1',
};
const srvOf = (key) => SRV_KEY[key] || key;
const NICK_KEY = 'ac_save_nick';
const PIN_KEY = 'ac_save_pin';
const ANON_KEY = 'ac_save_player_id';
const PORT = 8790;
// ---- Канал 2.5: ВНЕШНИЙ СЕРВЕР ВЛАДЕЛЬЦА (lovii + Cloudflare Tunnel) ----
// Если адрес задан и жив — он главнее гиста: это постоянная БД на машине владельца.
// Задаётся в localStorage 'ac_save_ext_api' (панель профиля) или константой ниже.
const EXT_API_DEFAULT = ''; // например 'https://xxx.trycloudflare.com'
const EXT_KEY = 'ac_save_ext_api';
function readExtApi() { return readLS(EXT_KEY) || EXT_API_DEFAULT || ''; }

// ---- Канал 3: GitHub Gist (работает с GitHub Pages) ----
// Чтение: публичный raw гиста (HTTPS, CORS ok). Запись: gist-мост на :8791 (Mac владельца).
// Файл профиля: ac_<sha256(nick:pin).slice32>_<key>.json — пин в URL не светит ничего,
// файл без верного хеша не найти, запись защищена мостом.
const GIST_ID = '69f6832c50a3715bb60c2a8ff896dca9';
const GIST_RAW = `https://gist.githubusercontent.com/bestdeejay-design/${GIST_ID}/raw`;
const BRIDGE_PORT = 8791;
// Канал 4: PAT владельца (вводится один раз в профиле, хранится в localStorage,
// в репо/клиентский код не попадает) — прямой GitHub API PATCH гиста из браузера.
const PAT_KEY = 'ac_save_pat';
const readPAT = () => readLS(PAT_KEY);
async function sha32(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
async function gistFileOf(key) {
  const h = await sha32(`${identity.nick.toLowerCase()}:${identity.pin}`);
  return `ac_${h}_${key.replace(/[^a-z0-9._-]/gi, '_')}.json`;
}

import { closeOthers, registerModal, unregisterModal } from './js/modals.js?v=10271841';
import { t } from './js/i18n.js?v=10271841';
// P1 (#45): пинпад и «выход = полная очистка» живут в отдельных модулях.
// Сети они не касаются — единственный сетевой клиент остаётся здесь
// (гейт check_r.mjs [4]).
import {
  PIN_MIN, PIN_MAX, normalizeNick, openAuth, authGate, confirmSignOut,
  applySnapshotToGame, auth as authState,
} from './js/auth-ui.js?v=10271841';
import { purgeProfileKeys, PROFILE_KEYS } from './js/storage-ns.js?v=10271841';

const readLS = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } };

// ---- Адрес API: same-origin /api → иначе прямой порт 8790 ----
let apiBase = null;
let apiMode = 'не проверен';
// manual=true — единственный законный случай поиска канала без профиля:
// игрок сам нажал «Войти» в панели профиля (это действие, а не фон).
async function resolveApi(manual = false) {
  // A2 (аудит владельца 26.10.2026): «без профиля — ноль запросов к серверу,
  // условие максимально тихое». Здесь даже /health молчит: пока игрок не вошёл
  // по нику и пину, клиент не знает канал и не имеет права его искать.
  if (!identity && !manual) { apiBase = null; apiMode = 'нужен профиль'; return null; }
  try {
    const r = await fetch('/health', { cache: 'no-store' });
    if (r.ok || r.status === 401) { apiBase = ''; apiMode = 'прокси'; return apiBase; }
  } catch { /* прокси нет */ }
  // Канал 2.5: внешний сервер владельца (lovii через туннель) — главнее гиста.
  const ext = readExtApi();
  if (ext) {
    try {
      const r = await fetch(ext + '/health', { cache: 'no-store' });
      if (r.ok) { apiBase = ext; apiMode = 'внешний сервер (lovii)'; return apiBase; }
    } catch { /* туннель лежит — падаем в гист */ }
  }
  // Канал 3 (GitHub Pages): сервера рядом нет — читаем из публичного гиста,
  // запись уходит на gist-мост (Mac владельца, :8791), если он включён.
  if (location.protocol === 'https:') {
    apiBase = 'gist'; apiMode = 'гист (чтение) + мост :8791 (запись)';
    return apiBase;
  }
  apiBase = `http://${location.hostname}:${PORT}`;
  apiMode = 'порт ' + PORT;
  return apiBase;
}

function askIdentity() {
  const nick = readLS(NICK_KEY);
  const pin = readLS(PIN_KEY);
  return nick && pin ? { nick, pin } : null;
}

let identity = askIdentity();
const player = identity ? identity.nick : (() => {
  let id = readLS(ANON_KEY);
  if (!id) { id = 'anon-' + Math.random().toString(36).slice(2, 10); writeLS(ANON_KEY, id); }
  return id;
})();
window.__saveIdentity = identity;

// lastSynced[key] — значение, которое сервер уже видел. Push уходит только при
// отличии: уход со страницы не перетирает чужие изменения «пустым» значением.
const lastSynced = {};
const status = { online: false, lastError: '', lastPushTs: 0, lastPullTs: 0, api: apiMode };

async function call(path, payload) {
  // Страховка A2: любые фоновые /api/* (save/load/stats) без профиля — молчим,
  // не трогая сеть и не оставляя записей на сервере.
  if (!identity) return { j: { ok: false, error: 'нужен профиль' }, status: 0 };
  const base = apiBase === null ? await resolveApi() : apiBase;
  // Канал 3 (гист): /api/load читаем публично из raw; /api/save — на мост :8791.
  if (base === 'gist') {
    const key = payload && payload.key;
    if (path === '/api/load' && key) {
      const f = await gistFileOf(key);
      try {
        const r = await fetch(`${GIST_RAW}/${f}?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return { j: { ok: false, error: 'not found' }, status: r.status };
        const j = await r.json();
        if (j.pin !== await sha32(`${identity.nick}:${identity.pin}`)) {
          status.online = true;
          return { j: { ok: false, error: 'nick taken, wrong pin' }, status: 403 };
        }
        return { j: { ok: true, value: j.value, ts: j.ts }, status: 200 };
      } catch { status.online = false; return { j: { ok: false, error: 'not found' }, status: 0 }; }
    }
    if (path === '/api/save' && payload) {
      try {
        const r = await fetch(`http://${location.hostname}:${BRIDGE_PORT}/api/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });
        const j = await r.json().catch(() => ({ ok: false, error: 'bad json' }));
        if (!r.ok && !j.error) j.error = 'http ' + r.status;
        status.online = r.ok;
        return { j, status: r.status };
      } catch {
        status.online = false;
        status.lastError = 'мост выключен (Mac): включи node server/gist-bridge.mjs';
                // Мост выключен → канал 4: прямой GitHub API с PAT владельца.
        const pat = readPAT();
        if (!pat) {
          status.online = false;
          status.lastError = 'мост выключен (Mac) и PAT не введён — введите PAT в профиле';
          return { j: { ok: false, error: status.lastError }, status: 0 };
        }
        try {
          const f = await gistFileOf(payload.key);
          const prev = await fetch(`${GIST_RAW}/${f}?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          const ph = await sha32(`${identity.nick.toLowerCase()}:${identity.pin}`);
          if (prev && prev.pin !== ph) {
            status.online = true;
            return { j: { ok: false, error: 'nick taken, wrong pin' }, status: 403 };
          }
          const record = JSON.stringify({ pin: ph, key: payload.key, value: payload.value, ts: Date.now() });
          const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' },
            body: JSON.stringify({ files: { [f]: { content: record } } }),
          });
          const j = await r.json().catch(() => ({ ok: false, error: 'bad json' }));
          if (!r.ok) { j.ok = false; j.error = j.message || ('github ' + r.status); } else j.ok = true;
          status.online = r.ok;
          return { j, status: r.ok ? 200 : r.status };
        } catch (e2) {
          status.online = false;
          status.lastError = 'PAT-канал: ' + String(e2.message || e2).slice(0, 80);
          return { j: { ok: false, error: status.lastError }, status: 0 };
        }
      }
    }
    return { j: { ok: false, error: 'канал гист: только save/load' }, status: 0 };
  }
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({ ok: false, error: 'bad json' }));
  if (!r.ok && !j.error) j.error = 'http ' + r.status;
  status.online = (r.status !== 503 && r.status < 500) || r.status === 403;
  return { j, status: r.status };
}

const TS_PREFIX = 'ac_save_ts_';
// З3 (#33, жалоба «сохранение не работает, а никто не сказал»): тихая неудача
// пуша. Раньше ошибка жила только в панели профиля — игрок о ней не знал.
// Тост показываем один раз на «эпизод» сбоя и не чаще, чем раз в SAVE_TOAST_MS.
const SAVE_TOAST_MS = 5 * 60 * 1000;
let lastSaveToastTs = 0;
let lastSaveErrorShown = '';

function notifySaveError(text, isAuth = false) {
  const now = Date.now();
  if (lastSaveErrorShown === text && now - lastSaveToastTs < SAVE_TOAST_MS) return;
  if (now - lastSaveToastTs < SAVE_TOAST_MS && lastSaveErrorShown === text) return;
  lastSaveErrorShown = text;
  lastSaveToastTs = now;
  try {
    const g = window.game;
    if (g && g.ui && typeof g.ui.toast === 'function' && g.state) {
      // Локаль — единый ключ (RU/EN симметрично). З2 (#42): при сетевом сбое
      // успокаиваем — прогресс жив в браузере; 403 «чужой пин» без хвоста
      // (там потеря реальная, успокаивать нельзя).
      g.ui.toast(t(isAuth ? 'ui.save.failedAuth' : 'ui.save.failed', { err: text }), 'warn', 4200);
    }
  } catch { /* офлайн-стенд без UI */ }
}

// Разрешение конфликтов «локально ↔ сервер» по времени сервера:
//   serverTs > localTs → сервер новее, забираем (вторая машина играла);
//   иначе              → локальный прогресс новее, отправляем.
// Без этого первый же запуск на второй машине мог откатить базу назад.
// Э6: статистика игрока для рейтинга (топ-100 по вылетам/добыче).
// Считается из живого состояния игры; на сервере ключ ac_stats.
function buildStats() {
  const g = window.game;
  if (!g || !g.state) return null;
  const st = g.state;
  let ccLevel = 1, houseLevel = 0;
  for (const b of st.buildings || []) {
    if (!b || b.dead || !b.done || b.side !== 'player') continue;
    if (b.type === 'cc') ccLevel = Math.max(ccLevel, b.level || 1);
    if (b.type === 'depot') houseLevel = Math.max(houseLevel, b.level || 1);
  }
  return JSON.stringify({
    nick: identity ? identity.nick : player,
    raids: (g.raidSession && g.raidSession.raidSeq) || 0,
    loot: Math.round((st.stats && st.stats.mined) || 0),
    ccLevel,
    houseLevel,
    ts: Date.now(),
  });
}

async function pushStats() {
  if (!identity || !window.game || !window.game.state) return;
  const value = buildStats();
  if (!value) return;
  if (lastSynced[STATS_KEY] === value) return;
  try {
    const { j } = await call('/api/save', {
      player: identity.nick, key: STATS_KEY, value, pin: identity.pin,
    });
    if (j.ok) lastSynced[STATS_KEY] = value;
  } catch { /* офлайн */ }
}

// Ключ базы рейда: на старте его тянет гейт входа (raid-boot → authGate).
// reconcile читает только кампанию и быстрый бой — иначе на каждый вход
// уходило два одинаковых /api/load (итерация 2 ревью #45).
const RAID_KEY = 'ac_raid_session_v1';

async function reconcile() {
  if (!identity) return;
  const list = await window.__saveApi.list();
  for (const key of SYNC_KEYS) {
    if (key === RAID_KEY) continue;
    const local = readLS(key);
    const localTs = Number(readLS(TS_PREFIX + key) || 0);
    const rec = list && list.ok && Array.isArray(list.records)
      ? list.records.find((x) => x.key === srvOf(key) || x.key === key) : null;
    const serverTs = rec ? Number(rec.ts) || 0 : 0;
    if (rec && serverTs > localTs) {
      await pull(key);
      writeLS(TS_PREFIX + key, String(serverTs));
    } else if (local != null) {
      await push(key, { force: true });
    }
  }
}

async function push(key, { force = false } = {}) {
  if (!identity) return false; // A2: без профиля не сохраняем ничего
  const value = readLS(key);
  if (value == null) return false;
  if (!force && lastSynced[key] === value) return false;
  try {
    const { j, status: code } = await call('/api/save', {
      player: identity ? identity.nick : player,
      key: srvOf(key), value, pin: identity ? identity.pin : undefined,
    });
    if (j.ok) {
      lastSynced[key] = value;
      if (j.ts) writeLS(TS_PREFIX + key, String(j.ts));
      status.online = true; status.lastError = ''; status.lastPushTs = Date.now();
      lastSaveErrorShown = ''; // новый эпизод сбоя покажется снова
      if (j.player && identity && j.player !== identity.nick) {
        // сервер вернул канонический ник (другой регистр) — запомним его
        identity = { ...identity, nick: j.player };
        window.__saveIdentity = identity;
        writeLS(NICK_KEY, j.player);
      }
      return true;
    }
    status.lastError = j.error === 'nick taken, wrong pin' ? '403: чужой пин' : String(j.error || 'ошибка');
    if (code === 403) status.online = true;
    notifySaveError(status.lastError, code === 403);   // З3: игрок видит, что сейв не ушёл
    return false;
  } catch (e) {
    status.online = false;
    status.lastError = 'сервер недоступен';
    notifySaveError(status.lastError);
    return false;
  }
}

async function pull(key) {
  if (!identity) return null;
  try {
    let { j } = await call('/api/load', {
      player: identity.nick, key: srvOf(key), pin: identity.pin,
    });
    // Совместимость: раньше ключи назывались как localStorage (terranrts.*).
    if (!j.ok && srvOf(key) !== key) {
      ({ j } = await call('/api/load', { player: identity.nick, key, pin: identity.pin }));
      if (j.ok) await call('/api/save', {
        player: identity.nick, key: srvOf(key), value: j.value, pin: identity.pin,
      });
    }
    if (j.ok && typeof j.value === 'string') {
      writeLS(key, j.value);
      lastSynced[key] = j.value;
      if (j.ts) writeLS(TS_PREFIX + key, String(j.ts));
      status.online = true; status.lastPullTs = Date.now();
      return j.value;
    }
    if (j.error && j.error !== 'not found') status.lastError = String(j.error);
    return null;
  } catch { status.online = false; return null; }
}

async function pullAll() {
  if (!identity) return;
  for (const key of SYNC_KEYS) await pull(key);
}

// ------------------------------------------------------------------
// P1 (#45): ВХОД ПОЭТАПНО. Шаг 1 (ник) — в auth-ui, шаг 2 (пинпад) —
// здесь: проверка ника+пина на сервере без перезагрузки страницы.
// Возвращаем КОД (403 чужой пин / 429 кулдаун), чтобы пинпад мог отличить
// «неверный пин» от «сервера нет»: шейк панели — только на 403/429.
// ------------------------------------------------------------------
const NICK_RE = /^[a-zA-Zа-яА-Я0-9_-]{2,24}$/;
async function loginWithPin(nickRaw, pinRaw) {
  const nick = normalizeNick(nickRaw);
  const pin = String(pinRaw == null ? '' : pinRaw).trim();
  if (!NICK_RE.test(nick)) return { ok: false, code: 0, error: 'nick' };
  // Пин 3–12 цифр (§4 «Итоги аудита» приоритетнее старого 4–8 в тексте issue).
  if (!new RegExp('^[0-9]{' + PIN_MIN + ',' + PIN_MAX + '}$').test(pin)) return { ok: false, code: 0, error: 'pin' };
  // Ручной вход — единственное место, где сеть разрешена без профиля.
  const base = apiBase === null ? await resolveApi(true) : apiBase;
  if (base === 'gist') {
    // Гист не умеет «проверить пин» отдельно от данных: входим локально,
    // расхождение пина поймает первый save/load (403 'nick taken, wrong pin').
    window.__saveApi.setIdentity(nick, pin);
    return { ok: true, code: 200, player: nick, verified: false, registered: false };
  }
  let r;
  try {
    r = await fetch(`${base}/api/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: nick, pin, key: '__check__' }),
      cache: 'no-store',
    });
  } catch {
    status.online = false;
    status.lastError = 'сервер недоступен';
    return { ok: false, code: 0, offline: true, error: 'offline' };
  }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  const retryAfter = Number((j && j.retryAfter) || (r.headers && r.headers.get && r.headers.get('Retry-After')) || 0) || 0;
  if (r.status === 403) { status.online = true; return { ok: false, code: 403, error: 'pin' }; }
  if (r.status === 429) { status.online = true; return { ok: false, code: 429, retryAfter: retryAfter || 60, error: 'cooldown' }; }
  if (r.status >= 500 || r.status === 0) { status.online = false; return { ok: false, code: r.status, offline: true, error: 'offline' }; }
  if (r.ok && j && j.ok === false && j.error && j.error !== 'not found') {
    // Прочие отказы сервера (битый ник и т.п.) — не шейк, а текст ошибки.
    status.online = true;
    return { ok: false, code: r.status, error: String(j.error) };
  }
  status.online = true;
  status.lastError = '';
  window.__saveApi.setIdentity((j && j.player) || nick, pin);
  // registered: сервер только что создал профиль → пинпад покажет тост
  // «Профиль создан» (итерация 2 ревью #45).
  return {
    ok: true, code: r.status, player: (j && j.player) || nick,
    verified: true, registered: !!(j && j.registered),
  };
}

// ------------------------------------------------------------------
// P1 (#45): PULL СНАПШОТА ДО СТАРТА СИМУЛЯЦИИ (закрывает гонку входа —
// раньше симуляция стартовала с пустым localStorage, и человек видел
// «новую базу» вместо своей КЦ-16). Пустое облако = новая база законна.
// «Облако приоритетнее локала»: серверное значение перезаписывает локальное
// без сравнения времени — снапшот на сервере и есть истина входа.
// ------------------------------------------------------------------
async function pullSnapshot() {
  if (!identity) return { ok: false, offline: true, error: 'нужен профиль', found: 0 };
  let found = 0;
  let netFails = 0;
  const got = [];
  for (const key of SYNC_KEYS) {
    let r;
    try {
      r = await call('/api/load', { player: identity.nick, key: srvOf(key), pin: identity.pin });
    } catch { netFails++; continue; }
    if (!r || r.status === 0) { netFails++; continue; }
    if (r.j && r.j.ok && typeof r.j.value === 'string') {
      writeLS(key, r.j.value);
      lastSynced[key] = r.j.value;
      if (r.j.ts) writeLS(TS_PREFIX + key, String(r.j.ts));
      found++; got.push(key);
    }
  }
  if (!got.length && netFails === SYNC_KEYS.length) {
    status.online = false;
    status.lastError = 'сервер недоступен';
    return { ok: false, offline: true, found: 0 };
  }
  status.online = true;
  status.lastPullTs = Date.now();
  return { ok: true, found, keys: got };
}

// Публичный API для остальных модулей полигона (raid-boot).
window.__saveApi = {
  keys: SYNC_KEYS,
  get identity() { return identity; },
  get status() { return { ...status, api: apiMode }; },
  // P1 (#45): вход поэтапно и pull до старта симуляции.
  loginWithPin,
  pullSnapshot,
  purgeProfileKeys,
  profileKeys: PROFILE_KEYS,
  // Пинпад панели профиля берёт отсюда состояние мастера (нужен гейту/sim).
  get auth() { return authState; },
  // Гейт «pull до старта симуляции» — его ждёт raid-boot.js.
  authGate: (game, opts) => authGate(game || window.game, opts),
  pullKey: (key) => pull(key),
  pullAll,
  pushKey: (key) => push(key, { force: true }),
  pushAll: async () => { for (const key of SYNC_KEYS) await push(key, { force: true }); return status; },
  setIdentity: (nick, pin) => {
    writeLS(NICK_KEY, nick); writeLS(PIN_KEY, pin);
    identity = { nick, pin }; window.__saveIdentity = identity;
  },
  // P1 (#45, §4): выход = полная очистка. Мало забыть ник и пин: прогресс
  // рейда (минимум ac_raid_session_v1) не должен оставаться в браузере —
  // иначе следующий человек увидит чужую базу. Ключи S1 (без namespace) и
  // «мягкие» настройки (язык/звук) не трогаем.
  clearIdentity: () => {
    const purged = purgeProfileKeys();
    for (const k of Object.keys(lastSynced)) delete lastSynced[k];
    for (const k of SYNC_KEYS) {
      try { localStorage.removeItem(TS_PREFIX + k); } catch { /* приватный режим */ }
    }
    identity = null; window.__saveIdentity = null;
    apiBase = null; apiMode = 'нужен профиль';
    status.online = false; status.lastError = ''; status.api = apiMode;
    return purged;
  },
  // Универсальный вызов API полигона (капсулы, рейтинг, ручные выдачи).
  // Держим сеть ТОЛЬКО здесь — гейт check_r.mjs [4] это проверяет.
  api: async (path, payload, opts = {}) => {
    // A2: без профиля публичные ручки (капсулы, рейтинг) сеть не трогают —
    // полигон работает на локальных данных, сервер про анонима не узнает.
    if (!identity) return { ok: false, error: 'нужен профиль' };
    const base = apiBase === null ? await resolveApi() : apiBase;
    const method = opts.method || (payload ? 'POST' : 'GET');
    const headers = { 'Content-Type': 'application/json' };
    if (opts.pin) headers.Authorization = 'Bearer ' + opts.pin;
    try {
      const r = await fetch(base + path, {
        method,
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
        cache: 'no-store',
      });
      status.online = r.status < 500 || r.status === 403;
      const j = await r.json().catch(() => ({ ok: false, error: 'bad json' }));
      if (!r.ok && !j.error) j.error = 'http ' + r.status;
      return j;
    } catch {
      status.online = false;
      return { ok: false, error: 'сервер недоступен' };
    }
  },
  list: async () => {
    if (!identity) return { ok: false, error: 'нужен профиль' };
    const base = apiBase === null ? await resolveApi() : apiBase;
    try {
      const r = await fetch(`${base}/api/list?player=${encodeURIComponent(identity ? identity.nick : player)}`, { cache: 'no-store' });
      const j = await r.json();
      status.online = true;
      return j;
    } catch { status.online = false; return { ok: false, error: 'сервер недоступен' }; }
  },
};

// ------------------------------------------------------------------
// Панель профиля — открывается командой КЦ «Профиль» (канон владельца:
// вход/сохранения только внутри КЦ, в хедере ничего нет).
// ------------------------------------------------------------------
window.__saveGetPat = readPAT;
window.__saveGetExt = readExtApi;
window.__saveSetExt = (u) => writeLS(EXT_KEY, String(u || '').trim());
window.__saveSetPat = (t) => { writeLS(PAT_KEY, String(t || '').trim()); };
window.showProfilePanel = function showProfilePanel() {
  const old = document.getElementById('sv-panel');
  // Только РЕАЛЬНО прикреплённая панель считается открытой: отсоединённый
  // узел (или пустой стаб в headless-прогоне) не должен блокировать открытие.
  const oldLive = old && (!document.body.contains || document.body.contains(old));
  if (oldLive) { old.remove(); unregisterModal('profile'); return; }
  // З2 (#33): профиль тоже модалка — закрывает капсулы/командира/админку.
  closeOthers('profile');
  const panel = document.createElement('div');
  panel.id = 'sv-panel';
  panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;' +
    'background:#101c22;border:1px solid #2a3a42;border-radius:12px;padding:14px 16px;font:13px system-ui;color:#dfe8ea;' +
    'box-shadow:0 8px 32px rgba(0,0,0,.6);width:min(92vw,320px);max-height:86vh;overflow:auto';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const who = identity
    ? `Профиль: <b>${esc(identity.nick)}</b>`
    : 'Профиль не выбран — прогресс живёт только в этом браузере';
  panel.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">Профиль и сохранения</div>
    <div style="opacity:.78;margin-bottom:4px">${who}</div>
    <div id="sv-state" style="font-size:12px;margin-bottom:10px;opacity:.8">сервер: проверяю…</div>
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <input id="sv-nick" placeholder="ник" maxlength="24" autocomplete="username" autocapitalize="none"
        spellcheck="false" ${identity ? 'disabled' : ''} value="${identity ? esc(identity.nick) : ''}"
        style="flex:1 1 120px;min-width:0;background:#0b1418;border:1px solid #2a3a42;color:#dfe8ea;border-radius:6px;padding:6px 8px">
      ${identity ? '' : '<button id="sv-login" style="background:#2fa89b;border:0;color:#04262a;border-radius:6px;padding:6px 10px;font-weight:600;cursor:pointer">Далее: пин</button>'}
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <button id="sv-sync" style="background:#1c2c33;border:1px solid #2a3a42;color:#cfe3e6;border-radius:6px;padding:6px 10px;cursor:pointer">Сохранить сейчас</button>
      ${identity ? '<button id="sv-out" style="background:none;border:1px solid #2a3a42;color:#8fa6ae;border-radius:6px;padding:6px 10px;cursor:pointer">Выйти</button>' : ''}
    </div>
    <div id="sv-list" style="margin-top:6px;font-size:12px;opacity:.85">на сервере: …</div>
    <div id="sv-msg" style="margin-top:6px;font-size:12px;color:#ff8d7a;min-height:14px"></div>
    <details style="margin-top:8px;font-size:12px;opacity:.85">
      <summary style="cursor:pointer">сервер БД (lovii/туннель) — постоянное хранилище</summary>
      <div style="margin-top:6px">Адрес вида https://….trycloudflare.com — все сохранения пойдут в БД на этой машине.</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input id="sv-ext" placeholder="https://…" style="flex:1 1 auto;min-width:0;background:#0b1418;border:1px solid #2a3a42;color:#dfe8ea;border-radius:6px;padding:6px 8px">
        <button id="sv-ext-ok" style="background:#1c2c33;border:1px solid #2a3a42;color:#cfe3e6;border-radius:6px;padding:6px 10px;cursor:pointer">OK</button>
      </div>
    </details>
    <details style="margin-top:8px;font-size:12px;opacity:.85">
      <summary style="cursor:pointer">канал записи: PAT GitHub (для игры с Pages)</summary>
      <div style="margin-top:6px">Токен с правом «gist» хранится только в этом браузере и пишет ваш приватный гист напрямую.</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input id="sv-pat" placeholder="ghp_…" type="password"
          style="flex:1 1 auto;min-width:0;background:#0b1418;border:1px solid #2a3a42;color:#dfe8ea;border-radius:6px;padding:6px 8px">
        <button id="sv-pat-ok" style="background:#1c2c33;border:1px solid #2a3a42;color:#cfe3e6;border-radius:6px;padding:6px 10px;cursor:pointer">OK</button>
      </div>
    </details>
    <div style="opacity:.55;font-size:11px;margin-top:6px">Ник запоминается без регистра: первый вход с пином закрепляет его за вами.</div>
    <button id="sv-close" style="margin-top:8px;background:none;border:0;color:#8fa6ae;cursor:pointer">закрыть</button>`;
  document.body.append(panel);
  registerModal('profile', () => { unregisterModal('profile'); panel.remove(); });
  const $ = (id) => panel.querySelector(id);
  // Поле внешнего сервера (lovii): текущее значение + сохранение
  if ($('#sv-ext') && window.__saveGetExt) $('#sv-ext').value = window.__saveGetExt() || '';
  if ($('#sv-ext-ok')) $('#sv-ext-ok').addEventListener('click', () => {
    const v = ($('#sv-ext').value || '').trim().replace(/\/+$/, '');
    window.__saveSetExt(v);
    setMsg(v ? 'внешний сервер сохранён: ' + v : 'внешний сервер очищен', !v);
    apiBase = null; // пересчитать канал
  });
  // PAT-поле: текущее значение + сохранение
  if ($('#sv-pat') && window.__saveGetPat) $('#sv-pat').value = window.__saveGetPat() || '';
  if ($('#sv-pat-ok')) $('#sv-pat-ok').addEventListener('click', () => {
    window.__saveSetPat($('#sv-pat').value);
    setMsg(window.__saveGetPat() ? 'PAT сохранён в этом браузере' : 'PAT удалён', !window.__saveGetPat());
  });
  const msg = $('#sv-msg');
  const setMsg = (text, bad = true) => { if (msg) { msg.textContent = text; msg.style.color = bad ? '#ff8d7a' : '#9be29e'; } };

  const refreshStatus = async () => {
    const stateEl = $('#sv-state');
    if (!identity) {
      // A2: без профиля панель ничего не зондирует — только объясняет, что делать.
      if (stateEl) {
        stateEl.textContent = 'без профиля сеть молчит — войдите в КЦ (U), чтобы сейвы ходили между машинами';
        stateEl.style.color = '#ffbf69';
      }
      const listEl = $('#sv-list');
      if (listEl) listEl.textContent = 'на сервере: — (нужен профиль)';
      return;
    }
    await resolveApi();
    const st = window.__saveApi.status;
    if (stateEl) {
      stateEl.textContent = `сервер: ${st.online ? 'на связи' : 'нет связи'} · канал: ${st.api}` +
        (st.lastPushTs ? ` · записано ${new Date(st.lastPushTs).toLocaleTimeString()}` : '');
      stateEl.style.color = st.online ? '#9be29e' : '#ff8d7a';
    }
    const list = await window.__saveApi.list();
    const listEl = $('#sv-list');
    if (!listEl) return;
    if (list.ok && list.records && list.records.length) {
      listEl.innerHTML = 'на сервере:<br>' + list.records.map((x) =>
        `· ${esc(x.key)} — ${new Date(x.ts).toLocaleString()}${x.bytes ? ' · ' + (x.bytes / 1024).toFixed(1) + ' КБ' : ''}`
      ).join('<br>');
    } else {
      listEl.textContent = list.ok ? 'на сервере пусто — база запишется при игре' : 'список недоступен: ' + (list.error || '');
    }
  };

  $('#sv-close').addEventListener('click', () => { unregisterModal('profile'); panel.remove(); });
  $('#sv-sync').addEventListener('click', async () => {
    setMsg('сохраняю…', false);
    const st = await window.__saveApi.pushAll();
    setMsg(st.lastError ? 'ошибка: ' + st.lastError : 'готово', !!st.lastError);
    refreshStatus();
  });
  const outBtn = $('#sv-out');
  if (outBtn) outBtn.addEventListener('click', () => {
    // Выход стирает профиль и локальную базу — сначала подтверждение
    // (одна модалка, канон [18]); после него чистим и перезагружаемся.
    confirmSignOut(() => {
      window.__saveApi.clearIdentity();
      location.reload();
    });
  });
  // P1 (#45): ШАГ 1 (ник) живёт в панели, ШАГ 2 (пинпад) — отдельная модалка
  // auth-ui: текстового поля для пина больше нет ни на телефоне, ни на десктопе.
  const loginBtn = $('#sv-login');
  if (loginBtn) loginBtn.addEventListener('click', () => {
    const nickEl = $('#sv-nick');
    const nick = normalizeNick(nickEl ? nickEl.value : '');
    if (!/^[a-zA-Zа-яА-Я0-9_-]{2,24}$/.test(nick)) { setMsg('ник: 2–24 буквы/цифры/-/_'); return; }
    // Одна модалка за раз: панель профиля уступает место пинпаду.
    unregisterModal('profile');
    panel.remove();
    openAuth(window.game, { step: 'pin', nick });
  });
  refreshStatus();
};

// ------------------------------------------------------------------
// Жизненный цикл синхронизации.
// ------------------------------------------------------------------
// A2 (аудит владельца 26.10.2026): без профиля — НОЛЬ сетевых запросов.
// Порядок: есть профиль → ищем канал и сверяемся; нет профиля → тишина
// (никаких /health, /api/save, /api/load, sendBeacon). Панель профиля и вход
// по нику+пину — единственные места, где сеть просыпается: это действие
// игрока, а не фоновая синхронизация.
// C1 (кросс-браузер): raid-boot должен дождаться ЭТОЙ сверки, иначе он читает
// пустой localStorage и стартует новую базу, хотя на сервере лежит прогресс
// владельца. Промис публикуем ДО ожидания внутри — boot подписывается на него.
window.__saveReady = (async () => {
  if (!identity) { apiMode = 'нужен профиль'; return false; }
  try {
    await resolveApi();
    // Публичный API нужен ДО сверки — им пользуется панель и raid-boot.
    await reconcile();
    return true;
  } catch { return false; }
})();
await window.__saveReady;
setInterval(() => {
  if (!identity) return; // A2: анонимный таймер спит
  for (const k of SYNC_KEYS) push(k);
  pushStats();
}, 15000);
document.addEventListener('visibilitychange', () => {
  if (!identity || !document.hidden) return;
  for (const k of SYNC_KEYS) push(k, { force: true });
});
// Уход со страницы: обычный fetch может не успеть — досылаем sendBeacon.
// Тело отправляем как text/plain, чтобы браузер не требовал preflight;
// сервер и так разбирает JSON независимо от Content-Type.
function beaconFlush() {
  if (!identity) return; // A2: уходя со страницы аноним тоже молчит
  try {
    const base = apiBase === null ? '' : apiBase;
    for (const key of SYNC_KEYS) {
      const value = readLS(key);
      if (value == null || lastSynced[key] === value) continue;
      const payload = JSON.stringify({
        player: identity ? identity.nick : player,
        key: srvOf(key), value, pin: identity ? identity.pin : undefined,
      });
      navigator.sendBeacon?.(`${base}/api/save`, new Blob([payload], { type: 'text/plain' }));
    }
  } catch { /* приватный режим */ }
}
setTimeout(() => { if (identity) pushStats(); }, 4000);
addEventListener('pagehide', beaconFlush);
addEventListener('beforeunload', beaconFlush);

console.log(identity
  ? `[save] клиент активен, канал ${apiMode}, профиль «${identity.nick}»`
  : '[save] профиля нет — сеть молчит (вход: выделить КЦ → «Профиль» (U))');
