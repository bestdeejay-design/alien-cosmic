// ============================================================
// sim_season2.mjs — smoke-тест новой обучающей миссии S2 M1.
// Проверяет стартовый отряд, отключённый аванпост, активацию ретранслятора,
// строительную зону, боевого героя, гарнизон и scripted-налёты.
// Запуск: node scripts/sim_season2.mjs
// ============================================================
import './harness.mjs';
import { el } from './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(condition, message) { if (!condition) throw new Error(message); }

await import('../js/game.js');
const { SEASON2_M1, updateSeason2Mission, season2EndObjectives } = await import('../js/season2.js');
const U = await import('../js/units.js');
const B = await import('../js/buildings.js');
const { TILE } = await import('../js/config.js');
const { isUnlocked } = await import('../js/missions.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }
const center = (tile) => (tile + 0.5) * TILE;
function move(unit, tx, ty) {
  unit.x = center(tx); unit.y = center(ty);
  unit.prevX = unit.x; unit.prevY = unit.y;
  unit.path = null; unit.moving = false;
  unit.order = { kind: 'idle' };
}
function freshMission() {
  game.startMission(SEASON2_M1);
  return game.state;
}
function createFinishedBuilding(st, type, tx, ty) {
  const building = new B.Building(st, 'player', type, tx, ty, true);
  st.map.markBuilding(building);
  st.bcount.player++;
  return building;
}
function openBuildSpot(st, type) {
  const cfg = (awaitConfig)[type];
  const zone = st.s2.buildZone;
  for (let y = zone.y; y <= zone.y + zone.h - cfg.h; y++) {
    for (let x = zone.x; x <= zone.x + zone.w - cfg.w; x++) {
      let explored = true;
      for (let dy = 0; dy < cfg.h; dy++) for (let dx = 0; dx < cfg.w; dx++) {
        if (!st.fog.tileExplored(x + dx, y + dy)) explored = false;
      }
      if (explored && B.zoneAllows(st, x, y, cfg.w, cfg.h) && B.canPlace(st.map, x, y, cfg.w, cfg.h)) return { x, y };
    }
  }
  throw new Error(`no open explored build tile for ${type}`);
}
const awaitConfig = (await import('../js/config.js')).BUILDINGS;

// ---------- M1-1: запуск и штатный состав ----------
let st, s2;
try {
  st = freshMission();
  s2 = st.s2;
  const count = (type) => st.units.filter((unit) => unit.side === 'player' && unit.type === type && !unit.dead).length;
  assert(game.mission === SEASON2_M1 && game.mission.id === 's2_1', 'S2 M1 не запустилась');
  assert(st.map.w === 48 && st.map.h === 48, 'карта не небольшая');
  assert(st.factions.player === 'human' && st.factions.enemy === 'alien', 'неверные фракции');
  assert(count('hero') === 1 && count('scout') === 1 && count('marine') === 3 && count('worker') === 2,
    'неверный состав стартового отряда');
  assert(st.buildings.filter((building) => building.side === 'enemy').length === 0, 'враг получил обычную базу');
  assert(st.buildings.filter((building) => building.side === 'player' && building.type === 'cc').length === 1,
    'на аванпосте нет существующего командного центра');
  assert(s2.cc.s2Hidden && s2.cc.s2Offline && s2.cc.cfg.produces === null, 'командный центр должен быть скрыт, обесточен и не производить рабочих');
  assert(st.minerals.player === 250 && st.buildZone === null, 'неверные стартовые ресурсы или ранняя зона стройки');
  assert(s2.hero.cfg.dmg > 0 && s2.hero.cfg.projectile === 'bullet', 'герой не имеет боевой атаки');
  assert(!B.zoneAllows(st, 22, 24, 3, 2), 'строительство доступно до включения ретранслятора');
  const initialBuildings = st.buildings.length;
  st.selection = [s2.workers[0]];
  st.placing = { type: 'barracks', tx: 18, ty: 15 };
  game.tryPlace(18, 15);
  st.placing = null;
  assert(st.buildings.length === initialBuildings, 'команда tryPlace строит до включения ретранслятора');
  assert(!isUnlocked(SEASON2_M1, 'cc') && !isUnlocked(SEASON2_M1, 'turret') &&
    isUnlocked(SEASON2_M1, 'barracks') && isUnlocked(SEASON2_M1, 'bunker') && isUnlocked(SEASON2_M1, 'wall'),
    'неверные запреты/доступность построек');
  game.render(1);
  pass('M1-1 старт: герой, Следопыт, 3 рейнджера, 2 сборщика и выключенная база');
} catch (e) { fail('M1-1 setup', e); }

// ---------- M1-2: обнаружение аванпоста и активация героем ----------
try {
  st = st || freshMission();
  s2 = st.s2;
  const scout = s2.scout;
  const hero = s2.hero;
  assert(B.buildingAt(st, s2.cc.x, s2.cc.y) === null, 'скрытый командный центр доступен для клика до разведки');
  move(scout, s2.relay.tx - 2, s2.relay.ty);
  st.fog.recompute(st);
  updateSeason2Mission(game, st);
  assert(s2.baseFound && !s2.cc.s2Hidden, 'разведка не открыла аванпост');
  assert(B.buildingAt(st, s2.cc.x, s2.cc.y) === s2.cc, 'найденный командный центр нельзя выбрать');
  assert(game.objectiveText().includes('героя'), 'цель после обнаружения не объясняет активацию ретранслятора');

  st.selection = [scout];
  game.issueRMB(s2.relay.x, s2.relay.y);
  assert(!s2.relayActivationRequested, 'разведчик активирует ретранслятор вместо героя');
  st.selection = [hero];
  game.issueRMB(s2.relay.x, s2.relay.y);
  assert(s2.relayActivationRequested && hero.order.kind === 'move', 'правый клик героем не запустил активацию');
  move(hero, s2.relay.tx, s2.relay.ty);
  updateSeason2Mission(game, st);
  assert(s2.relay.active && !s2.cc.s2Offline && !s2.cc.s2Hidden, 'ретранслятор/командный центр не включились');
  assert(st.buildZone && st.buildZone.length === 1 && B.zoneAllows(st, 22, 24, 3, 2) &&
    !B.zoneAllows(st, 5, 5, 3, 2), 'после активации не появилась или не ограничивает территорию зона строительства');
  assert(s2.cc.cfg.produces === 'worker', 'командный центр не восстановил производство');
  assert(B.enqueueUnit(st, s2.cc, 'worker') === 'ok', 'включённый командный центр не принимает очередь');
  B.cancelQueueItem(st, s2.cc, 0);
  game.render(1);
  pass('M1-2 разведчик находит базу; только герой включает ретранслятор и открывает зону');
} catch (e) { fail('M1-2 relay', e); }

// ---------- M1-3: рамки стройки, строительство и боевой урон героя ----------
try {
  st = st || freshMission();
  s2 = st.s2;
  if (!s2.relay.active) {
    move(s2.scout, s2.relay.tx - 2, s2.relay.ty);
    st.fog.recompute(st); updateSeason2Mission(game, st);
    move(s2.hero, s2.relay.tx, s2.relay.ty);
    st.selection = [s2.hero]; game.issueRMB(s2.relay.x, s2.relay.y); updateSeason2Mission(game, st);
  }
  const spot = openBuildSpot(st, 'barracks');
  st.selection = [s2.workers[0]];
  st.placing = { type: 'barracks', tx: spot.x, ty: spot.y };
  game.tryPlace(spot.x, spot.y);
  const barracks = st.buildings.find((building) => building.side === 'player' && building.type === 'barracks');
  assert(barracks && !barracks.done, 'строительство не создало недострой в разрешённой зоне');
  barracks.done = true; barracks.progress = 1; barracks.hp = barracks.maxHp;
  st.placing = null;
  st.selection = [barracks];
  assert(!game.getCommands().some((command) => command.icon === 'grade'), 'в обучающей миссии доступен апгрейд');

  const hero = s2.hero;
  const target = U.spawnUnit(st, 'enemy', 'marine', hero.x + 32, hero.y);
  const before = target.hp;
  U.shoot(st, hero, target);
  U.updateProjectiles(st, 0.2);
  assert(target.hp < before, 'боевой выстрел героя не нанёс урон');
  target.dead = true;
  pass('M1-3 граница зоны блокирует лишнюю стройку, казарма размещается, апгрейда нет, герой наносит урон');
} catch (e) { fail('M1-3 build/combat', e); }

// ---------- M1-4: укрытие рейнджеров, три налёта и scripted-победа ----------
try {
  st = st || freshMission();
  s2 = st.s2;
  if (!s2.relay.active) {
    move(s2.scout, s2.relay.tx - 2, s2.relay.ty);
    st.fog.recompute(st); updateSeason2Mission(game, st);
    move(s2.hero, s2.relay.tx, s2.relay.ty);
    st.selection = [s2.hero]; game.issueRMB(s2.relay.x, s2.relay.y); updateSeason2Mission(game, st);
  }
  let spot = openBuildSpot(st, 'barracks');
  const barracks = st.buildings.find((building) => building.type === 'barracks') || createFinishedBuilding(st, 'barracks', spot.x, spot.y);
  barracks.done = true; barracks.progress = 1; barracks.hp = barracks.maxHp;
  spot = openBuildSpot(st, 'bunker');
  const bunker = createFinishedBuilding(st, 'bunker', spot.x, spot.y);
  for (let i = 0; i < 3; i++) {
    spot = openBuildSpot(st, 'wall');
    createFinishedBuilding(st, 'wall', spot.x, spot.y);
  }
  st.stats.mined = 120;
  updateSeason2Mission(game, st);
  assert(s2.bunker === bunker, 'миссия не распознала построенный бункер');
  st.selection = [...s2.rangers];
  game.issueRMB(bunker.x, bunker.y);
  assert(s2.rangers.every((ranger) => ranger.order.kind === 'garrison'), 'правый клик не отправил рейнджеров в гарнизон');
  for (const ranger of s2.rangers) {
    ranger.garrison = bunker;
    ranger.order = { kind: 'idle' };
    bunker.garrison.push(ranger);
  }

  st.time = s2.relayOnAt + 146;
  updateSeason2Mission(game, st);
  assert(s2.raidGroups[0] && s2.raidGroups[0].length === 2, 'первый малый налёт не создан');
  st.time = s2.relayOnAt + 326;
  updateSeason2Mission(game, st);
  assert(s2.raidGroups[1] === null, 'герой противника пришёл до отражения первого налёта');
  for (const raider of s2.raidGroups[0]) raider.dead = true;
  updateSeason2Mission(game, st);
  assert(s2.raidGroups[1] && s2.raidGroups[1].length === 3 && s2.finalBoss &&
    s2.finalBoss.type === 'hero' && s2.finalBoss.s2RetakeHero,
    'герой противника не пришёл отбивать ретранслятор после малого налёта');
  assert(s2.finalBoss.order.kind === 'attackMove', 'герой противника не направлен к ретранслятору');
  for (const raider of s2.raidGroups[1]) raider.dead = true;
  updateSeason2Mission(game, st);
  assert(st.gameOver === 'win', 'выполненные условия scripted-миссии не дали победу');
  assert(season2EndObjectives(st).every((objective) => objective.complete), 'итоговые цели показывают невыполненную задачу');
  pass('M1-4 рейнджеры укрываются; один малый налёт и герой противника; победа по целям обучения');
} catch (e) { fail('M1-4 raids/win', e); }

// ---------- M1-5: поражение при гибели героя ----------
try {
  st = freshMission();
  s2 = st.s2;
  s2.hero.dead = true;
  updateSeason2Mission(game, st);
  assert(st.gameOver === 'lose', 'гибель героя не завершила сценарий поражением');
  pass('M1-5 гибель героя вызывает поражение');
} catch (e) { fail('M1-5 loss', e); }

console.log(failures.length
  ? `\nИТОГ SIM_SEASON2: ПРОВАЛЕНО ${failures.length}: ${failures.join(', ')}`
  : '\nИТОГ SIM_SEASON2: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exitCode = failures.length ? 1 : 0;
