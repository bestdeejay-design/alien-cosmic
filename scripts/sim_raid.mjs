// ============================================================
// sim_raid.mjs — тесты R0-a локального raid-loop (карта и петля без боя):
//   R0a.1 постоянный корабль-КЦ на планете новичка + разовый стартовый подарок;
//   R0a.2 уровни допуска loadout tier 1–5 и строгая валидация состава/бюджета;
//   R0a.3 детерминизм сектора цели по seed и запрет постройки второго КЦ в рейде;
//   R0a.4 полный цикл база-КЦ → сбор эрга в трюм челнока → эвакуация → база-КЦ → 2-й рейд;
//   R0a.5 гибель отряда без бесплатного пополнения (#25), обе фракции и RU↔EN.
//
// Запуск: node scripts/sim_raid.mjs
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
const B = await import('../js/buildings.js');
const U = await import('../js/units.js');
const missionsMod = await import('../js/missions.js');
const i18n = await import('../js/i18n.js');
const raid = await import('../js/raid.js');

const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

function countPlayerUnits(st, type = null) {
  return st.units.filter((u) => !u.dead && !u.garrison && u.side === 'player' && (!type || u.type === type)).length;
}

// ---------- R0a.1: домашняя база и разовый стартовый подарок ----------
try {
  // В обычном скирмише рейдовая кнопка топбара скрыта.
  game.startSkirmish('human', { w: 48, h: 48 });
  ui.update(game);
  assert(el('btn-raid-action').hidden === true, 'рейдовая кнопка топбара видна вне рейда');
  game.toMenu();

  // Старт рейда с лендинга за Гелиос.
  el('raid-faction-human').click();
  el('btn-raid-home').click();

  const st = game.state;
  assert(game.started && st.raidMode === 'home', 'домашняя база не запустилась');
  assert(st.map.w === 64 && st.map.h === 64, 'размер планеты новичка не 64×64');
  assert(st.bcount.enemy === 0 && st.units.filter((u) => u.side === 'enemy').length === 0, 'на домашней базе есть враг');
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc' && b.done);
  assert(cc, 'постоянный корабль-КЦ не развёрнут');
  assert(st.minerals.player === raid.RAID_STARTER_MINERALS, 'стартовый запас эрга не совпал');
  assert(countPlayerUnits(st, 'worker') === 2 && countPlayerUnits(st, 'marine') === 2, 'стартовый подарок 2+2 не выдан');
  assert(game.raidSession.starterGiftClaimed === true, 'флаг разового подарка не выставлен');
  assert(el('btn-raid-action').hidden === false, 'кнопка Вылазка скрыта на домашней базе');

  // 60 тиков без врага не вызывают ложной победы/поражения.
  for (let i = 0; i < 60; i++) game.tick();
  assert(!st.gameOver, 'домашняя база завершилась сама без врагов');
  game.render(0.5);
  ui.drawMinimap(game);

  pass('R0a.1 home-base: постоянный корабль-КЦ на Актан-4 + разовый стартовый подарок без авто-победы');
} catch (e) { fail('R0a.1 home-base', e); }

// ---------- R0a.2: уровни вылазки 1–5 и валидация loadout ----------
try {
  game.startRaidHome('human', { forceNew: true });
  const st = game.state;

  assert(raid.RAID_TIERS.length === 5, 'число уровней loadout не равно 5');
  assert(raid.unlockedRaidTier(st) === 1, 'на старте открыт уровень выше 1');

  // Попытка выбрать закрытый уровень 2 отклоняется.
  assert(!raid.validateRaidLoadout(st, { tier: 2, units: { worker: 1 }, budget: 0, seed: 101 }).ok, 'пропущен закрытый tier 2');
  // Пустой отряд отклоняется.
  assert(!raid.validateRaidLoadout(st, { tier: 1, units: {}, budget: 0, seed: 101 }).ok, 'пропущен пустой отряд');
  // Запрос большего числа юнитов, чем есть на базе, отклоняется.
  assert(!raid.validateRaidLoadout(st, { tier: 1, units: { marine: 3 }, budget: 0, seed: 101 }).ok, 'пропущен несуществующий резерв');
  // Превышение лимита бюджета уровня 1 (100) отклоняется.
  st.minerals.player = 500;
  assert(!raid.validateRaidLoadout(st, { tier: 1, units: { worker: 2 }, budget: 120, seed: 101 }).ok, 'пропущен бюджет выше капа tier 1');
  // Превышение запаса домашней базы отклоняется.
  st.minerals.player = 40;
  assert(!raid.validateRaidLoadout(st, { tier: 1, units: { worker: 2 }, budget: 50, seed: 101 }).ok, 'пропущен бюджет выше минералов базы');
  // Нулевой seed отклоняется.
  assert(!raid.validateRaidLoadout(st, { tier: 1, units: { worker: 1 }, budget: 0, seed: 0 }).ok, 'пропущен нулевой seed');

  // Прогрессия уровней 1 → 2 → 3 → 4 → 5 по постройкам и грейду корабля-КЦ.
  const cc = st.buildings.find((b) => b.type === 'cc');
  const depot = new B.Building(st, 'player', 'depot', cc.tx + 5, cc.ty, true);
  st.map.markBuilding(depot); st.bcount.player++;
  assert(raid.unlockedRaidTier(st) === 2, 'склад не открыл tier 2');

  const rax = new B.Building(st, 'player', 'barracks', cc.tx + 5, cc.ty - 3, true);
  st.map.markBuilding(rax); st.bcount.player++;
  cc.level = 2;
  assert(raid.unlockedRaidTier(st) === 3, 'казарма + КЦ II не открыли tier 3');

  const fac = new B.Building(st, 'player', 'factory', cc.tx, cc.ty - 4, true);
  st.map.markBuilding(fac); st.bcount.player++;
  assert(raid.unlockedRaidTier(st) === 4, 'завод не открыл tier 4');

  cc.level = 3;
  assert(raid.unlockedRaidTier(st) === 5, 'КЦ III не открыл tier 5');

  // На 5-м уровне валиден отряд до 12 и бюджет до 400.
  for (let i = 0; i < 8; i++) U.spawnUnit(st, 'player', 'marine', (cc.tx + 2) * 32, (cc.ty + 5) * 32, false);
  st.minerals.player = 600;
  const v5 = raid.validateRaidLoadout(st, { tier: 5, units: { worker: 2, marine: 10 }, budget: 400, seed: 7777 });
  assert(v5.ok && v5.totalUnits === 12 && v5.budget === 400, 'валидный loadout tier 5 не прошёл');

  pass('R0a.2 tiers-1-5: прогрессия допуска 1→5 и граничные отказы loadout');
} catch (e) { fail('R0a.2 tiers-1-5', e); }

// ---------- R0a.3: детерминизм сектора цели по seed и запрет КЦ в вылазке ----------
try {
  const snapSector = (seed, tier) => {
    game.startRaidHome('human', { forceNew: true });
    const res = game.launchRaidExpedition({ tier, units: { worker: 2, marine: 1 }, budget: 25, seed });
    assert(res.ok, 'вылазка для проверки seed не стартовала');
    const st = game.state;
    assert(st.raidMode === 'expedition' && st.noBase === true, 'режим вылазки некорректен');
    assert(!missionsMod.isUnlocked(game.mission, 'cc'), 'в вылазке разрешена постройка второго КЦ');
    assert(missionsMod.isUnlocked(game.mission, 'turret'), 'в вылазке заблокирована полевая турель');
    for (let i = 0; i < 45; i++) game.tick();
    return {
      rng: st.rngState,
      w: st.map.w,
      h: st.map.h,
      terrainSum: st.map.terrain.reduce((a, b) => a + b, 0),
      crystals: st.map.crystals.map((c) => `${c.tx},${c.ty}:${c.amount}`).join('|'),
      units: st.units.map((u) => `${u.type}@${Math.round(u.x)},${Math.round(u.y)}`).join('|'),
    };
  };

  const a1 = snapSector(424242, 1);
  const a2 = snapSector(424242, 1);
  const b1 = snapSector(989898, 1);

  assert(a1.rng === a2.rng && a1.terrainSum === a2.terrainSum, 'одинаковый seed дал разный рельеф или RNG');
  assert(a1.crystals === a2.crystals && a1.units === a2.units, 'одинаковый seed дал разные кристаллы или позиции через 45 тиков');
  assert(a1.crystals !== b1.crystals, 'разные seed дали идентичную раскладку кристаллов');

  pass('R0a.3 determinism: одинаковый seed воспроизводит сектор 1:1, второй КЦ в вылазке запрещён');
} catch (e) { fail('R0a.3 determinism', e); }

// ---------- R0a.4: полная петля база → сбор эрга → эвакуация → база → 2-й рейд ----------
try {
  game.startRaidHome('human', { forceNew: true });
  const home0 = game.state;
  const cc0 = home0.buildings.find((b) => b.type === 'cc');

  // Строим достроенный склад на домашней базе и уменьшаем один кристалл (проверка сохранения DTO).
  let depotSpot = null;
  for (let dy = -6; dy <= 6 && !depotSpot; dy++) {
    for (let dx = -6; dx <= 8 && !depotSpot; dx++) {
      if (B.canPlace(home0.map, cc0.tx + dx, cc0.ty + dy, 2, 2)) {
        depotSpot = { x: cc0.tx + dx, y: cc0.ty + dy };
      }
    }
  }
  assert(depotSpot, 'не найдено место под склад на домашней базе');
  const homeDepot = new B.Building(home0, 'player', 'depot', depotSpot.x, depotSpot.y, true);
  home0.map.markBuilding(homeDepot);
  home0.bcount.player++;
  home0.minerals.player = 240;
  const homeCrystal0 = home0.map.crystals[0];
  const editedAmount = Math.max(25, homeCrystal0.amount - 77);
  homeCrystal0.amount = editedAmount;

  // Открываем консоль вылазки через команду КЦ KeyE.
  home0.selection = [cc0];
  const ccCmds = game.getCommands();
  const launchCmd = ccCmds.find((c) => c.code === 'KeyE');
  assert(launchCmd, 'у домашнего корабля-КЦ нет команды Вылазка (KeyE)');
  launchCmd.on();
  assert(ui.isRaidOverlayOpen() && game.paused, 'консоль вылазки не открылась на паузе');

  // Отправляем 2 рабочих + 1 морпеха и 50 стройбюджета; 1 морпех и 190 эрга остаются дома.
  const targetSeed = game.nextRaidSeed(2);
  const launched = game.launchRaidExpedition({
    tier: 2,
    units: { worker: 2, marine: 1 },
    budget: 50,
    seed: targetSeed,
  });
  assert(launched.ok, 'первая вылазка не запустилась');
  assert(!ui.isRaidOverlayOpen() && !game.paused, 'консоль вылазки не закрылась после старта');

  // Проверяем whitelist-DTO домашней базы.
  const dto = game.raidSession.homeDto;
  assert(dto && dto.schemaVersion === raid.RAID_SCHEMA_VERSION, 'DTO домашней базы без schemaVersion');
  assert(!('game' in dto) && !('fog' in dto) && !('ai' in dto), 'DTO содержит живые поля state');
  assert(dto.minerals === 190, 'остаток эрга дома в DTO неверен: ' + dto.minerals);
  assert(dto.units.length === 1 && dto.units[0].type === 'marine', 'оставшийся дома морпех не записан в DTO');

  // В вылазке рабочие добывают эрг и сдают его на челночную площадку (raidCargo).
  const exp = game.state;
  assert(exp.raidMode === 'expedition' && exp.minerals.player === 50, 'бюджет вылазки неверен');
  let ticks = 0;
  while ((exp.raidCargo || 0) < 16 && ticks < 1500) {
    game.tick();
    ticks++;
  }
  const minedCargo = exp.raidCargo || 0;
  assert(minedCargo >= 16, 'рабочие не сдали эрг в трюм челнока за 1500 тиков: ' + minedCargo);
  assert(exp.minerals.player === 50, 'сдача в трюм изменила стройбюджет вместо raidCargo');
  game.render(0.5);
  ui.drawMinimap(game);

  // Включаем эвакуацию кнопкой топбара и ждём посадки всех 3 бойцов и возврата на базу-КЦ.
  el('btn-raid-action').click();
  assert(exp.raidEvacuating === true, 'эвакуация не включилась кнопкой топбара');
  let evacTicks = 0;
  while (game.state === exp && evacTicks < 900) {
    game.tick();
    evacTicks++;
  }
  assert(game.state !== exp && game.state.raidMode === 'home', 'челнок не вернул отряд на домашнюю базу');

  const home1 = game.state;
  const finalCargo = game.raidSession.lastReturn.cargo;
  assert(finalCargo >= minedCargo, 'груз уменьшился при посадке');
  assert(home1.buildings.some((b) => !b.dead && b.type === 'cc'), 'корабль-КЦ пропал после возврата');
  assert(home1.buildings.some((b) => !b.dead && b.type === 'depot' && b.tx === depotSpot.x && b.ty === depotSpot.y), 'построенный склад пропал после вылазки');
  const restoredCrystal = home1.map.crystals.find((c) => c.tx === homeCrystal0.tx && c.ty === homeCrystal0.ty);
  assert(restoredCrystal && restoredCrystal.amount === editedAmount, 'выработка домашнего кристалла не сохранилась');
  assert(countPlayerUnits(home1, 'worker') === 2 && countPlayerUnits(home1, 'marine') === 2, 'состав после возврата не сошёлся (подарок продублирован или юниты пропали)');
  assert(home1.minerals.player === 190 + 50 + finalCargo, `баланс эрга не сошёлся: ${home1.minerals.player} != ${240 + finalCargo}`);

  // Сразу запускаем 2-й вылет с той же домашней базы.
  const launched2 = game.launchRaidExpedition({
    tier: 2,
    units: { worker: 1, marine: 2 },
    budget: 75,
    seed: game.nextRaidSeed(2),
  });
  assert(launched2.ok && game.raidSession.raidSeq === 2, 'вторая вылазка подряд не стартовала');

  pass('R0a.4 full-loop: база-КЦ → сбор эрга в трюм челнока → эвакуация → сохранность базы и точный баланс → 2-й рейд');
} catch (e) { fail('R0a.4 full-loop', e); }

// ---------- R0a.5: гибель отряда без бесплатного пополнения (#25), Кхарид и RU↔EN ----------
try {
  // Продолжаем со 2-й вылазки (в вылазке 1 рабочий + 2 морпеха и 75 бюджета; дома остался 1 рабочий).
  const exp2 = game.state;
  const homeMineralsBefore = game.raidSession.homeDto.minerals;
  exp2.raidCargo = 40; // допустим, успели набрать 40 эрга в трюм до гибели
  for (const u of exp2.units) {
    if (u.side === 'player') u.hp = 0, u.dead = true;
  }
  game.tick(); // гибель всего отряда завершает вылазку со статусом wiped

  const homeAfterWipe = game.state;
  assert(homeAfterWipe.raidMode === 'home', 'после гибели отряда не вернуло на домашнюю базу');
  assert(game.raidSession.lastReturn.outcome === 'wiped', 'исход гибели не отмечен как wiped');
  assert(homeAfterWipe.minerals.player === homeMineralsBefore, 'при гибели отряда вернулись трюм или бюджет вылазки');
  assert(countPlayerUnits(homeAfterWipe) === 1 && countPlayerUnits(homeAfterWipe, 'worker') === 1, 'после гибели отряда выдано бесплатное пополнение (#25 нарушен)');

  // Выход в меню и возврат на базу-КЦ сохраняют состояние сессии; проверка фракции Кхарид и локалей RU↔EN.
  game.toMenu();
  assert(el('btn-raid-reset').hidden === false, 'кнопка Новая база скрыта при активной базе');

  game.startRaidHome('alien', { forceNew: true });
  assert(game.state.factions.player === 'alien' && game.state.raidMode === 'home', 'база Кхарид не стартовала');
  game.openRaidLaunch();
  await i18n.setLocale('en');
  assert(el('raid-modal-sub').textContent.includes('Actan-4'), 'EN-локаль не обновила консоль вылазки');
  assert(game.objectiveText().includes('Actan-4'), 'EN-локаль не обновила цель HUD');
  await i18n.setLocale('ru');
  assert(el('raid-modal-sub').textContent.includes('Актан-4'), 'RU-локаль не восстановила консоль вылазки');
  game.closeRaidLaunch();

  pass('R0a.5 wipe-and-i18n: гибель отряда теряет трюм/бюджет без бесплатного комплекта (#25), Кхарид и RU↔EN чисты');
} catch (e) { fail('R0a.5 wipe-and-i18n', e); }

console.log(failures.length
  ? `\nИТОГ SIM_RAID: ${failures.length} ОШИБОК (${failures.join(', ')})`
  : '\nИТОГ SIM_RAID: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
