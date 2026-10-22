// ============================================================
// sim_season2.mjs — smoke-тест сценарной миссии «Чужие на пороге».
// Проверяет запуск из меню, героев/ауру, Тропы, следы, разделение
// патруля, тупик, финал с капитаном Рейном и условия поражения.
// Запуск: node scripts/sim_season2.mjs
// ============================================================
import './harness.mjs';
import { el, endStatsHTML } from './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(condition, message) { if (!condition) throw new Error(message); }

await import('../js/game.js');
const { SEASON2_M1, isOnSeason2Trail, updateSeason2Mission } = await import('../js/season2.js');
const U = await import('../js/units.js');
const { TILE } = await import('../js/config.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }
const center = (tile) => (tile + 0.5) * TILE;
function move(unit, tx, ty) {
  unit.x = center(tx); unit.y = center(ty);
  unit.prevX = unit.x; unit.prevY = unit.y;
  unit.path = null; unit.moving = false;
  unit.order = { kind: 'idle' };
}
function rebuildGrid(st) {
  game.grid.clear();
  for (const unit of st.units) if (!unit.dead && !unit.garrison) game.grid.insert(unit);
}

// ---------- M1-1: лендинг → брифинг → старт миссии ----------
try {
  el('btn-season2').click();
  assert(!el('brief-overlay').classList.contains('hidden'), 'кнопка Сезона 2 не открыла брифинг');
  assert(el('brief-title').textContent === 'Чужие на пороге', 'в брифинге неверное название');
  el('btn-brief-back').click();
  assert(el('brief-overlay').classList.contains('hidden'), 'возврат не закрыл брифинг');
  assert(!el('landing-page').classList.contains('hidden'), 'возврат из брифинга не вернул на лендинг');

  el('btn-season2').click();
  el('btn-brief-go').click();
  assert(game.started && game.mission.id === 's2_1', 'брифинг не запустил S2 M1');
  assert(game.state.factions.player === 'alien' && game.state.factions.enemy === 'human', 'неверные фракции');
  assert(game.state.s2 && game.state.s2.patrol.length === 6, 'скриптовый патруль не создан');
  assert(!game.state.buildings.some((building) => building.side === 'enemy'), 'враг получил обычную базу');
  assert(game.state.units.some((unit) => unit.side === 'player' && unit.type === 'hero'), 'Тха-Рисса не появилась');
  assert(game.state.units.some((unit) => unit.side === 'enemy' && unit.type === 'hero'), 'капитан Рейн не появился');
  for (let i = 0; i < 4; i++) game.tick();
  game.render(1);
  pass('M1-1 меню/брифинг: стартует отдельная миссия за кхарид без базы противника');
} catch (e) { fail('M1-1 menu/setup', e); }

// ---------- M1-2: первый след и три боевые стороны ауры ----------
try {
  game.startMission(SEASON2_M1);
  const st = game.state, s2 = st.s2;
  const heroine = s2.heroine;
  const scout = s2.scout;
  const marine = st.units.find((unit) => unit.side === 'player' && unit.type === 'marine');
  assert(heroine && scout && marine, 'в стартовом отряде нет героя/Следопыта/морпеха');
  s2.patrol[0].visible = true;
  updateSeason2Mission(game, st);
  assert(!s2.spotted, 'патруль найден до первой подсказки Следопыта');
  s2.patrol[0].visible = false;

  move(scout, 25, 38);
  updateSeason2Mission(game, st);
  assert(s2.foundTracks === 1, 'Следопыт не обнаружил первую улику');
  assert(/по следам/.test(game.objectiveText()), 'HUD не переключился на поиск патруля');

  // Обзор союзника растёт только внутри ауры Тха-Риссы.
  move(heroine, 20, 20);
  move(marine, 26, 20);
  st.fog.recompute(st);
  assert(st.fog.tileVisible(34, 20), 'аура не добавила союзнику два тайла обзора');
  heroine.dead = true;
  st.fog.recompute(st);
  assert(!st.fog.tileVisible(34, 20), 'обзор ауры остался после смерти героини');
  heroine.dead = false;
  st.fog.recompute(st);

  // Боевой бонус активен внутри ауры и не применяется за её границей.
  const target = s2.patrol[1];
  move(target, 28, 20);
  U.shoot(st, marine, target);
  const boostedDamage = st.projectiles.at(-1).dmg;
  assert(boostedDamage === Math.round(marine.cfg.dmg * 1.15), `неверный бонус урона ауры: ${boostedDamage}`);
  move(marine, 40, 20);
  move(target, 42, 20);
  U.shoot(st, marine, target);
  assert(st.projectiles.at(-1).dmg === marine.cfg.dmg, 'бонус урона действует вне ауры');

  const repairGain = (withAura) => {
    game.startMission(SEASON2_M1);
    const repairState = game.state, rs2 = repairState.s2;
    const worker = repairState.units.find((unit) => unit.side === 'player' && unit.type === 'worker');
    const patient = repairState.units.find((unit) => unit.side === 'player' && unit.type === 'marine');
    move(rs2.heroine, withAura ? 20 : 8, 20);
    move(worker, 26, 20);
    move(patient, 27, 20);
    patient.hp = 10;
    U.orderRepair(repairState, worker, patient);
    for (let i = 0; i < 30; i++) game.tick();
    return patient.hp - 10;
  };
  const auraRepair = repairGain(true), ordinaryRepair = repairGain(false);
  assert(auraRepair > ordinaryRepair, `ремонт не ускоряется аурой: ${auraRepair} vs ${ordinaryRepair}`);
  pass('M1-2 следы и аура: обзор, урон, ремонт и первая подсказка работают');
} catch (e) { fail('M1-2 tracks/aura', e); }

// ---------- M1-2b: реальный маршрут Следопыта открывает патруль ----------
try {
  game.startMission(SEASON2_M1);
  const st = game.state, s2 = st.s2;
  U.orderMove(st, s2.scout, center(44), center(21));
  for (let i = 0; i < 600 && !st.gameOver; i++) game.tick();
  assert(s2.foundTracks === 3, `Следопыт не прошёл все три точки: ${s2.foundTracks}`);
  assert(s2.spotted && s2.foundBeforeDeadline, 'маршрут не открыл патруль до срока');
  assert(/· \d\d:\d\d$/.test(game.objectiveText()), 'после обнаружения нет оценки времени до гнезда');
  assert(st.time < s2.findDeadline, `патруль найден поздно: ${st.time.toFixed(1)}с`);
  pass('M1-2b маршрут: Следопыт проходит следы, раскрывает дозор и получает бонус до срока');
} catch (e) { fail('M1-2b scout route', e); }

// ---------- M1-3: Тропы скрывают кхарид от вражеского патруля ----------
try {
  game.startMission(SEASON2_M1);
  const st = game.state, s2 = st.s2;
  const marine = st.units.find((unit) => unit.side === 'player' && unit.type === 'marine');
  const enemy = s2.patrol[1];
  move(marine, 25, 38);
  move(enemy, 25, 38);
  assert(isOnSeason2Trail(st, marine), 'кхарид на Тропе не распознан');
  rebuildGrid(st);
  assert(U.acquireTarget(st, enemy, game.grid) === null, 'патруль обнаружил кхарид на Тропе');
  move(marine, 25, 42);
  move(enemy, 25, 42);
  assert(!isOnSeason2Trail(st, marine), 'обычная местность ошибочно считается Тропой');
  rebuildGrid(st);
  assert(U.acquireTarget(st, enemy, game.grid) === marine, 'патруль не заметил кхарид вне Тропы');
  pass('M1-3 Тропы: враг не выбирает скрытого бойца, но видит его вне маршрута');
} catch (e) { fail('M1-3 trail stealth', e); }

// ---------- M1-4: шум делит патруль, часть попадает в тупик ----------
try {
  game.startMission(SEASON2_M1);
  const st = game.state, s2 = st.s2;
  const heroine = s2.heroine;
  move(heroine, s2.trap.x, s2.trap.y);
  const wounded = s2.patrol[1];
  move(wounded, s2.trap.x, s2.trap.y);
  wounded.hp -= 1;
  updateSeason2Mission(game, st);
  assert(s2.noise, 'урон не создал шум');
  assert(s2.trapBaited, 'шум у кристального тупика не заманил патруль');
  assert(s2.investigators.length === 3, `шум не отделил половину патруля: ${s2.investigators.length}`);
  assert(s2.investigators.every((unit) => unit.s2Investigator), 'следователи не получили сценарную роль');

  const trapX = center(s2.trap.x), trapY = center(s2.trap.y);
  for (const unit of s2.investigators.slice(0, 2)) {
    unit.x = trapX; unit.y = trapY; unit.prevX = trapX; unit.prevY = trapY;
  }
  updateSeason2Mission(game, st);
  assert(s2.trapped, 'двое следователей не зафиксировались в тупике');
  assert(s2.investigators.filter((unit) => unit.s2Trapped).length >= 2, 'тупик не удержал часть патруля');
  pass('M1-4 шум/тупик: группа разделилась, двое следователей заперты в проходе');
} catch (e) { fail('M1-4 noise/trap', e); }

// ---------- M1-4b: изолированные следователи не держат миссию в софтлоке ----------
try {
  game.startMission(SEASON2_M1);
  const st = game.state, s2 = st.s2;
  move(s2.heroine, s2.trap.x, s2.trap.y);
  const wounded = s2.patrol[1];
  move(wounded, s2.trap.x, s2.trap.y);
  wounded.hp -= 1;
  updateSeason2Mission(game, st);
  const trapX = center(s2.trap.x), trapY = center(s2.trap.y);
  for (const unit of s2.investigators.slice(0, 2)) {
    unit.x = trapX; unit.y = trapY; unit.prevX = trapX; unit.prevY = trapY;
  }
  updateSeason2Mission(game, st);
  for (const unit of s2.patrol) {
    if (!unit.dead && !unit.s2Investigator && !unit.s2Trapped) U.damageEntity(st, unit, unit.hp + 1, null);
  }
  updateSeason2Mission(game, st);
  assert(st.gameOver === 'win', 'последние участники похода не завершили миссию победой');
  assert(s2.patrol.some((unit) => !unit.dead && unit.s2Investigator), 'изолированные следователи исчезли вместо ожидания');
  assert(el('end-epilogue').textContent === '', 'эпилог о Рейне показан без финального контакта');
  pass('M1-4b остановка: выжившие следователи не блокируют победу после остановки главного отряда');
} catch (e) { fail('M1-4b stopped patrol', e); }

// ---------- M1-5: финал — Рейн не стреляет; вторичные цели в отчёте ----------
try {
  game.startMission(SEASON2_M1);
  const st = game.state, s2 = st.s2;
  move(s2.heroine, 27, 35);
  move(s2.captain, 29, 35);
  updateSeason2Mission(game, st);
  assert(s2.finale, 'контакт Тха-Риссы и Рейна не начался');
  assert(st.gameOver === 'win', 'финальная встреча не завершила миссию победой');
  assert(s2.captain.s2Ceasefire && s2.captain.cfg.dmg === 0, 'Рейн не опустил оружие');
  assert(/не нажал на спуск/.test(el('end-epilogue').textContent), 'финальный эпилог не сохранил момент, когда Рейн не стреляет');
  assert(/Чужие на пороге|Вторичные цели/.test(endStatsHTML()), 'в итогах нет вторичных целей');
  assert(/выполнено/.test(endStatsHTML()) && /не выполнено/.test(endStatsHTML()), 'в итогах не показаны статусы целей');
  pass('M1-5 финал: победа, прекращение огня Рейна и отчёт по вторичным целям');
} catch (e) { fail('M1-5 finale', e); }

// ---------- M1-6: две обязательные причины поражения ----------
try {
  game.startMission(SEASON2_M1);
  let st = game.state, s2 = st.s2;
  U.damageEntity(st, s2.heroine, s2.heroine.hp + 1, null);
  updateSeason2Mission(game, st);
  assert(st.gameOver === 'lose', 'смерть Тха-Риссы не привела к поражению');

  game.startMission(SEASON2_M1);
  st = game.state; s2 = st.s2;
  const patrol = s2.patrol[0];
  patrol.x = s2.basePoint.x; patrol.y = s2.basePoint.y;
  patrol.prevX = patrol.x; patrol.prevY = patrol.y;
  updateSeason2Mission(game, st);
  assert(st.gameOver === 'lose', 'выход патруля к гнезду не привёл к поражению');
  pass('M1-6 поражение: гибель героини и достижение гнезда завершают миссию');
} catch (e) { fail('M1-6 lose conditions', e); }

// ---------- M1-7: idle path remains a loss, not an accidental scripted win ----------
try {
  game.startMission(SEASON2_M1);
  const st = game.state, s2 = st.s2;
  for (let i = 0; i < 3000 && !st.gameOver; i++) game.tick();
  assert(st.gameOver === 'lose', 'патруль без вмешательства не завершил миссию поражением');
  assert(!s2.finale, 'героиня сама покинула позицию и запустила финал');
  assert(st.time > s2.findDeadline && st.time < 90, `неверный темп маршрута патруля: ${st.time.toFixed(1)}с`);
  assert(/достиг гнезда/.test(el('end-reason').textContent), 'поражение получено не из-за достижения гнезда');
  pass('M1-7 idle: патруль идёт по маршруту, героиня не запускает финал сама, пропуск ведёт к поражению');
} catch (e) { fail('M1-7 idle progression', e); }

console.log(failures.length
  ? `\nИТОГ SIM_SEASON2: ${failures.length} ОШИБОК (${failures.join(', ')})`
  : '\nИТОГ SIM_SEASON2: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
