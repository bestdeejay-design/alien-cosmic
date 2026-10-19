// ============================================================
// sim_build.mjs — тесты пакета B.7 (П3): лимит строителей,
// распределение, серии, линия стен, стройка без мыши, подхват.
//
// B1 лимит: из 8 выделенных строят 5, трое держат приказы.
// B2 распределение: 12 рабочих на 4 стройки — всем есть место, >5 нигде.
// B3 серия: placing жив после 4 постановок, минералы списаны.
// B4 линия: 8 тайлов коммитятся, бригада вдоль; кламп по бюджету.
// B5 смерть строителя: idle-рабочий подхватывает недострой.
// B6 превью линии: тайлы + строка цены рисуются.
// B7 без мыши: стрелки двигают призрак, постановка — под призраком.
//
// Запуск: node scripts/sim_build.mjs
// ============================================================
import './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(c, msg) { if (!c) throw new Error(msg); }

await import('../js/game.js');
const U = await import('../js/units.js');
const B = await import('../js/buildings.js');
const input = await import('../js/input.js');
const missionsMod = await import('../js/missions.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

function start() {
  game.startMission({ ...missionsMod.SKIRMISH, id: -1, faction: 'human',
    map: { seed: 424242, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } } });
  for (let i = 0; i < 5; i++) game.tick();
  const st = game.state;
  st.fog.explored.fill(1); // стройка видна везде — проверяем механику, не разведку
  st.minerals.player = 99999;
  return st;
}
function crew(st, n) {
  // Ровно n рабочих в выделении (свои + призванные рядом с базой).
  const have = st.units.filter((u) => u.side === 'player' && u.cfg.canBuild && !u.dead);
  for (let i = have.length; i < n; i++) {
    have.push(U.spawnUnit(st, 'player', 'worker', (10 + i) * 32, 50 * 32));
  }
  const sel = have.slice(0, n);
  st.selection = [...sel];
  return sel;
}
function buildOrders(st, b) {
  return st.units.filter((u) => !u.dead && u.order.kind === 'build' && (!b || u.order.target === b));
}

// ---------- B1: лимит 5 ----------
try {
  const st = start();
  crew(st, 8);
  st.placing = { type: 'depot', tx: 14, ty: 44 };
  game.tryPlace(14, 44);
  const site = st.buildings[st.buildings.length - 1];
  assert(site.type === 'depot' && !site.done, 'стройка не встала');
  assert(buildOrders(st, site).length === 5, 'строят не 5: ' + buildOrders(st, site).length);
  const kept = st.selection.filter((u) => u.order.kind === 'gather').length;
  assert(kept === 3, 'остатки не сохранили добычу: ' + kept);
  assert(st.placing && st.placing.type === 'depot', 'серия сброшена (placing=null)');
  pass('B1 limit: строят 5 из 8, трое добывают, серия жива');
} catch (e) { fail('B1 limit5', e); }

// ---------- B2: распределение на 4 стройки ----------
try {
  const st = start();
  const pre = [];
  for (const [x, y] of [[16, 52], [20, 52], [24, 52]]) {
    const b = B.placeBuildingCmd(st, 'player', 'depot', x, y, []);
    assert(b, `пре-стройка (${x},${y}) не встала`);
    pre.push(b);
  }
  crew(st, 12);
  st.placing = { type: 'depot', tx: 28, ty: 52 };
  game.tryPlace(28, 52);
  const sites = [...pre, st.buildings[st.buildings.length - 1]];
  const counts = sites.map((s) => buildOrders(st, s).length);
  assert(counts.every((n) => n >= 1), 'голая стройка: ' + counts.join(','));
  assert(counts.every((n) => n <= 5), 'перебор >5: ' + counts.join(','));
  assert(counts.reduce((a, b2) => a + b2, 0) === 12, 'потеряны рабочие: ' + counts.join(','));
  pass(`B2 spread: 12 по стройкам [${counts.join(',')}], все ≤5`);
} catch (e) { fail('B2 spread', e); }

// ---------- B3: серия из 4 ----------
try {
  const st = start();
  crew(st, 4);
  st.placing = { type: 'wall', tx: 30, ty: 40 };
  const m0 = st.minerals.player;
  for (let i = 0; i < 4; i++) {
    game.tryPlace(30 + i * 2, 40);
    assert(st.placing, 'placing сброшен на ' + (i + 1) + '-й постановке');
  }
  assert(m0 - st.minerals.player === 4 * 30, 'минералы списаны не ×4');
  pass('B3 series: 4 стены подряд, placing жив, −120 минералов');
} catch (e) { fail('B3 series', e); }

// ---------- B4: линия 8 тайлов + кламп ----------
try {
  const st = start();
  crew(st, 8);
  st.placing = { type: 'wall', tx: 20, ty: 36 };
  st.wallDrag = { x0: 20, y0: 36, x1: 27, y1: 36 };
  const { tiles } = game.wallLineTiles();
  assert(tiles.length === 8, 'тайлов не 8: ' + tiles.length);
  const n = game.commitWallLine();
  assert(n === 8, 'встало не 8: ' + n);
  const walls = st.buildings.filter((b) => b.type === 'wall' && !b.done);
  assert(walls.length === 8, 'стен-недостроев не 8: ' + walls.length);
  assert(walls.every((w) => buildOrders(st, w).length >= 1), 'бригада не вдоль линии');
  // Кламп по бюджету: 100 минералов = 3 стены, остаток обрезан.
  st.minerals.player = 100;
  st.wallDrag = { x0: 20, y0: 38, x1: 27, y1: 38 };
  const cut = game.wallLineTiles();
  assert(cut.tiles.length === 3 && cut.skipped === 5, `кламп не 3+5: ${cut.tiles.length}+${cut.skipped}`);
  const n2 = game.commitWallLine();
  assert(n2 === 3, 'по клампу встало не 3: ' + n2);
  pass('B4 line: 8 стен бригадой вдоль, бюджет 100 → 3+5');
} catch (e) { fail('B4 wall-line', e); }

// ---------- B5: смерть строителя → подхват ----------
try {
  const st = start();
  const w1 = crew(st, 1)[0];
  const site = B.placeBuildingCmd(st, 'player', 'depot', 14, 44, [w1]);
  assert(buildOrders(st, site).length === 1, 'строитель не назначен');
  U.damageEntity(st, w1, 1e9, null); // строитель погиб
  const w2 = U.spawnUnit(st, 'player', 'worker', 15 * 32, 46 * 32);
  w2.order = { kind: 'idle' }; // простой рядом со стройкой
  w2.path = null;
  for (let i = 0; i < 90; i++) game.tick(); // 3 секунды
  assert(w2.order.kind === 'build' && w2.order.target === site, 'подхвата нет: ' + w2.order.kind);
  const p0 = site.progress;
  for (let i = 0; i < 60; i++) game.tick();
  assert(site.progress > p0, 'стройка стоит после подхвата');
  pass('B5 pickup: гибель → idle подхватил, прогресс идёт');
} catch (e) { fail('B5 pickup', e); }

// ---------- B6: превью линии рисуется ----------
try {
  const st = start();
  st.placing = { type: 'wall', tx: 20, ty: 36 };
  st.wallDrag = { x0: 20, y0: 36, x1: 27, y1: 36 };
  const calls = [];
  const sink = new Proxy(function () {}, { get: () => sink, set: () => true, apply: () => sink });
  const ctx = new Proxy({}, { get: (t, k) => (...a) => { calls.push([k, ...a]); return sink; }, set: () => true });
  game.drawWallLine(ctx, st, { x: 0, y: 0 });
  const rects = calls.filter((c) => c[0] === 'fillRect').length;
  assert(rects >= 8, 'тайлов нарисовано <8: ' + rects);
  const price = calls.find((c) => c[0] === 'fillText' && /×.*=/.test(String(c[1])));
  assert(price, 'строки цены нет');
  pass(`B6 preview: ${rects} тайлов + цена «${price[1]}»`);
} catch (e) { fail('B6 preview', e); }

// ---------- B7: стройка без мыши ----------
try {
  const st = start();
  crew(st, 2);
  st.placing = { type: 'depot', tx: 10, ty: 40 };
  input.stepPlacing(st, 1, 0);
  assert(st.placing.tx === 11 && st.placing.ty === 40, 'шаг не (11,40)');
  input.stepPlacing(st, 999, 999);
  assert(st.placing.tx <= 64 && st.placing.ty <= 64, 'клампа края нет');
  st.placing.tx = 12; st.placing.ty = 40;
  game.tryPlace(st.placing.tx, st.placing.ty); // Enter ставит под призраком
  const site = st.buildings[st.buildings.length - 1];
  assert(site.tx === 12 && site.ty === 40, 'встало не под призраком');
  pass('B7 keyboard: призрак шагает с клампом, Enter ставит под ним');
} catch (e) { fail('B7 keyboard', e); }

console.log(failures.length ? `\nИТОГ SIM_BUILD: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_BUILD: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
