// save-client.js — ПРИМИТИВНЫЙ клиент сохранения прогресса в БД на внешней машине.
// Полигон r/: показывает живой круг «игра → сервер (chuwi/lovii/fonotext) → игра».
// Что синхронизируем: ключи localStorage с прогрессом (кампания, конфиг быстрого боя).
// Игровой движок не трогаем; арбитр «чей сейв новее» — метка времени сервера.
const SYNC_KEYS = ['terranrts.progress', 'terranrts.quickBattle'];
const PLAYER_KEY = 'ac_save_player_id';
const PORT = 8790;
const API = `http://${location.hostname}:${PORT}`;

function playerId() {
  let id = null;
  try { id = localStorage.getItem(PLAYER_KEY); } catch { /* приватный режим */ }
  if (!id) {
    id = 'p-' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(PLAYER_KEY, id); } catch { /* приватный режим */ }
  }
  return id;
}
const PLAYER = playerId();
// lastSynced[key] — значение, которое сервер уже видел (после push или pull).
// Push уходит только при отличии от lastSynced: уход со страницы не перетирает
// чужие изменения «пустым» локальным значением (урок первого теста).
const lastSynced = {};

async function push(key) {
  let value = null;
  try { value = localStorage.getItem(key); } catch { return; }
  if (value == null || lastSynced[key] === value) return;
  try {
    await fetch(`${API}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: PLAYER, key, value }),
    });
    lastSynced[key] = value;
    console.log('[save] отправлен на сервер:', key);
  } catch (e) { /* сервер недоступен — играем локально */ }
}

async function pull() {
  for (const key of SYNC_KEYS) {
    try {
      const r = await fetch(`${API}/api/load?player=${encodeURIComponent(PLAYER)}&key=${encodeURIComponent(key)}`);
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
console.log('[save] полигон: клиент сейва активен, сервер', API, 'игрок', PLAYER);
