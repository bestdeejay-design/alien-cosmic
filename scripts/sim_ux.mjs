// ============================================================
// sim_ux.mjs — тесты пакета A (П2): выделение зданий, портрет,
// флажок точки сбора, зум с якорем, выход в меню.
//
// U1 клик по зданию: выделение + панель + контур на канвасе.
// U2 портрет здания 52×52 в панели (своя иконка фракции).
// U3 флажок точки сбора: ПКМ ставит, drawRallyFlag рисует у точки.
// U4 зум: кламп 0.6–1.6, якорь держит мировую точку, туда-обратно.
// U5 выход: меню показано, прогресс кампании цел, рестарт работает.
//
// Запуск: node scripts/sim_ux.mjs
// ============================================================
import './harness.mjs';
import { el } from './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(c, msg) { if (!c) throw new Error(msg); }

await import('../js/game.js');
const ui = await import('../js/ui.js');
const input = await import('../js/input.js');
const missionsMod = await import('../js/missions.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

function start() {
  game.startMission({ ...missionsMod.SKIRMISH, id: -1, faction: 'human',
    map: { seed: 777, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } } });
  for (let i = 0; i < 5; i++) game.tick();
}
function paint() { game.render(1); ui.update(game); ui.drawMinimap(game); }
// Пишущий стаб ctx: фиксирует рисование у заданной точки.
function recCtx() {
  const calls = [];
  const sink = new Proxy(function () {}, {
    get: () => sink, set: () => true, apply: () => sink,
  });
  const ctx = new Proxy({}, { get: (t, k) => {
    if (k === 'canvas') return null;
    return (...a) => { calls.push([k, ...a]); return sink; };
  }, set: () => true });
  return { calls, ctx };
}

// ---------- U1: клик по зданию ----------
try {
  start();
  const st = game.state;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  input.clickSelect(game, st, { x: cc.x, y: cc.y }, false);
  assert(st.selection.length === 1 && st.selection[0] === cc, 'КЦ не выделился кликом');
  game.tick(); // syncSelectionFlags
  assert(cc.selected, 'флаг selected не взведён');
  ui.update(game);
  const texts = [];
  (function walk(n) { texts.push(n.textContent || ''); (n.children || []).forEach(walk); })(el('sel-info'));
  assert(/Командный центр/.test(texts.join('|')), 'панели здания нет: ' + texts.join('|'));
  const rec = recCtx();
  const B = await import('../js/buildings.js');
  B.drawBuilding(rec.ctx, cc, false, st.camera.x, st.camera.y);
  assert(rec.calls.some((c) => c[0] === 'strokeRect'), 'контур выделения не рисуется');
  assert(rec.calls.some((c) => c[0] === 'fillRect'), 'полоса HP не рисуется');
  paint();
  pass('U1 click: КЦ выделился, панель есть, контур+HP рисуются');
} catch (e) { fail('U1 click-select', e); }

// ---------- U2: портрет ----------
try {
  start();
  const st = game.state;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  input.clickSelect(game, st, { x: cc.x, y: cc.y }, false);
  ui.update(game);
  const box = el('sel-info').children[0];
  const portrait = box.children.find((c) => c.tag === 'canvas' && c.width === 52);
  assert(portrait, 'портрета 52×52 в панели нет');
  assert(portrait.className === 'portrait', 'у портрета нет класса');
  pass('U2 portrait: портрет 52×52 в панели здания');
} catch (e) { fail('U2 portrait', e); }

// ---------- U3: флажок точки сбора ----------
try {
  start();
  const st = game.state;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  input.clickSelect(game, st, { x: cc.x, y: cc.y }, false);
  game.tick();
  const wx = cc.x + 200, wy = cc.y - 150;
  game.hooks.issueRMB(wx, wy); // ПКМ-перенос точки сбора
  assert(cc.rally && cc.rally.x === wx && cc.rally.y === wy, 'точка сбора не встала');
  const rec = recCtx();
  game.drawRallyFlag(rec.ctx, cc, st.camera.x, st.camera.y);
  const near = (x, y) => rec.calls.some((c) =>
    c.slice(1).some((a, i, arr) =>
      typeof a === 'number' && typeof arr[i + 1] === 'number' &&
      Math.hypot(a - (x - st.camera.x), arr[i + 1] - (y - st.camera.y)) < 30));
  assert(near(wx, wy), 'у точки сбора ничего не нарисовано');
  assert(near(cc.x, cc.y), 'линия от здания не нарисована');
  paint(); // полный кадр с флажком — без ошибок
  pass('U3 rally: ПКМ ставит точку, флажок рисуется у неё');
} catch (e) { fail('U3 rally-flag', e); }

// ---------- U4: зум с якорем ----------
try {
  start();
  const st = game.state;
  game.setZoom(99);
  assert(st.camera.z === 1.6, 'верхний кламп не 1.6: ' + st.camera.z);
  game.setZoom(0);
  assert(st.camera.z === 0.6, 'нижний кламп не 0.6: ' + st.camera.z);
  game.setZoom(1);
  st.camera.x = 100; st.camera.y = 200;
  const ax = 400, ay = 300;
  const before = game.screenToWorld(ax, ay);
  game.setZoom(1.5, ax, ay);
  const after = game.screenToWorld(ax, ay);
  assert(Math.hypot(before.x - after.x, before.y - after.y) < 1e-6, 'якорь уплыл');
  // Туда-обратно: мир под курсором совпадает, камера валидна.
  const rt = game.worldToScreen(before.x, before.y);
  assert(Math.hypot(rt.x - ax, rt.y - ay) < 1e-6, 'screen/world не обратны');
  game.setZoom(1.5, ax, ay); // повторный зум — идемпотентен
  assert(Math.abs(st.camera.z - 1.5) < 1e-9, 'повторный зум сдвинул камеру');
  paint(); // рендер на зуме 1.5 — без ошибок
  game.setZoom(0.6);
  paint(); // рендер на зуме 0.6 — без ошибок
  game.setZoom(1);
  pass('U4 zoom: клампы 0.6–1.6, якорь стоит, рендер на обоих краях');
} catch (e) { fail('U4 zoom', e); }

// ---------- U5: выход в меню ----------
try {
  start();
  const prog0 = missionsMod.loadProgress();
  assert(game.started, 'партия не стартовала');
  el('btn-exit').click(); // клик по кнопке хедера
  assert(!game.started, 'started не сброшен');
  assert(!el('overlay').classList.contains('hidden'), 'главное меню не показано');
  assert(missionsMod.loadProgress() === prog0, 'прогресс кампании изменился');
  start(); // после выхода можно играть снова
  assert(game.started && !game.state.gameOver, 'рестарт после выхода сломан');
  for (let i = 0; i < 30; i++) game.tick();
  paint();
  pass('U5 exit: меню показано, прогресс цел, новая партия идёт');
} catch (e) { fail('U5 exit', e); }

console.log(failures.length ? `\nИТОГ SIM_UX: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_UX: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
