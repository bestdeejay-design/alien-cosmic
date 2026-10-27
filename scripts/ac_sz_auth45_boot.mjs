// ============================================================
// ac_sz_auth45_boot.mjs — АВТОПРИЁМКА этапа P1 «Авторизация поэтапно» (#45):
// сквозной путь ЧЕРЕЗ BOOT (raid-boot.js), как у живого игрока:
//
//   есть профиль (ник+пин в localStorage) → загрузка страницы → raid-boot
//   → pull снапшота с индикатором → база встаёт в state → «КЦ-16»
//
// Доказываем ровно то, на что жаловался владелец (баг №1 «вход не даёт базу»):
// симуляция НЕ стартует до pull, снапшот применяется до первого тика, и
// серверный прогресс не затирается «новой базой».
//
// Сценарии (argv[2]):
//   cloud    — сервер отвечает снапшотом: КЦ-16 до первого тика;
//   offline  — сервер молчит, игрок жмёт «Играть офлайн»;
//   later    — сервер молчит, игрок закрывает панель кнопкой «Позже» —
//              гейт ОБЯЗАН завершиться (блокер ревью №2: раньше boot висел);
//   esc      — то же, но двумя Escape (первый чистит точки/ничего, второй
//              закрывает панель) — тоже не должно вешать boot.
//
// Запуск: node scripts/ac_sz_auth45_boot.mjs [cloud|offline|later|esc]
// ============================================================
import { fireWindow } from './harness.mjs';

const MODE = ['offline', 'later', 'esc'].includes(process.argv[2]) ? process.argv[2] : 'cloud';
const SERVER_DOWN = MODE !== 'cloud';
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
  if (path.endsWith('/health')) return SERVER_DOWN ? (() => { throw new Error('offline'); })() : resp(200, { ok: true });
  if (SERVER_DOWN) throw new Error('network down');
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
// «Игрок» реагирует на экран выбора, как только панель его показала:
//   offline — «Играть офлайн»; later — «Позже»; esc — Escape, Escape.
// Без реакции гейт обязан ждать (10 с таймаут pull), но ЛЮБОЕ закрытие панели
// должно его завершить — это и есть фикс блокера ревью №2.
let clicked = 0;
let sawOffline = false;
if (SERVER_DOWN) {
  const timer = setInterval(() => {
    const ov = document.body.children.find((c) => c && c.id === 'auth-overlay');
    if (!ov) return;
    // Экран выбора узнаём по его же кнопкам: состояние модуля к этому моменту
    // может быть ещё не импортировано (auth-ui тянется через save-client).
    const offlineScreen = !!ov.querySelector('#auth-offline');
    if (offlineScreen) sawOffline = true;
    if (MODE === 'offline') {
      const btn = ov.querySelector('#auth-offline');
      if (btn && typeof btn.click === 'function') { btn.click(); clicked++; clearInterval(timer); }
    } else if (MODE === 'later') {
      const btn = ov.querySelector('#auth-close');
      if (btn && typeof btn.click === 'function') { btn.click(); clicked++; clearInterval(timer); }
    } else if (MODE === 'esc') {
      if (offlineScreen) {
        // Первый Escape: на шаге pull/offline точек нет — панель закрывается им же;
        // второй Escape не должен ломать игру (idempotent, как у живого игрока).
        fireWindow('keydown', { key: 'Escape', code: 'Escape' });
        fireWindow('keydown', { key: 'Escape', code: 'Escape' });
        clicked += 2;
        clearInterval(timer);
      }
    }
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
  // Никакого двойного pull: базу рейда на старте тянет ТОЛЬКО гейт
  // (итерация 2 ревью #45 — раньше был ещё pullKey после reconcile).
  const raidLoads = net.calls.filter((c) => c.path.includes('/api/load') && String(c.body || '').includes(KEY));
  eq(raidLoads.length, 1, 'базу рейда тянули ' + raidLoads.length + ' раза за старт (ожидался один pull)');
  const checkLoads = net.calls.filter((c) => c.path.includes('/api/load') && String(c.body || '').includes('__check__'));
  eq(checkLoads.length, 0, 'boot проверял пин через __check__ (лишний запрос: __saveReady уже сверил профиль)');
  eq(A.isAuthOpen(), false, 'после успешного pull панель входа осталась на экране');
  console.log('PASS  BOOT вход → pull → КЦ-16: база на месте до первого тика, панель закрыта');
} else {
  // Сервера нет — boot обязан прийти в играбельную базу, а не висеть на гейте.
  assert(game.state.buildings.some((b) => !b.dead && b.side === 'player' && b.type === 'cc'), 'офлайн-boot без КЦ');
  assert(!game.state.gameOver, 'офлайн-boot пришёл в gameOver');
  assert(sawOffline, 'панель не дошла до экрана выбора (нет ни спиннера, ни офлайна)');
  eq(A.isAuthOpen(), false, 'панель входа осталась висеть поверх игры');
  if (MODE === 'offline') {
    eq(clicked, 1, 'офлайн-фолбэк не был нажат (boot завис бы на панели)');
    console.log('PASS  BOOT офлайн: сервер молчит, база из локального сейва играбельна (без зависания)');
  } else if (MODE === 'later') {
    eq(clicked, 1, 'кнопка «Позже» не была нажата');
    console.log('PASS  BOOT «Позже»: закрытие панели завершает гейт, игра стартует на локальной базе');
  } else {
    eq(clicked, 2, 'Escape не был отправлен дважды');
    console.log('PASS  BOOT Escape-Escape: панель закрыта, гейт завершён, игра стартует (без зависания)');
  }
}
process.exit(0); // raid-boot держит setInterval(сейв) — без выхода сим не завершается
