// ============================================================
// ac_sz_auth45_boot.mjs — АВТОПРИЁМКА этапа P1 «Авторизация поэтапно» (#45):
// сквозной путь ЧЕРЕЗ BOOT (raid-boot.js), как у живого игрока:
//
//   есть профиль (ник+пин в localStorage) → загрузка страницы → raid-boot
//   → pull снапшота с индикатором → база встаёт в state → «КЦ-16»
//
// Доказываем ровно то, на что жаловался владелец (баг №1 «вход не даёт базу»):
// симуляция НЕ стартует до pull, снапшот применяется до первого тика, и
// серверный прогресс не затирается «новой базой». Плюс проверяем, что при
// офлайн-сервере boot не виснет: гейт показывает фолбэк, игра продолжается.
//
// Запуск: node scripts/ac_sz_auth45_boot.mjs [cloud|offline]
// ============================================================
import './harness.mjs';

const MODE = process.argv[2] === 'offline' ? 'offline' : 'cloud';
const KEY = 'ac_raid_session_v1';
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m}: ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`);

// ---- сеть: облачный снапшот лежит в переменной cloud (заполним ниже) ----
const net = { calls: [], cloud: null };
const resp = (status, obj) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => obj,
});
globalThis.fetch = async (url, opts = {}) => {
  const path = String(url);
  net.calls.push({ path, body: opts.body });
  if (path.endsWith('/health')) return MODE === 'offline' ? (() => { throw new Error('offline'); })() : resp(200, { ok: true });
  if (MODE === 'offline') throw new Error('network down');
  let body = {};
  try { body = JSON.parse(opts.body || '{}'); } catch { /* пусто */ }
  if (path.endsWith('/api/load')) {
    if (body.key === '__check__') return resp(200, { ok: false, error: 'not found', player: body.player });
    if (body.key === KEY && net.cloud) return resp(200, { ok: true, value: net.cloud, ts: Date.now() });
    return resp(200, { ok: false, error: 'not found' });
  }
  if (path.endsWith('/api/save')) return resp(200, { ok: true, ts: Date.now() });
  if (path.includes('/api/list')) return resp(200, { ok: true, records: [] });
  return resp(200, { ok: true });
};
globalThis.location = { protocol: 'http:', hostname: 'polygon.test', reload: () => {} };
try {
  Object.defineProperty(globalThis.navigator, 'sendBeacon', { value: () => true, configurable: true, writable: true });
} catch { /* node без navigator */ }
if (typeof globalThis.dispatchEvent !== 'function') globalThis.dispatchEvent = () => true;
globalThis.Event = globalThis.Event || class Event { constructor(t) { this.type = t; } };

// ---- 1) «сервер»: собираем настоящую базу КЦ-16 движком и кладём в облако ----
await import('../r/js/game.js');
const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
game.startRaidHome('human', { forceNew: true });
const cc = (game.state.buildings || []).find((b) => b && !b.dead && b.side === 'player' && b.type === 'cc');
assert(cc, 'на домашней базе нет КЦ');
cc.level = 16;
cc.done = true;
game.syncRaidHomeSnapshot();
net.cloud = JSON.stringify(game.raidSession);
assert(net.cloud.length > 100, 'облачный снапшот пуст');

// ---- 2) «новый браузер»: профиль есть, локальной базы нет ----
localStorage.setItem('ac_save_nick', 'best');
localStorage.setItem('ac_save_pin', '1234');
localStorage.removeItem(KEY);
game.raidSession = null;
game.started = false;
net.calls.length = 0;

// ---- 3) живой boot полигона: он сам решает, когда стартовать симуляцию ----
// Офлайн-сценарий: «игрок» нажимает «Играть офлайн», как только панель его
// предложила (это и есть канон §A «явный офлайн-фолбэк», а не тихий старт).
let clicked = 0;
if (MODE === 'offline') {
  const timer = setInterval(() => {
    const ov = document.body.children.find((c) => c && c.id === 'auth-overlay');
    const btn = ov && ov.querySelector('#auth-offline');
    if (btn && typeof btn.click === 'function') { btn.click(); clicked++; clearInterval(timer); }
  }, 20);
  setTimeout(() => clearInterval(timer), 12000);
}
await import('../r/save-client.js');
await import('../r/raid-boot.js');

const A = await import('../r/js/auth-ui.js' + (await import('./stamp.mjs')).V);
eq(game.started, true, 'boot не дошёл до старта сессии');
assert(game.state && game.state.raidMode === 'home', 'raidMode !== home');

if (MODE === 'cloud') {
  const ccNow = (game.state.buildings || []).find((b) => b && !b.dead && b.side === 'player' && b.type === 'cc');
  assert(ccNow, 'КЦ на базе отсутствует');
  eq(ccNow.level, 16, 'КЦ после входа не 16 уровня (снапшот не применился до старта)');
  assert(net.calls.some((c) => c.path.includes('/api/load') && String(c.body || '').includes(KEY)),
    'boot ни разу не запросил базу рейда у сервера — симуляция стартовала до pull');
  assert(localStorage.getItem(KEY), 'снапшот не лёг в localStorage после boot');
  eq(A.isAuthOpen(), false, 'после успешного pull панель входа осталась на экране');
  console.log('PASS  BOOT вход → pull → КЦ-16: база на месте до первого тика, панель закрыта');
} else {
  // Офлайн: сервера нет, но boot обязан прийти в играбельную базу, а не висеть.
  assert(game.state.buildings.some((b) => !b.dead && b.side === 'player' && b.type === 'cc'), 'офлайн-boot без КЦ');
  assert(!game.state.gameOver, 'офлайн-boot пришёл в gameOver');
  eq(clicked, 1, 'офлайн-фолбэк не был нажат (boot завис бы на панели)');
  console.log('PASS  BOOT офлайн: сервер молчит, база из локального сейва играбельна (без зависания)');
}
process.exit(0); // raid-boot держит setInterval(сейв) — без выхода сим не завершается
