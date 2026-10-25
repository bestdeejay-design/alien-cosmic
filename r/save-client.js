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
function showIdentityForm() {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9999;background:#101c22;' +
    'border:1px solid #2a3a42;border-radius:10px;padding:10px 12px;font:13px system-ui;color:#dfe8ea;box-shadow:0 4px 16px rgba(0,0,0,.5)';
  box.innerHTML = `
    <div style="margin-bottom:6px;opacity:.8">Сохранение прогресса: ник и пин</div>
    <input id="sv-nick" placeholder="ник" style="width:140px;margin-right:6px;background:#0b1418;border:1px solid #2a3a42;color:#dfe8ea;border-radius:6px;padding:4px 8px">
    <input id="sv-pin" placeholder="пин" style="width:80px;margin-right:6px;background:#0b1418;border:1px solid #2a3a42;color:#dfe8ea;border-radius:6px;padding:4px 8px">
    <button id="sv-ok" style="background:#2fa89b;border:0;color:#04262a;border-radius:6px;padding:4px 10px;font-weight:600;cursor:pointer">OK</button>
    <button id="sv-skip" style="background:none;border:0;color:#8fa6ae;cursor:pointer;margin-left:4px">позже</button>`;
  document.body.append(box);
  box.querySelector('#sv-ok').addEventListener('click', () => {
    const nick = box.querySelector('#sv-nick').value.trim();
    const pin = box.querySelector('#sv-pin').value.trim();
    if (!/^[a-zA-Zа-яА-Я0-9_-]{2,24}$/.test(nick) || !pin) {
      box.querySelector('#sv-nick').style.borderColor = '#ff8d7a';
      return;
    }
    try { localStorage.setItem(NICK_KEY, nick); localStorage.setItem(PIN_KEY, pin); } catch { /* */ }
    location.reload();
  });
  box.querySelector('#sv-skip').addEventListener('click', () => box.remove());
}

const identity = askIdentity();
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

// Примитивная стратегия: при старте тянем, затем толкаем; дальше — раз в 20 секунд и при уходе.
await pull();
for (const k of SYNC_KEYS) push(k);
setInterval(() => { for (const k of SYNC_KEYS) push(k); }, 20000);
addEventListener('beforeunload', () => { for (const k of SYNC_KEYS) push(k); });
if (!identity && document.body) showIdentityForm();
else if (!identity) addEventListener('DOMContentLoaded', () => showIdentityForm());
console.log('[save] полигон: клиент сейва активен, сервер', API,
  identity ? `ник «${player}»` : `анонимно (${player})`);
