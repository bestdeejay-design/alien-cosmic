// ============================================================
// sim_touch.mjs — хотфикс-пакет T (мобильный тач):
//
// T1  тап по своему рабочему — выделение.
// T2  тап по земле при выделении — ПРИКАЗ (движение), выделение живо.
// T3  тап по кристаллу при выделении рабочего — добыча.
// T4  тап по вражескому зданию при выделении — атака.
// T5  двойной тап по пустому — снять выделение.
// T6  тап по своему зданию — выделение здания; тап по земле — точка сбора.
// T7  долгое нажатие (450мс) — приказ как ПКМ.
// T8  дрифт камеры: синтетический mousemove тача НЕ оживляет мышь
//     (ни sourceCapabilities-путь, ни эвристика), камера стоит.
// T9  настоящая мышь работает после тача (регресс десктопа).
// T10 pointerdown тача возвращает мышь в sentinel −1.
// T11 подсказка жестов показывается один раз (touchHintShown).
//
// Запуск: node scripts/sim_touch.mjs
// ============================================================
import './harness.mjs';
import { el } from './harness.mjs';

// Перехватываем window-обработчики (mousemove и пр.) ДО импорта game.js.
const winH = {};
const origAdd = globalThis.addEventListener;
globalThis.addEventListener = (ev, fn) => { (winH[ev] = winH[ev] || []).push(fn); };
await import('../js/game.js');
globalThis.addEventListener = origAdd;
const fireWin = (ev, obj) => (winH[ev] || []).forEach((fn) => fn(obj));

const U = await import('../js/units.js');
const missionsMod = await import('../js/missions.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

const failures = [];
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (id, e) => { failures.push(id); console.log(`FAIL  ${id}: ${String((e && e.message) || e)}`); };
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cv = el('game-canvas');
const fire = (ev, obj) => (cv._handlers[ev] || []).forEach((fn) => fn(obj));
const tapDown = (x, y, id = 1) => fire('pointerdown', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, cancelable: true, preventDefault() {} });
const tapUp = (x, y, id = 1) => fire('pointerup', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, cancelable: true, preventDefault() {} });
const tap = (x, y, id = 1) => { tapDown(x, y, id); tapUp(x, y, id); };
const toScr = (wx, wy) => game.worldToScreen(wx, wy);

function start() {
  game.startMission({ ...missionsMod.SKIRMISH, id: -1, faction: 'human',
    map: { seed: 777, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } } });
  for (let i = 0; i < 3; i++) game.tick();
}
const myWorker = () => game.state.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.dead && !u.garrison);
const myCC = () => game.state.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
const enemyCC = () => game.state.buildings.find((b) => b.side === 'enemy' && !b.dead);
// Пустая точка земли рядом с рабочим: без кристалла, без зданий, без юнитов.
function emptySpot(near) {
  for (let d = 3; d < 14; d++) {
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) {
      const x = near.x + dx * 32, y = near.y + dy * 32;
      if (U.crystalAt(game.state, x, y)) continue;
      if (game.state.buildings.some((b) => !b.dead &&
        x > b.tx * 32 - 20 && x < (b.tx + b.w) * 32 + 20 &&
        y > b.ty * 32 - 20 && y < (b.ty + b.h) * 32 + 20)) continue;
      return { x, y };
    }
  }
  throw new Error('пустая точка не найдена');
}

// ---------- T1: тап по своему рабочему ----------
try {
  start();
  const w = myWorker();
  const s = toScr(w.x, w.y);
  tap(s.x, s.y);
  assert(game.state.selection.length === 1 && game.state.selection[0] === w, 'рабочий не выделился тапом');
  pass('T1  тап по своему юниту — выделение');
} catch (e) { fail('T1', e); }

// ---------- T2: тап по земле при выделении — приказ ----------
try {
  await sleep(420); // не склеить с предыдущим тапом в «двойной»
  const w = myWorker();
  const spot = emptySpot(w);
  const s = toScr(spot.x, spot.y);
  tap(s.x, s.y);
  assert(w.order.kind === 'move', `ожидал приказ move, факт ${w.order.kind}`);
  assert(game.state.selection.includes(w), 'выделение сбросилось после приказа');
  pass('T2  тап по земле — приказ движения, выделение живо');
} catch (e) { fail('T2', e); }

// ---------- T3: тап по кристаллу — добыча ----------
try {
  await sleep(420);
  const w = myWorker();
  const c = game.state.map.crystals.find((c) => c.amount > 0);
  assert(c, 'в скирмише нет кристаллов');
  const s = toScr((c.tx + 0.5) * 32, (c.ty + 0.5) * 32);
  tap(s.x, s.y);
  assert(w.order.kind === 'gather', `ожидал gather, факт ${w.order.kind}`);
  pass('T3  тап по кристаллу — добыча');
} catch (e) { fail('T3', e); }

// ---------- T4: тап по вражескому зданию — атака ----------
try {
  await sleep(420);
  const w = myWorker();
  game.state.selection = [w]; // прямое выделение (камеру к врагу не возим)
  const e2 = enemyCC();
  assert(e2, 'нет вражеского КЦ');
  const s = toScr((e2.tx + 1.5) * 32, (e2.ty + 1) * 32);
  tap(s.x, s.y);
  assert(w.order.kind === 'attack', `ожидал attack, факт ${w.order.kind}`);
  pass('T4  тап по врагу — атака');
} catch (e) { fail('T4', e); }

// ---------- T5: двойной тап по пустому — снять выделение ----------
try {
  await sleep(420);
  const w = myWorker();
  game.state.selection = [w];
  const spot = emptySpot(w);
  const s = toScr(spot.x, spot.y);
  tap(s.x, s.y);          // первый тап — приказ
  tap(s.x + 3, s.y + 2);  // второй сразу — снять выделение
  assert(game.state.selection.length === 0, 'двойной тап не снял выделение');
  pass('T5  двойной тап по пустому — снять выделение');
} catch (e) { fail('T5', e); }

// ---------- T6: своё здание — выделение и точка сбора ----------
try {
  await sleep(420);
  const cc = myCC();
  const s = toScr((cc.tx + cc.w / 2) * 32, (cc.ty + cc.h / 2) * 32);
  tap(s.x, s.y);
  assert(game.state.selection.length === 1 && game.state.selection[0] === cc, 'КЦ не выделился тапом');
  await sleep(420);
  const spot = emptySpot({ x: (cc.tx + 4) * 32, y: (cc.ty + cc.h + 2) * 32 });
  const s2 = toScr(spot.x, spot.y);
  tap(s2.x, s2.y);
  assert(cc.rally && Math.abs(cc.rally.x - spot.x) < 40, 'точка сбора не поставлена');
  pass('T6  свой КЦ: выделение тапом + точка сбора тапом по земле');
} catch (e) { fail('T6', e); }

// ---------- T7: долгое нажатие — приказ как ПКМ ----------
try {
  await sleep(420);
  const w = myWorker();
  game.state.selection = [w];
  const c = game.state.map.crystals.find((c) => c.amount > 0);
  const s = toScr((c.tx + 0.5) * 32, (c.ty + 0.5) * 32);
  tapDown(s.x, s.y);
  await sleep(520); // > 450мс таймера long-press
  tapUp(s.x, s.y);
  assert(w.order.kind === 'gather', `ожидал gather от long-press, факт ${w.order.kind}`);
  pass('T7  долгое нажатие — приказ (ПКМ-эквивалент)');
} catch (e) { fail('T7', e); }

// ---------- T8: дрифт камеры — синтетика тача мышь не оживляет ----------
try {
  await sleep(420);
  game.sleepMouse();
  const w = myWorker();
  const s = toScr(w.x, w.y);
  tap(s.x, s.y); // тач: lastTouchPoint обновлён, мышь сброшена
  // (а) Chrome/Android: sourceCapabilities.firesTouchEvents
  fireWin('mousemove', { clientX: 640, clientY: 790, sourceCapabilities: { firesTouchEvents: true } });
  assert(game.mouse.x === -1 && game.mouse.y === -1, 'sourceCapabilities-синтетика двигает мышь');
  // (б) Safari: эвристика — рядом и сразу после тача
  fireWin('mousemove', { clientX: s.x + 10, clientY: s.y + 8 });
  assert(game.mouse.x === -1 && game.mouse.y === -1, 'эвристика пропустила синтетику');
  const y0 = game.state.camera.y, x0 = game.state.camera.x;
  for (let i = 0; i < 90; i++) game.tick(); // 1.5 c логики у нижней кромки
  assert(game.state.camera.y === y0 && game.state.camera.x === x0, `камера уехала: (${x0},${y0}) → (${game.state.camera.x},${game.state.camera.y})`);
  pass('T8  синтетический mousemove тача не панирует камеру');
} catch (e) { fail('T8', e); }

// ---------- T9: настоящая мышь после тача работает ----------
try {
  await sleep(800); // выйти из 700мс окна эвристики
  fireWin('mousemove', { clientX: 640, clientY: 400 });
  assert(game.mouse.x === 640 && game.mouse.y === 400, 'настоящая мышь заблокирована');
  game.sleepMouse();
  pass('T9  настоящая мышь работает после тача');
} catch (e) { fail('T9', e); }

// ---------- T10: pointerdown тача сбрасывает мышь в sentinel ----------
try {
  game.mouse.x = 500; game.mouse.y = 500;
  const w = myWorker();
  const s = toScr(w.x, w.y);
  tapDown(s.x, s.y);
  assert(game.mouse.x === -1 && game.mouse.y === -1, 'pointerdown не сбросил мышь');
  assert(game.edgeT === 0 && !game.edgeZone, 'краевые зоны не погашены');
  tapUp(s.x, s.y);
  pass('T10  тач возвращает мышь в sentinel −1');
} catch (e) { fail('T10', e); }

// ---------- T11: подсказка жестов один раз + текст тоста не «[object Object]» ----------
try {
  assert(game.touchHintShown === true, 'touchHintShown не взведён');
  const ui = await import('../js/ui.js');
  const msg = ui.toast.last ? String(ui.toast.last.msg) : '';
  assert(msg.includes('Тап по карте') && !msg.includes('object Object'),
    `текст тоста сломан: "${msg.slice(0, 60)}"`);
  pass('T11  подсказка жестов показана (один раз), текст тоста корректный');
} catch (e) { fail('T11', e); }

// ---------- ИТОГ ----------
console.log(failures.length
  ? `\nИТОГ SIM_TOUCH: ПРОВАЛЕНО ${failures.length}: ${failures.join(', ')}`
  : '\nИТОГ SIM_TOUCH: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exitCode = failures.length ? 1 : 0;
