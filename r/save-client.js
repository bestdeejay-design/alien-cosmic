// save-client.js — ПРИМИТИВНЫЙ клиент сохранения прогресса в БД на внешней машине.
// Полигон r/: показывает живой круг «игра → сервер (chuwi/lovii/fonotext) → игра».
// Идентификация: НИК + ПИН (два значения по решению владельца 25.10.2026).
//   Первый save под ником регистрирует его на сервере с этим пином;
//   дальше все операции требуют тот же пин (чужой ник без пина — 403).
//   Если игрок отменил ввод — анонимный случайный id (прогресс не ходит между машинами).
const SYNC_KEYS = ['terranrts.progress', 'terranrts.quickBattle'];
const NICK_KEY = 'ac_save_nick';
const PIN_KEY = 'ac_save_pin';
const ANON_KEY = 'ac_save_player_id';
const PORT = 8790;
const API = `http://${location.hostname}:${PORT}`;

function askIdentity() {
  try {
    let nick = localStorage.getItem(NICK_KEY);
    let pin = localStorage.getItem(PIN_KEY);
    if (nick && pin) return { nick, pin };
    return null; // идентификации нет — оверлей предложит ввести ниже
  } catch { return null; }
}

// Мини-форма «ник + пин» поверх страницы (примитив; Арена заменит на нормальную).
// Пока игрок не заполнил — работает анонимный режим. Заполнение → перезагрузка.

// Мини-чип профиля в углу: кто вошёл + «сменить» (сброс ника/пина → форма заново).
// Решение владельца 25.10: он ввёл ник/пин неверно и застрял в чужом профиле.

const identity = askIdentity();
window.__saveIdentity = identity; // raid-boot читает для серверного восстановления
const player = identity ? identity.nick
  : (() => {
      let id = null;
      try {
        id = localStorage.getItem(ANON_KEY);
        if (!id) { id = 'anon-' + Math.random().toString(36).slice(2, 10); localStorage.setItem(ANON_KEY, id); }
      } catch { id = 'anon-' + Math.random().toString(36).slice(2, 10); }
      return id;
    })();

// lastSynced[key] — значение, которое сервер уже видел (после push или pull).
// Push уходит только при отличии от lastSynced: уход со страницы не перетирает
// чужие изменения «пустым» локальным значением (урок первого теста).
const lastSynced = {};

async function push(key) {
  let value = null;
  try { value = localStorage.getItem(key); } catch { return; }
  if (value == null || lastSynced[key] === value) return;
  try {
    const r = await fetch(`${API}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player, key, value, pin: identity && identity.pin }),
    });
    const j = await r.json();
    if (j.ok) { lastSynced[key] = value; console.log('[save] отправлен на сервер:', key); }
    else if (r.status === 403) console.warn('[save] 403: ник занят, пин не подошёл — записи НЕ отправляются');
  } catch (e) { /* сервер недоступен — играем локально */ }
}

async function pull() {
  if (!identity) return; // аноним не тянем с чужих записей
  for (const key of SYNC_KEYS) {
    try {
      const r = await fetch(`${API}/api/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player, key, pin: identity.pin }),
      });
      const j = await r.json();
      if (j.ok) {
        try {
          localStorage.setItem(key, j.value);
          lastSynced[key] = j.value;
          console.log('[save] восстановлен с сервера:', key);
        } catch { /* приватный режим */ }
      }
    } catch { /* сервер недоступен */ }
  }
}

// Панель профиля — открывается командой КЦ «Профиль».
window.showProfilePanel = function () {
  const old = document.getElementById('sv-panel');
  if (old) { old.remove(); return; }
  const panel = document.createElement('div');
  panel.id = 'sv-panel';
  panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;' +
    'background:#101c22;border:1px solid #2a3a42;border-radius:12px;padding:14px 16px;font:13px system-ui;color:#dfe8ea;' +
    'box-shadow:0 8px 32px rgba(0,0,0,.6);width:280px';
  const savesNote = identity
    ? `Профиль: <b style="color:#dfe8ea">${identity.nick}</b>`
    : 'Профиль не выбран (аноним — прогресс не ходит между машинами)';
  panel.innerHTML = `
    <div style="font-weight:600;margin-bottom:8px">Профиль и сохранения</div>
    <div style="opacity:.75;margin-bottom:10px">${savesNote}</div>
    <input id="sv-nick" placeholder="ник" style="width:120px;margin-right:6px;background:#0b1418;border:1px solid #2a3a42;color:#dfe8ea;border-radius:6px;padding:4px 8px">
    <input id="sv-pin" placeholder="пин" style="width:70px;margin-right:6px;background:#0b1418;border:1px solid #2a3a42;color:#dfe8ea;border-radius:6px;padding:4px 8px">
    <button id="sv-ok" style="background:#2fa89b;border:0;color:#04262a;border-radius:6px;padding:4px 10px;font-weight:600;cursor:pointer">Войти</button>
    <div id="sv-list" style="margin-top:10px;font-size:12px;opacity:.8">сохранения: …</div>
    <div id="sv-msg" style="margin-top:6px;font-size:12px;color:#ff8d7a;min-height:14px"></div>
    <button id="sv-close" style="margin-top:8px;background:none;border:0;color:#8fa6ae;cursor:pointer">закрыть</button>`;
  document.body.append(panel);
  panel.querySelector('#sv-close').addEventListener('click', () => panel.remove());
  if (identity) {
    panel.querySelector('#sv-nick').value = identity.nick;
    try {
      fetch(`${API}/api/list?player=${encodeURIComponent(identity.nick)}`)
        .then((r) => r.json())
        .then((j) => {
          const el = panel.querySelector('#sv-list');
          if (j.ok && j.records.length) {
            el.textContent = 'на сервере: ' + j.records.map((x) => x.key.replace('ac_', '').replace('terranrts.', '') + ' (' + new Date(x.ts).toLocaleTimeString() + ')').join(', ');
          } else el.textContent = 'на сервере пусто — база сохранится при игре';
        });
    } catch { /* */ }
  }
  panel.querySelector('#sv-ok').addEventListener('click', () => {
    const nick = panel.querySelector('#sv-nick').value.trim();
    const pin = panel.querySelector('#sv-pin').value.trim();
    if (!/^[a-zA-Zа-яА-Я0-9_-]{2,24}$/.test(nick) || !pin) {
      panel.querySelector('#sv-msg').textContent = 'ник 2–24 буквы/цифры, пин не пустой';
      return;
    }
    // проверка входа: если ник занят другим пином — сервер откажет при первом же сейве,
    // поэтому пробуем load: пусто = новый профиль, ок = верный пин, 403 = чужой пин
    fetch(`${API}/api/load`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: nick, pin, key: '__check__' }),
    }).then(async (r) => {
      if (r.status === 403) {
        panel.querySelector('#sv-msg').textContent = 'ник занят, пин не подошёл';
        return;
      }
      try { localStorage.setItem(NICK_KEY, nick); localStorage.setItem(PIN_KEY, pin); } catch { /* */ }
      location.reload();
    });
  });
};

// Примитивная стратегия: при старте тянем, затем толкаем; дальше — раз в 20 секунд и при уходе.
await pull();
for (const k of SYNC_KEYS) push(k);
setInterval(() => { for (const k of SYNC_KEYS) push(k); }, 20000);
addEventListener('beforeunload', () => { for (const k of SYNC_KEYS) push(k); });
// ВЛАДЕЛЕЦ 25.10: вход/профиль/сохранения — ТОЛЬКО внутри КЦ (команда строения),
// в хедере ничего нет. КЦ зовёт window.showProfilePanel().
console.log('[save] полигон: клиент сейва активен, сервер', API,
  identity ? `ник «${player}»` : `анонимно (${player})`);
