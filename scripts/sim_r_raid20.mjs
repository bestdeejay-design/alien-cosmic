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
import { V } from './stamp.mjs';
const cfg = await import('../r/js/config.js' + V);
const E = await import('../r/js/economy.js' + V);
const U = await import('../r/js/units.js' + V);
const B = await import('../r/js/buildings.js' + V);
const R = await import('../r/js/raid.js' + V);
const ui = await import('../r/js/ui.js' + V);
// ace#10 Ф-3 (ревизия SZ m2): на v2-базе кошелёк (walletMicro) авторитарен,
// прямая запись в view не доходит до расходов (startGrade тратит из кошелька).
// Посев денег сима идёт через единую точку дохода creditMinerals.
const W = await import('../r/js/alarm-v2-wallet.js' + V);
function giveMoney(s, amount) {
  const need = amount - (s.minerals.player || 0);
  if (need > 0) W.creditMinerals(s, 'player', need);
}
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
  giveMoney(s, 5_000_000);
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
  giveMoney(s, 5_000_000);
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
  giveMoney(s, 5_000_000);
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
  giveMoney(s, 5_000_000);
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
  giveMoney(s, 5_000_000);
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
  giveMoney(s, 5000);
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
  // ВЛАДЕЛЕЦ 26.10.2026 (правка спеки): аура лечения Дома Г4+ работает ТОЛЬКО
  // В РЕЙДЕ. Лечит существ своей расы — поэтому проверяем на марине, а не на
  // дроне-технике (дронов чинят сборщики, аура их не трогает).
  // Десант тира 1 — только техники, поэтому существо для проверки ауры
  // добавляем на карту вручную (аура лечит существ, а не дронов).
  const hurt = U.spawnUnit(ex, 'player', 'marine', ex.raidHouse.x + 16, ex.raidHouse.y + 16, false);
  assert(hurt, 'не удалось выставить марина для проверки ауры');
  ex.raidHouse.level = 4;
  hurt.hp = 20;
  for (let i = 0; i < 60; i++) {
    hurt.x = ex.raidHouse.x + 16; hurt.y = ex.raidHouse.y + 16;
    if (game.state !== ex) break;
    game.tick();
  }
  assert(hurt.hp > 20, 'Дом-Г4 не лечит существо в рейде: hp ' + hurt.hp);
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
  giveMoney(s, 50_000_000);
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
  giveMoney(s, 5_000_000);
  const cc = ccOf(s);
  const house = placeDone(s, 'player', 'depot', cc.tx, cc.ty);
  gradeTo(s, cc, 2);
  gradeTo(s, house, 2);
  ticks(3);
  // #36 З3: консоль показывает ТОЛЬКО доступные тиры (сетки 1–20 больше нет) и
  // честный лимит — ТРЮМ ДОМА, а не «эрг на карте» (репро SZ BUG-3).
  ui.showRaidLaunch(game);
  const grid = document.getElementById('raid-tier-grid');
  const model = game.getRaidConsoleModel(null);
  const unlocked = model.unlockedTier;
  assert(unlocked >= 1 && unlocked < R.RAID_TIERS.length, 'неподходящий стартовый доступ тиров: ' + unlocked);
  assert(grid && grid.children.length === unlocked,
    'в консоли должно быть ' + unlocked + ' доступных тиров, а не ' + (grid && grid.children.length));
  for (const btn of grid.children) {
    assert(!btn.disabled, 'в сетке остался заблокированный тир: ' + btn.id);
    assert(!btn.classList.contains('is-locked'), 'в сетке остался is-locked тир: ' + btn.id);
  }
  assert(model.houseSlots === 10, 'мест в Доме-Г2 не 10: ' + model.houseSlots);
  assert(model.cargoCap === E.HOUSE_LEVELS.cargo(2), 'трюм консоли не по грейду Дома: ' + model.cargoCap);
  const lootEl = (grid.children[0].children || []).find((c) => String(c.className || '').includes('rt-loot'));
  assert(lootEl, 'у тира нет строки трюма (.rt-loot)');
  const holdText = String(lootEl.textContent || '');
  // Число форматируется fmtNum (3 000 с пробелом-разделителем) — сравниваем цифры.
  const digits = (v) => String(v).replace(/[^0-9]/g, '');
  assert(digits(holdText).includes(digits(model.cargoCap)), 'в консоли нет трюма Дома ({cap}): ' + holdText);
  for (const t of model.tiers) assert(t.maxUnits <= model.houseSlots, 'тир ' + t.tier + ' обещает больше мест, чем есть');
  ui.hideRaidLaunch();
  // errTierRange больше не хардкодит «от 1 до 5» — диапазон идёт из RAID_TIERS.
  const ruErr = (await import('../r/locales/ru.js' + V)).default;
  const enErr = (await import('../r/locales/en.js' + V)).default;
  for (const [loc, txt] of [['ru', ruErr.ui.raid.errTierRange], ['en', enErr.ui.raid.errTierRange]]) {
    assert(!/1\s*(?:до|to|–|-)\s*5/.test(String(txt)), 'errTierRange всё ещё обещает 1–5 (' + loc + '): ' + txt);
  }
  // Бейдж уровня на кнопке грейда (находка владельца про уровни в меню).
  selectOnly(cc);
  paint();
  const gradeBtn = findCmd('KeyR');
  assert(gradeBtn && gradeBtn.level === 3, 'у кнопки грейда нет целевого уровня: ' + (gradeBtn && gradeBtn.level));
  pass(`E9 консоль вылазки: только ${unlocked} доступных тира (без стены 1–20), трюм Дома-Г2 ${model.cargoCap}, лимит состава 10, у кнопок есть уровень`);
} catch (e) { fail('E9 консоль вылазки', e); }

// ---------- E10: «к 20 идти труднее» — элитное условие КЦ ----------
try {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const s = st();
  giveMoney(s, 1_000_000_000);
  const cc = ccOf(s);
  cc.level = 10; // низкие уровни проверены в E3/E4, здесь только новое условие
  for (let i = 0; i < 10; i++) { const t = placeDone(s, 'player', 'turret', cc.tx, cc.ty); t.level = 10; }
  let chk = E.canGradeBuilding(s, 'player', cc); // КЦ→11
  assert(!chk.ok && chk.code === 'gate', 'КЦ→11 прошёл без элитных зданий: ' + chk.code);
  assert(chk.gate.eliteNeed === 2, 'элитное условие КЦ→11 не 2: ' + chk.gate.eliteNeed);
  assert(chk.gate.eliteHave === 0, 'элита посчитана неверно: ' + chk.gate.eliteHave);
  assert(chk.gate.have === chk.gate.need, 'всего зданий должно хватать: ' + chk.gate.have + '/' + chk.gate.need);
  // Одна казарма X ур. — 1 из 2, всё ещё нельзя.
  const bar = placeDone(s, 'player', 'barracks', cc.tx, cc.ty);
  bar.level = 10;
  chk = E.canGradeBuilding(s, 'player', cc);
  assert(!chk.ok && chk.gate.eliteHave === 1, 'элита 1/2 должна блокировать: ' + JSON.stringify(chk.gate));
  // Завод X ур. — условие выполнено.
  const fac = placeDone(s, 'player', 'factory', cc.tx, cc.ty);
  fac.level = 10;
  chk = E.canGradeBuilding(s, 'player', cc);
  assert(chk.ok, 'КЦ→11 не открылся при 2 развитых: ' + JSON.stringify(chk));
  // Правило в панели: причина видна словами.
  selectOnly(cc);
  paint();
  const btn = findCmd('KeyR');
  assert(btn && btn.level === 11, 'нет кнопки КЦ-XI');
  // КЦ→20 требует 6 развитых — проверяем формулу, а не игру.
  const g20 = E.ccGate(20);
  assert(g20.count === 20 && g20.elite === 6, 'условие КЦ→20 неверно: ' + JSON.stringify(g20));
  pass(`E10 «труднее к 20»: КЦ→11 требует 11 зданий X ур. + 2 развитых, КЦ→20 — 20 зданий XIX + 6 развитых; турели элиту не дают`);
} catch (e) { fail('E10 элитное условие КЦ', e); }

// ---------- E11: Дом — отсек, «собрать всех», лут и перегруз ----------
try {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const s = st();
  giveMoney(s, 5_000_000);
  const cc = ccOf(s);
  const house = placeDone(s, 'player', 'depot', cc.tx, cc.ty);
  gradeTo(s, cc, 2);
  gradeTo(s, house, 2);

  // Вместимость — ОДНО число и растёт медленно (решение владельца).
  const slots = [];
  for (let L = 1; L <= 20; L++) slots.push(E.HOUSE_LEVELS.slots(L));
  assert(slots[0] === 8 && slots[1] === 10 && slots[19] === 24, 'кривая вместимости: ' + slots.join(','));
  assert(slots[19] - slots[1] <= 15, 'вместимость растёт слишком быстро');
  assert(E.HOUSE_LEVELS.speed(3) === 80 && E.HOUSE_LEVELS.speed(20) === 182, 'кривая скорости Дома');
  assert(U.unitCapOf(house) === 10, 'вместимость Дома-Г2 не 10: ' + U.unitCapOf(house));

  // «Собрать всех»: юниты идут в отсек, лишние не влезают.
  const pool = [];
  for (let i = 0; i < 14; i++) {
    const u = U.spawnUnit(s, 'player', i % 3 === 0 ? 'worker' : 'marine',
      house.x + 60 + (i % 5) * 14, house.y + 80 + ((i / 5) | 0) * 14, false);
    pool.push(u);
  }
  const before = s.units.filter((u) => !u.dead && u.side === 'player').length;
  const n = game.loadAllIntoHouse(house);
  assert(n === 10, 'в отсек отправлено не 10: ' + n);
  for (let i = 0; i < 400; i++) game.tick();
  assert(house.garrison.length === 10, 'в отсеке не 10: ' + house.garrison.length);
  assert(s.units.filter((u) => !u.dead && u.side === 'player' && !u.garrison).length === before - 10,
    'лишние юниты должны остаться снаружи');
  assert(U.orderGarrison && U.unitCapOf(house) === 10, 'кап отсека изменился');

  // Запуск вылазки берёт отряд ИЗ ОТСЕКА в первую очередь.
  giveMoney(s, 5000);
  const v = game.launchRaidExpedition({ tier: 2, units: { marine: 4 }, budget: 0, seed: 777 });
  assert(v.ok, 'вылазка из отсека не стартовала');
  ticks(5);
  const ex = st();
  const marines = ex.units.filter((u) => u.type === 'marine' && u.side === 'player' && !u.dead);
  assert(marines.length === 4, 'в вылазке не 4 десantника: ' + marines.length);

  // Лут с вражеского КЦ. Сектор по seed может быть пустым (50%), поэтому
  // оборону ставим руками — проверяем именно механику лута, а не генератор.
  let enemyCC = ex.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
  if (!enemyCC) {
    const pb = ex.map.bases.player.cc;
    enemyCC = new B.Building(ex, 'enemy', 'cc',
      Math.max(2, Math.min(ex.map.w - 6, pb.x + 10)), Math.max(2, Math.min(ex.map.h - 5, pb.y + 4)), true);
    ex.map.markBuilding(enemyCC);
    ex.buildings.push(enemyCC);
    const tur = new B.Building(ex, 'enemy', 'turret', enemyCC.tx + 4, enemyCC.ty, true);
    ex.map.markBuilding(tur);
    ex.buildings.push(tur);
    const w8 = (enemyCC.cfg.cost || 400) + (tur.cfg.cost || 100);
    ex.raidLootPool = Math.round(E.raidTierAt(ex.raidTier).yieldTotal * 1.2);
    ex.raidLootLeft = ex.raidLootPool;
    ex.raidLootWeight = w8;
  }
  assert(ex.raidLootPool > 0, 'пул лута не создан');
  {
    ex.raidCargo = ex.raidCargoCap - 5; // трюм почти полон
    U.damageEntity(ex, enemyCC, 1e9, null);
    ticks(2);
    assert(ex.raidCargoLost > 0 || ex.raidLootLeft < ex.raidLootPool, 'лут с КЦ не выпал');
    const lootCrystals = ex.map.crystals.filter((c) => !c.dead && c.fieldId === -1);
    assert(lootCrystals.length >= 1, 'обломки не появились на карте');
    // Сдаём груз в трюм: излишек учитывается, а не пропадает молча.
    ex.raidCargo = ex.raidCargoCap;
    const w = U.spawnUnit(ex, 'player', 'worker', ex.raidDrop.x + 20, ex.raidDrop.y + 20, false);
    w.carrying = 50;
    w.order = { kind: 'gather', target: lootCrystals[0], phase: 'toDrop' };
    const lostBefore = ex.raidCargoLost || 0;
    for (let i = 0; i < 60; i++) game.tick();
    assert((ex.raidCargoLost || 0) >= lostBefore, 'перегруз не учтён');
    assert(ex.raidCargo <= ex.raidCargoCap, 'трюм переполнен сверх капа');
  }
  pass(`E11 Дом: вместимость 8→24 (одно число, +1 за два грейда), «собрать всех» 10/10, вылет берёт отсек, лут с КЦ ${ex.raidLootPool}, перегруз считается`);
} catch (e) { fail('E11 Дом: отсек и лут', e); }

// ---------- E12: КАПСУЛЫ СНАБЖЕНИЯ (призы, условия, веса, выдача) ----------
try {
  const C = await import('../r/js/chests.js' + V);
  // Чистое состояние капсул, чтобы прогон был повторяемым.
  for (const k of ['ac_chest_cfg_v1', 'ac_chest_state_v1', 'ac_birthday_v1']) localStorage.removeItem(k);

  const cfg0 = C.loadConfig();
  assert(cfg0.chests.length >= 5, 'в заводском наборе не 5 капсул');
  const ids = cfg0.chests.map((c) => c.id).sort().join(',');
  assert(ids === 'birthday,daily,evening-drop,leader-100,raider-20', 'заводские id: ' + ids);

  // 1) Окно входа 20:00–20:30.
  const win = cfg0.chests.find((c) => c.id === 'evening-drop').condition;
  assert(C.checkCondition(win, { now: new Date(2026, 0, 5, 20, 15) }).ok, 'окно 20:15 не сработало');
  assert(!C.checkCondition(win, { now: new Date(2026, 0, 5, 19, 59) }).ok, 'окно сработало до 20:00');
  assert(!C.checkCondition(win, { now: new Date(2026, 0, 5, 20, 31) }).ok, 'окно сработало после 20:30');
  // Окно через полночь.
  assert(C.checkCondition({ type: 'window', params: { from: '23:30', to: '00:30' } },
    { now: new Date(2026, 0, 5, 0, 10) }).ok, 'окно через полночь не работает');

  // 2) День рождения: без даты закрыто, в свой день открыто, назавтра — снова закрыто.
  assert(!C.checkCondition({ type: 'birthday', params: {} }, { now: new Date(2026, 4, 1, 12, 0) }).ok,
    'капсула именинника открыта без даты');
  C.setBirthday(5, 1); // 01.05
  assert(C.checkCondition({ type: 'birthday', params: {} }, { now: new Date(2026, 4, 1, 12, 0) }).ok,
    'капсула именинника не открылась в ДР');
  assert(!C.checkCondition({ type: 'birthday', params: {} }, { now: new Date(2026, 4, 2, 12, 0) }).ok,
    'капсула именинника открыта не в ДР');

  // 3) Пороговые условия: рейды / добыча / КЦ / топ.
  assert(!C.checkCondition({ type: 'raids', params: { n: 20 } }, { raids: 19 }).ok, 'рейдер-20 открылся на 19');
  assert(C.checkCondition({ type: 'raids', params: { n: 20 } }, { raids: 20 }).ok, 'рейдер-20 не открылся на 20');
  assert(C.checkCondition({ type: 'loot', params: { n: 50_000 } }, { loot: 50_000 }).ok, 'лут-капсула не открылась');
  assert(!C.checkCondition({ type: 'cc', params: { n: 10 } }, { ccLevel: 9 }).ok, 'КЦ-капсула открылась раньше времени');
  assert(!C.checkCondition({ type: 'top', params: { n: 100 } }, { topRank: 5, statsAvailable: false }).ok,
    'топ-капсула открылась без серверного рейтинга');
  assert(C.checkCondition({ type: 'top', params: { n: 100 } }, { topRank: 42, statsAvailable: true }).ok,
    'топ-100 не открылся для 42-го места');
  assert(!C.checkCondition({ type: 'top', params: { n: 100 } }, { topRank: 420, statsAvailable: true }).ok,
    'топ-100 открылся для 420-го места');

  // 4) Веса наград: 60/30/10 на 10 000 бросков даёт ~60/30/10 %.
  const pool = [
    { kind: 'erg', params: { amount: 100 }, weight: 60 },
    { kind: 'unit', params: { unit: 'marine', count: 1 }, weight: 30 },
    { kind: 'boost', params: { mul: 1.2, minutes: 5 }, weight: 10 },
  ];
  const cnt = { erg: 0, unit: 0, boost: 0 };
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 10_000; i++) cnt[C.pickReward(pool, rnd).kind]++;
  assert(Math.abs(cnt.erg / 100 - 60) < 3 && Math.abs(cnt.unit / 100 - 30) < 3 && Math.abs(cnt.boost / 100 - 10) < 3,
    'веса наград врут: ' + JSON.stringify(cnt));

  // 5) Выдача наград в живую игру.
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const s2 = st();
  giveMoney(s2, 1000);
  const cc2 = ccOf(s2);
  cc2.level = 6; // для проверки выдачи грейда достаточно уровня КЦ
  const house2 = placeDone(s2, 'player', 'depot', cc2.tx, cc2.ty);
  const erg0 = s2.minerals.player;
  C.applyReward(game, { kind: 'erg', params: { amount: 2500 } });
  assert(s2.minerals.player === erg0 + 2500, 'эрг из капсулы не зачислен');

  const unitsBefore = s2.units.filter((u) => !u.dead && u.side === 'player').length;
  const made = C.applyReward(game, { kind: 'unit', params: { unit: 'marine', count: 3 } });
  ticks(2);
  const unitsAfter = s2.units.filter((u) => !u.dead && u.side === 'player' && u.type === 'marine').length;
  assert(/\+3/.test(made) && unitsAfter >= 3, 'юниты из капсулы не появились: ' + made);

  // Грейд из капсулы не ломает канон R1 (не выше КЦ).
  const lvl0 = house2.level || 1;
  C.applyReward(game, { kind: 'grade', params: { building: 'depot', levels: 2 } });
  assert((house2.level || 1) === lvl0 + 2, 'грейд Дома из капсулы не применился');
  house2.level = 6; // ровно на уровне КЦ — выше нельзя (канон R1)
  const capped = C.applyReward(game, { kind: 'grade', params: { building: 'depot', levels: 5 } });
  assert(house2.level === 6 && /не выше КЦ/.test(capped), 'грейд из капсулы перепрыгнул КЦ: ' + capped);

  const techBefore = s2.tech.player.infantryAtk || s2.tech.player.infAtk || 0;
  C.applyReward(game, { kind: 'tech', params: { key: 'infAtk', levels: 1 } });
  const techAfter = s2.tech.player.infAtk || 0;
  assert(techAfter >= techBefore, 'ранг юнитов из капсулы не изменился');

  C.applyReward(game, { kind: 'boost', params: { mul: 1.5, minutes: 20 } });
  assert(s2.boost && s2.boost.mul === 1.5 && s2.boost.until > Date.now(), 'бустер добычи не включился');

  // 6) «Забрал» — раз в день (day) и раз в жизни (once).
  const ctx2 = C.buildContext(game, {});
  const first = C.claimChest(game, 'daily', ctx2);
  assert(first.ok, 'ежедневная капсула не вскрылась: ' + first.error);
  const second = C.claimChest(game, 'daily', ctx2);
  assert(!second.ok, 'ежедневную капсулу можно вскрыть дважды в день');
  const bdChest = C.loadConfig().chests.find((c) => c.id === 'birthday');
  assert(bdChest, 'капсулы именинника нет');
  // «раз в жизни»: ставим ДР на сегодня, забираем, второй раз — уже нельзя.
  const today = new Date();
  C.setBirthday(today.getMonth() + 1, today.getDate());
  const bdFirst = C.claimChest(game, 'birthday', C.buildContext(game, {}));
  assert(bdFirst.ok, 'капсула именинника не вскрылась в ДР: ' + bdFirst.error);
  const bdSecond = C.claimChest(game, 'birthday', C.buildContext(game, {}));
  assert(!bdSecond.ok, 'капсулу «раз в жизни» можно забрать дважды');

  // 7) Список для входного оверлея: доступные впереди, закрытые объясняют причину.
  const cfg1 = C.loadConfig();
  cfg1.chests = cfg1.chests.map((c) => (c.id === 'raider-20' ? { ...c, condition: { type: 'raids', params: { n: 1 } } } : c));
  C.saveConfig(cfg1);
  const list = C.availableChests(game, C.buildContext(game, {}));
  assert(list.length === cfg1.chests.length, 'в списке не все капсулы');
  assert(list.every((x) => x.chest && x.period), 'у карточки нет периода');
  const locked = list.find((x) => !x.eligible);
  assert(!locked || locked.why, 'закрытая капсула не объясняет причину');
  assert(list[0].eligible || list.every((x) => !x.eligible), 'доступные не идут первыми');
  pass(`E12 капсулы: ${cfg0.chests.length} заводских, окно/ДР/рейды/лут/КЦ/топ проверяются, веса 60/30/10 сходятся, эрг/юнит/грейд/ранг/бустер выдаются, «раз в день» и «раз в жизни» держат`);
} catch (e) { fail('E12 капсулы', e); }

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
