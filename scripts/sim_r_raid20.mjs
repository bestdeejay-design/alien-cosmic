// ============================================================
// sim_r_raid20.mjs — Э1: экономика рейдов на 20 уровней (полигон r/).
//
// Проверяет на настоящем движке r/js/*:
//   E1 грейды 1→20: цена/время растут, статы применяются (турель/бункер);
//   E2 правило «не выше КЦ»: кнопка грейда ВИДНА и объясняет запрет;
//   E3 правило КЦ: КЦ→3 требует 3 здания II ур. (КЦ считается), КЦ→4 — 4 III;
//   E4 КЦ грейдится (раньше кнопка не появлялась вовсе — баг полигона);
//   E5 ранги юнитов (лаборатория): 20 уровней, не выше КЦ, проценты урона;
//   E6 рейды 1→20: тир открывает КЦ, добыча/бур/трюм по тиру и грейду Дома;
//   E7 DTO домашней базы хранит уровни до 20 (не режет до 3);
//   E8 сводка экономики: до базы-20 нужны миллионы, кривая рейдов окупает.
//
// Запуск: node scripts/sim_r_raid20.mjs
// ============================================================
import './harness.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (msg) => console.log(`PASS  ${msg}`);
const assert = (c, msg) => { if (!c) throw new Error(msg); };

await import('../r/js/game.js');
// ВАЖНО: тот же суффикс ?v=, что и внутри движка, иначе Node создаст
// ВТОРЫЕ экземпляры модулей (свой `els` в ui, свой стейт) — классическая
// ловушка кэш-бастинга (см. коммит «штамп в путях»).
const V = '?v=10262510';
const cfg = await import('../r/js/config.js' + V);
const E = await import('../r/js/economy.js' + V);
const U = await import('../r/js/units.js' + V);
const B = await import('../r/js/buildings.js' + V);
const R = await import('../r/js/raid.js' + V);
const ui = await import('../r/js/ui.js' + V);
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }
assert(E.MAX_LEVEL === 20, 'MAX_LEVEL не 20');

const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };
const paint = () => { game.render(1); ui.update(game); ui.drawMinimap(game); };
const st = () => game.state;
const ccOf = (s = st()) => s.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
const cmds = () => game.getCommands();
const findCmd = (code) => cmds().find((c) => c.code === code);

function placeDone(state, side, type, cx, cy) {
  const bc = cfg.BUILDINGS[type];
  for (let r = 0; r < 16; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (B.canPlace(state.map, cx + dx, cy + dy, bc.w, bc.h)) {
          const b = B.placeBuildingCmd(state, side, type, cx + dx, cy + dy, []);
          b.done = true; b.hp = b.maxHp;
          return b;
        }
      }
    }
  }
  throw new Error('негде встать: ' + type);
}

function gradeTo(state, b, to) {
  while ((b.level || 1) < to) {
    const r = B.startGrade(state, b);
    assert(r && r.ok, 'старт грейда до ' + to + ': ' + JSON.stringify(r));
    b.gradeUp.t = 0.01;
    ticks(3);
  }
  assert((b.level || 1) === to, 'уровень не ' + to);
}

function selectOnly(e) { st().selection = [e]; }

// ---------- E1: грейды 1→20 ----------
try {
  game.startRaidHome('human');
  ticks(3);
  const s = st();
  assert(s.raidMode === 'home', 'не рейд-хоум');
  s.minerals.player = 5_000_000;
  const cc = ccOf(s);
  assert(cc && cc.level === 1, 'КЦ не Г1');

  // Турель: Г2 цена 60, Г3 86 (кривая из economy), урон и дальность растут.
  const tur = placeDone(s, 'player', 'turret', cc.tx, cc.ty);
  assert(tur.level === 1, 'турель не Г1');
  const t2 = E.gradeEntry('turret', 2), t3 = E.gradeEntry('turret', 3);
  assert(t2.cost === 60 && t3.cost === 83, 'цены турели 2/3 не 60/83: ' + t2.cost + '/' + t3.cost);
  // Правило R1: сначала КЦ-II, потом турель-II (иначе cclow — это E2).
  gradeTo(s, cc, 2);
  gradeTo(s, tur, 2);
  assert(tur.level === 2, 'турель не Г2');
  assert(cfg.gradeDmg('turret', 2, 8) === t2.dmg, 'урон турели не по таблице');
  assert(cfg.gradeRange('turret', 2, 150) === t2.range, 'дальность не по таблице');
  assert(!E.canGradeBuilding(s, 'player', tur).ok, 'турель-III при КЦ-II должна быть заперта');
  pass(`E1 грейды 1→20: турель Г2=${t2.cost}/${t2.time}с, Г3=${t3.cost}/${t3.time}с, Г20=${E.gradeEntry('turret', 20).cost}, урон ${E.gradeEntry('turret', 20).dmg}`);
} catch (e) { fail('E1 грейды 1→20', e); }

// ---------- E2: грейд не выше КЦ — кнопка ВИДНА и объясняет ----------
try {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const s = st();
  s.minerals.player = 5_000_000;
  const cc = ccOf(s);
  const tur = placeDone(s, 'player', 'turret', cc.tx, cc.ty);
  gradeTo(s, tur, 1); // остаётся Г1
  // КЦ Г1 → грейд турели до Г2 запрещён (цель 2 > КЦ 1).
  selectOnly(tur);
  paint();
  const btn = findCmd('KeyR');
  assert(btn, 'кнопка грейда исчезла при упоре в КЦ (баг владельца)');
  assert(/закрыто|locked/.test(btn.label), 'на кнопке нет метки «закрыто»: ' + btn.label);
  assert(btn.enabled && !btn.enabled(), 'кнопка грейда должна быть недоступна');
  const tipText = JSON.stringify(btn.tip);
  assert(/КЦ/.test(tipText), 'в тултипе нет причины «нужен КЦ»: ' + tipText);
  const chk = E.canGradeBuilding(s, 'player', tur);
  assert(!chk.ok && chk.code === 'cclow', 'код запрета не cclow: ' + chk.code);
  // И сама команда не срабатывает: startGrade возвращает cclow, деньги целы.
  const money = s.minerals.player;
  const r = B.startGrade(s, tur);
  assert(r && r.code === 'cclow', 'startGrade не вернул cclow');
  assert(s.minerals.player === money, 'деньги списались при запрете');
  pass('E2 «не выше КЦ»: кнопка видна, помечена «закрыто», тултип объясняет, списания нет');
} catch (e) { fail('E2 «не выше КЦ»', e); }

// ---------- E3/E4: правило условий КЦ и сам грейд КЦ ----------
try {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const s = st();
  s.minerals.player = 5_000_000;
  const cc = ccOf(s);
  selectOnly(cc);
  paint();
  // E4: кнопка грейда КЦ существует (в старой сборке её не было вовсе).
  const cbtn = findCmd('KeyR');
  assert(cbtn, 'у КЦ нет кнопки грейда');
  assert(cbtn.enabled && cbtn.enabled(), 'грейд КЦ-I недоступен при 5М эрга');
  gradeTo(s, cc, 2);
  assert(cc.level === 2, 'КЦ не Г2');
  assert(cc.maxHp === Math.round(cfg.BUILDINGS.cc.hp * E.gradeEntry('cc', 2).hpMul), 'HP КЦ не по грейду');

  // КЦ→3: нужно 3 здания II ур. (КЦ-II считается). Сейчас только КЦ → запрет.
  const bar = placeDone(s, 'player', 'barracks', cc.tx, cc.ty);
  gradeTo(s, bar, 2);
  let chk = E.canGradeBuilding(s, 'player', cc);
  assert(!chk.ok && chk.code === 'gate', 'КЦ→3 разрешён без условия: ' + chk.code);
  assert(chk.gate.need === 3 && chk.gate.minLevel === 2, 'условие КЦ→3 неверно: ' + JSON.stringify(chk.gate));
  assert(chk.gate.have === 2, 'насчитано зданий ' + chk.gate.have + ' вместо 2 (КЦ-II + казарма-II)');
  selectOnly(cc);
  paint();
  const blockedBtn = findCmd('KeyR');
  assert(blockedBtn && /закрыто|locked/.test(blockedBtn.label), 'кнопка КЦ не помечена при невыполненном условии');
  // Третье здание II ур. → условие выполнено.
  const dep = placeDone(s, 'player', 'depot', cc.tx, cc.ty);
  gradeTo(s, dep, 2);
  chk = E.canGradeBuilding(s, 'player', cc);
  assert(chk.ok, 'условие КЦ→3 не выполнено при 3 зданиях II: ' + JSON.stringify(chk));
  gradeTo(s, cc, 3);
  assert(cc.level === 3, 'КЦ не Г3');
  // КЦ→4: нужно 4 здания III ур.
  const gate4 = E.ccGate(4);
  assert(gate4.count === 4 && gate4.minLevel === 3, 'условие КЦ→4 неверно');
  chk = E.canGradeBuilding(s, 'player', cc);
  assert(!chk.ok && chk.code === 'gate' && chk.gate.need === 4 && chk.gate.have === 1, 'КЦ→4 условие: ' + JSON.stringify(chk.gate));
  // Теперь здания могут дойти до III (уровень КЦ 3) — но не до IV.
  assert(E.canGradeBuilding(s, 'player', bar).ok, 'казарма-II не грейдится в III при КЦ-III');
  gradeTo(s, bar, 3);
  const barChk = E.canGradeBuilding(s, 'player', bar);
  assert(!barChk.ok && barChk.code === 'cclow', 'казарма-III грейдится в IV при КЦ-III');
  pass('E3/E4 условия КЦ: →3 = 3 здания II (насчитано 2→3), →4 = 4 здания III; КЦ грейдится, кнопка есть');
} catch (e) { fail('E3/E4 условия КЦ', e); }

// ---------- E5: ранги юнитов 1..20, не выше КЦ ----------
try {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const s = st();
  s.minerals.player = 5_000_000;
  const cc = ccOf(s);
  const lab = placeDone(s, 'player', 'lab', cc.tx, cc.ty);
  selectOnly(lab);
  paint();
  const atkBtn = findCmd('KeyQ');
  assert(atkBtn, 'в лаборатории нет кнопки ранга пехоты');
  // Ранг 1 ≤ уровня КЦ (I) — доступен; ранг 2 — уже нет.
  const r1 = B.startResearch(s, lab, 'infAtk');
  assert(r1 === 'ok', 'ранг 1 пехоты не стартовал при КЦ-I: ' + r1);
  lab.res.t = 0.01; ticks(3);
  assert(s.tech.player.infAtk === 1, 'ранг не записан');
  const r2 = B.startResearch(s, lab, 'infAtk');
  assert(r2 === 'grade', 'ранг 2 при КЦ-I должен быть закрыт: ' + r2);
  // КЦ-II открывает ранг 2 (и только его).
  gradeTo(s, cc, 2);
  assert(B.startResearch(s, lab, 'infAtk') === 'ok', 'ранг 2 не открылся на КЦ-II');
  lab.res.t = 0.01; ticks(3);
  assert(B.startResearch(s, lab, 'infAtk') === 'grade', 'ранг 3 при КЦ-II должен быть закрыт');
  // Урон и броня — проценты.
  assert(Math.round(cfg.UNITS.marine.dmg * E.attackMul(1) * 10) / 10 > cfg.UNITS.marine.dmg, 'ранг не даёт урона');
  assert(E.armorFrac(20) === 0.5, 'потолок брони не 50%');
  assert(E.TECH.infAtk.max === 20 && E.TECH.infAtk.costs.length === 20, 'ранги не 20 уровней');
  pass(`E5 ранги юнитов: 20 уровней, «не выше КЦ» работает, урон ×${E.attackMul(20).toFixed(2)} на 20 ур., броня до ${E.armorFrac(20) * 100}%`);
} catch (e) { fail('E5 ранги юнитов', e); }

// ---------- E6: рейды 1→20 ----------
try {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const s = st();
  s.minerals.player = 5_000_000;
  const cc = ccOf(s);
  const house = placeDone(s, 'player', 'depot', cc.tx, cc.ty);

  // До Г2 Дома рейд запрещён.
  let v = R.validateRaidLoadout(s, { tier: 1, units: { worker: 1 }, budget: 0, seed: 7 });
  assert(!v.ok && v.reasonKey === 'ui.raid.errNoHouse', 'рейд без Дома-II не запрещён');

  // Дом-II требует КЦ-II (правило R1), поэтому сперва КЦ.
  gradeTo(s, cc, 2);
  gradeTo(s, house, 2);
  // Тир открывает КЦ: тир T доступен с КЦ уровня T.
  assert(R.unlockedRaidTier(s) === 2, 'при КЦ-II открытый тир не 2: ' + R.unlockedRaidTier(s));
  v = R.validateRaidLoadout(s, { tier: 2, units: { worker: 1 }, budget: 0, seed: 7 });
  assert(v.ok, 'тир 2 при КЦ-II должен быть открыт: ' + (v.reasonKey || ''));
  v = R.validateRaidLoadout(s, { tier: 3, units: { worker: 1 }, budget: 0, seed: 7 });
  assert(!v.ok && v.reasonKey === 'ui.raid.errTierLocked', 'тир 3 при КЦ-II не закрыт');

  // Тир 20 при КЦ-20 — открыт; добыча и бур растут экспоненциально.
  const t1 = E.raidTierAt(1), t20 = E.raidTierAt(20);
  assert(t1.yieldTotal === 900 && t20.tripYield > 200, 'кривая рейдов: ' + t1.yieldTotal + '/' + t20.tripYield);
  assert(E.raidTierAt(20).unlockCC === 20, 'тир 20 не требует КЦ 20');

  // Запуск вылазки: трюм = грейд Дома, бур = тир.
  s.minerals.player = 5000;
  const squad = { worker: 2 };
  const v1 = R.validateRaidLoadout(s, { tier: 1, units: squad, budget: 0, seed: 12345 });
  assert(v1.ok, 'валидная вылазка отклонена: ' + (v1.reasonKey || ''));
  const launched = game.launchRaidExpedition({ tier: 1, units: squad, budget: 0, seed: 12345 });
  assert(launched && launched.ok, 'вылазка не стартовала');
  ticks(5);
  const ex = st();
  assert(ex.raidMode === 'expedition', 'не вылазка');
  assert(ex.raidTripYield === t1.tripYield, 'бур тира не применён: ' + ex.raidTripYield);
  assert(ex.raidCargoCap === E.HOUSE_LEVELS.cargo(2), 'трюм Дома-Г2 не 3000: ' + ex.raidCargoCap);
  // Рабочий добывает ровно бур тира и сдаёт в трюм Дома-шаттла.
  const w = ex.units.find((u) => u.type === 'worker' && u.side === 'player' && !u.dead);
  assert(w, 'нет рабочего в вылазке');
  const c = ex.map.crystals.find((cr) => !cr.dead && cr.amount > 0);
  assert(c, 'на карте тира нет кристаллов');
  assert(c.amount <= t1.yieldTotal, 'одна жила богаче всего тира: ' + c.amount);
  U.orderGather(ex, w, c);
  const pile = ex.map.crystals.reduce((a, cr) => a + (cr.dead ? 0 : cr.amount), 0);
  assert(pile > 0 && pile < 3000, 'сумма месторождения тира вне ожиданий: ' + pile);
  // Дом-шаттл в вылазке: команда эвакуации есть, грейда нет (грейд — только на базе).
  selectOnly(ex.raidHouse);
  paint();
  assert(findCmd('KeyE'), 'у Дома-шаттла нет команды эвакуации в вылазке');
  assert(!findCmd('KeyR'), 'на карте вылазки появилась кнопка грейда');
  // Дом-Г4 лечит отряд в радиусе ауры (канон владельца).
  const hurt = ex.units.find((u) => u.type === 'worker' && u.side === 'player' && !u.dead);
  ex.raidHouse.level = 4;
  hurt.hp = 20;
  hurt.x = ex.raidDrop.x + 16; hurt.y = ex.raidDrop.y + 16;
  for (let i = 0; i < 60; i++) game.tick();
  assert(hurt.hp > 20, 'Дом-Г4 не лечит в рейде: hp ' + hurt.hp);
  // Трюм растёт с грейдом Дома: Г20 — 83 000.
  ex.raidHouse.level = 20;
  ex.raidCargoCap = E.HOUSE_LEVELS.cargo(ex.raidHouse.level);
  assert(ex.raidCargoCap === 83000, 'трюм Дома-Г20 не 83 000: ' + ex.raidCargoCap);
  pass(`E6 рейды: тир=уровень КЦ, тир1 ${t1.yieldTotal} эрга/${t1.tripYield} за рейс, тир20 ${t20.yieldTotal}/${t20.tripYield}, трюм Г2 3000 → Г20 83 000, аура лечения Г4 работает, карта тира ${pile}`);
} catch (e) { fail('E6 рейды 1→20', e); }

// ---------- E7: DTO домашней базы хранит уровни до 20 ----------
try {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const s = st();
  s.minerals.player = 50_000_000;
  const cc = ccOf(s);
  const tur = placeDone(s, 'player', 'turret', cc.tx, cc.ty);
  // E7 — про сериализацию: уровни ставим напрямую (правила гейтов проверены выше).
  cc.level = 8; tur.level = 7;
  game.syncRaidHomeSnapshot();
  const dto = game.raidSession.homeDto;
  const turDto = dto.buildings.find((b) => b.type === 'turret');
  assert(turDto.level === 7, 'DTO срезал уровень турели до ' + turDto.level);
  const ccDto = dto.buildings.find((b) => b.type === 'cc');
  assert(ccDto.level === 8, 'DTO срезал уровень КЦ до ' + ccDto.level);
  pass('E7 DTO базы: уровни 7 и 8 переживают снимок (было жёсткое мин(3, level))');
} catch (e) { fail('E7 DTO базы', e); }

// ---------- E9: консоль вылазки и бейджи уровней ----------
try {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const s = st();
  s.minerals.player = 5_000_000;
  const cc = ccOf(s);
  const house = placeDone(s, 'player', 'depot', cc.tx, cc.ty);
  gradeTo(s, cc, 2);
  gradeTo(s, house, 2);
  ticks(3);
  // Консоль вылазки: 20 тиров, лимит состава не больше мест Дома.
  ui.showRaidLaunch(game);
  const grid = document.getElementById('raid-tier-grid');
  assert(grid && grid.children.length === 20, 'в консоли не 20 тиров: ' + (grid && grid.children.length));
  const model = game.getRaidConsoleModel(null);
  assert(model.houseSlots === 10, 'мест в Доме-Г2 не 10: ' + model.houseSlots);
  for (const t of model.tiers) assert(t.maxUnits <= model.houseSlots, 'тир ' + t.tier + ' обещает больше мест, чем есть');
  ui.hideRaidLaunch();
  // Бейдж уровня на кнопке грейда (находка владельца про уровни в меню).
  selectOnly(cc);
  paint();
  const gradeBtn = findCmd('KeyR');
  assert(gradeBtn && gradeBtn.level === 3, 'у кнопки грейда нет целевого уровня: ' + (gradeBtn && gradeBtn.level));
  pass('E9 консоль вылазки: 20 тиров, лимит по Дому-Г2 (10 мест), у кнопок есть уровень');
} catch (e) { fail('E9 консоль вылазки', e); }

// ---------- E8: сводка экономики ----------
try {
  const plan = E.basePlanCost();
  assert(plan.total > 3_000_000 && plan.total < 15_000_000, 'итог базы-20 вне коридора: ' + plan.total);
  assert(E.chainCost('cc', 20) > 1_000_000, 'КЦ-20 дешевле 1М: ' + E.chainCost('cc', 20));
  assert(E.HOUSE_LEVELS.cargo(20) === 83000, 'трюм Г20 не 83 000');
  const rows = E.ccProgression();
  assert(rows.length === 19 && rows[18].level === 20, 'прогрессия КЦ не 19 шагов');
  for (const r of rows) assert(r.cost > 0 && r.time > 0, 'пустой шаг прогрессии ' + r.level);
  // Кривая цены монотонна на всех 20 уровнях.
  for (let L = 3; L <= 20; L++) {
    assert(E.gradeEntry('cc', L).cost > E.gradeEntry('cc', L - 1).cost, 'цена КЦ не растёт на ' + L);
    assert(E.raidTierAt(L).yieldTotal > E.raidTierAt(L - 1).yieldTotal, 'добыча тира не растёт на ' + L);
  }
  pass(`E8 экономика: база-20 = ${plan.total.toLocaleString('ru-RU')} эрга (здания ${plan.buildings.toLocaleString('ru-RU')} + ранги ${plan.tech.toLocaleString('ru-RU')}), КЦ-20 ${E.chainCost('cc', 20).toLocaleString('ru-RU')}`);
} catch (e) { fail('E8 экономика', e); }

// ---------- Итог ----------
if (failures.length) {
  console.log(`\n❌ Э1: провалено ${failures.length} блок(ов): ${failures.join(', ')}`);
  process.exit(1);
} else {
  console.log('\n✅ Э1: экономика 20 уровней — все блоки зелёные');
}
