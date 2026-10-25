// ============================================================
// sim_house.mjs — аудит владельца 26.10.2026, пакет P2 «Дом» (issue #35).
//
// Три находки:
//   B1 · T2/T2b — «сбор показывает не там, где он стоит»: moveHouse менял
//        тайлы, но не мировой центр b.x/b.y. От центра считаются аура,
//        выпуск отсека, ремонт и дистанции в панели — всё оставалось на
//        старом месте.
//   B2 · T5 — аура лечения Дома Г4+ работала ТОЛЬКО на вылазке (рейдовый
//        тик). Владелец: «только на базовой локации, на вылазке не работает».
//   B3 · T6 — сборщики не чинили сборщиков: цели ремонта фильтровались по
//        cfg.vehicle. Владелец: «да, сами, это их базовая функция».
//
// Проверяем:
//   H1  после перелёта Дома b.x/b.y = центр нового места (и в полёте, и после);
//   H2  отсек выпускается у НОВОГО места, а не у старого центра;
//   H3  аура Г4+ на базе лечит своих в радиусе нового центра, включая
//       сборщиков; Г3 не лечит; далеко от Дома не лечит;
//   H4  на вылазке ауры нет (функция и живой тик) — канон владельца;
//   H5  сборщик чинит сборщика: приказ repair появляется сам, HP растёт,
//       приказ игрока (движение) не подменяется;
//   H6  ПКМ по раненому сборщику — ремонт (как по технике), не «просто идём».
//
// Запуск: node scripts/sim_house.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

await import('../r/js/game.js');
const U = await import('../r/js/units.js' + V);
const B = await import('../r/js/buildings.js' + V);

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const TILE = 32;
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };

function boot(houseLv = 5) {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const st = game.state;
  st.minerals.player = 100000;
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const depot = new B.Building(st, 'player', 'depot', cc.tx + 2, cc.ty + 2, true);
  depot.level = houseLv;
  depot.maxHp = depot.hp = Math.round(depot.cfg.hp * 2);
  st.map.markBuilding(depot);
  st.bcount.player++;
  st._depot = depot;
  ticks(2);
  return st;
}

// ---------- H1: перелёт Дома обновляет мировой центр ----------
try {
  const st = boot();
  const b = st._depot;
  const oldX = b.x, oldY = b.y;
  const wx = (b.tx + 8) * TILE, wy = (b.ty + 6) * TILE;
  game.moveHouse(b, wx, wy);
  const expectX = (b.tx + b.w / 2) * TILE, expectY = (b.ty + b.h / 2) * TILE;
  assert(Math.abs(b.x - expectX) <= 1 && Math.abs(b.y - expectY) <= 1,
    `центр не обновился: (${b.x},${b.y}) вместо (${expectX},${expectY})`);
  assert(Math.hypot(b.x - oldX, b.y - oldY) > TILE * 3, 'Дом не сдвинулся');
  ticks(200); // полёт закончился (3–4 c логики)
  assert(Math.abs(b.x - expectX) <= 1 && Math.abs(b.y - expectY) <= 1,
    'после полёта центр уехал');
  assert(!b.flight, 'визуальный полёт не завершился');
  pass(`H1 перелёт Дома: b.x/b.y = новый центр (${Math.round(b.x)},${Math.round(b.y)})`);
} catch (e) { fail('H1 центр Дома после перелёта', e); }

// ---------- H2: отсек выпускается у нового места ----------
try {
  const st = boot();
  const b = st._depot;
  const oldCenter = { x: b.x, y: b.y };
  game.moveHouse(b, (b.tx + 8) * TILE, (b.ty + 6) * TILE);
  ticks(5);
  const u = U.spawnUnit(st, 'player', 'marine', b.x, b.y + 40, false);
  u.garrison = b;
  u.x = b.x; u.y = b.y;
  b.garrison.push(u);
  U.releaseGarrison(st, b);
  const newX = (b.tx + b.w / 2) * TILE, newY = (b.ty + b.h / 2) * TILE;
  assert(!u.garrison, 'юнит не вышел из отсека');
  const dNew = Math.hypot(u.x - newX, u.y - newY);
  const dOld = Math.hypot(u.x - oldCenter.x, u.y - oldCenter.y);
  assert(dNew < TILE * 3.5, `выпуск отсека далеко от нового места: ${(dNew / TILE).toFixed(1)} тайла`);
  assert(dOld > dNew, `выпуск считается от старого центра (old ${(dOld / TILE).toFixed(1)} тайла)`);
  pass(`H2 отсек выходит у нового места (${(dNew / TILE).toFixed(1)} тайла от центра, старое — ${(dOld / TILE).toFixed(1)})`);
} catch (e) { fail('H2 выпуск отсека после перелёта', e); }

// ---------- H3: аура Дома Г4+ на базе ----------
try {
  const st = boot(4);
  const b = st._depot;
  const marine = U.spawnUnit(st, 'player', 'marine', b.x + TILE, b.y, false);
  marine.hp = 10;
  const worker = U.spawnUnit(st, 'player', 'worker', b.x - TILE, b.y, false);
  worker.hp = 5;
  ticks(120); // ~2 c логики
  assert(marine.hp > 10, 'аура не лечит бойца рядом с Домом Г4');
  assert(worker.hp > 5, 'аура не лечит сборщика рядом с Домом Г4 (владелец: чинит и их)');

  // Далеко от Дома аура не достаёт.
  const far = U.spawnUnit(st, 'player', 'marine', b.x + TILE * 10, b.y, false);
  far.hp = 10;
  ticks(60);
  assert(far.hp === 10, 'аура лечит за пределами радиуса');

  // Г3 — ауры ещё нет.
  const st3 = boot(3);
  const b3 = st3._depot;
  const m3 = U.spawnUnit(st3, 'player', 'marine', b3.x + TILE, b3.y, false);
  m3.hp = 10;
  ticks(120);
  assert(m3.hp === 10, 'аура работает на Доме Г3 (должна открываться с Г4)');
  pass('H3 аура Г4+ на базе лечит своих (включая сборщиков), Г3 молчит, радиус соблюдён');
} catch (e) { fail('H3 аура Дома на базе', e); }

// ---------- H4: на вылазке ауры нет ----------
try {
  const st = boot(6);
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  for (let i = 0; i < 3; i++) U.spawnUnit(st, 'player', 'worker', cc.x + 80 + i * 24, cc.y + 90, false);
  ticks(3);
  const res = game.launchRaidExpedition({ tier: 1, seed: 91, budget: 80, units: { worker: 2 } });
  assert(res && res.ok, 'вылазка не запустилась: ' + JSON.stringify(res));
  ticks(4);
  const ex = game.state;
  assert(ex.raidMode === 'expedition', 'не вылазка после запуска');
  const house = ex.raidHouse;
  assert(house && (house.level || 1) >= 4, 'Дом-шаттл ниже Г4 — тест ауры не о чём');
  const u = ex.units.find((x) => x.side === 'player' && !x.dead && x.kind === 'unit');
  assert(u, 'на вылазке нет своего юнита');
  u.x = house.x + TILE; u.y = house.y; u.hp = 10;
  const beforeFn = B.updateHouseAura(ex, 0.5);
  assert(beforeFn === 0, 'updateHouseAura не выключена на вылазке (вернула ' + beforeFn + ')');
  assert(u.hp === 10, 'прямой вызов ауры вылечил на вылазке');
  // И живой тик тоже не лечит.
  for (let i = 0; i < 90; i++) { u.x = house.x + TILE; u.y = house.y; game.tick(); if (game.state !== ex) break; }
  assert(u.hp === 10, 'на вылазке аура Дома всё ещё лечит (hp ' + Math.round(u.hp) + ')');
  pass('H4 на вылазке ауры нет (ни прямой вызов, ни живой тик), HP не растёт');
} catch (e) { fail('H4 аура на вылазке выключена', e); }

// ---------- H5: сборщик чинит сборщика ----------
try {
  const st = boot(3);
  const b = st._depot;
  const hurt = U.spawnUnit(st, 'player', 'worker', b.x + TILE * 3, b.y + TILE * 2, false);
  hurt.hp = Math.round(hurt.maxHp * 0.4);
  const medic = U.spawnUnit(st, 'player', 'worker', b.x + TILE * 3.6, b.y + TILE * 2.2, false);
  st.minerals.player = 50000;
  let sawRepair = false, target = null;
  for (let i = 0; i < 240 && !sawRepair; i++) {
    game.tick();
    const order = medic.order;
    if (order && order.kind === 'repair' && order.target === hurt) { sawRepair = true; target = hurt; }
  }
  assert(sawRepair, 'свободный сборщик не взялся чинить раненого сборщика (приказ repair не появился)');
  const hpBefore = hurt.hp;
  for (let i = 0; i < 120; i++) game.tick();
  assert(hurt.hp > hpBefore || hurt.hp >= hurt.maxHp,
    `ремонт сборщика не идёт: ${Math.round(hpBefore)} → ${Math.round(hurt.hp)}`);
  assert(target === hurt, 'цель ремонта подменилась');

  // Приказ игрока сильнее: отправленный юнит не переключается на ремонт.
  const mover = st.units.find((x) => x.side === 'player' && x.type === 'worker' && x !== medic && !x.dead)
    || U.spawnUnit(st, 'player', 'worker', b.x + TILE * 2, b.y + TILE, false);
  hurt.hp = Math.round(hurt.maxHp * 0.5);
  U.orderMove(st, mover, b.x + TILE * 14, b.y + TILE * 12);
  game.tick();
  assert(mover.order.kind === 'move', 'приказ игрока (движение) подменён ремонтом: ' + mover.order.kind);
  pass('H5 сборщик чинит раненого сборщика (HP растёт), приказ игрока не ломается');
} catch (e) { fail('H5 ремонт сборщиков сборщиками', e); }

// ---------- H6: ПКМ по раненому сборщику = ремонт ----------
try {
  const st = boot(3);
  const b = st._depot;
  const hurt = U.spawnUnit(st, 'player', 'worker', b.x + TILE * 4, b.y + TILE * 3, false);
  hurt.hp = Math.round(hurt.maxHp * 0.5);
  const helper = U.spawnUnit(st, 'player', 'worker', b.x + TILE * 5, b.y + TILE * 3, false);
  st.selection = [helper];
  st.minerals.player = 50000;
  game.issueRMB(hurt.x, hurt.y);
  assert(helper.order.kind === 'repair',
    'ПКМ по раненому сборщику не дал ремонт, а ' + helper.order.kind);
  assert(helper.order.target === hurt, 'ремонт назначен не на того сборщика');
  pass('H6 ПКМ по раненому сборщику ставит ремонт (как по технике)');
} catch (e) { fail('H6 ПКМ-ремонт сборщика', e); }

if (failures.length) {
  console.log(`\n❌ Дом (P2): провалено ${failures.length} (${failures.join(', ')})`);
  process.exit(1);
}
console.log('\n✅ Дом (P2): центр после перелёта, аура только на базе, сборщики чинят сборщиков');
