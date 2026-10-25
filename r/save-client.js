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
const SYNC_KEYS = ['terranrts.progress', 'terranrts.quickBattle', 'ac_raid_session_v1'];
const NICK_KEY = 'ac_save_nick';
const PIN_KEY = 'ac_save_pin';
const ANON_KEY = 'ac_save_player_id';
const PORT = 8790;

const readLS = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } };

// ---- Адрес API: same-origin /api → иначе прямой порт 8790 ----
let apiBase = null;
let apiMode = 'не проверен';
async function resolveApi() {
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

// Разрешение конфликтов «локально ↔ сервер» по времени сервера:
//   serverTs > localTs → сервер новее, забираем (вторая машина играла);
//   иначе              → локальный прогресс новее, отправляем.
// Без этого первый же запуск на второй машине мог откатить базу назад.
async function reconcile() {
  if (!identity) return;
  const list = await window.__saveApi.list();
  for (const key of SYNC_KEYS) {
    const local = readLS(key);
    const localTs = Number(readLS(TS_PREFIX + key) || 0);
    const rec = list && list.ok && Array.isArray(list.records) ? list.records.find((x) => x.key === key) : null;
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
  const value = readLS(key);
  if (value == null) return false;
  if (!force && lastSynced[key] === value) return false;
  try {
    const { j, status: code } = await call('/api/save', {
      player: identity ? identity.nick : player,
      key, value, pin: identity ? identity.pin : undefined,
    });
    if (j.ok) {
      lastSynced[key] = value;
      if (j.ts) writeLS(TS_PREFIX + key, String(j.ts));
      status.online = true; status.lastError = ''; status.lastPushTs = Date.now();
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
    return false;
  } catch (e) {
    status.online = false;
    status.lastError = 'сервер недоступен';
    return false;
  }
}

async function pull(key) {
  if (!identity) return null;
  try {
    const { j } = await call('/api/load', {
      player: identity.nick, key, pin: identity.pin,
    });
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
  list: async () => {
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
  if (old) { old.remove(); return; }
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
  const $ = (id) => panel.querySelector(id);
  const msg = $('#sv-msg');
  const setMsg = (text, bad = true) => { if (msg) { msg.textContent = text; msg.style.color = bad ? '#ff8d7a' : '#9be29e'; } };

  const refreshStatus = async () => {
    await resolveApi();
    const st = window.__saveApi.status;
    const stateEl = $('#sv-state');
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

  $('#sv-close').addEventListener('click', () => panel.remove());
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
    const base = apiBase === null ? await resolveApi() : apiBase;
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
await resolveApi();
// Публичный API нужен ДО сверки — им пользуется панель и raid-boot.
await reconcile();
setInterval(() => { for (const k of SYNC_KEYS) push(k); }, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) for (const k of SYNC_KEYS) push(k, { force: true });
});
// Уход со страницы: обычный fetch может не успеть — досылаем sendBeacon.
// Тело отправляем как text/plain, чтобы браузер не требовал preflight;
// сервер и так разбирает JSON независимо от Content-Type.
function beaconFlush() {
  try {
    const base = apiBase === null ? '' : apiBase;
    for (const key of SYNC_KEYS) {
      const value = readLS(key);
      if (value == null || lastSynced[key] === value) continue;
      const payload = JSON.stringify({
        player: identity ? identity.nick : player,
        key, value, pin: identity ? identity.pin : undefined,
      });
      navigator.sendBeacon?.(`${base}/api/save`, new Blob([payload], { type: 'text/plain' }));
    }
  } catch { /* приватный режим */ }
}
addEventListener('pagehide', beaconFlush);
addEventListener('beforeunload', beaconFlush);

console.log('[save] клиент активен, канал', apiMode,
  identity ? `профиль «${player}»` : `анонимно (${player})`);
