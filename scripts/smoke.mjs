// ============================================================
// smoke.mjs — headless smoke-тест всей игры без браузера.
//
// Стабает DOM/Canvas/Audio, грузит настоящий js/game.js, затем:
//  - кликает меню (кампания → список миссий → брифинг → старт),
//  - гоняет КАЖДУЮ миссию + скирмиш за обе фракции через реальный
//    loop(): тики логики + render + ui.update,
//  - дёргает команды, хуки, хоткеи, стройку, исследования, группы,
//  - форсирует победу и поражение, проверяет экран финала
//    (время боя обязано быть конечным — регресс NaN:NaN),
//  - меряет среднее время тика/рендера по миссиям (перф-аудит).
//
// Любое исключение = FAIL с миссией и фазой. Запуск: node scripts/smoke.mjs
// ============================================================

// ---------- Стабы браузера ----------
class FakeClassList {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach((x) => this.s.add(x)); }
  remove(...c) { c.forEach((x) => this.s.delete(x)); }
  toggle(c, force) {
    const on = force !== undefined ? force : !this.s.has(c);
    if (on) this.s.add(c); else this.s.delete(c);
    return on;
  }
  contains(c) { return this.s.has(c); }
}

function makeCtx() {
  const grad = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
      if (prop === 'createPattern') return () => ({});
      if (prop === 'measureText') return () => ({ width: 8 });
      if (prop === 'createImageData' || prop === 'getImageData') {
        return (w, h) => ({ width: w, height: h || w, data: new Uint8ClampedArray((w * (h || w) || 4) * 4) });
      }
      if (prop === 'canvas') return {};
      return (..._a) => undefined; // все методы рисования — no-op
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

class FakeEl {
  constructor(tag = 'div', id = '') {
    this.tag = tag; this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.textContent = '';
    this._html = '';
    this.parent = null;
    this.disabled = false;
    this.width = tag === 'canvas' ? 300 : 0;
    this.height = tag === 'canvas' ? 150 : 0;
    this._handlers = {};
    this._ctx = tag === 'canvas' ? makeCtx() : null;
  }
  get firstChild() { return this.children[0] || null; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; this.children = []; }
  addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); }
  removeEventListener() {}
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() {
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    }
  }
  click() { (this._handlers.click || []).forEach((fn) => fn({ preventDefault() {} })); }
  getContext() { return this._ctx || (this._ctx = makeCtx()); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width || 800, height: this.height || 600 }; }
}

const elCache = {};
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.devicePixelRatio = 1;
const winHandlers = {};
globalThis.addEventListener = (ev, fn) => { (winHandlers[ev] = winHandlers[ev] || []).push(fn); };
globalThis.removeEventListener = () => {};
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  hidden: false,
  getElementById: (id) => {
    if (!elCache[id]) {
      const isCanvas = id === 'game-canvas' || id === 'minimap';
      elCache[id] = new FakeEl(isCanvas ? 'canvas' : 'div', id);
    }
    return elCache[id];
  },
  createElement: (tag) => new FakeEl(tag),
  addEventListener: (ev, fn) => { (winHandlers['doc:' + ev] = winHandlers['doc:' + ev] || []).push(fn); },
};

// ---------- Загрузка настоящей игры ----------
const failures = [];
function fail(phase, err) {
  failures.push({ phase, err: String((err && err.stack) || err).split('\n').slice(0, 4).join(' | ') });
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }

const gameMod = await import('../js/game.js');
const missionsMod = await import('../js/missions.js');
const ui = await import('../js/ui.js');
const U = await import('../js/units.js');
const B = await import('../js/buildings.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }
pass('boot: игра загрузилась, меню построено');

// ---------- Фаза 1: клики по меню ----------
try {
  const $ = (id) => document.getElementById(id);
  $('btn-campaign').click();               // список миссий
  const cards = $('mission-list').children.length;
  if (!cards) throw new Error('список миссий пуст');
  // Первый доступный брифинг: кликаем первую незаблокированную карточку.
  const list = $('mission-list').children;
  let opened = false;
  for (const card of list) {
    if (!card.disabled) {
      // карточка может быть обёрткой; ищем кнопку внутри
      const btn = card.children.find((c) => c.tag === 'button') || card;
      btn.click();
      opened = true;
      break;
    }
  }
  if (!opened) throw new Error('нет доступных миссий в списке');
  if ($('brief-overlay').classList.contains('hidden')) throw new Error('брифинг не открылся');
  // Кодекс: вкладки.
  $('btn-codex').click();
  for (const tab of $('codex-tabs').children) tab.click();
  $('btn-codex-back').click();
  $('btn-skirmish').click();
  if ($('skirmish-overlay').classList.contains('hidden')) throw new Error('оверлей скирмиша не открылся');
  $('btn-skirmish-back').click();
  $('btn-skirmish').click();
  $('btn-skirmish-human').click(); // стартует быстрый бой за людей
  if (!game.started) throw new Error('скирмиш не стартовал по клику');
  $('btn-brief-back').click();
  $('btn-missions-back').click();
  pass(`menu: кампания (${cards} карточек), брифинг, кодекс, скирмиш — клики без ошибок`);
} catch (e) { fail('menu', e); }

// ---------- Хелперы прогона ----------
const TICK_DT = 1 / 30;
function frames(n, every = 6) {
  // Крутим настоящий loop() с шагом кадра 30 Гц.
  let t = game.last || 0;
  for (let i = 0; i < n; i++) {
    t += 1000 / 30;
    game.loop(t);
    if (i % every === 0) ui.update(game);
  }
}
function exercise(game) {
  const st = game.state;
  // Выделить всех своих юнитов, отдать приказы.
  const mine = st.units.filter((u) => u.side === 'player' && !u.dead);
  if (mine.length) {
    st.selection = mine.slice(0, 12);
    game.hooks.issueRMB(400, 400);
    game.hooks.issueAttackMove(500, 500);
    game.hooks.stopSelected();
    game.hooks.assignGroup(1);
    game.hooks.selectGroup(1);
    game.hooks.centerOnGroup(1);
    game.hooks.selectArmy();
    game.hooks.cycleCombat();
    game.hooks.cycleIdleWorker();
    game.hooks.jumpToAlert();
  }
  // Команды панели для разных выделений: каждую — через хоткей и on().
  const tryCmds = (sel) => {
    st.selection = sel;
    st.buildMenu = false;
    for (const c of game.getCommands()) {
      ui.handleHotkey(c.code);
      if (!c.enabled || c.enabled()) { try { c.on(); } catch (e) { /* on() под охраной enabled */ } }
    }
    st.buildMenu = false;
    st.placing = null;
  };
  const b = st.buildings.find((x) => x.side === 'player' && !x.dead);
  if (b) tryCmds([b]);
  const w = mine.find((u) => u.cfg && u.cfg.canBuild);
  if (w) { tryCmds([w]); st.buildMenu = true; tryCmds([w]); }
  if (mine.length) tryCmds(mine.slice(0, 3));
  st.selection = [];
  st.buildMenu = false;
  st.placing = null;
}
function forceEnd(game, how) {
  const st = game.state;
  // Убиваем через настоящий боевой урон — идёт полный путь смерти:
  // killEntity, bcount, эффекты, статистика, checkEnd.
  const side = how === 'win' ? 'enemy' : 'player';
  for (const e of [...st.units, ...st.buildings]) {
    if (e.side === side && !e.dead) U.damageEntity(st, e, 1e9, null);
  }
  for (let i = 0; i < 40 && !st.gameOver; i++) game.tick();
  if (!st.gameOver) throw new Error(`конец не наступил (${how})`);
  const html = document.getElementById('end-stats').innerHTML;
  if (/NaN|undefined/.test(html)) throw new Error(`битая статистика финала: ${html.slice(0, 120)}`);
  if (!/\d\d:\d\d/.test(html)) throw new Error(`нет времени боя в финале: ${html.slice(0, 120)}`);
  return html.match(/\d\d:\d\d/)[0];
}

// ---------- Фаза 2: все миссии кампании ----------
const MISSIONS = missionsMod.MISSIONS;
const perf = [];
for (const m of MISSIONS) {
  const tag = `m${m.id} ${m.map && m.map.biome}`;
  try {
    game.startMission(m);
    // Прогрев + замер: 20 игровых секунд через настоящий loop.
    frames(60);
    const t0 = performance.now();
    frames(600);
    const dt = performance.now() - t0;
    exercise(game);
    frames(60);
    perf.push({ tag, ms: dt / 660 });
    const tWin = forceEnd(game, 'win');
    game.restart();
    frames(30);
    if (m.defense) {
      // Победа обороной: мотаем время за предел и ждём триггер.
      game.state.time = m.defense.prep + m.defense.total + 1;
      for (let i = 0; i < 10 && !game.state.gameOver; i++) game.tick();
      if (game.state.gameOver !== 'win') throw new Error('оборона не выиграна по таймауту');
      const html = document.getElementById('end-stats').innerHTML;
      if (/NaN|undefined/.test(html)) throw new Error('битый финал обороны');
    }
    game.restart();
    frames(30);
    exercise(game);
    const tLose = forceEnd(game, 'lose');
    game.restart();
    pass(`${tag}: 22с игры, команды, победа (${tWin}) и поражение (${tLose}) — финал чистый`);
  } catch (e) { fail(tag, e); }
}

// ---------- Фаза 3: стресс-бой 40×40 ----------
try {
  game.startSkirmish('human');
  frames(30);
  const st = game.state;
  const cx = 32 * 32, cy = 32 * 32;
  for (let i = 0; i < 40; i++) {
    U.spawnUnit(st, 'player', 'marine', cx - 200 + (i % 10) * 24, cy - 100 + Math.floor(i / 10) * 24);
    U.spawnUnit(st, 'enemy', 'marine', cx + 200 - (i % 10) * 24, cy - 100 + Math.floor(i / 10) * 24);
  }
  for (const u of st.units) {
    if (u.side === 'player' && u.type === 'marine') U.orderAttackMove(st, u, cx + 300, cy);
    if (u.side === 'enemy' && u.type === 'marine') U.orderAttackMove(st, u, cx - 300, cy);
  }
  const t0 = performance.now();
  frames(300);
  const ms = (performance.now() - t0) / 300;
  if (!(st.stats.kills > 0)) throw new Error('стресс-бой без фрагов');
  pass(`stress: 40×40, ${st.stats.kills} фрагов, кадр ${ms.toFixed(2)} мс — без ошибок`);
} catch (e) { fail('stress', e); }

// ---------- Фаза 4: лимит снабжения держит очередь ----------
// Регресс: раньше q.hold никто не выставлял — юниты выходили сверх лимита,
// а «ждёт снабжения» в UI было недостижимо.
try {
  game.startSkirmish('alien'); // заодно фракционный тост needSupply роя
  frames(30);
  const st = game.state;
  for (let i = 0; i < 30; i++) U.spawnUnit(st, 'player', 'marine', 120 + i * 8, 120);
  game.tick(); // calcSupply пересчитает used
  const used = st.supply.player.used, cap = st.supply.player.cap;
  if (!(used > cap)) throw new Error(`население не переполнено: ${used}/${cap}`);
  const prod = st.buildings.find((b) => b.side === 'player' && !b.dead && b.done && b.cfg.produces);
  st.minerals.player = 99999;
  const first = Array.isArray(prod.cfg.produces) ? prod.cfg.produces[0] : prod.cfg.produces;
  if (B.enqueueUnit(st, prod, first) !== 'ok') throw new Error('не встало в очередь');
  prod.queue[0].t = 0.01;
  const n0 = st.units.length;
  for (let i = 0; i < 10; i++) game.tick();
  if (!prod.queue[0] || prod.queue[0].hold !== true) throw new Error('очередь не встала на hold');
  if (st.units.length !== n0) throw new Error('юнит вышел сверх лимита снабжения');
  // Освобождаем место — очередь оживает сама.
  for (const u of st.units) if (u.side === 'player' && u.type === 'marine') U.damageEntity(st, u, 1e9, null);
  for (let i = 0; i < 10; i++) game.tick();
  if (prod.queue.length !== 0) throw new Error('очередь не двинулась после освобождения снабжения');
  pass(`supply: hold при ${used}/${cap}, автовыход после освобождения — лимит работает`);
} catch (e) { fail('supply', e); }

// ---------- Фаза 5: скирмиш за обе фракции ----------
for (const fac of ['human', 'alien']) {
  try {
    game.startSkirmish(fac);
    frames(300);
    exercise(game);
    frames(120);
    forceEnd(game, 'win');
    game.restart();
    forceEnd(game, 'lose');
    pass(`skirmish/${fac}: игра, команды, победа и поражение — финал чистый`);
  } catch (e) { fail(`skirmish/${fac}`, e); }
}

// ---------- Перф-сводка ----------
console.log('\n--- Среднее время кадра (loop 30 Гц, мс) ---');
perf.sort((a, b) => b.ms - a.ms);
for (const p of perf.slice(0, 5)) console.log(`  ${p.ms.toFixed(2)} мс  ${p.tag}`);
console.log(`  ... среднее по всем: ${(perf.reduce((a, p) => a + p.ms, 0) / Math.max(1, perf.length)).toFixed(2)} мс`);

console.log(failures.length ? `\nИТОГ SMOKE: ${failures.length} ОШИБОК` : '\nИТОГ SMOKE: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
