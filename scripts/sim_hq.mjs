// ============================================================
// sim_hq.mjs — H: штаб, авторемонт, тревога, разведка и сбор.
// H1: затвор КЦ Г2 → ресерч → 2/цель → возврат к добыче.
// H2: сирена только на базе Г2+, полевая тревога без сирены; рабочие стоят.
// H3: завод/безоружность/разведка/отход/доклады/зеркало.
// H4: idle к точке; приказы и гарнизон не затрагиваются.
// H5: ключ-цель, noBase-миссии и невидимость новых механик для ИИ.
// Запуск: node scripts/sim_hq.mjs
// ============================================================
import './harness.mjs';
import { el } from './harness.mjs';

await import('../js/game.js');
const cfg = await import('../js/config.js');
const B = await import('../js/buildings.js');
const U = await import('../js/units.js');
const { message } = await import('../js/i18n.js');
const missions = await import('../js/missions.js');
const game = globalThis.game;

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(c, msg) { if (!c) throw new Error(msg); }
function ticks(n) { for (let i = 0; i < n; i++) game.tick(); }
function testMission(over = {}) {
  return {
    id: -1, faction: 'human',
    map: { seed: 424242, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } },
    ai: {}, defense: null, objective: 'H harness', ...over,
  };
}
function start(over = {}) {
  game.startMission(testMission(over));
  ticks(3);
  return game.state;
}
function nearDone(st, side, type, cx, cy) {
  const c = cfg.BUILDINGS[type];
  for (let r = 0; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = cx + dx, ty = cy + dy;
      if (!B.canPlace(st.map, tx, ty, c.w, c.h)) continue;
      const b = B.placeBuildingCmd(st, side, type, tx, ty, []);
      b.done = true; b.progress = 1; b.hp = b.maxHp;
      return b;
    }
  }
  throw new Error(`не нашлось места для ${type}`);
}
function atDistance(st, side, type, from, minD, maxD) {
  const c = cfg.BUILDINGS[type];
  let best = null, score = Infinity;
  for (let ty = 1; ty < st.map.h - c.h - 1; ty++) {
    for (let tx = 1; tx < st.map.w - c.w - 1; tx++) {
      if (!B.canPlace(st.map, tx, ty, c.w, c.h)) continue;
      const x = (tx + c.w / 2) * cfg.TILE, y = (ty + c.h / 2) * cfg.TILE;
      const d = Math.hypot(x - from.x, y - from.y);
      if (d < minD || d > maxD) continue;
      const targetD = (minD + maxD) / 2;
      if (Math.abs(d - targetD) < score) { score = Math.abs(d - targetD); best = { tx, ty, d }; }
    }
  }
  if (!best) throw new Error(`не нашлось ${type} на расстоянии ${minD}–${maxD}px от КЦ`);
  const b = B.placeBuildingCmd(st, side, type, best.tx, best.ty, []);
  b.done = true; b.progress = 1; b.hp = b.maxHp;
  return b;
}
function completeGrade(st, b) {
  const before = st.minerals[b.side];
  const target = (b.level || 1) + 1;
  const r = B.startGrade(st, b);
  assert(r === 'ok', `старт грейда ${target}: ${r}`);
  const g = cfg.GRADES[b.type][target];
  assert(st.minerals[b.side] === before - g.cost, `цена грейда ${target}`);
  assert(b.gradeUp.total === g.time, `время грейда ${target}`);
  b.gradeUp.t = 0.001;
  ticks(2);
  assert(b.level === target && !b.gradeUp, `КЦ не завершил грейд ${target}`);
}
function countExplored(fog) {
  let n = 0;
  for (const x of fog.explored) n += x;
  return n;
}
function positionNear(st, from, minD = 80, maxD = 260) {
  const tx0 = (from.x / cfg.TILE) | 0, ty0 = (from.y / cfg.TILE) | 0;
  for (let r = 1; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = tx0 + dx, ty = ty0 + dy;
      if (!st.map.inBounds(tx, ty) || st.map.blockedAt(tx, ty)) continue;
      const p = { x: (tx + 0.5) * cfg.TILE, y: (ty + 0.5) * cfg.TILE };
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if (d >= minD && d <= maxD) return p;
    }
  }
  throw new Error('нет свободной точки в радиусе от юнита');
}
function openPoint(st, tx, ty, radius = 12) {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = tx + dx, y = ty + dy;
      if (st.map.inBounds(x, y) && !st.map.blockedAt(x, y))
        return { x: (x + 0.5) * cfg.TILE, y: (y + 0.5) * cfg.TILE };
    }
  }
  throw new Error('нет свободной точки рядом с ' + tx + ',' + ty);
}
function openRallyPoint(st, b, count) {
  for (let ty = 2; ty < st.map.h - 2; ty++) for (let tx = 2; tx < st.map.w - 2; tx++) {
    const p = { x: (tx + 0.5) * cfg.TILE, y: (ty + 0.5) * cfg.TILE };
    if (Math.hypot(p.x - b.x, p.y - b.y) < 180) continue;
    let ok = true;
    for (let seq = (b.rallySeq || 0) + 1; seq <= (b.rallySeq || 0) + count; seq++) {
      const a = seq * 2.39996, r = 20 + 9 * Math.sqrt(seq);
      const gx = p.x + Math.cos(a) * r, gy = p.y + Math.sin(a) * r;
      if (st.map.blockedAt((gx / cfg.TILE) | 0, (gy / cfg.TILE) | 0)) { ok = false; break; }
    }
    if (ok) return p;
  }
  throw new Error('нет точки сбора со свободными слотами для ' + count);
}

if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

// ---------- H1: грейд-ключ, исследование, диспетчер, возврат рабочего ----------
try {
  const st = start();
  st.minerals.player = 99999;
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const lab = nearDone(st, 'player', 'lab', cc.tx + 5, cc.ty);
  const h0 = { hp: cc.hp, maxHp: cc.maxHp, sight: cc.cfg.sightTiles };

  st.selection = [lab];
  const locked = game.getCommands().find((c) => c.icon === 'u_autoRepair');
  assert(locked && locked.code === 'KeyT', 'нет 5-го слота Авторемонта (T)');
  assert(!locked.enabled(), 'Авторемонт активен до КЦ Г2');
  assert(locked.tip.lines.includes(message('needCC2', st.factions.player)), 'нет строки затвора Г2');
  assert(B.startResearch(st, lab, 'autoRepair') === 'grade', 'startResearch до Г2 не вернул grade');

  completeGrade(st, cc);
  assert(cc.hp === h0.hp && cc.maxHp === h0.maxHp && cc.cfg.sightTiles === h0.sight,
    'грейд-ключ КЦ изменил боевые статы');
  assert(B.bestCCLevel(st, 'player') === 2, 'bestCCLevel не видит Г2');
  // До завершения исследования механика выключена даже при КЦ Г2.
  const workers = st.units.filter((u) => !u.dead && u.side === 'player' && u.type === 'worker');
  assert(workers.length >= 3, 'стартовых рабочих меньше 3');
  const idle = workers[0], gatherer = workers[1];
  const crystal = st.map.crystals.find((c) => !c.dead && c.amount > 0);
  assert(crystal, 'на карте нет жилы для возврата');
  for (const w of workers) { if (w === idle) U.orderStop(w); else U.orderGather(st, w, crystal); }
  const preTarget = atDistance(st, 'player', 'wall', cc, 250, cfg.AUTOREPAIR_RADIUS - 24);
  preTarget.hp = preTarget.maxHp - 12;
  st.autoRepairT = 0;
  ticks(16);
  assert(!st.units.some((u) => u.side === 'player' && u.order.kind === 'repair' && u.order.target === preTarget),
    'диспетчер включился до исследования');
  preTarget.hp = preTarget.maxHp;
  const beforeResearch = st.minerals.player;
  assert(B.startResearch(st, lab, 'autoRepair') === 'ok', 'ресерч за Г2 не запустился');
  assert(lab.res.total === 60 && st.minerals.player === beforeResearch - 150,
    'цена/время Авторемонта');
  lab.res.t = 0.001;
  ticks(2);
  assert(st.tech.player.autoRepair === 1, 'Авторемонт не завершился');

  const inside = atDistance(st, 'player', 'wall', cc, 250, cfg.AUTOREPAIR_RADIUS - 24);
  const outside = atDistance(st, 'player', 'wall', cc, cfg.AUTOREPAIR_RADIUS + 24, 720);
  inside.hp = inside.maxHp - 12;
  outside.hp = outside.maxHp - 12;
  for (const w of workers) {
    if (w === idle) U.orderStop(w);
    else U.orderGather(st, w, crystal);
  }
  // Поставить двух допустимых ремонтников в рабочую дистанцию; занятые
  // приказом ниже не трогаются, а после ремонта один восстановит свою жилу.
  idle.x = inside.x - 27; idle.y = inside.y - 23;
  gatherer.x = inside.x + 27; gatherer.y = inside.y - 23;
  idle.prevX = idle.x; idle.prevY = idle.y;
  gatherer.prevX = gatherer.x; gatherer.prevY = gatherer.y;
  st.autoRepairT = 0;
  ticks(16); // > 0.5с: диспетчер назначил idle первым, затем gather.
  const assigned = st.units.filter((u) => u.side === 'player' && u.order.kind === 'repair' && u.order.target === inside);
  const outAssigned = st.units.filter((u) => u.side === 'player' && u.order.kind === 'repair' && u.order.target === outside);
  assert(assigned.length === 2, `на ближнюю цель назначено ${assigned.length}, ожидалось 2`);
  assert(outAssigned.length === 0, 'здание вне R=15 получило диспетчера');
  assert(assigned.includes(idle), 'idle-техник не получил приоритет перед gather');

  const gatherResume = gatherer.order.resume;
  inside.hp = inside.maxHp - 1.5;
  for (const w of assigned) {
    w.x = inside.x - 26; w.y = inside.y - 24;
    w.prevX = w.x; w.prevY = w.y;
  }
  const beforeRepairMinerals = st.minerals.player;
  ticks(6);
  assert(inside.hp === inside.maxHp, 'авторемонт не восстановил повреждение');
  assert(st.minerals.player < beforeRepairMinerals, 'ремонт не потратил минералы');
  ticks(3);
  assert(idle.order.kind === 'gather', 'idle-техник не вернулся добывать');
  assert(gatherer.order.kind === 'gather' && gatherer.order.target === gatherResume,
    'gather-техник не вернулся на прежнюю жилу');
  assert(outside.hp === outside.maxHp - 12, 'авторемонт вышел за радиус КЦ');

  // Второй тип цели — повреждённая машина. Все рабочие снова добывают,
  // чтобы тестировал именно диспетчер, а не старый idle-поиск техники.
  for (const w of workers) U.orderGather(st, w, crystal);
  const vehicleSpot = positionNear(st, inside, 40, 90);
  const vehicle = U.spawnUnit(st, 'player', 'buggy', vehicleSpot.x, vehicleSpot.y, false);
  assert(Math.hypot(vehicle.x - cc.x, vehicle.y - cc.y) <= cfg.AUTOREPAIR_RADIUS,
    'тестовая техника оказалась за R15');
  vehicle.hp = vehicle.maxHp - 18;
  st.autoRepairT = 0;
  ticks(16);
  const vehicleRepairers = st.units.filter((u) => u.side === 'player' && u.order.kind === 'repair' && u.order.target === vehicle);
  assert(vehicleRepairers.length === 2, `на технику назначено ${vehicleRepairers.length}, ожидалось 2`);
  vehicle.hp = vehicle.maxHp - 1.5;
  for (const w of vehicleRepairers) { w.x = vehicle.x - 20; w.y = vehicle.y - 5; w.prevX = w.x; w.prevY = w.y; }
  ticks(6);
  assert(vehicle.hp === vehicle.maxHp, 'авторемонт не восстановил повреждённую технику');
  pass('H1 grade lock 240/30 → research 150/60 → 2/цель, здания+техника, R15, платный ремонт и возврат к добыче');
} catch (e) { fail('H1 autorepair', e); }

// ---------- H2: полевой/базовый тир, сирена только Г2+, рабочие не дёргаются ----------
try {
  const st = start();
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const counts = { ping: 0, alarm: 0 };
  game.sound.ping = () => { counts.ping++; };
  game.sound.alarm = () => { counts.alarm++; };
  const victim = U.spawnUnit(st, 'player', 'marine', cc.x + 42, cc.y + 78, false);
  const fieldX = cc.x + cfg.ALARM_BASE_RADIUS + 96 < st.map.pxW - cfg.TILE
    ? cc.x + cfg.ALARM_BASE_RADIUS + 96 : cc.x - cfg.ALARM_BASE_RADIUS - 96;
  const fieldVictim = U.spawnUnit(st, 'player', 'marine', fieldX, cc.y, false);
  const workers = st.units.filter((u) => !u.dead && u.side === 'player' && u.type === 'worker');
  const beforeWorkers = workers.map((u) => ({ x: u.x, y: u.y, kind: u.order.kind, target: u.order.target }));
  const beforePings = st.pings.length;
  const alert = (unit) => {
    st.lastAlertT = st.time - 9;
    U.damageEntity(st, unit, 1, null);
  };
  alert(victim); // КЦ Г1, у базы
  assert(counts.ping === 1 && counts.alarm === 0, 'Г1 у базы должен давать мягкий ping');
  alert(fieldVictim); // КЦ Г1, в поле
  assert(counts.ping === 2 && counts.alarm === 0, 'Г1 в поле должен давать мягкий ping');
  cc.level = 2;
  alert(victim); // КЦ Г2+, у базы
  assert(counts.alarm === 1 && counts.ping === 2, 'КЦ Г2+ в R15 должен включать сирену');
  alert(fieldVictim); // КЦ Г2+, далеко от базы
  assert(counts.alarm === 1 && counts.ping === 3, 'в поле сирена не должна звучать даже при Г2');
  assert(st.pings.length >= beforePings + 4, 'тревога не оставила пинги миникарты');
  assert(workers.every((u, i) => u.x === beforeWorkers[i].x && u.y === beforeWorkers[i].y &&
    u.order.kind === beforeWorkers[i].kind && u.order.target === beforeWorkers[i].target),
    'тревога переместила или перекомандовала рабочего');
  const texts = el('toasts').children.map((c) => c.textContent || '').join('|');
  assert(texts.includes(message('underAttack', st.factions.player)), 'нет единой строки underAttack');
  pass('H2: 4 тревоги/пинга, сирена только у КЦ Г2+ в R15; рабочие стоят');
} catch (e) { fail('H2 alarm', e); }

// ---------- H3: производство, пять затворов, разведка, отход и доклады ----------
try {
  const st = start();
  st.minerals.player = 99999;
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const factory = nearDone(st, 'player', 'factory', cc.tx + 6, cc.ty);
  assert(missions.UNLOCK_AT.scout === 2, 'UNLOCK_AT.scout не равен 2');
  assert(cfg.UNITS.scout.hp === 50 && cfg.UNITS.scout.speed === 185 && cfg.UNITS.scout.sightTiles === 11 &&
    cfg.UNITS.scout.dmg === 0 && cfg.UNITS.scout.range === 0 && cfg.UNITS.scout.vehicle && cfg.UNITS.scout.supply === 1,
    'характеристики разведчика не соответствуют H');
  assert(factory.cfg.produces.includes('scout'), 'завод не производит разведчика');
  st.selection = [factory];
  const train = game.getCommands().find((c) => c.code === 'KeyT');
  assert(train && train.icon === 'scout' && train.cost === 60, 'на заводе нет разведчика на T');
  train.on();
  assert(factory.queue.length === 1 && factory.queue[0].type === 'scout', 'завод не поставил разведчика');
  factory.queue[0].t = 0.001;
  ticks(2);
  const scout = st.units.find((u) => !u.dead && u.side === 'player' && u.cfg.scout);
  assert(scout && scout.faction === 'human' && scout.order.kind === 'idle', 'не создан idle-разведчик Гелиоса');
  game.render(1); // обе ветки спрайта проходят настоящий Canvas-харнес.

  completeGrade(st, cc); completeGrade(st, cc);
  st.selection = [cc];
  const hqCmds = game.getCommands();
  const recon = hqCmds.find((c) => c.code === 'KeyT');
  const rally = hqCmds.find((c) => c.code === 'KeyG');
  assert(recon && recon.icon === 'recon' && rally && rally.icon === 'rally', 'КЦ Г3 не показывает T/G');
  const beforeNoRally = scout.order.kind;
  rally.on();
  assert(scout.order.kind === beforeNoRally, 'G без точки сбора изменил приказы');
  const texts = el('toasts').children.map((c) => c.textContent || '').join('|');
  assert(texts.includes(message('noRally', st.factions.player)), 'G без точки не показал noRally');

  const exploredBefore = countExplored(st.fog);
  recon.on();
  assert(scout.order.kind === 'scout', 'T не отдал разведчику приказ scout');
  ticks(180);
  const exploredAfter = countExplored(st.fog);
  assert(exploredAfter > exploredBefore, `разведка не открыла туман (${exploredBefore}→${exploredAfter})`);

  // Пять затворов: ресерчи не вооружают, приказ/агро/армия/A-move — мимо.
  st.tech.player.vehAtk = 3;
  assert(U.atkBonus(st, scout) === 0, 'vehAtk вооружил безоружного разведчика');
  const combatUnit = U.spawnUnit(st, 'player', 'marine', scout.x - 100, scout.y, false);
  // Размещаем безоружную вражескую цель в sight: тест отхода без риска смерти.
  const enemySpot = positionNear(st, scout, 80, 260);
  const enemy = U.spawnUnit(st, 'enemy', 'scout', enemySpot.x, enemySpot.y, false);
  st.fog.recompute(st);
  const fleeStart = Math.hypot(scout.x - enemy.x, scout.y - enemy.y);
  U.orderScout(st, scout);
  const pingStart = st.pings.length;
  ticks(1);
  assert(st.lastContactT != null && st.pings.length > pingStart, 'контакт не доложен пингом');
  ticks(99);
  assert(scout.order.kind === 'scout', 'разведчик потерял приказ при отходе');
  assert(Math.hypot(scout.x - enemy.x, scout.y - enemy.y) > fleeStart + 30,
    'разведчик не отошёл от видимой угрозы');

  U.orderStop(scout);
  ticks(12);
  assert(scout.order.kind === 'idle', 'idle-разведчик сам захватил врага');
  U.orderAttack(st, scout, enemy);
  assert(scout.order.kind === 'idle', 'orderAttack принялся на разведчике');
  st.selection = [scout];
  game.hooks.issueRMB(enemy.x, enemy.y);
  assert(scout.order.kind === 'idle', 'ПКМ-атака дала разведчику приказ');
  game.hooks.issueAttackMove(enemy.x + 80, enemy.y + 80);
  assert(scout.order.kind === 'idle', 'A-move дал разведчику приказ');
  game.hooks.selectArmy();
  assert(!st.selection.includes(scout), 'Запятая включила разведчика в армию');
  st.selection = [scout];
  game.hooks.cycleCombat();
  assert(!st.selection.includes(scout), 'Tab включил разведчика в перебор бойцов');

  // Доклад о жиле: поле F.1 сообщает один раз по fieldId, а не на каждый кристалл.
  const scout2 = U.spawnUnit(st, 'player', 'scout', scout.x, scout.y, false);
  const crystal = st.map.crystals.find((c) => !c.dead && c.amount > 0);
  assert(crystal, 'нет кристаллов для доклада');
  scout2.x = crystal.x + 30; scout2.y = crystal.y; scout2.prevX = scout2.x; scout2.prevY = scout2.y;
  st.reportedFields = new Set();
  st.fog.recompute(st);
  const pingVein = st.pings.length;
  U.orderScout(st, scout2);
  ticks(1);
  assert(st.reportedFields.size === 1 && st.pings.length > pingVein, 'не доложена впервые открытая жила');
  const fieldKey = crystal.fieldId ? 'f' + crystal.fieldId : 'c' + crystal.tx + ',' + crystal.ty;
  ticks(20);
  assert(st.reportedFields.has(fieldKey), 'доклад о жиле не запомнен');

  // Зеркало: Кхарид обучает ту же роль с собственным именем, портретом и спрайтом.
  const alienState = start({ faction: 'alien' });
  alienState.minerals.player = 99999;
  const alienCC = alienState.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const alienFactory = nearDone(alienState, 'player', 'factory', alienCC.tx + 6, alienCC.ty);
  alienState.selection = [alienFactory];
  const alienTrain = game.getCommands().find((c) => c.code === 'KeyT');
  assert(alienTrain && alienTrain.icon === 'a_scout' && alienTrain.label === cfg.fname(cfg.UNITS.scout, 'alien'),
    'нет зеркала Слухач/a_scout');
  alienTrain.on(); alienFactory.queue[0].t = 0.001; ticks(2);
  const alienScout = alienState.units.find((u) => !u.dead && u.side === 'player' && u.cfg.scout);
  assert(alienScout && alienScout.faction === 'alien', 'Слухач не зеркален');
  game.render(1);
  pass('H3 factory T, UNLOCK_AT=2, 50/185/11, scout безоружен, разведка/отход/доклады, Гелиос+Кхарид');
} catch (e) { fail('H3 scout', e); }

// ---------- H4: «Сбор» отправляет только idle, разделяет цель и не сбивает приказы ----------
try {
  const st = start();
  st.minerals.player = 99999;
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  completeGrade(st, cc); completeGrade(st, cc);
  st.selection = [cc];
  let rally = game.getCommands().find((c) => c.code === 'KeyG');
  assert(rally, 'нет KeyG на КЦ Г3');

  // Начинаем с чистых idle-приказов, затем маркируем представителей всех
  // защищённых ордеров. Ни один не должен поменяться при массовом сборе.
  for (const u of st.units) if (u.side === 'player' && !u.dead) U.orderStop(u);
  const workers = st.units.filter((u) => u.side === 'player' && u.type === 'worker');
  while (workers.length < 5) workers.push(U.spawnUnit(st, 'player', 'worker', cc.x + 80, cc.y + 80, false));
  const idleWorker = workers[0];
  const idleMarine = U.spawnUnit(st, 'player', 'marine', cc.x + 250, cc.y + 170, false);
  const gatherer = workers[1];
  const builder = workers[2];
  const repairer = workers[3];
  const crystal = st.map.crystals.find((c) => !c.dead && c.amount > 0);
  const site = B.placeBuildingCmd(st, 'player', 'wall', cc.tx + 6, cc.ty + 3, []);
  const target = nearDone(st, 'player', 'wall', cc.tx + 8, cc.ty + 4);
  target.hp -= 25;
  const foe = U.spawnUnit(st, 'enemy', 'marine', cc.x + 400, cc.y + 300, false);
  const combat = U.spawnUnit(st, 'player', 'marine', cc.x + 100, cc.y + 150, false);
  const mover = U.spawnUnit(st, 'player', 'flamer', cc.x + 130, cc.y + 150, false);
  const scout = U.spawnUnit(st, 'player', 'scout', cc.x + 160, cc.y + 150, false);
  const garrison = U.spawnUnit(st, 'player', 'marine', cc.x + 190, cc.y + 150, false);
  const bunker = nearDone(st, 'player', 'bunker', cc.tx + 7, cc.ty + 7);
  const healer = U.spawnUnit(st, 'player', 'medic', cc.x + 220, cc.y + 150, false);
  const healTarget = U.spawnUnit(st, 'player', 'marine', cc.x + 230, cc.y + 150, false);
  assert(crystal, 'нет жилы');
  U.orderGather(st, gatherer, crystal);
  U.orderBuild(st, builder, site);
  U.orderRepair(st, repairer, target);
  U.orderAttack(st, combat, foe);
  U.orderMove(st, mover, cc.x + 300, cc.y + 300);
  U.orderScout(st, scout);
  U.orderGarrison(st, garrison, bunker);
  healer.order = { kind: 'heal', target: healTarget };
  const held = [gatherer, builder, repairer, combat, mover, scout, garrison, healer];
  const heldOrders = new Map(held.map((u) => [u, u.order]));

  const idleBefore = st.units.filter((u) => u.side === 'player' && !u.dead && !u.garrison && u.order.kind === 'idle');
  assert(idleBefore.includes(idleWorker) && idleBefore.includes(idleMarine), 'не подготовлены два idle-юнита');
  const open = openRallyPoint(st, cc, idleBefore.length);
  cc.rallySeq = 0;
  cc.rally = null;
  rally.on();
  assert(idleBefore.every((u) => u.order.kind === 'idle') && held.every((u) => u.order === heldOrders.get(u)),
    'G без rally что-то сдвинул');
  const texts = el('toasts').children.map((c) => c.textContent || '').join('|');
  assert(texts.includes(message('noRally', st.factions.player)), 'нет noRally при null-точке');

  cc.rally = open;
  rally = game.getCommands().find((c) => c.code === 'KeyG');
  rally.on();
  assert(idleWorker.order.kind === 'move' && idleMarine.order.kind === 'move', 'idle-пехота не собрана');
  assert(held.every((u) => u.order === heldOrders.get(u)), 'Сбор изменил приказ занятого юнита');
  assert(idleBefore.every((u) => u.order.kind === 'move'), 'не все idle-юниты получили приказ сбора');
  const idleGoals = idleBefore.map((u) => `${u.order.x},${u.order.y}`);
  assert(new Set(idleGoals).size === idleGoals.length, 'кольцо rally слипло idle-юнитов в одну точку');
  pass('H4: KeyG без точки — no-op/toast; idle идут строем, gather/build/repair/attack/move/scout/heal/garrison целы');
} catch (e) { fail('H4 rally', e); }

// ---------- H5: keyTarget, startTech, noBase и новые функции вне словаря ИИ ----------
try {
  const st = start({ objective: { kind: 'key', type: 'cc' }, ai: { startTech: 1 } });
  st.minerals.player = 99999;
  const playerCC = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const enemyCC = st.buildings.find((b) => !b.dead && b.side === 'enemy' && b.type === 'cc');
  assert(enemyCC, 'нет вражеского КЦ для keyTarget');
  assert(st.tech.enemy.infAtk === 1 && st.tech.enemy.vehArm === 1, 'startTech перестал настраивать армейские исследования');
  assert(st.tech.enemy.autoRepair === 0, 'startTech случайно включил Авторемонт ИИ');
  game.checkEnd();
  assert(enemyCC.keyTarget && st.keyTotal > 0 && !st.gameOver, 'КЦ не распознан keyTarget');
  completeGrade(st, playerCC);
  game.checkEnd();
  assert(enemyCC.type === 'cc' && enemyCC.side === 'enemy' && !enemyCC.dead && enemyCC.keyTarget && !st.gameOver,
    'грейд игрока изменил семантику вражеской keyTarget');
  for (const id of [8, 13, 17]) {
    const m = missions.MISSIONS.find((x) => x.id === id);
    assert(m && m.noBase, `миссия №${id} потеряла noBase`);
  }
  pass('H5 keyTarget переживает грейд; startTech только 4 армейских ветки; noBase №8/13/17 сохранены; autoRepair ИИ=0');
} catch (e) { fail('H5 boundaries', e); }

console.log(failures.length ? `\nИТОГ SIM_HQ: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_HQ: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
