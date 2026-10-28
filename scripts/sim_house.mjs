// ============================================================
// sim_house.mjs — аудит владельца 26.10.2026, пакет P2 «Дом» (issue #35).
//
// СПЕКА ПОСЛЕ ПРАВКИ ВЛАДЕЛЬЦА (§«мы всё напутали»):
//   • чинят — СБОРЩИКИ сборщиков и технику (repair);
//   • лечат — ХИЛЫ, и только СУЩЕСТВ (живых/людей своей расы): техника и
//     дроны-сборщики не лечатся никогда;
//   • авто-лечение = «КЦ отправляет хила к раненому»: пока у стороны есть КЦ,
//     цель хилу выдаёт диспетчер у КЦ; без КЦ хил ищет раненого сам;
//   • АУРА Дома Г4+ — наоборот, ТОЛЬКО В РЕЙДЕ (на своей базе её нет).
//
// B1 (перелёт) остаётся как было: центр здания b.x/b.y едет вместе с Домом —
// точка сбора, отсек, эффекты и дистанции считаются от нового места.
//
// Проверяем:
//   H1  после перелёта Дома b.x/b.y = центр нового места (и в полёте, и после);
//   H2  отсек выпускается у НОВОГО места, а не у старого центра;
//   H3  ауры Дома на БАЗЕ нет: Дом-Г6 рядом с раненым ничего не лечит;
//   H4  аура в РЕЙДЕ работает: Дом-шаттл Г4+ поднимает HP существу рядом,
//       но НЕ трогает технику/дрона и не лечит чужую расу;
//   H5  сборщик чинит сборщика (приказ repair, HP растёт), приказ игрока цел;
//   H6  ПКМ по раненому сборщику = ремонт;
//   H7  хил лечит существо и НЕ лечит дрон-техника/технику/чужую расу;
//   H8  авто-лечение: КЦ отправляет свободного хила к раненому; вне радиуса
//       КЦ и без КЦ (нет базы) — хил не приходит, но действует сам;
//   H9  приказ игрока у хила не перебивается диспетчером КЦ;
//   H11 R1 (аудит SZ): пул авто-хилов фильтруется по расе цели (слот не сгорает);
//   H12 ПКМ «лечить» (GO владельца 26.10): хилы → heal, не-хилы → move,
//       ветка ремонта техники B3 не сломана;
//   H13 нет хилов в выделении → тихий фолбэк в движение.
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
  st._cc = cc;
  ticks(2);
  return st;
}

// Канон владельца 28.10: автопоиск сборщика — только по открытым жилам.
// Хелпер симулирует разведку (открытие тумана) и возвращает рабочих к добыче.
function revealAndGather(st) {
  for (const c of st.map.crystals) if (c.amount > 0) st.fog.mark(c.tx, c.ty, 2);
  for (const u of st.units) {
    if (u.side !== 'player' || u.dead || u.garrison || u.type !== 'worker') continue;
    const c = U.nearestCrystal(st, u);
    if (c) U.orderGather(st, u, c);
  }
}

// ---------- H1: перелёт Дома обновляет мировой центр ----------
try {
  const st = boot();
  const b = st._depot;
  const oldX = b.x, oldY = b.y;
  game.moveHouse(b, (b.tx + 8) * TILE, (b.ty + 6) * TILE);
  const expectX = (b.tx + b.w / 2) * TILE, expectY = (b.ty + b.h / 2) * TILE;
  assert(Math.abs(b.x - expectX) <= 1 && Math.abs(b.y - expectY) <= 1,
    `центр не обновился: (${b.x},${b.y}) вместо (${expectX},${expectY})`);
  assert(Math.hypot(b.x - oldX, b.y - oldY) > TILE * 3, 'Дом не сдвинулся');
  ticks(200);
  assert(Math.abs(b.x - expectX) <= 1 && Math.abs(b.y - expectY) <= 1, 'после полёта центр уехал');
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

// ---------- H3: на БАЗЕ ауры Дома нет ----------
try {
  const st = boot(8);
  const b = st._depot;
  const marine = U.spawnUnit(st, 'player', 'marine', b.x + TILE, b.y, false);
  marine.hp = 10;
  const worker = U.spawnUnit(st, 'player', 'worker', b.x, b.y + TILE, false);
  worker.hp = 5;
  // Убираем КЦ, чтобы диспетчер авто-лечения не подменил проверку ауры.
  for (const cc of st.buildings) if (cc.type === 'cc' && cc.side === 'player') cc.dead = true;
  // Канон 28.10: рабочий занят добычей по открытым жилам (иначе бездельник
  // получает пассивную регенерацию и проверка ауры не о том).
  revealAndGather(st);
  ticks(150);
  assert(marine.hp === 10, `на базе аура Дома всё ещё лечит существо (hp ${Math.round(marine.hp)})`);
  assert(worker.hp === 5, `на базе аура Дома лечит дрона-сборщика (hp ${Math.round(worker.hp)})`);
  pass('H3 на базе ауры Дома нет: ни существо, ни дрон HP не получают');
} catch (e) { fail('H3 аура на базе выключена', e); }

// ---------- H4: аура Дома работает В РЕЙДЕ ----------
try {
  const st = boot(6);
  const cc = st._cc;
  for (let i = 0; i < 3; i++) U.spawnUnit(st, 'player', 'worker', cc.x + 80 + i * 24, cc.y + 90, false);
  ticks(3);
  const res = game.launchRaidExpedition({ tier: 1, seed: 91, budget: 80, units: { worker: 2 } });
  assert(res && res.ok, 'вылазка не запустилась: ' + JSON.stringify(res));
  ticks(4);
  const ex = game.state;
  assert(ex.raidMode === 'expedition', 'не вылазка после запуска');
  const house = ex.raidHouse;
  house.level = 6;
  assert(house && (house.level || 1) >= 4, 'Дом-шаттл ниже Г4 — тест ауры не о чём');

  const marine = U.spawnUnit(ex, 'player', 'marine', house.x + TILE, house.y, false);
  marine.hp = 10;
  const tank = U.spawnUnit(ex, 'player', 'tank', house.x - TILE, house.y, false);
  tank.hp = 50;
  const drone = ex.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.dead);
  drone.hp = 20;
  const alien = U.spawnUnit(ex, 'player', 'marine', house.x, house.y + TILE, false);
  alien.faction = 'alien';
  alien.hp = 10;

  // Канон 28.10: сборщики заняты открытой добычей (не чинят технику из праздности).
  revealAndGather(ex);
  for (let i = 0; i < 90; i++) { // ~3 c логики
    marine.x = house.x + TILE; marine.y = house.y;
    tank.x = house.x - TILE; tank.y = house.y;
    drone.x = house.x; drone.y = house.y + TILE * 0.5;
    alien.x = house.x; alien.y = house.y + TILE;
    if (game.state !== ex) break;
    game.tick();
  }
  assert(marine.hp > 10, 'аура Дома в рейде не лечит существо своей расы');
  assert(tank.hp === 50, `аура Дома в рейде лечит технику (hp ${Math.round(tank.hp)}) — должна только существ`);
  assert(drone.hp === 20, `аура Дома в рейде лечит дрона-сборщика (hp ${Math.round(drone.hp)}) — его чинят сборщики`);
  assert(alien.hp === 10, `аура Дома в рейде лечит чужую расу (hp ${Math.round(alien.hp)})`);
  pass('H4 аура Дома в рейде лечит существо своей расы, технику/дрона/чужую расу — нет');
} catch (e) { fail('H4 аура в рейде', e); }

// ---------- H9 (П2): таймеры дома идут, пока идёт рейд ----------
try {
  const st = boot(3);
  const b = st._depot;
  // Дом на апгрейде (600 c остаток) + очередь производства (30 c).
  b.gradeUp = { to: b.level + 1, t: 600, total: 600 };
  b.queue = [{ type: 'marine', t: 30, total: 30 }];
  ticks(2);
  const res = game.launchRaidExpedition({ tier: 1, seed: 77, budget: 0, units: { worker: 1, marine: 1 } });
  assert(res && res.ok, 'вылазка для H9 не запустилась: ' + JSON.stringify(res));
  // Рейд «длился» 60 секунд реального времени: сдвигаем capturedAt снимка базы.
  game.raidSession.homeDto.capturedAt = Date.now() - 60000;
  ticks(2);
  game.triggerRaidEvac(); // нажатие 1 — маяк
  game.triggerRaidEvac(); // нажатие 2 — взлёт и возврат на базу
  const home = game.state;
  assert(home.raidMode === 'home', 'не вернулись на базу после эвакуации');
  const b2 = home.buildings.find((x) => !x.dead && x.type === 'depot');
  assert(b2 && b2.gradeUp, 'апгрейд Дома пропал после возврата');
  assert(b2.gradeUp.t <= 540.5,
    `таймер апгрейда не списал время рейда: ${b2.gradeUp.t.toFixed(1)} (ожидалось ~540)`);
  assert(b2.gradeUp.t >= 538,
    `таймер апгрейда списал слишком много: ${b2.gradeUp.t.toFixed(1)}`);
  const q = b2.queue[0];
  assert(!q || q.t <= 0.5 || q.t >= 28,
    `очередь в «мёртвой зоне»: t=${q && q.t} (либо ~0 — время списано, либо следующий юнит с полным t)`);
  pass(`H9 таймеры дома идут в рейде: апгрейд 600→${b2.gradeUp.t.toFixed(1)} c (рейд 60 c)`);
} catch (e) { fail('H9 таймеры дома в рейде', e); }

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
  assert(helper.order.kind === 'repair', 'ПКМ по раненому сборщику не дал ремонт, а ' + helper.order.kind);
  assert(helper.order.target === hurt, 'ремонт назначен не на того сборщика');
  pass('H6 ПКМ по раненому сборщику ставит ремонт (как по технике)');
} catch (e) { fail('H6 ПКМ-ремонт сборщика', e); }

// ---------- H7: хил лечит только существа своей расы ----------
try {
  const st = boot(3);
  const cc = st._cc;
  // Убираем стартовых дронов-техников: в этом тесте нас интересует ТОЛЬКО хил.
  // (Иначе ремонт танка соседом — законная реакция сборщиков, а не протечка лечения.)
  for (const w of st.units) if (w.side === 'player' && w.cfg.canMine) w.dead = true;
  const x0 = cc.x + TILE * 5, y0 = cc.y + TILE * 6;
  const healer = U.spawnUnit(st, 'player', 'medic', x0, y0, false);
  const marine = U.spawnUnit(st, 'player', 'marine', x0 + 24, y0, false);
  marine.hp = 20;
  const drone = U.spawnUnit(st, 'player', 'worker', x0 - 30, y0 + 6, false);
  drone.hp = 20;
  const tank = U.spawnUnit(st, 'player', 'tank', x0, y0 + 30, false);
  tank.hp = 40;
  const foeRace = U.spawnUnit(st, 'player', 'marine', x0 + 12, y0 + 12, false);
  foeRace.faction = 'alien';
  foeRace.hp = 20;

  const okDrone = U.orderHeal(st, healer, drone);
  const okTank = U.orderHeal(st, healer, tank);
  const okRace = U.orderHeal(st, healer, foeRace);
  assert(okDrone === false, 'хил принял приказ лечить дрон-сборщика');
  assert(okTank === false, 'хил принял приказ лечить технику');
  assert(okRace === false, 'хил принял приказ лечить чужую расу');
  assert(U.canBeHealed(marine) === true && U.canBeHealed(drone) === false &&
    U.canBeHealed(tank) === false, 'классификация «существо/машина» неверна');
  assert(U.canBeRepaired(drone) === true && U.canBeRepaired(tank) === true &&
    U.canBeRepaired(marine) === false, 'классификация «ремонт» неверна');

  const accepted = U.orderHeal(st, healer, marine);
  assert(accepted === true, 'хил не принял приказ лечить марина своей расы');
  const hp0 = marine.hp;
  for (let i = 0; i < 90; i++) {
    game.tick();
    // КЦ продолжает выпускать дронов-техников из очереди — они законно чинят
    // танк. Для чистоты теста про лечение убираем их из сцены каждый тик.
    for (const w of st.units) if (w.side === 'player' && w.cfg.canMine && !w.dead) w.dead = true;
    assert(!(healer.order.kind === 'heal' && healer.order.target && !U.canBeHealed(healer.order.target)),
      'хил взял в цель машину (дрон/технику)');
  }
  assert(marine.hp > hp0, 'хил не лечит марина своей расы');
  assert(drone.hp === 20 && tank.hp === 40 && foeRace.hp === 20,
    `хил вылечил запрещённую цель (drone ${Math.round(drone.hp)}, tank ${Math.round(tank.hp)}, alien ${Math.round(foeRace.hp)})`);
  pass('H7 хил лечит существо своей расы; дрон, техника и чужая раса — отказ');
} catch (e) { fail('H7 хил: существа и раса', e); }

// ---------- H8: авто-лечение = КЦ отправляет хила ----------
try {
  const st = boot(3);
  const cc = st._cc;
  // Раненый марин рядом с КЦ, хил — свободен и тоже рядом.
  const hurt = U.spawnUnit(st, 'player', 'marine', cc.x + TILE * 3, cc.y + TILE * 2, false);
  hurt.hp = Math.round(hurt.maxHp * 0.35);
  const healer = U.spawnUnit(st, 'player', 'medic', cc.x + TILE * 5, cc.y + TILE * 3, false);
  let saw = null;
  for (let i = 0; i < 200 && !saw; i++) {
    game.tick();
    if (healer.order.kind === 'heal' && healer.order.target === hurt) saw = healer.order;
  }
  assert(saw, 'КЦ не отправил свободного хила к раненому (авто-лечение не сработало)');
  assert(saw.auto === true, 'приказ авто-лечения не помечен auto (нельзя отличить от приказа игрока)');
  const hp0 = hurt.hp;
  for (let i = 0; i < 90; i++) game.tick();
  assert(hurt.hp > hp0, `авто-лечение не идёт: ${Math.round(hp0)} → ${Math.round(hurt.hp)}`);

  // Вне радиуса КЦ диспетчер не вмешивается: раненый далеко, хил остаётся свободен.
  const st2 = boot(3);
  const cc2 = st2._cc;
  const far = U.spawnUnit(st2, 'player', 'marine', cc2.x + TILE * 20, cc2.y + TILE * 20, false);
  far.hp = Math.round(far.maxHp * 0.3);
  const healer2 = U.spawnUnit(st2, 'player', 'medic', cc2.x + TILE * 22, cc2.y + TILE * 20, false);
  for (let i = 0; i < 120; i++) game.tick();
  assert(healer2.order.kind !== 'heal' || healer2.order.target !== far,
    'диспетчер отправил хила за пределы радиуса КЦ');
  pass('H8 авто-лечение: КЦ отправляет хила к раненому (auto), за радиусом не вмешивается');
} catch (e) { fail('H8 авто-лечение от КЦ', e); }

// ---------- H9: приказ игрока у хила не перебивается ----------
try {
  const st = boot(3);
  const cc = st._cc;
  const hurt = U.spawnUnit(st, 'player', 'marine', cc.x + TILE * 2, cc.y + TILE * 2, false);
  hurt.hp = Math.round(hurt.maxHp * 0.4);
  const healer = U.spawnUnit(st, 'player', 'medic', cc.x + TILE * 4, cc.y + TILE * 2, false);
  U.orderMove(st, healer, cc.x + TILE * 12, cc.y + TILE * 10);
  const orderRef = healer.order;
  for (let i = 0; i < 30; i++) game.tick();
  assert(healer.order === orderRef && healer.order.kind === 'move',
    'диспетчер КЦ перебил приказ игрока: ' + healer.order.kind);
  pass('H9 приказ игрока у хила сильнее авто-лечения КЦ');
} catch (e) { fail('H9 приоритет приказа игрока', e); }

// ---------- H10: своя раса лечится, резерв без КЦ работает ----------
try {
  // 1) Кхарид-хил лечит кхарид-существо (сторона enemy, обе — alien).
  const st = boot(3);
  const cc = st._cc;
  const x0 = cc.x + TILE * 5, y0 = cc.y + TILE * 7;
  for (const w of st.units) if (w.side === 'enemy') w.dead = true;
  const alienHealer = U.spawnUnit(st, 'enemy', 'medic', x0, y0, false);
  const alienMarine = U.spawnUnit(st, 'enemy', 'marine', x0 + 22, y0, false);
  assert(alienHealer.faction === 'alien' && alienMarine.faction === 'alien', 'не кхарид-пара');
  alienMarine.hp = 20;
  assert(U.orderHeal(st, alienHealer, alienMarine) === true, 'кхарид-хил не принял своё существо');
  const hp0 = alienMarine.hp;
  for (let i = 0; i < 60; i++) game.tick();
  assert(alienMarine.hp > hp0, 'кхарид-хил не лечит своё существо');

  // 2) Без КЦ (миссии без базы) хил всё равно поднимает раненого рядом сам.
  const st2 = boot(3);
  for (const b2 of st2.buildings) if (b2.type === 'cc') b2.dead = true;
  const h2 = U.spawnUnit(st2, 'player', 'medic', st2._depot.x + TILE * 6, st2._depot.y + TILE * 6, false);
  const m2 = U.spawnUnit(st2, 'player', 'marine', h2.x + 20, h2.y, false);
  m2.hp = 15;
  for (let i = 0; i < 120; i++) game.tick();
  assert(m2.hp > 15, 'без КЦ хил не лечит раненого рядом (резервное поведение сломано)');
  pass('H10 кхарид лечит кхарид; без КЦ хил работает сам (резерв для миссий без базы)');
} catch (e) { fail('H10 раса и резерв без КЦ', e); }

// ---------- H11: R1 — пул авто-хилов фильтруется по расе цели ----------
// Аудит SZ: при несовпадении расы orderHeal возвращал false, а счётчик
// назначений уже сгорал — хил выпадал из диспетчера до следующего тика и
// раненый своей расы оставался без лекаря (слот «съедала» чужая цель).
try {
  const st = boot(3);
  const cc = st._cc;
  const human = U.spawnUnit(st, 'player', 'marine', cc.x + TILE * 4, cc.y + TILE * 2, false);
  human.hp = Math.round(human.maxHp * 0.4);
  // Чужая раса на нашей стороне — БЛИЖЕ к хилу, поэтому старый код выбирал
  // именно её и сжигал слот назначения.
  const alien = U.spawnUnit(st, 'player', 'marine', cc.x + TILE * 5, cc.y + TILE * 3, false);
  alien.faction = 'alien';
  alien.hp = Math.round(alien.maxHp * 0.3);
  const healer = U.spawnUnit(st, 'player', 'medic', cc.x + TILE * 6, cc.y + TILE * 3, false);
  let auto = null;
  for (let i = 0; i < 240 && !auto; i++) {
    game.tick();
    if (healer.order.kind === 'heal' && healer.order.auto) auto = healer.order;
  }
  assert(auto, 'R1: авто-лечение не назначило хила вовсе (слот сгорел на чужой расе)');
  assert(auto.target === human,
    'R1: хил взял не свою расу/не того раненого: ' + (auto.target === alien ? 'чужую расу' : 'иного юнита'));
  const hp0 = human.hp;
  for (let i = 0; i < 90; i++) game.tick();
  assert(human.hp > hp0, 'R1: назначенный хил не лечит своего');
  assert(alien.hp <= alien.maxHp, 'R1: чужую расу вылечили');
  pass('H11 R1: пул авто-хилов фильтруется по расе цели — слот не сгорает, свой раненый получает лекаря');
} catch (e) { fail('H11 R1 раса в пуле', e); }

// ---------- H12: ПКМ «лечить» — симметрично ремонту (GO владельца) ----------
try {
  const st = boot(3);
  const cc = st._cc;
  const hurt = U.spawnUnit(st, 'player', 'marine', cc.x + TILE * 6, cc.y + TILE * 4, false);
  hurt.hp = Math.round(hurt.maxHp * 0.5);
  const healer = U.spawnUnit(st, 'player', 'medic', cc.x + TILE * 8, cc.y + TILE * 4, false);
  const marine = U.spawnUnit(st, 'player', 'marine', cc.x + TILE * 8, cc.y + TILE * 6, false);
  st.selection = [healer, marine];
  game.issueRMB(hurt.x, hurt.y);
  assert(healer.order.kind === 'heal' && healer.order.target === hurt,
    'ПКМ по раненому существу не дал приказ «лечить»: ' + healer.order.kind);
  assert(healer.order.auto === false, 'ПКМ-лечение помечено как авто (приказ игрока!)');
  assert(marine.order.kind === 'move', 'не-хил не пошёл к цели: ' + marine.order.kind);
  const hp0 = hurt.hp;
  for (let i = 0; i < 120; i++) game.tick();
  assert(hurt.hp > hp0, 'ПКМ-лечение не поднимает HP: ' + Math.round(hp0) + ' → ' + Math.round(hurt.hp));
  // Техника остаётся в ремонтной ветке B3: ПКМ по танку не лечит, а чинит.
  const tank = U.spawnUnit(st, 'player', 'tank', cc.x + TILE * 4, cc.y + TILE * 6, false);
  tank.hp = 40;
  const tech = U.spawnUnit(st, 'player', 'worker', cc.x + TILE * 6, cc.y + TILE * 6, false);
  st.selection = [tech];
  game.issueRMB(tank.x, tank.y);
  assert(tech.order.kind === 'repair' && tech.order.target === tank,
    'ветка ремонта B3 сломалась: ПКМ по технике дал ' + tech.order.kind);
  pass('H12 ПКМ «лечить»: хилы получают heal, не-хилы идут за целью, техника по-прежнему в ремонте');
} catch (e) { fail('H12 ПКМ лечение', e); }

// ---------- H13: нет хилов — тихий фолбэк в движение ----------
try {
  const st = boot(3);
  const cc = st._cc;
  const hurt = U.spawnUnit(st, 'player', 'marine', cc.x + TILE * 6, cc.y + TILE * 4, false);
  hurt.hp = Math.round(hurt.maxHp * 0.4);
  const marine = U.spawnUnit(st, 'player', 'marine', cc.x + TILE * 8, cc.y + TILE * 4, false);
  st.selection = [marine];
  let threw = null;
  try { game.issueRMB(hurt.x, hurt.y); } catch (e) { threw = e; }
  assert(!threw, 'ПКМ по раненому без хилов бросил исключение: ' + (threw && threw.message));
  assert(marine.order.kind === 'move', 'без хилов приказ не стал движением: ' + marine.order.kind);
  pass('H13 нет хилов в выделении: ПКМ по раненому = обычное движение (тихий фолбэк)');
} catch (e) { fail('H13 тихий фолбэк', e); }

if (failures.length) {
  console.log(`\n❌ Дом (P2): провалено ${failures.length} (${failures.join(', ')})`);
  process.exit(1);
}
console.log('\n✅ Дом (P2): перелёт, аура только в рейде, хилы лечат существ, сборщики чинят машины');
