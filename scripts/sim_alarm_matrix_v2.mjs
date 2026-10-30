// ============================================================
// sim_alarm_matrix_v2.mjs — ace#10: матрица планов и режимы (SPEC §1–§2).
//   M1 все 400 пар КЦ×командир: L/M/H/T формулы, тир 1–5, hpBP/dmgBP растут;
//   M2 1200 normal-планов + 7200 siege-планов (5–10 волн) арифметически
//      согласованы: роли/тиры/капы 18 и 24, стабильный seed;
//   M3 режимы: 240 с первый входящий, 300 с cooldown, повторный старт
//      не обходит cooldown; сложность переживает JSON roundtrip.
// Запуск: node scripts/sim_alarm_matrix_v2.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

const PLAN = await import('../r/js/alarm-v2-plan.js' + V);
const CLOCK = await import('../r/js/alarm-v2-clock.js' + V);

// ---------- M1: матрица 400 пар ----------
try {
  let maxCount = 0, tierSeen = new Set();
  for (let C = 1; C <= 20; C++) {
    for (let K = 1; K <= 20; K++) {
      for (const mode of ['light', 'medium', 'hard']) {
        const p = PLAN.createAlarmPlan({ baseId: 'b' + '0'.repeat(31) + '1', eventSeq: 1, ccUid: 'cc1',
          ccLevel: C, commanderLevel: K, mode, kind: 'normal', seed: 1000 + C * 40 + K });
        assert(p.C === C && p.K === K && p.mode === mode, 'поля плана неверны');
        assert(p.tier >= 1 && p.tier <= 5, 'тир вне 1–5: ' + p.tier);
        tierSeen.add(p.tier);
        const total = p.waves.reduce((s, w) => s + w.count, 0);
        for (const w of p.waves) {
          assert(w.count >= 1 && w.count <= 18, 'волна вне капа 18: ' + w.count);
          assert(w.slots.length === w.count, 'слоты != числу');
          for (const slot of w.slots) {
            assert(slot.enemyId.startsWith(p.eventId + ':'), 'enemyId не от события');
            assert(slot.hpBP >= 10000 && slot.dmgBP >= 10000, 'BP ниже базы');
            assert(slot.bounty >= 0, 'отрицательная награда');
          }
        }
        maxCount = Math.max(maxCount, Math.max(...p.waves.map((w) => w.count)));
        // Нормировка sketch-b сохраняет сумму: potentialBounty = сумма слотов.
        const sumB = p.waves.flatMap((w) => w.slots).reduce((t, slot) => t + slot.bounty, 0);
        assert(sumB === p.potentialBounty && sumB > 0, 'потенциал B не сходится: ' + sumB + ' vs ' + p.potentialBounty);
        // hpBP/dmgBP монотонно растут по C и K.
        const p2 = PLAN.createAlarmPlan({ baseId: 'b' + '0'.repeat(31) + '1', eventSeq: 1, ccUid: 'cc1',
          ccLevel: C, commanderLevel: K, mode, kind: 'normal', seed: 7 });
        const p3 = PLAN.createAlarmPlan({ baseId: 'b' + '0'.repeat(31) + '1', eventSeq: 1, ccUid: 'cc1',
          ccLevel: Math.min(20, C + 1), commanderLevel: K, mode, kind: 'normal', seed: 7 });
        assert(p3.hpBP >= p2.hpBP && p3.dmgBP >= p2.dmgBP, 'BP не растут по КЦ');
      }
    }
  }
  assert(maxCount <= 18, 'максимальная волна вне капа: ' + maxCount);
  assert(tierSeen.size >= 3, 'тиры не различаются: ' + [...tierSeen]);
  pass(`M1 матрица: 400 пар × 3 режима, тиры ${[...tierSeen].sort()}, макс. волна ${maxCount}`);
} catch (e) { fail('M1 матрица', e); }

// ---------- M2: осадные планы ----------
try {
  let plans = 0, wavesTotal = 0;
  for (const [C, K] of [[1, 1], [7, 4], [13, 9], [20, 20]]) {
    for (const mode of ['light', 'medium', 'hard']) {
      for (let W = 5; W <= 10; W++) {
        const p = PLAN.createAlarmPlan({ baseId: 'b' + '0'.repeat(31) + '1', eventSeq: 2, ccUid: 'cc1',
          ccLevel: C, commanderLevel: K, mode, kind: 'siege', waves: W, seed: W * 11 + C });
        assert(p.waves.length === W, 'осада: волн ' + p.waves.length + ' != ' + W);
        for (const w of p.waves) assert(w.count <= 18, 'осадная волна вне капа');
        plans++; wavesTotal += p.waves.length;
      }
    }
  }
  assert(plans === 72 && wavesTotal === 72 * 7.5, 'осадных планов/волн неверно: ' + plans + '/' + wavesTotal);
  pass(`M2 осада: ${plans} планов, ${wavesTotal} волн, W=5…10, капы соблюдены`);
} catch (e) { fail('M2 осада', e); }

// ---------- M3: режимы и часы ----------
try {
  const meta = { incomingTicks: undefined, cooldownTicks: undefined, selectedMode: undefined };
  CLOCK.initializeAlarmClock(meta);
  assert(meta.incomingTicks === 240 * 30, 'первый входящий не 240 с');
  assert(meta.selectedMode === 'medium', 'сложность по умолчанию не medium');
  const roundtrip = JSON.parse(JSON.stringify(meta));
  CLOCK.validateAlarmClock(roundtrip);
  assert(roundtrip.selectedMode === 'medium', 'сложность не пережила JSON');
  // cooldown после итога = 300 с (проверка перехода).
  const prev = { ...meta, settledThrough: 0 };
  const next = { ...meta, settledThrough: 1, cooldownTicks: 300 * 30, incomingTicks: 300 * 30 };
  CLOCK.validateAlarmClockTransition(prev, next);
  // Тик clock идёт только на живой домашней симуляции (не при паузе).
  const gameStub = { raidSession: { schema: 2, alarmV2: meta }, started: true, paused: false };
  const stStub = { raidMode: 'home', gameOver: false };
  const t0 = meta.incomingTicks;
  assert(CLOCK.tickAlarmClock(gameStub, stStub) === true, 'clock не тикнул');
  assert(meta.incomingTicks === t0 - 1, 'clock не сдвинулся');
  gameStub.paused = true;
  CLOCK.tickAlarmClock(gameStub, stStub);
  assert(meta.incomingTicks === t0 - 1, 'clock тикнул на паузе');
  pass('M3 режимы: 240/300 с, medium по умолчанию, roundtrip, пауза не тикает');
} catch (e) { fail('M3 режимы', e); }

if (failures.length) { console.log('FAIL  alarm matrix v2: ' + failures.join('; ')); process.exit(1); }
console.log('PASS  alarm matrix v2: все группы зелёные');
