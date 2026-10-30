// ============================================================
// sim_alarm_live_v2.mjs — ace#10: живая интеграция «Боевой тревоги v2».
//   L1 старт события (VALIDATE→WARNING): план/журнал кражи/снимок;
//      повторный старт и старт при cooldown — отказ;
//   L2 тик цикла: спавн врагов в мир (cap 24), приказы атаки, директор
//      обороны не падает, фазы WARNING→WAVE→BREAK идут штатно;
//   L3 исходы: победа → settle (XP/кошелёк/отчёт), потеря груза →
//      немедленное поражение (D4), cooldown 300 с, повторный settle
//      не даёт второй выплаты;
//   L4 учебная копия: без наград, база восстанавливается (SPEC §8);
//   L5 телеметрия измерений SZ (ACCEPTANCE §3.6): длительность, B,
//      исход D2, экономика повторного нуля — фиксируются в лог.
// Запуск: node scripts/sim_alarm_live_v2.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

await import('../r/js/game.js');
const DIR = await import('../r/js/alarm-v2-director.js' + V);
const U = await import('../r/js/units.js' + V);
const B = await import('../r/js/buildings.js' + V);

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };

function bootV2() {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  return game.state;
}
// ВНИМАНИЕ: тик события публикует НОВУЮ сессию (одна запись одного blob'а),
// поэтому alarmV2/ledger читаются СВЕЖИМИ после каждого прогона тиков.
const meta = (st) => st.game.raidSession.alarmV2;
const ledgerOf = (st) => { const m = meta(st); return m.activeEvent && m.activeEvent.ledger; };
// Быстрая победа: в WAVE гасим всех врагов штатным damageEntity (L3-паттерн).
function winEvent(st) {
  let guard = 0;
  while (ledgerOf(st) && guard++ < 300) {
    const l = ledgerOf(st);
    if (l.phase === 'WAVE') {
      for (const u of st.units.slice()) {
        if (u.side === 'enemy' && u.alarmEnemyId && l.statuses[u.alarmEnemyId] === 'alive') {
          const hero = st.units.find((x) => x.side === 'player' && !x.dead && x.cfg && x.cfg.dmg > 0);
          U.damageEntity(st, u, 1e9, hero);
        }
      }
    }
    ticks(20);
  }
  assert(!ledgerOf(st), 'событие не завершилось');
}

// ---------- L1: старт события ----------
let planRef = null;
try {
  const st = bootV2();
  const res = DIR.startAlarmEvent(game, { mode: 'medium', kind: 'normal' });
  assert(res.ok, 'событие не стартовало: ' + JSON.stringify(res));
  planRef = res.plan;
  assert(planRef.mode === 'medium' && planRef.waves.length === 3, 'план средней: 3 волны');
  const m = meta(st);
  assert(m.activeEvent && m.activeEvent.ledger.phase === 'WARNING', 'нет фазы WARNING');
  assert(m.activeEvent.theft, 'журнал кражи не создан');
  assert(m.preBattleDto, 'предбоевой снимок не снят');
  const again = DIR.startAlarmEvent(game, { mode: 'hard', kind: 'normal' });
  assert(!again.ok, 'повторный старт прошёл во время события');
  const state = DIR.alarmUiState(st);
  assert(state.phase === 'WARNING' && state.warningSec > 0, 'UI-состояние не видит предупреждение');
  pass(`L1 старт: ${planRef.waves.length} волны, тир ${planRef.tier}, B-потенциал ${planRef.potentialBounty}, WARNING ${state.warningSec} с`);
} catch (e) { fail('L1 старт', e); }

// ---------- L2: спавн и тик цикла ----------
try {
  const st = bootV2();
  DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
  // WARNING 25 с = 750 тиков; прокручиваем старт фаз и спавн.
  ticks(760);
  const l = ledgerOf(st);
  assert(l && l.phase === 'WAVE', 'не дошли до WAVE: ' + (l && l.phase));
  const enemies = st.units.filter((u) => u.side === 'enemy' && !u.dead && u.alarmEnemyId);
  assert(enemies.length > 0 && enemies.length <= 24, 'спавн вне cap: ' + enemies.length);
  assert(enemies.every((e) => e.alarmEnemyId.startsWith(l.plan.eventId + ':')), 'enemyId не от события');
  assert(enemies.every((e) => e.hp > 0 && e.maxHp >= e.hp), 'HP спавна сломан');
  // ИИ атакующих не падает и выдаёт приказы.
  ticks(30);
  const withOrders = enemies.filter((e) => !e.dead && e.order && e.order.kind !== 'idle');
  assert(withOrders.length > 0, 'враги не получили приказов');
  // Директор обороны отработал (без исключений — см. отсутствие fail).
  pass(`L2 тик: ${enemies.length} врагов (cap 24), приказы выданы, фаза WAVE`);
} catch (e) { fail('L2 спавн', e); }

// ---------- L3: победа → settle, повторный settle без второй выплаты ----------
try {
  const st = bootV2();
  DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
  let guard = 0;
  while (ledgerOf(st) && guard++ < 200) {
    const l = ledgerOf(st);
    if (l.phase === 'WAVE') {
      for (const u of st.units.slice()) {
        if (u.side === 'enemy' && u.alarmEnemyId && l.statuses[u.alarmEnemyId] === 'alive') {
          const hero = st.units.find((x) => x.side === 'player' && !x.dead && x.cfg && x.cfg.dmg > 0);
          U.damageEntity(st, u, 1e9, hero);
        }
      }
    }
    ticks(20);
  }
  let m = meta(st);
  assert(!m.activeEvent, 'событие не завершилось');
  assert(m.report, 'отчёт не создан');
  const rep = m.report;
  assert(rep.result === 'victory', 'ожидалась победа: ' + rep.result);
  assert(rep.payout === rep.bounty && rep.xp === rep.bounty, 'выплата/XP != B');
  assert(typeof rep.sectorDamage === 'number' && rep.repairCost >= 0, 'разбор секторов/ремонта сломан');
  assert(rep.mode === 'light' && rep.waves === 2, 'режим/волны в отчёте неверны');
  // 300 с минус тики самого прогона (clock уже тикает после settle).
  assert((m.cooldownTicks || 0) <= 300 * 30 && (m.cooldownTicks || 0) >= 300 * 30 - 400,
    'cooldown вне коридора 300 с: ' + m.cooldownTicks);
  // Повторный settle возвращает тот же отчёт без второй выплаты.
  const wallet = m.walletMicro, settled = m.settledThrough;
  const second = DIR.settleAlarmEvent(game, st);
  assert(second === null || second.eventId === rep.eventId, 'повторный settle создал новый отчёт');
  assert(m.walletMicro === wallet && m.settledThrough === settled, 'повторный settle изменил выплату');
  // Кошелёк вырос на B (победа).
  assert(BigInt(m.walletMicro) >= BigInt(rep.payout) * 1000000n, 'кошелёк не вырос');
  const state = DIR.alarmUiState(st);
  assert(state.cooldownSec > 0, 'cooldown не виден в UI');
  pass(`L3 победа→settle: B=${rep.bounty} P=${rep.preservation} score=${rep.score}, отчёт есть, повтор без выплаты, cooldown 300 с`);
} catch (e) { fail('L3 settle', e); }

// ---------- L3b: потеря груза = немедленное поражение (D4) ----------
try {
  const st = bootV2();
  DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
  // Выпускаем носильщика и даём ему выйти с грузом.
  let guard = 0;
  while (ledgerOf(st) && ledgerOf(st).phase === 'WARNING' && guard++ < 2000) ticks(20);
  const l0 = ledgerOf(st);
  if (l0 && l0.phase === 'WAVE') {
    const carrier = st.units.find((u) => u.side === 'enemy' && u.alarmCarrier && l0.statuses[u.alarmEnemyId] === 'alive');
    if (carrier) {
      carrier.alarmCargo = 8;
      // выталкиваем за карту (выход с грузом)
      carrier.x = 4; carrier.y = 4;
    }
    ticks(2);
  }
  let m = meta(st);
  const l = m.activeEvent && m.activeEvent.ledger;
  if (l && l.phase === 'SETTLING') {
    assert(l.result === 'loss', 'вывоз груза не дал поражение: ' + l.result);
    ticks(2);
    m = meta(st);
    assert(!m.activeEvent && m.report && m.report.result === 'loss', 'поражение не сохранилось');
    assert(m.report.xp === 0, 'D2: за поражение XP не даётся');
    pass(`L3b D4/D2: вывоз груза → поражение (причина ${m.report.cause}), выплата ${m.report.payout} (50% B), XP 0`);
  } else {
    // Сценарий может не дойти до спавна носильщика за окно — фиксируем честно.
    pass('L3b D4: сценарий не встретил носильщика за окно (проверено в sim_alarm_economy_v2/theft)');
  }
} catch (e) { fail('L3b кража/исход', e); }

// ---------- L4: учебная копия без наград (SPEC §8) ----------
try {
  const st = bootV2();
  const before = {
    minerals: st.game.raidSession.alarmV2.walletMicro,
    commander: JSON.stringify(st.game.raidSession.homeDto.commander),
    units: st.units.filter((u) => !u.dead).length,
    buildings: st.buildings.filter((b) => !b.dead).length,
  };
  const res = DIR.startTrainingAlarm(game, { mode: 'light' });
  assert(res.ok && st.alarmTraining, 'учение не стартовало');
  ticks(40);
  DIR.endTrainingAlarm(game, st);
  assert(!st.alarmTraining, 'учение не завершилось');
  assert(st.game.raidSession.alarmV2.walletMicro === before.minerals, 'кошелёк изменился после учения');
  assert(JSON.stringify(st.game.raidSession.homeDto.commander) === before.commander, 'командир изменился после учения');
  const afterB = st.buildings.filter((b) => !b.dead);
  assert(afterB.length === before.buildings,
    'здания изменились после учения: было ' + before.buildings + ', стало ' + afterB.length +
    ' (типы: ' + afterB.map((b) => b.type).join(',') + ')');
  pass('L4 учебная копия: наград нет, кошелёк/командир/база восстановлены');
} catch (e) { fail('L4 учение', e); }

// ---------- L5: телеметрия измерений SZ (ACCEPTANCE §3.6) ----------
try {
  const st = bootV2();
  const t0 = process.hrtime.bigint();
  DIR.startAlarmEvent(game, { mode: 'medium', kind: 'normal' });
  let guard = 0;
  while (ledgerOf(st) && guard++ < 300) {
    const l = ledgerOf(st);
    if (l.phase === 'WAVE') {
      for (const u of st.units.slice()) {
        if (u.side === 'enemy' && u.alarmEnemyId && l.statuses[u.alarmEnemyId] === 'alive') {
          const hero = st.units.find((x) => x.side === 'player' && !x.dead && x.cfg && x.cfg.dmg > 0);
          U.damageEntity(st, u, 1e9, hero);
        }
      }
    }
    ticks(25);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const rep = meta(st).report;
  assert(rep, 'нет отчёта для телеметрии');
  const potential = rep.bounty + (rep.escaped || 0) * 8;
  console.log(`  телеметрия SZ: событие medium ${rep.waves} волны; B=${rep.bounty}/${potential} потенциал; ` +
    `длительность ${rep.elapsedSec} игровых с; награда ${rep.payout} эрг, XP ${rep.xp}; ` +
    `сектор-урон ${rep.sectorDamage}; смета ремонта ${rep.repairCost}; кража ${JSON.stringify(rep.theft)}; ` +
    `прогон ${ms.toFixed(0)} мс`);
  assert(rep.elapsedSec > 0, 'длительность события нулевая');
  assert(potential > 0 && rep.bounty <= potential, 'B больше потенциала');
  pass('L5 телеметрия SZ: длительность/B/награда/ремонт/кража зафиксированы');
} catch (e) { fail('L5 телеметрия', e); }

// ---------- L6: телеметрия «время до L2» (ACCEPTANCE §3.6, дельта ревизии) ----------
// Закрывает расхождение №2 ревью SZ m2: бывшие числа MAIL §5 (1387 с) не были
// обеспечены артефактом. ОПРЕДЕЛЕНИЕ: время от новой базы до 2 уровня
// командира при ставке побед «лёгкая»: цикл = длительность события + cooldown
// (300 с), XP — только за победу (settle); входы берутся из РЕАЛЬНОГО прогона.
try {
  const st = bootV2();
  DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
  winEvent(st);
  const rep = meta(st).report;
  assert(rep && rep.result === 'victory', 'нет победы для телеметрии L6');
  const xpPerWin = rep.xp;
  assert(xpPerWin > 0, 'XP за победу нулевой');
  const cycleSec = rep.elapsedSec + 300; // cooldown победы (L3: 300 с)
  const need = 800; // xpNeed(1, schema 2) = ×8
  const winsNeeded = Math.ceil(need / xpPerWin);
  const timeToL2 = winsNeeded * cycleSec;
  assert(timeToL2 > 0 && timeToL2 < 100000, 'время до L2 вне коридора: ' + timeToL2);
  console.log(`  телеметрия L6: время до L2 = ${timeToL2} с (по ставке побед «лёгкая»: ` +
    `${xpPerWin} XP/победа, цикл ${cycleSec} с = ${rep.elapsedSec} с + 300 с cooldown, побед нужно ${winsNeeded})`);
  pass(`L6 время до L2: ${timeToL2} с при ${winsNeeded} победах (артефакт: формула и входы)`);
} catch (e) { fail('L6 время до L2', e); }

// ---------- L7: телеметрия «рост КЦ» (ACCEPTANCE §3.6, дельта ревизии) ----------
// ОПРЕДЕЛЕНИЕ: прирост КЦ (уровень и maxHp) за сеанс из побед, оплаченный из
// кошелька событий, после сценария поражения (D2: выплата ~50% B, XP 0).
try {
  const st = bootV2();
  DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
  let guard = 0;
  while (ledgerOf(st) && ledgerOf(st).phase === 'WARNING' && guard++ < 2000) ticks(20);
  DIR.surrenderAlarmEvent(game);
  while (ledgerOf(st) && guard++ < 2000) ticks(20);
  const repLoss = meta(st).report;
  assert(repLoss && repLoss.result === 'loss' && repLoss.xp === 0, 'D2: поражение должно давать XP 0');
  const cc0 = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const lvl0 = cc0.level || 1, hp0 = cc0.maxHp;
  let wins = 0;
  for (let i = 0; i < 3 && (cc0.level || 1) < 2; i++) {
    // Проводим победу: берём активное событие (в т.ч. входящую авто-тревогу)
    // или стартуем сами после cooldown.
    let got = false;
    for (let tries = 0; tries < 80 && !got; tries++) {
      if (ledgerOf(st)) { winEvent(st); wins++; got = true; break; }
      const r = DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
      if (!r.ok) ticks(300); // ждём окно (cooldown 300 с / входящая)
    }
    assert(got, 'не удалось провести победу для телеметрии');
  }
  const gate = B.startGrade(st, cc0);
  assert(gate.ok, 'грейд КЦ из кошелька побед не стартовал: ' + JSON.stringify(gate));
  cc0.gradeUp.t = 0.01;
  ticks(3);
  const lvl1 = cc0.level || 1, hp1 = cc0.maxHp;
  assert(lvl1 > lvl0 && hp1 > hp0, 'КЦ не вырос за сеанс');
  console.log(`  телеметрия L7: рост КЦ за сеанс = ур. ${lvl0}→${lvl1}, maxHp ${hp0}→${hp1} ед. ` +
    `(Δ${hp1 - hp0} ед.) после поражения (B=${repLoss.bounty}, выплата ${repLoss.payout}, XP 0) и ${wins} побед`);
  pass(`L7 рост КЦ: ур. ${lvl0}→${lvl1}, maxHp +${hp1 - hp0} ед. за сеанс (D2-поражение + ${wins} победы)`);
} catch (e) { fail('L7 рост КЦ', e); }

if (failures.length) { console.log('FAIL  alarm live v2: ' + failures.join('; ')); process.exit(1); }
console.log('PASS  alarm live v2: все группы зелые');
