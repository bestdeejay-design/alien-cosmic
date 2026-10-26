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

import { closeOthers, registerModal, unregisterModal } from './js/modals.js?v=10262518';
import { t } from './js/i18n.js?v=10262518';

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

function notifySaveError(text) {
  const now = Date.now();
  if (lastSaveErrorShown === text && now - lastSaveToastTs < SAVE_TOAST_MS) return;
  if (now - lastSaveToastTs < SAVE_TOAST_MS && lastSaveErrorShown === text) return;
  lastSaveErrorShown = text;
  lastSaveToastTs = now;
  try {
    const g = window.game;
    if (g && g.ui && typeof g.ui.toast === 'function' && g.state) {
      // Локаль — единый ключ (RU/EN симметрично), текст ошибки подставляется.
      g.ui.toast(t('ui.save.failed', { err: text }), 'warn', 4200);
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

async function reconcile() {
  if (!identity) return;
  const list = await window.__saveApi.list();
  for (const key of SYNC_KEYS) {
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
    notifySaveError(status.lastError);   // З3: игрок видит, что сейв не ушёл
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

// Публичный API для остальных модулей полигона (raid-boot).
window.__saveApi = {
  keys: SYNC_KEYS,
  get identity() { return identity; },
  get status() { return { ...status, api: apiMode }; },
  pullKey: (key) => pull(key),
  pullAll,
  pushKey: (key) => push(key, { force: true }),
  pushAll: async () => { for (const key of SYNC_KEYS) await push(key, { force: true }); return status; },
  setIdentity: (nick, pin) => {
    writeLS(NICK_KEY, nick); writeLS(PIN_KEY, pin);
    identity = { nick, pin }; window.__saveIdentity = identity;
  },
  clearIdentity: () => {
    try { localStorage.removeItem(NICK_KEY); localStorage.removeItem(PIN_KEY); } catch { /* */ }
    identity = null; window.__saveIdentity = null;
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
      <input id="sv-nick" placeholder="ник" maxlength="24" value="${identity ? esc(identity.nick) : ''}"
        style="flex:1 1 120px;min-width:0;background:#0b1418;border:1px solid #2a3a42;color:#dfe8ea;border-radius:6px;padding:6px 8px">
      <input id="sv-pin" placeholder="пин" inputmode="numeric" maxlength="12" type="password"
        style="width:84px;background:#0b1418;border:1px solid #2a3a42;color:#dfe8ea;border-radius:6px;padding:6px 8px">
      <button id="sv-ok" style="background:#2fa89b;border:0;color:#04262a;border-radius:6px;padding:6px 10px;font-weight:600;cursor:pointer">Войти</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <button id="sv-sync" style="background:#1c2c33;border:1px solid #2a3a42;color:#cfe3e6;border-radius:6px;padding:6px 10px;cursor:pointer">Сохранить сейчас</button>
      ${identity ? '<button id="sv-out" style="background:none;border:1px solid #2a3a42;color:#8fa6ae;border-radius:6px;padding:6px 10px;cursor:pointer">Выйти</button>' : ''}
    </div>
    <div id="sv-list" style="margin-top:6px;font-size:12px;opacity:.85">на сервере: …</div>
    <div id="sv-msg" style="margin-top:6px;font-size:12px;color:#ff8d7a;min-height:14px"></div>
    <div style="opacity:.55;font-size:11px;margin-top:6px">Ник запоминается без регистра: первый вход с пином закрепляет его за вами.</div>
    <button id="sv-close" style="margin-top:8px;background:none;border:0;color:#8fa6ae;cursor:pointer">закрыть</button>`;
  document.body.append(panel);
  registerModal('profile', () => { unregisterModal('profile'); panel.remove(); });
  const $ = (id) => panel.querySelector(id);
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
    window.__saveApi.clearIdentity();
    location.reload();
  });
  $('#sv-ok').addEventListener('click', async () => {
    const nick = ($('#sv-nick').value || '').trim();
    const pin = ($('#sv-pin').value || '').trim();
    if (!/^[a-zA-Zа-яА-Я0-9_-]{2,24}$/.test(nick)) { setMsg('ник: 2–24 буквы/цифры/-/_'); return; }
    if (!/^\d{3,12}$/.test(pin)) { setMsg('пин: 3–12 цифр'); return; }
    setMsg('проверяю профиль…', false);
    // Ручной вход — единственное место, где сеть разрешена без профиля.
    const base = apiBase === null ? await resolveApi(true) : apiBase;
    try {
      const r = await fetch(`${base}/api/load`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: nick, pin, key: '__check__' }),
      });
      if (r.status === 403) { setMsg('этот ник занят другим пином'); return; }
      const j = await r.json().catch(() => ({}));
      window.__saveApi.setIdentity((j && j.player) || nick, pin);
      setMsg('вхожу, база подтянется после перезагрузки…', false);
      setTimeout(() => location.reload(), 350);
    } catch {
      // сервера нет — сохраняем локально, играем офлайн
      window.__saveApi.setIdentity(nick, pin);
      setMsg('сервер недоступен: профиль сохранён локально', false);
      setTimeout(() => location.reload(), 700);
    }
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
