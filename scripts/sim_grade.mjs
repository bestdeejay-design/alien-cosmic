// ============================================================
// sim_grade.mjs — пакет F.2: грейды зданий Г1→Г2→Г3.
//
// R1 turret: цена/время, урон 8→10→12, дальность 150→165→180.
// R2 bunker: гарнизон 4→6→8, прочность ×1.25→×1.5.
// R3 busy-works: здание производит во время грейда.
// R4 factory: темп ×1.25→×1.5, очередь 5→7→9 (вместо отменённого КЦ).
// R5 cancel: отмена возвращает минералы, уровень не меняется.
// R6 buttons: KeyR своим достроенным, KeyX во время грейда, чужим/Г3/лабе — нет.
// R7 ai-idle: ИИ за 30с с казной не грейдит ничего.
//
// Запуск: node scripts/sim_grade.mjs
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
const cfg = await import('../js/config.js');
const ui = await import('../js/ui.js');
const U = await import('../js/units.js');
const B = await import('../js/buildings.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

function testMission(over = {}) {
  return {
    id: -1, faction: 'human',
    map: { seed: 424242, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } },
    ai: {}, defense: null,
    objective: 'Тестовая цель',
    ...over,
  };
}
function ticks(n) { for (let i = 0; i < n; i++) game.tick(); }
function paint() { game.render(1); ui.update(game); ui.drawMinimap(game); }
// Достроенное здание в чистом поле рядом с базой стороны.
function placeDone(st, side, type, cx, cy) {
  const bc = cfg.BUILDINGS[type];
  for (let r = 0; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (B.canPlace(st.map, cx + dx, cy + dy, bc.w, bc.h)) {
          const b = B.placeBuildingCmd(st, side, type, cx + dx, cy + dy, []);
          b.done = true; b.hp = b.maxHp;
          return b;
        }
      }
    }
  }
  throw new Error('негде встать: ' + type);
}
// Грейд до целевого уровня ускоренной перемоткой (цены настоящие).
function gradeTo(st, b, to) {
  while ((b.level || 1) < to) {
    const r = B.startGrade(st, b);
    assert(r === 'ok', 'старт грейда: ' + r);
    b.gradeUp.t = 0.01;
    ticks(3);
  }
  assert((b.level || 1) === to, 'уровень не ' + to);
}

// ---------- R1: турель ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.player = 99999;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const tur = placeDone(st, 'player', 'turret', cc.tx, cc.ty);
  assert(tur.level === 1 && !tur.gradeUp, 'турель не Г1');
  // Враг-строение на 176px: Г1 не достаёт (150+16), Г2 достаёт (165+16).
  const foe = B.placeBuildingCmd(st, 'enemy', 'turret', tur.tx + 6, tur.ty, []);
  foe.done = true; foe.hp = foe.maxHp;
  assert(!st.units.some((u) => u.side === 'enemy' && !u.dead && Math.hypot(u.x - tur.x, u.y - tur.y) < 300), 'вражеские юниты рядом');
  assert(U.acquireTarget(st, tur, game.grid) === null, 'Г1 достала на 176px');
  const m0 = st.minerals.player;
  assert(B.startGrade(st, tur) === 'ok', 'старт Г2 не ok');
  assert(st.minerals.player === m0 - 60, 'цена Г2 не 60');
  assert(tur.gradeUp && tur.gradeUp.total === 30, 'время Г2 не 30с');
  tur.gradeUp.t = 0.01; ticks(3);
  assert(tur.level === 2, 'уровень не Г2');
  assert(U.acquireTarget(st, tur, game.grid) === foe, 'Г2 не достала на 176px');
  assert(cfg.gradeDmg('turret', 2, 8) === 10, 'урон Г2 не 10');
  // Боевой выстрел Г2 по живому врагу — урон в снаряде настоящий.
  const dummy = U.spawnUnit(st, 'enemy', 'marine', tur.x + 100, tur.y, false);
  dummy.hp = dummy.maxHp = 1e6;
  let shot = null;
  for (let i = 0; i < 8 && !shot; i++) {
    ticks(15);
    shot = st.projectiles.find((p) => !p.dead && p.src === tur);
  }
  assert(shot && shot.dmg === 10, 'снаряд Г2 не 10: ' + (shot && shot.dmg));
  assert(B.startGrade(st, tur) === 'ok', 'старт Г3 не ok');
  assert(tur.gradeUp.total === 45, 'время Г3 не 45с');
  tur.gradeUp.t = 0.01; ticks(3);
  assert(tur.level === 3, 'уровень не Г3');
  assert(cfg.gradeDmg('turret', 3, 8) === 12, 'урон Г3 не 12');
  assert(cfg.gradeRange('turret', 3, 150) === 180, 'дальность Г3 не 180');
  assert(B.startGrade(st, tur) === 'max', 'Г3 грейдится дальше');
  paint(); // шевроны + слоты — без ошибок
  pass('R1 turret: цены 60/30с→100/45с, урон 8→10→12, дальность 150→165→180');
} catch (e) { fail('R1 turret', e); }

// ---------- R2: бункер ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.player = 99999;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const bun = placeDone(st, 'player', 'bunker', cc.tx, cc.ty);
  gradeTo(st, bun, 2);
  assert(bun.maxHp === Math.round(1100 * 1.25), 'прочность Г2: ' + bun.maxHp);
  const squad = [];
  for (let i = 0; i < 7; i++) {
    const m = U.spawnUnit(st, 'player', 'marine', bun.x - 40 + i * 12, bun.y + 60, false);
    U.orderGarrison(st, m, bun);
    squad.push(m);
  }
  ticks(120);
  assert(bun.garrison.length === 6, 'в Г2 влезло не 6: ' + bun.garrison.length);
  assert(!squad[6].garrison, '7-й влез в Г2 сверх капа');
  gradeTo(st, bun, 3);
  assert(bun.maxHp === Math.round(1100 * 1.5), 'прочность Г3: ' + bun.maxHp);
  for (let i = 0; i < 2; i++) {
    const m = U.spawnUnit(st, 'player', 'marine', bun.x - 40 + i * 12, bun.y + 60, false);
    U.orderGarrison(st, m, bun);
    squad.push(m);
  }
  U.orderGarrison(st, squad[6], bun);
  ticks(120);
  assert(bun.garrison.length === 8, 'в Г3 влезло не 8: ' + bun.garrison.length);
  paint();
  pass('R2 bunker: гарнизон 4→6→8, прочность 1100→1375→1650');
} catch (e) { fail('R2 bunker', e); }

// ---------- R3: здание работает во время грейда ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.player = 99999;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const bar = placeDone(st, 'player', 'barracks', cc.tx, cc.ty);
  B.enqueueUnit(st, bar, 'marine');
  assert(B.startGrade(st, bar) === 'ok', 'старт грейда не ok');
  const q0 = bar.queue[0].t, g0 = bar.gradeUp.t;
  ticks(30); // 1 игровая секунда
  assert(bar.queue[0].t < q0, 'производство встало во время грейда');
  assert(bar.gradeUp && bar.gradeUp.t < g0, 'грейд не тикает');
  assert((bar.level || 1) === 1, 'уровень поднялся раньше времени');
  pass('R3 busy-works: очередь и грейд тикают одновременно');
} catch (e) { fail('R3 busy-works', e); }

// ---------- R4: завод — темп и очередь ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.player = 99999;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const fac = placeDone(st, 'player', 'factory', cc.tx, cc.ty);
  gradeTo(st, fac, 2);
  for (let i = 0; i < 7; i++) assert(B.enqueueUnit(st, fac, 'buggy') !== 'queue', 'Г2 не взял ' + (i + 1) + '-й заказ');
  assert(B.enqueueUnit(st, fac, 'buggy') === 'queue', 'Г2 взял 8-й заказ');
  fac.queue.length = 0;
  B.enqueueUnit(st, fac, 'buggy');
  fac.queue[0].t = 10;
  ticks(30);
  assert(Math.abs(fac.queue[0].t - 8.75) < 0.05, 'темп Г2 не ×1.25: ' + fac.queue[0].t);
  gradeTo(st, fac, 3);
  fac.queue.length = 0;
  for (let i = 0; i < 9; i++) assert(B.enqueueUnit(st, fac, 'buggy') !== 'queue', 'Г3 не взял ' + (i + 1) + '-й заказ');
  assert(B.enqueueUnit(st, fac, 'buggy') === 'queue', 'Г3 взял 10-й заказ');
  fac.queue.length = 0;
  B.enqueueUnit(st, fac, 'buggy');
  fac.queue[0].t = 10;
  ticks(30);
  assert(Math.abs(fac.queue[0].t - 8.5) < 0.05, 'темп Г3 не ×1.5: ' + fac.queue[0].t);
  paint();
  pass('R4 factory: очередь 5→7→9, темп ×1.25→×1.5');
} catch (e) { fail('R4 factory', e); }

// ---------- R5: отмена ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.player = 99999;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const bar = placeDone(st, 'player', 'barracks', cc.tx, cc.ty);
  const m0 = st.minerals.player;
  assert(B.startGrade(st, bar) === 'ok', 'старт не ok');
  assert(st.minerals.player === m0 - 90, 'цена Г2 казармы не 90');
  assert(B.startGrade(st, bar) === 'busy', 'повторный старт не busy');
  B.cancelGrade(st, bar);
  assert(st.minerals.player === m0, 'отмена не вернула минералы');
  assert(!bar.gradeUp && (bar.level || 1) === 1, 'отмена тронула уровень');
  B.cancelGrade(st, bar); // пустая отмена — без ошибок
  pass('R5 cancel: отмена возвращает 90 минералов, уровень цел');
} catch (e) { fail('R5 cancel', e); }

// ---------- R6: кнопки ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.player = 99999;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const bar = placeDone(st, 'player', 'barracks', cc.tx, cc.ty);
  st.selection = [bar];
  const hasGrade = (cmds) => cmds.some((c) => c.icon === 'grade');
  let cmds = game.getCommands();
  const gr = cmds.find((c) => c.code === 'KeyR');
  assert(gr && gr.label === 'Грейд II' && gr.icon === 'grade', 'нет кнопки Грейд II');
  paint(); // панель с иконкой grade — без ошибок
  assert(B.startGrade(st, bar) === 'ok', 'старт не ok');
  cmds = game.getCommands();
  assert(!hasGrade(cmds), 'грейд остался во время грейда');
  assert(cmds.some((c) => c.code === 'KeyX'), 'нет отмены KeyX во время грейда');
  B.cancelGrade(st, bar);
  gradeTo(st, bar, 3);
  cmds = game.getCommands();
  assert(!hasGrade(cmds), 'грейд остался на Г3');
  const ecc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc');
  const ebar = placeDone(st, 'enemy', 'barracks', ecc.tx, ecc.ty);
  st.selection = [ebar];
  assert(!hasGrade(game.getCommands()), 'грейд на чужой казарме');
  const lab = placeDone(st, 'player', 'lab', cc.tx, cc.ty);
  st.selection = [lab];
  assert(!hasGrade(game.getCommands()), 'грейд на лаборатории'); // KeyR лабы — исследование, не грейд
  const wall = placeDone(st, 'player', 'wall', cc.tx, cc.ty);
  st.selection = [wall];
  assert(!hasGrade(game.getCommands()), 'грейд на стене');
  st.selection = [];
  pass('R6 buttons: KeyR своим Г1/Г2, KeyX в работе, чужим/Г3/лабе/стене — нет');
} catch (e) { fail('R6 buttons', e); }

// ---------- R7: ИИ не грейдит ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.enemy = 99999;
  const ecc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc');
  if (!st.buildings.some((b) => b.side === 'enemy' && b.type === 'barracks')) {
    placeDone(st, 'enemy', 'barracks', ecc.tx, ecc.ty);
  }
  ticks(900); // 30 игровых секунд с полной казной
  for (const b of st.buildings) {
    if (b.side !== 'enemy' || b.dead) continue;
    assert((b.level || 1) === 1 && !b.gradeUp, 'ИИ грейдит: ' + b.type);
  }
  pass('R7 ai-idle: 30с с казной 99999 — у ИИ все здания Г1');
} catch (e) { fail('R7 ai-idle', e); }

console.log(failures.length ? `\nИТОГ SIM_GRADE: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_GRADE: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
