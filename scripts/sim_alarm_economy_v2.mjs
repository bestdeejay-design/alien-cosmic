// ============================================================
// sim_alarm_economy_v2.mjs — ace#10: экономика события (ECONOMY §2–§3).
//   E1 B/исход: победа wallet+=B, XP+=B (D2); поражение wallet+=B/2, XP=0;
//      очки P=floor(B*(1-D)/4), score=B+P;
//   E2 структурный инвариант: ЕДИНСТВЕННЫЙ runtime-вход нового XP — settle
//      (prepareAlarmXpAward вызывается ровно из prepareAlarmSettlement);
//      намеренная мутация (второй вызов) ломается grep-инвариантом;
//   E3 уникальные смерти: один enemyId — не более одной записи B;
//   E4 баланс режимов (условие GO 28.10): XP/ч режимов в коридоре ±25%
//      по измерениям MEASUREMENTS — телеметрия фиксируется симом.
// Запуск: node scripts/sim_alarm_economy_v2.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLAN = await import('../r/js/alarm-v2-plan.js' + V);
const MIG = await import('../r/js/alarm-v2-migration.js' + V);
const EVT = await import('../r/js/alarm-v2-event.js' + V);
const THEFT = await import('../r/js/alarm-v2-theft.js' + V);

// Доводка ledger до фазы WAVE штатными тиками ядра (recordDeath работает в WAVE).
function toWave(ledger) {
  let guard = 0;
  while (ledger.phase === 'WARNING' && guard++ < 20000) PLAN.tickAlarm(ledger);
  while (ledger.phase === 'BREAK' && guard++ < 20000) PLAN.tickAlarm(ledger);
  assert(ledger.phase === 'WAVE', 'ledger не дошёл до WAVE: ' + ledger.phase);
}
// Прогон всех волн до победы: убийство всех слотов волны → завершение → следующая.
function runToVictory(ledger) {
  let guard = 0;
  while (ledger.phase !== 'SETTLING' && guard++ < 50) {
    toWave(ledger);
    for (const slot of ledger.plan.waves[ledger.waveIndex].slots) {
      ledger.statuses[slot.enemyId] = 'alive';
      PLAN.recordDeath(ledger, slot.enemyId, true);
    }
    PLAN.finishAlarmTick(ledger, true);
  }
  assert(ledger.phase === 'SETTLING', 'событие не завершилось: ' + ledger.phase);
}

// Мини-сессия v2 для чистых проверок ядра (без игрового мира).
function miniSession() {
  return {
    schema: 2, schemaVersion: 1, raidSeq: 0, starterGiftClaimed: true,
    faction: 'human',
    alarmV2: {
      schema: 2, revision: 0, baseId: 'b' + '0'.repeat(31) + '1',
      nextEntitySeq: 1, nextEventSeq: 1, settledThrough: 0,
      walletMicro: '0', reports: [],
      incomingTicks: 240 * 30, cooldownTicks: 0, selectedMode: 'medium',
    },
    homeDto: { capturedAt: 0, minerals: 0, buildings: [], units: [], crystals: [], commander: null },
  };
}

// ---------- E1: победа/поражение по D2 ----------
try {
  const s = miniSession();
  s.homeDto.commander = MIG.migrateAlarmCommander(null);
  const ccUid = 'b' + '0'.repeat(31) + '1:b:1';
  s.homeDto.buildings = [{ entityId: ccUid, type: 'cc', done: true, hpMicro: '1500000000', maxHpMicro: '1500000000', tx: 4, ty: 4, w: 4, h: 3, level: 1 }];
  s.homeDto.commander.level = 1;
  EVT.beginAlarmCandidate(s, { ccUid, mode: 'light', kind: 'normal', seed: 7 });
  const active = s.alarmV2.activeEvent;
  const ledger = active.ledger;
  // Убиваем всех врагов всех волн с зачётом игрока (штатные тики ядра).
  runToVictory(ledger);
  assert(ledger.result === 'victory', 'волна не завершилась победой');
  const expectedB = ledger.plan.waves.flatMap((w) => w.slots).reduce((sum, slot) => sum + slot.bounty, 0);
  assert(ledger.bounty === expectedB, `B=${ledger.bounty} != ${expectedB}`);
  const { outcome } = EVT.prepareAlarmSettlement(s, ledger.plan.eventId);
  assert(outcome.payout === outcome.bounty, 'победа: выплата != B');
  assert(outcome.xp === outcome.bounty, 'победа: XP != B');
  assert(outcome.score === outcome.bounty + outcome.preservation, 'score != B+P');
  const xpMicro = BigInt(s.homeDto.commander.xpMicro);
  assert(xpMicro === BigInt(outcome.xp) * 1000000n, 'XP командира не применился');
  const wallet = BigInt(s.alarmV2.walletMicro);
  assert(wallet === BigInt(outcome.payout) * 1000000n, 'кошелёк не применился');
  pass(`E1 победа: B=${outcome.bounty}, P=${outcome.preservation}, score=${outcome.score}, XP=+${outcome.xp}`);

  // Поражение (сдача): D2 — 50% B, 0 XP.
  const s2 = miniSession();
  s2.homeDto.commander = MIG.migrateAlarmCommander(null);
  s2.homeDto.buildings = [{ entityId: ccUid, type: 'cc', done: true, hpMicro: '1500000000', maxHpMicro: '1500000000', tx: 4, ty: 4, w: 4, h: 3, level: 1 }];
  EVT.beginAlarmCandidate(s2, { ccUid, mode: 'medium', kind: 'normal', seed: 9 });
  const a2 = s2.alarmV2.activeEvent;
  const l2 = a2.ledger;
  toWave(l2);
  const w2 = l2.plan.waves[0];
  for (const slot of w2.slots.slice(0, 5)) {
    l2.statuses[slot.enemyId] = 'alive';
    PLAN.recordDeath(l2, slot.enemyId, true);
  }
  PLAN.surrenderAlarm(l2);
  assert(l2.result === 'loss' && l2.cause === 'surrender', 'сдача не зафиксирована');
  const r2 = EVT.prepareAlarmSettlement(s2, l2.plan.eventId);
  assert(r2.outcome.xp === 0, 'D2: при поражении XP должен быть 0');
  assert(r2.outcome.payout === Math.floor(r2.outcome.bounty / 2), 'D2: выплата != floor(B/2)');
  assert(BigInt(s2.homeDto.commander.xpMicro) === 0n, 'D2: командир получил XP за поражение');
  pass(`E1 поражение (D2): B=${r2.outcome.bounty}, выплата=${r2.outcome.payout} (50%), XP=0`);
} catch (e) { fail('E1 исходы D2', e); }

// ---------- E2: единственный runtime-вход XP ----------
try {
  const eventSrc = readFileSync(path.join(ROOT, 'r/js/alarm-v2-event.js'), 'utf8');
  const migSrc = readFileSync(path.join(ROOT, 'r/js/alarm-v2-migration.js'), 'utf8');
  const calls = [...eventSrc.matchAll(/prepareAlarmXpAward\s*\(/g)].length;
  assert(calls === 1, 'prepareAlarmXpAward должен вызываться ровно 1 раз в event.js: ' + calls);
  // Мутация: добавление второго вызова должно ломаться проверкой.
  const mutated = eventSrc.replace('prepareAlarmXpAward', 'prepareAlarmXpAward').replace(/(\n.*?prepareAlarmXpAward.*?\n)/, '$1  prepareAlarmXpAward(commander, "0"); // MUTATION\n');
  const mutCalls = [...mutated.matchAll(/prepareAlarmXpAward\s*\(/g)].length;
  assert(mutCalls > calls, 'мутация не добавила второй вызов — инвариант нечувствителен');
  // Прямая запись XP мимо award запрещена (только legacy-тень xp=).
  const direct = [...eventSrc.matchAll(/commander\.xp\s*=[^=]/g)].length;
  assert(direct === 0, 'event.js пишет commander.xp напрямую');
  // addXp на v2 — no-op (проверено в sim_commander); здесь — структура migration.
  assert(/export function prepareAlarmXpAward/.test(migSrc), 'нет prepareAlarmXpAward');

  // К-1 (ревизия SZ m2): инвариант на ВЕСЬ r/js — каждый call-site addXp(
  // обязан попадать в явный whitelist барьеров:
  //   commander.js — сам барьер: addXp no-op на v2-командире (гейт C1(v2));
  //   home-raid.js — legacy-волны: на v2 не тикают (game.js переключает на
  //     updateAlarmHome при session.schema === 2), двойной барьер;
  //   game.js — XP возврата вылазки: no-op через v2-командира.
  // Новый источник XP обязан пройти через settle (prepareAlarmXpAward).
  const { readdirSync } = await import('node:fs');
  const allowed = new Set(['commander.js', 'home-raid.js', 'game.js']);
  const offenders = [];
  for (const f of readdirSync(path.join(ROOT, 'r/js')).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(path.join(ROOT, 'r/js', f), 'utf8');
    const n = [...src.matchAll(/\baddXp\s*\(/g)].length
      - [...src.matchAll(/(?:function|export function)\s+addXp\s*\(/g)].length;
    if (n > 0 && !allowed.has(f)) offenders.push(f + ':' + n);
  }
  assert(offenders.length === 0, 'addXp вне whitelist барьеров: ' + offenders.join(', '));
  // Не-вакуальность: врезка чужого call-site'а в КОПИЮ units.js ловится
  // тем же детектором (units.js не в whitelist — появление addXp = RED).
  const unitsSrc = readFileSync(path.join(ROOT, 'r/js/units.js'), 'utf8');
  const mutatedUnits = unitsSrc.replace(/\n/, '\nlet __st0; addXp(__st0, 1); // MUTATION\n');
  const mutN = [...mutatedUnits.matchAll(/\baddXp\s*\(/g)].length
    - [...mutatedUnits.matchAll(/(?:function|export function)\s+addXp\s*\(/g)].length;
  assert(mutN === 1, 'мутация addXp в units.js не обнаружена — инвариант нечувствителен');
  pass('E2 единственный XP-вход: ровно 1 call-site в settle, addXp по r/js за барьерами (К-1), мутации ловятся');
} catch (e) { fail('E2 инвариант XP', e); }

// ---------- E3: уникальные смерти ----------
try {
  const s = miniSession();
  s.homeDto.commander = MIG.migrateAlarmCommander(null);
  const ccUid = 'b' + '0'.repeat(31) + '1:b:1';
  s.homeDto.buildings = [{ entityId: ccUid, type: 'cc', done: true, hpMicro: '1000000000', maxHpMicro: '1000000000', tx: 4, ty: 4, w: 4, h: 3, level: 1 }];
  EVT.beginAlarmCandidate(s, { ccUid, mode: 'hard', kind: 'normal', seed: 3 });
  const l = s.alarmV2.activeEvent.ledger;
  toWave(l);
  const slot = l.plan.waves[0].slots[0];
  l.statuses[slot.enemyId] = 'alive';
  assert(PLAN.recordDeath(l, slot.enemyId, true) === true, 'первая смерть не засчитана');
  assert(PLAN.recordDeath(l, slot.enemyId, true) === false, 'двойная смерть засчитана повторно');
  assert(PLAN.recordDeath(l, slot.enemyId + ':fake', true) === false, 'неизвестный enemyId засчитан');
  assert(l.creditedKills === 1, 'creditedKills != 1: ' + l.creditedKills);
  pass('E3 уникальные смерти: один enemyId — одна запись B');
} catch (e) { fail('E3 уникальность', e); }

// ---------- E4: телеметрия баланса режимов (условие GO: ±25%) ----------
try {
  // XP/ч = B*3600/(t+300) по измерениям стенда (MEASUREMENTS.md, C1/K1).
  // Балансировка sketch-b-v1 (applySketchBounty) должна держать режимы в
  // коридоре ±25% вокруг средней линии.
  const measured = { light: 289, medium: 604, hard: 1024, 'siege-5': 880, 'siege-10': 1716 };
  const modeOf = (mode, kind, waves, seed = 7) => {
    const s = miniSession();
    s.homeDto.commander = MIG.migrateAlarmCommander(null);
    const ccUid = 'b' + '0'.repeat(31) + '1:b:1';
    s.homeDto.buildings = [{ entityId: ccUid, type: 'cc', done: true, hpMicro: '1000000000', maxHpMicro: '1000000000', tx: 4, ty: 4, w: 4, h: 3, level: 1 }];
    EVT.beginAlarmCandidate(s, { ccUid, mode, kind, waves, seed });
    return s.alarmV2.activeEvent.ledger.plan.potentialBounty;
  };
  const b = {
    light: modeOf('light', 'normal'),
    medium: modeOf('medium', 'normal'),
    hard: modeOf('hard', 'normal'),
    'siege-5': modeOf('medium', 'siege', 5),
    'siege-10': modeOf('medium', 'siege', 10),
  };
  // SKETCH_NORMAL_C1 нормирует награды: light 58, medium 60, hard 61 при C1/K1.
  assert(Math.abs(b.light - 58) <= 2, 'лёгкая: цель эскиза B ≈58, получено ' + b.light);
  assert(Math.abs(b.medium - 60) <= 2, 'средняя: цель эскиза B ≈60, получено ' + b.medium);
  assert(Math.abs(b.hard - 61) <= 2, 'тяжёлая: цель эскиза B ≈61, получено ' + b.hard);
  assert(Math.abs(b['siege-5'] - 66) <= 3, 'осада-5: цель ≈66, получено ' + b['siege-5']);
  assert(Math.abs(b['siege-10'] - 83) <= 3, 'осада-10: цель ≈83, получено ' + b['siege-10']);
  // Телеметрия фактической нормы (в условных C1/K1 XP/ч): отношение наград
  // при измеренных длительностях (полный выигрыш).
  const xpPerH = (mode) => b[mode] * 3600 / (measuredDur(mode) + 300);
  const measuredDur = (mode) => ({ light: 48.5, medium: 57.7, hard: 65.8, 'siege-5': 92.5, 'siege-10': 186.7 })[mode];
  const rates = Object.keys(b).map((m) => xpPerH(m));
  const mean = rates.reduce((x, y) => x + y, 0) / rates.length;
  const spread = Math.max(...rates.map((r) => Math.abs(r / mean - 1)));
  // Условие GO: ±25%. До выравнивания spread был ~5.9× (289 vs 1716).
  assert(spread <= 0.25, `баланс режимов вне ±25%: разброс ${(spread * 100).toFixed(1)}%`);
  console.log('  телеметрия баланса (C1/K1, норма эскиза B): ' +
    Object.keys(b).map((m) => `${m}=${Math.round(xpPerH(m))}/ч`).join(' ') + `; разброс ${(spread * 100).toFixed(1)}%`);
  pass('E4 баланс режимов ±25%: норма эскиза B держит коридор');
} catch (e) { fail('E4 баланс', e); }

if (failures.length) { console.log('FAIL  alarm economy v2: ' + failures.join('; ')); process.exit(1); }
console.log('PASS  alarm economy v2: все группы зелёные');
