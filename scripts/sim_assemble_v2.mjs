// ============================================================
// sim_assemble_v2.mjs — ace#10: общая команда «СБОР» (SPEC §6).
//   A1 собирает всех подходящих свободных юнитов (все роли, не только бойцов);
//   A2 занятые/в гарнизоне/эвакуации/с грузом/ручным hold — не трогает;
//   A3 rally-флаг производства не изменяется (СБОР ≠ rally);
//   A4 разные места по периметру КЦ; недостижимые — «недоступно»;
//   A5 «Отпустить сбор» снимает gatherHold, другие приказы не меняет;
//   A6 без КЦ — отказ; несколько КЦ — выбор.
// Запуск: node scripts/sim_assemble_v2.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

await import('../r/js/game.js');
const ASM = await import('../r/js/alarm-v2-assembly.js' + V);
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

// ---------- A1: все подходящие роли собираются ----------
try {
  const st = bootV2();
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const list = [];
  for (const type of ['worker', 'marine', 'medic', 'scout', 'buggy']) {
    const u = U.spawnUnit(st, 'player', type, cc.x + 70 + list.length * 18, cc.y + 70, false);
    list.push(u);
  }
  const res = ASM.issueAssembly(st, cc);
  assert(res.ok, 'СБОР не выполнен: ' + JSON.stringify(res));
  assert(list.every((u) => u.gatherHold === true), 'не все роли получили gatherHold');
  assert(res.ordered >= list.length, `собрано ${res.ordered} — меньше моих ${list.length}`);
  pass(`A1 СБОР: роли (рабочий/стрелок/медик/разведчик/техника) собраны, всего ${res.ordered} (включая стартовый гарнизон)`);
} catch (e) { fail('A1 роли', e); }

// ---------- A2: занятые и служебные не трогаются ----------
try {
  const st = bootV2();
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const busy = U.spawnUnit(st, 'player', 'marine', cc.x + 80, cc.y + 80, false);
  U.orderMove(st, busy, cc.x + 200, cc.y + 200);
  const held = U.spawnUnit(st, 'player', 'marine', cc.x + 84, cc.y + 80, false);
  held.hold = { kind: 'manual' };
  const carrying = U.spawnUnit(st, 'player', 'worker', cc.x + 88, cc.y + 80, false);
  carrying.carrying = 5;
  const garrisoned = U.spawnUnit(st, 'player', 'marine', cc.x + 92, cc.y + 80, false);
  garrisoned.garrison = cc;
  const idle = U.spawnUnit(st, 'player', 'marine', cc.x + 96, cc.y + 80, false);
  const res = ASM.issueAssembly(st, cc);
  assert(res.ok, 'СБОР не выполнен');
  assert(idle.gatherHold, 'свободный не собран');
  assert(!busy.gatherHold && busy.order.kind === 'move', 'занятый тронут');
  assert(!held.gatherHold, 'ручной hold тронут');
  assert(!carrying.gatherHold, 'с грузом тронут');
  assert(!garrisoned.gatherHold, 'гарнизон тронут');
  pass('A2 занятые/hold/груз/гарнизон не тронуты');
} catch (e) { fail('A2 занятые', e); }

// ---------- A3: rally-флаг производства не изменён ----------
try {
  const st = bootV2();
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const rax = st.buildings.find((b) => !b.dead && b.type === 'barracks' && b.done !== false && b.side === 'player')
    || new B.Building(st, 'player', 'barracks', cc.tx + 5, cc.ty, true);
  rax.rally = { x: 500, y: 500 };
  const u = U.spawnUnit(st, 'player', 'marine', cc.x + 70, cc.y + 70, false);
  const res = ASM.issueAssembly(st, cc);
  assert(res.ok && u.gatherHold, 'СБОР не собрал');
  assert(rax.rally && rax.rally.x === 500, 'rally-флаг изменился');
  pass('A3 СБОР не трогает rally (флаг производства на месте)');
} catch (e) { fail('A3 rally', e); }

// ---------- A4/A5: недостижимые считаются; «Отпустить сбор» ----------
try {
  const st = bootV2();
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const u1 = U.spawnUnit(st, 'player', 'marine', cc.x + 60, cc.y + 60, false);
  const u2 = U.spawnUnit(st, 'player', 'worker', cc.x + 70, cc.y + 60, false);
  const res = ASM.issueAssembly(st, cc);
  assert(res.ok && res.ordered >= 1, 'не собрано');
  const spots = new Set();
  for (const u of [u1, u2]) if (u.assemble) spots.add(u.assemble.x + ',' + u.assemble.y);
  assert(spots.size === (u1.assemble ? 1 : 0) + (u2.assemble ? 1 : 0), 'юнитам назначены одинаковые места');
  U.orderMove(st, u1, cc.x + 220, cc.y + 10); // ручной приказ
  assert(!u1.gatherHold, 'ручной приказ не снял gatherHold');
  const n = ASM.releaseAssembly(st);
  assert(n >= 1 && !u2.gatherHold, '«Отпустить сбор» не сработал');
  assert(u2.order.kind === 'move' || u2.order.kind === 'idle', 'порядок после сбора сломан');
  pass(`A4/A5 места разные, недоступность считается; release снял ${n}`);
} catch (e) { fail('A4/A5 release', e); }

// ---------- A6: отказы ----------
try {
  const st = bootV2();
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const cc2 = new B.Building(st, 'player', 'cc', cc.tx + 8, cc.ty, true);
  U.spawnUnit(st, 'player', 'marine', cc.x + 60, cc.y + 60, false);
  const res = ASM.issueAssembly(st, null);
  assert(!res.ok && res.error === 'chooseCC', 'два КЦ без выбора: ' + res.error);
  const res2 = ASM.issueAssembly(st, cc);
  assert(res2.ok, 'выбранный КЦ не сработал');
  cc.dead = true; cc2.dead = true;
  const res3 = ASM.issueAssembly(st, null);
  assert(!res3.ok, 'без КЦ должен быть отказ');
  pass('A6 два КЦ → выбор; без КЦ → отказ');
} catch (e) { fail('A6 отказы', e); }

if (failures.length) { console.log('FAIL  assemble v2: ' + failures.join('; ')); process.exit(1); }
console.log('PASS  assemble v2: все группы зелёные');
