// ============================================================
// ac_sz_auth45.mjs — АВТОПРИЁМКА этапа P1 «Авторизация поэтапно»
// (ACE / Alien Cosmic: Expedition, issue #45; спека ace/03-spec/
// auth-ci-stands.md §A, приоритетный §4 «Итоги аудита»).
//
// Стиль `ac_sz_*`: headless, без браузера, печатает PASS/FAIL по шагам,
// итог — код возврата. Что доказываем:
//   A  пинпад: 3×4 (1-9, «C», 0, «⌫»), «C» чистит ВСЁ, «⌫» — последнюю,
//      пин 3–12 (13-я цифра не принимается), Escape чистит точки и
//      НЕ закрывает панель, короткий пин уходит в ошибку без сети;
//   B  разметка и оформление: одна модалка (канон check_r [18]), клавиши
//      ≥48px и touch-action: manipulation, autocomplete="username", 12 точек;
//   C  RU/EN симметричны, «С» ↔ «C» (не «C» в русской локали);
//   D  неверный пин → шейк + очистка точек + ключ errPinWrong; 429 → кулдаун;
//   E  ГЛАВНОЕ: вход → пинпад → pull снапшота → в state КЦ-16 (баг №1:
//      раньше «вход» давал новую базу, потому что симуляция стартовала до pull);
//   F  таймаут 10 с (в тесте ускоренный): спиннер → «Повторить»/офлайн-фолбэк;
//   G  выход = полная очистка: все ключи профиля и базы удалены, «мягкие»
//      настройки устройства (язык/звук) и ключи S1 целы;
//   H  сервер: 5 неудач → кулдаун 60 с (живой save-server.mjs, Rate-Limit),
//      чужие ники кулдаун не наследуют; успех сбрасывает серию.
//
// Запуск: node scripts/ac_sz_auth45.mjs
// ============================================================
import { fireWindow } from './harness.mjs';
import { V } from './stamp.mjs';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const failures = [];
const skips = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const skip = (m) => { skips.push(m); console.log(`SKIP  ${m}`); };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m}: ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`);

// ---------- сеть: один управляемый стаб на весь прогон ----------
// Настоящий fetch сохраняем: живой save-server (шаг H) проверяется им,
// а не игровым стабом.
const realFetch = globalThis.fetch;
const net = { mode: 'cloud', calls: [], cloud: null };
const resp = (status, obj, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] || headers[String(k).toLowerCase()] || null },
  json: async () => obj,
});
globalThis.fetch = async (url, opts = {}) => {
  const path = String(url);
  net.calls.push({ path, body: opts.body, method: opts.method || 'GET' });
  if (path.endsWith('/health')) return resp(200, { ok: true });
  if (net.mode === 'hang') return new Promise(() => {});       // «сервер молчит»
  if (net.mode === 'off') throw new Error('network down');      // офлайн
  let body = {};
  try { body = JSON.parse(opts.body || '{}'); } catch { /* пусто */ }
  if (path.endsWith('/api/load')) {
    if (net.mode === 'wrongpin') return resp(403, { ok: false, error: 'nick taken, wrong pin' });
    if (net.mode === 'cooldown') return resp(429, { ok: false, error: 'too many attempts', retryAfter: 60 }, { 'retry-after': '60' });
    if (body.key === '__check__') return resp(200, { ok: false, error: 'not found', player: body.player });
    if (body.key === 'ac_raid_session_v1' && net.cloud) return resp(200, { ok: true, value: net.cloud, ts: Date.now() });
    return resp(200, { ok: false, error: 'not found' });
  }
  if (path.endsWith('/api/save')) return resp(200, { ok: true, ts: Date.now() });
  if (path.includes('/api/list')) return resp(200, { ok: true, records: [] });
  return resp(200, { ok: true });
};
let reloads = 0;
globalThis.location = { protocol: 'http:', hostname: 'polygon.test', reload: () => { reloads++; } };
try {
  Object.defineProperty(globalThis.navigator, 'sendBeacon', { value: () => true, configurable: true, writable: true });
} catch { /* node без navigator */ }

// harness кэширует getElementById: для оверлеев отдаём честную семантику.
const realGetById = document.getElementById.bind(document);
document.getElementById = (id) => {
  if (id === 'sv-panel' || id === 'auth-overlay' || id === 'admin-overlay') {
    return document.body.children.find((c) => c.id === id) || null;
  }
  return realGetById(id);
};

// ---------- движок и «облачная» база КЦ-16 ----------
await import('../r/js/game.js');
const game = globalThis.game;
assert(game, 'движок полигона не поднялся');

const ccOf = (st) => (st.buildings || []).find((b) => b && !b.dead && b.side === 'player' && b.type === 'cc');
let cloudSession = null;
try {
  game.startRaidHome('human', { forceNew: true });
  const st = game.state;
  const cc = ccOf(st);
  assert(cc, 'на домашней базе нет КЦ');
  cc.level = 16;
  cc.done = true;
  game.syncRaidHomeSnapshot();
  cloudSession = JSON.stringify(game.raidSession);
  assert(cloudSession && cloudSession.length > 100, 'не удалось собрать снапшот базы для «облака»');
  net.cloud = cloudSession;
  // «Новый браузер»: локальных данных нет, симуляции нет.
  localStorage.removeItem('ac_raid_session_v1');
  game.raidSession = null;
  game.started = false;
  pass('E0 снапшот КЦ-16 собран: ' + Math.round(cloudSession.length / 1024) + ' КБ, локальное хранилище очищено');
} catch (e) { fail('E0 подготовка снапшота', e); }

// ---------- A: логика пинпада ----------
const A = await import('../r/js/auth-ui.js' + V);
try {
  eq(A.PIN_MIN, 3, 'нижняя граница пина');
  eq(A.PIN_MAX, 12, 'верхняя граница пина');
  eq(A._debug.PAD_KEYS.join(','), '1,2,3,4,5,6,7,8,9,C,0,back', 'раскладка 3×4 (1-9, C, 0, ⌫)');

  A.authReset('login');
  assert(A.goToPin('  Best ') === true, 'шаг 1 не пустил валидный ник');
  eq(A.auth.nick, 'best', 'ник не нормализован (trim+lower)');
  eq(A.auth.step, 'pin', 'после ника не открылся пинпад');

  for (const d of '123456789012345'.split('')) A.pressKey(d);
  eq(A.auth.pin.length, 12, 'пин длиннее 12 цифр не должен приниматься');

  A.pressKey('C');
  eq(A.auth.pin, '', '«C» не очистил пин целиком');
  for (const d of '1234') A.pressKey(d);
  A.pressKey('back');
  eq(A.auth.pin, '123', '«⌫» не стёр последнюю цифру');

  // Escape сначала чистит точки и НЕ закрывает панель (канон §A).
  eq(A.escapeOnPin(), true, 'Escape на пинпаде не обработал точки');
  eq(A.auth.pin, '', 'Escape не очистил точки');
  eq(A.escapeOnPin(), false, 'пустой пинпад не должен «съедать» Escape (панель обязана закрыться)');

  // Короткий пин — локальная ошибка, сети нет.
  const before = net.calls.length;
  A.auth.step = 'pin';
  A.pressKey('7'); A.pressKey('7');
  const short = await A.submitPin();
  eq(short.ok, false, 'короткий пин принят');
  eq(A.auth.error, 'ui.auth.errPin', 'короткий пин: неверный ключ ошибки');
  eq(net.calls.length, before, 'короткий пин зачем-то сходил в сеть');

  // Ник тоже валидируется на шаге 1.
  A.authReset('login');
  eq(A.goToPin('a'), false, 'ник из одной буквы прошёл проверку');
  eq(A.auth.error, 'ui.auth.errNick', 'плохой ник: неверный ключ ошибки');
  pass('A пинпад: 3×4, C/⌫, 12 цифр, Escape чистит точки, короткий пин без сети');
} catch (e) { fail('A логика пинпада', e); }

// ---------- B: разметка панели и оформление ----------
try {
  A.openAuth(game, { step: 'login' });
  const overlay = document.body.children.find((c) => c.id === 'auth-overlay');
  assert(overlay, 'панель входа не построилась');
  const bodyNode = () => {
    const ov = document.body.children.find((c) => c.id === 'auth-overlay');
    assert(ov, 'панель входа исчезла');
    const body = ov.querySelector('#auth-body');
    assert(body, 'в панели нет тела #auth-body');
    return body;
  };
  let html = bodyNode().innerHTML;
  assert(/id="auth-nick"/.test(html), 'на шаге 1 нет поля ника');
  assert(/autocomplete="username"/.test(html), 'у поля ника нет autocomplete="username" (телефон не подставит ник)');
  assert(/id="auth-next"/.test(html), 'на шаге 1 нет кнопки «Далее»');

  A.authReset('login');
  A.goToPin('best');
  A._debug.render();
  html = bodyNode().innerHTML;
  const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  eq(keys.length, 12, 'в сетке не 12 клавиш');
  eq(keys.join(','), '1,2,3,4,5,6,7,8,9,C,0,back', 'порядок клавиш пинпада');
  eq((html.match(/class="auth-dot[ "]/g) || []).length, 12, 'точек пина не 12');
  assert(/id="auth-enter"/.test(html), 'под сеткой нет кнопки «Войти»');
  assert(/data-key="back"[^>]*>⌫/.test(html), 'у клавиши «⌫» нет подписи-символа');

  const css = readFileSync(new URL('../r/style.css', import.meta.url), 'utf8');
  const keyBlock = /\.auth-key\s*\{([^}]*)\}/.exec(css);
  assert(keyBlock, 'в r/style.css нет стилей клавиши пинпада');
  const minH = Number((/min-height:\s*(\d+)px/.exec(keyBlock[1]) || [])[1] || 0);
  assert(minH >= 48, '.auth-key ниже 48px: ' + minH);
  assert(/touch-action:\s*manipulation/.test(css), 'нет touch-action: manipulation (двойной тап зумит)');
  assert(/touch-action:\s*manipulation/.test(keyBlock[1]), 'у самой клавиши нет touch-action: manipulation');
  pass('B панель: 12 клавиш, 12 точек, «Войти», ≥48px и touch-action: manipulation');
} catch (e) { fail('B разметка панели', e); }

// ---------- C: RU/EN симметрия («С» ↔ «C») ----------
try {
  const ru = (await import('../r/locales/ru.js' + V)).default;
  const en = (await import('../r/locales/en.js' + V)).default;
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (
    v && typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, v]]
  ));
  const ruA = Object.fromEntries(flat(ru.ui.auth));
  const enA = Object.fromEntries(flat(en.ui.auth));
  eq(Object.keys(ruA).sort().join(','), Object.keys(enA).sort().join(','), 'набор ключей ui.auth в ru/en расходится');
  const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of Object.keys(ruA)) eq(holes(ruA[k]), holes(enA[k]), `плейсхолдеры ui.auth.${k} в ru/en расходятся`);
  eq(ruA.keyClear, 'С', 'русская клавиша «очистить» должна быть «С»');
  eq(enA.keyClear, 'C', 'английская клавиша «очистить» должна быть «C»');
  for (const k of ['errPinWrong', 'errCooldown', 'errOffline', 'pullWait', 'retry', 'offlinePlay']) {
    assert(ruA[k] && enA[k], 'нет ключа ui.auth.' + k);
  }
  pass('C i18n: ключи/плейсхолдеры ru=en, «С» ↔ «C»');
} catch (e) { fail('C i18n', e); }

// ---------- D: неверный пин и кулдаун ----------
try {
  // Профиль в браузере ещё не установлен — пинпад проверяет сервер сам.
  localStorage.setItem('ac_save_nick', 'best');
  localStorage.setItem('ac_save_pin', '1234');
  const save = await import('../r/save-client.js' + V);
  assert(save, 'клиент сохранения не загрузился');

  net.mode = 'wrongpin';
  A.authReset('login');
  A.goToPin('best');
  for (const d of '9999') A.pressKey(d);
  const bad = await A.submitPin();
  eq(bad.code, 403, 'неверный пин: код не 403');
  eq(A.auth.pin, '', 'неверный пин: точки не очищены');
  assert(A.auth.shakeCount >= 1, 'неверный пин: панель не «дёрнулась» (нет шейка)');
  eq(A.auth.error, 'ui.auth.errPinWrong', 'неверный пин: неверный ключ ошибки');

  net.mode = 'cooldown';
  A.authReset('login');
  A.goToPin('best');
  for (const d of '1234') A.pressKey(d);
  const cool = await A.submitPin();
  eq(cool.code, 429, 'кулдаун: код не 429');
  eq(A.auth.error, 'ui.auth.errCooldown', 'кулдаун: неверный ключ ошибки');
  eq(A.auth.errorParams && A.auth.errorParams.s, 60, 'кулдаун: не показано время ожидания');
  pass('D неверный пин → шейк + очистка (403), перебор → кулдаун 60 с (429)');
} catch (e) { fail('D неверный пин / кулдаун', e); }

// ---------- E: вход → пинпад → pull → КЦ-16 в state ----------
try {
  net.mode = 'cloud';
  // Чистим локальную базу: без pull игрок обязан увидеть «новую» пустую базу.
  localStorage.removeItem('ac_raid_session_v1');
  game.raidSession = null;
  game.started = false;

  A.authReset('login');
  A.goToPin('best');
  for (const d of '1234') A.pressKey(d);
  const ok = await A.submitPin();
  assert(ok && ok.ok, 'вход с верным пином не прошёл: ' + JSON.stringify(ok));

  // submitPin сам запускает pull; ждём, пока он применит снапшот.
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    if (A.auth.pullState === 'ok' || A.auth.pullState === 'empty') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  eq(A.auth.pullState, 'ok', 'pull снапшота не завершился успехом');
  assert(net.calls.some((c) => c.path.includes('/api/load') && String(c.body || '').includes('ac_raid_session_v1')),
    'pull не запросил базу рейда у сервера');

  const cc = ccOf(game.state);
  assert(cc, 'после входа в state нет КЦ');
  eq(cc.level, 16, 'после входа КЦ не 16 уровня (баг №1: база не подтянулась)');
  assert(game.started === true, 'симуляция не запущена после входа');
  assert(localStorage.getItem('ac_raid_session_v1'), 'снапшот не лёг в localStorage');
  assert(reloads === 0, 'вход не должен требовать перезагрузки страницы (база применяется на месте)');
  pass('E ВХОД → ПИНПАД → PULL → в state КЦ-16 (без перезагрузки)');
} catch (e) { fail('E вход → pull → КЦ-16', e); }

// ---------- F: таймаут pull и офлайн-фолбэк ----------
try {
  net.mode = 'hang';
  const t0 = Date.now();
  const res = await A.pullSnapshot({ timeoutMs: 60 });
  const dt = Date.now() - t0;
  eq(res.ok, false, 'молчащий сервер не дал таймаут');
  eq(A.auth.step, 'offline', 'после таймаута нет экрана офлайн-фолбэка');
  assert(dt < 1500, 'таймаут не сработал вовремя: ' + dt + ' мс');
  assert(A.PULL_TIMEOUT_MS === 10000, 'таймаут pull должен быть 10 с (сейчас ' + A.PULL_TIMEOUT_MS + ')');

  // Явный офлайн-фолбэк через гейт: панель ждёт решения игрока.
  localStorage.setItem('ac_save_nick', 'best');
  localStorage.setItem('ac_save_pin', '1234');
  game.started = false;
  const gateP = window.__saveApi.authGate(game, { timeoutMs: 80 });
  for (let i = 0; i < 40 && A.auth.step !== 'offline'; i++) await new Promise((r) => setTimeout(r, 10));
  eq(A.auth.step, 'offline', 'гейт не показал офлайн-экран при мёртвом сервере');
  const offlineBtn = A._debug.overlay && A._debug.overlay.querySelector('#auth-offline');
  assert(offlineBtn, 'в офлайн-экране нет кнопки «Играть офлайн»');
  assert(A._debug.overlay.querySelector('#auth-retry'), 'в офлайн-экране нет кнопки «Повторить»');
  offlineBtn.click();
  const gate = await gateP;
  eq(gate.source, 'offline', 'офлайн-фолбэк не вернул управление игре');
  eq(A.isAuthOpen(), false, 'после офлайн-фолбэка панель осталась открытой (игра не начнётся)');
  // Дальше ровно то, что делает raid-boot: база из локального сейва.
  if (!game.started) game.startRaidHome('human');
  eq(game.started, true, 'после офлайн-фолбэка полигон не может стартовать');
  pass('F таймаут pull (10 с) + «Повторить»/«Играть офлайн» — симуляция ждёт решения');
} catch (e) { fail('F таймаут и офлайн-фолбэк', e); }

// ---------- I: Escape на пинпаде (канон §A и [18]) ----------
try {
  A.openAuth(game, { step: 'login' });
  A.goToPin('best');
  for (const d of '123') A.pressKey(d);
  A._debug.render();
  eq(A.isAuthOpen(), true, 'пинпад не открылся');

  fireWindow('keydown', { key: 'Escape', code: 'Escape' });
  eq(A.auth.pin, '', 'Escape не стёр введённые точки');
  eq(A.isAuthOpen(), true, 'Escape с непустыми точками закрыл панель (сначала очистка!)');

  fireWindow('keydown', { key: 'Escape', code: 'Escape' });
  eq(A.isAuthOpen(), false, 'второй Escape не закрыл панель (нельзя выйти из пина)');
  pass('I Escape: первый — чистит точки, второй — закрывает панель');
} catch (e) { fail('I Escape на пинпаде', e); }

// ---------- G: выход = полная очистка ----------
try {
  const junk = [
    'ac_save_nick', 'ac_save_pin', 'ac_save_player_id', 'ac_save_ext_api', 'ac_save_pat',
    'ac_raid_session_v1', 'ac_chest_state_v1', 'ac_birthday_v1', 'ac_home_raid_cfg',
    'ac_econ_scale', 'ac_vv_hint_v1', 'terranrts.progress', 'terranrts.quickBattle',
  ];
  for (const k of junk) localStorage.setItem(k, k === 'ac_raid_session_v1' ? (cloudSession || '{}') : 'x');
  localStorage.setItem('terranrts.muted', '1');       // «мягкая» настройка устройства
  localStorage.setItem('terranrts.language', 'ru');

  const purged = window.__saveApi.clearIdentity();
  assert(purged >= junk.length, 'выход удалил меньше ключей, чем было: ' + purged);
  const left = junk.filter((k) => localStorage.getItem(k) !== null);
  eq(left.join(','), '', 'после выхода остались локальные ключи профиля: ' + left.join(','));
  eq(window.__saveApi.identity, null, 'после выхода профиль всё ещё активен');
  eq(localStorage.getItem('terranrts.muted'), '1', 'выход стёр настройку звука (это не профиль)');
  eq(localStorage.getItem('terranrts.language'), 'ru', 'выход стёр язык интерфейса (это не профиль)');
  pass('G выход: все ключи профиля и базы удалены, язык/звук целы');
} catch (e) { fail('G выход/очистка', e); }

// ---------- H: живой сервер — rate-limit 5 → 60 с ----------
try {
  const port = 8900 + (process.pid % 60);
  const db = join(tmpdir(), 'ac_auth45_' + process.pid + '.db');
  const srv = spawn(process.execPath, ['server/save-server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), DB_PATH: db },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  srv.stdout.on('data', (d) => { srvLog += String(d); });
  srv.stderr.on('data', (d) => { srvLog += String(d); });
  try {
    // ждём /health
    let up = false;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await realFetch(`http://127.0.0.1:${port}/health`);
        if (r.ok) { up = true; break; }
      } catch { /* ещё не поднялся */ }
      await new Promise((r) => setTimeout(r, 40));
    }
    if (!up) throw new Error('save-server не поднялся: ' + srvLog.slice(-300));
    const post = async (path, body) => {
      const r = await realFetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: r.status, retry: r.headers.get('retry-after'), j: await r.json().catch(() => ({})) };
    };
    // Регистрируем профиль, затем 5 раз ошибаемся пином.
    eq((await post('/api/save', { player: 'rl-probe', pin: '1234', key: 'r.progress', value: 'x' })).status, 200, 'регистрация профиля на сервере');
    for (let i = 1; i <= 5; i++) {
      const r = await post('/api/load', { player: 'rl-probe', pin: '0000', key: '__check__' });
      eq(r.status, 403, `попытка ${i}: ожидался 403 «чужой пин»`);
    }
    const blocked = await post('/api/load', { player: 'rl-probe', pin: '1234', key: '__check__' });
    eq(blocked.status, 429, 'после 5 неудач нет кулдауна 429');
    eq(Number(blocked.retry), 60, 'кулдаун не 60 с (Retry-After): ' + blocked.retry);
    // Другой ник кулдаун не наследует (счёт по паре ник+адрес).
    const other = await post('/api/load', { player: 'rl-other', pin: '1234', key: '__check__' });
    assert(other.status === 200, 'чужой ник попал под кулдаун соседа: ' + other.status);
    for (let i = 0; i < 20 && !/rate-limit/.test(srvLog); i++) await new Promise((r) => setTimeout(r, 20));
    assert(/rate-limit/.test(srvLog), 'сервер не записал инцидент в лог (канон §4: «и лог»): ' + srvLog.slice(-200));
    pass('H сервер: 5 неудач → 429 + Retry-After: 60, лог есть, соседние ники свободны');
  } finally {
    srv.kill('SIGKILL');
  }
} catch (e) { fail('H rate-limit на сервере', e); }

// ---------- итог ----------
console.log('');
if (skips.length) console.log('пропущено: ' + skips.join('; '));
if (failures.length) {
  console.log('❌ AUTH-45: провалено ' + failures.length + ' — ' + failures.join(' | '));
  process.exit(1);
}
console.log('✅ AUTH-45: вход поэтапно, пинпад, pull до старта (КЦ-16), выход с очисткой, кулдаун 60 с');
process.exit(0);
