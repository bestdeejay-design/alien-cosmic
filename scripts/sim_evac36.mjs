// ============================================================
// sim_evac36.mjs — issue #36 (маркер EVAC-CARGO-BUGS-1026):
//   З1 · эвакуация не дедлочится (отсек = на борту, взлёт по второму нажиму);
//   З2 · трюм полон → сборщики встают у челнока и ждут (u.evacWait);
//   З3 · консоль: только доступные тиры + честный трюм (проверяется в E9).
//
// Сценарии (репро SZ BUG-1a/1b/2 + новые поведения):
//   G1  BUG-1b: весь отряд в отсеке Дома → press1 флешит гарнизон в манифест,
//       авто-взлёт срабатывает, вылазка возвращается на базу (раньше дедлок);
//   G2  press1+press2 с гарнизоном → немедленный взлёт, борт = весь отряд;
//   G3  BUG-1a: полевой в кольце с приказом добычи теряет приказ при press1
//       (и тот, что снаружи, тоже едет к площадке, а не бурит);
//   G4  press2 при boarded=0, но отряд уже в кольце → мгновенная посадка + взлёт;
//   G5  отряд далеко: press2 = «финальный сбор», press3 = взлёт (дедлока нет);
//   G6  BUG-2: трюм полон → рабочий бросает добычу, едет к площадке, u.evacWait,
//       жила больше не убывает, тост ровно один раз;
//   G7  авто-логика не выдёргивает ожидающего, явный приказ игрока — снимает флаг;
//   G8  трюм меньше одного рейса (cap - trip <= 0) → добычи нет вовсе.
//
// Запуск: node scripts/sim_evac36.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

await import('../r/js/game.js');
const U = await import('../r/js/units.js' + V);
const B = await import('../r/js/buildings.js' + V);
const cfg = await import('../r/js/config.js' + V);

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };
const TILE = cfg.TILE;

// Вылазка с Домом заданного грейда и отрядом (как в sim_raid_field).
function launch(tier = 1, roster = { worker: 2, marine: 2 }, houseLv = 5) {
  game.startRaidHome('human', { forceNew: true });
  ticks(4);
  const st = game.state;
  st.minerals.player = 100000;
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const depot = new B.Building(st, 'player', 'depot', cc.tx + 2, cc.ty + 2, true);
  depot.level = houseLv;
  depot.maxHp = depot.hp = Math.round(depot.cfg.hp * 2);
  st.map.markBuilding(depot);
  st.bcount.player++;
  for (const [type, n] of Object.entries(roster)) {
    for (let i = 0; i < n; i++) U.spawnUnit(st, 'player', type, cc.x + 90 + i * 26, cc.y + 90, false);
  }
  ticks(3);
  st.minerals.player = 100000;
  const res = game.launchRaidExpedition({ tier, seed: 4242, budget: 100, units: { ...roster } });
  assert(res && res.ok, 'вылазка не запустилась: ' + JSON.stringify(res));
  ticks(4);
  return game.state;
}

// Посадить юнита в отсек Дома ровно так, как это делает updateGarrison.
function intoBay(st, u) {
  const hb = st.raidHouse;
  u.order = { kind: 'idle' };
  u.garrison = hb;
  u.hidden = true;
  u.selected = false;
  u.path = null;
  hb.garrison.push(u);
}

const fieldOf = (st) => U.fieldUnits(st);
const oreTotal = (st) => [...(st.map.crystals || [])].reduce((a, c) => a + (c.amount || 0), 0);

// ---------- G1: BUG-1b — весь отряд в отсеке → взлёт достижим ----------
try {
  const st = launch();
  const field = fieldOf(st);
  assert(field.length >= 2, 'на вылазке слишком мало полевых');
  const sent = st.raidInitialCount;
  for (const u of field) intoBay(st, u);
  assert(fieldOf(st).length === 0, 'после погрузки остались полевые');
  assert(st.raidHouse.garrison.length === sent, 'в отсеке не весь отряд: ' + st.raidHouse.garrison.length + '/' + sent);
  ticks(2);
  assert(game.state.raidMode === 'expedition', 'отряд в отсеке посчитали погибшим до эвакуации');
  game.triggerRaidEvac();                      // press 1
  assert(st.raidEvacuating === true, 'эвакуация не включилась');
  assert((st.raidBoarded || []).length === sent,
    'press1 не флешнул отсек в манифест: ' + (st.raidBoarded || []).length + '/' + sent);
  assert(st.evacuated === sent, 'юниты отсека остались «в поле»: ' + st.evacuated);
  ticks(3);                                    // авто-взлёт в updateRaidTick
  const lr = game.raidSession && game.raidSession.lastReturn;
  assert(game.state.raidMode === 'home', 'после авто-взлёта не вернулись на базу: ' + game.state.raidMode);
  assert(lr && lr.outcome === 'evac', 'исход не evac: ' + JSON.stringify(lr));
  assert(lr.boardedCount === sent, 'на борт вернулось ' + lr.boardedCount + ' из ' + sent);
  pass(`G1 BUG-1b: отсек = на борту — press1 флешит ${sent} юнитов, авто-взлёт вернул отряд`);
} catch (e) { fail('G1 отсек = на борту', e); }

// ---------- G2: press1 + press2 с гарнизоном — взлёт, а не отмена ----------
try {
  const st = launch();
  const sent = st.raidInitialCount;
  for (const u of fieldOf(st)) intoBay(st, u);
  game.triggerRaidEvac();                      // press 1 — маяк + флеш отсека
  assert((st.raidBoarded || []).length === sent, 'press1 не флешнул отсек');
  game.triggerRaidEvac();                      // press 2 — должен быть взлёт
  const lr = game.raidSession && game.raidSession.lastReturn;
  assert(game.state.raidMode === 'home', 'press2 не поднял челнок (остались в ' + game.state.raidMode + ')');
  assert(lr && lr.outcome === 'evac' && lr.boardedCount === sent,
    'press2 дал не взлёт: ' + JSON.stringify(lr));
  pass(`G2 press2 при полном отсеке = взлёт (${sent}/${sent}), отмены-дедлока нет`);
} catch (e) { fail('G2 press2 = взлёт', e); }

// ---------- G3: BUG-1a — приказ добычи снимается у ВСЕХ полевых ----------
try {
  const st = launch();
  const pad = st.raidDrop;
  const workers = fieldOf(st).filter((u) => u.cfg.canMine);
  assert(workers.length >= 2, 'нужно два сборщика');
  const crystal = (st.map.crystals || [])[0] || null;
  const [inside, outside] = workers;
  // Один — в кольце с приказом добычи, второй — далеко с тем же приказом.
  inside.x = pad.x + TILE * 0.5; inside.y = pad.y + TILE * 0.5;
  inside.order = { kind: 'gather', target: crystal, phase: 'toMineral' };
  outside.x = pad.x + TILE * 12; outside.y = pad.y + TILE * 12;
  outside.order = { kind: 'gather', target: crystal, phase: 'toMineral' };
  const d0 = Math.hypot(outside.x - pad.x, outside.y - pad.y);
  game.triggerRaidEvac();
  assert(inside.order.kind !== 'gather', 'стоящий в кольце сохранил приказ добычи: ' + inside.order.kind);
  assert(outside.order.kind !== 'gather', 'идущий снаружи сохранил приказ добычи: ' + outside.order.kind);
  assert(inside.evacHold === true, 'стоящий в кольце не помечен как «держится у площадки»');
  ticks(120);
  const d1 = Math.hypot(outside.x - pad.x, outside.y - pad.y);
  assert(d1 < d0 - TILE, `внешний сборщик не пошёл к площадке: ${(d0 / TILE).toFixed(1)} → ${(d1 / TILE).toFixed(1)} тайла`);
  pass('G3 BUG-1a: press1 снимает добычу у всех полевых и ведёт их к площадке');
} catch (e) { fail('G3 сброс приказов', e); }

// ---------- G4: press2 при boarded=0, отряд в кольце → посадка + взлёт ----------
try {
  const st = launch();
  const pad = st.raidDrop;
  const sent = st.raidInitialCount;
  for (const u of fieldOf(st)) { u.x = pad.x + TILE * 0.4; u.y = pad.y + TILE * 0.4; u.evacT = 0; }
  game.triggerRaidEvac();                      // press 1 — удержание 2 с не прошло
  assert((st.raidBoarded || []).length === 0, 'до удержания никто не должен быть на борту');
  game.triggerRaidEvac();                      // press 2 — посадка без ожидания + взлёт
  const lr = game.raidSession && game.raidSession.lastReturn;
  assert(game.state.raidMode === 'home', 'press2 не взлетел');
  assert(lr && lr.outcome === 'evac' && lr.boardedCount === sent,
    'press2 не посадил отряд из кольца: ' + JSON.stringify(lr));
  pass(`G4 press2 сажает стоящих в кольце без удержания и взлетает (${sent}/${sent})`);
} catch (e) { fail('G4 press2 посадка из кольца', e); }

// ---------- G5: отряд далеко — финальный сбор, затем взлёт ----------
try {
  const st = launch();
  const pad = st.raidDrop;
  const sent = st.raidInitialCount;
  for (const [i, u] of fieldOf(st).entries()) {
    u.x = pad.x + TILE * (14 + i); u.y = pad.y + TILE * 14;
    u.evacT = 0;
  }
  game.triggerRaidEvac();                      // press 1 — маяк
  game.triggerRaidEvac();                      // press 2 — финальный сбор
  assert(game.state.raidMode === 'expedition', 'press2 при опоздавших не должен молча бросать отряд');
  assert(st.evacFinal === true, 'не включился финальный сбор');
  assert(st.raidEvacuating === true, 'эвакуация слетела (это была бы отмена-дедлок)');
  game.triggerRaidEvac();                      // press 3 — взлёт
  const lr = game.raidSession && game.raidSession.lastReturn;
  assert(game.state.raidMode === 'home', 'press3 не взлетел');
  assert(lr && lr.outcome === 'evac', 'press3 дал не взлёт: ' + JSON.stringify(lr));
  assert(lr.sentCount === sent, 'в отчёте не то число отправленных: ' + lr.sentCount);
  pass(`G5 опоздавшие: press2 = финальный сбор, press3 = взлёт (${lr.boardedCount}/${sent} на борту)`);
} catch (e) { fail('G5 финальный сбор', e); }

// ---------- G6: BUG-2 — полный трюм останавливает добычу ----------
try {
  const st = launch(1, { worker: 3, marine: 1 }, 5);
  const cap = st.raidCargoCap;
  assert(cap > 0, 'нет ёмкости трюма');
  st.raidCargo = cap;                          // полный трюм
  const pad = st.raidDrop;
  ticks(240);                                  // 8 c логики: донести остаток и встать
  const workers = fieldOf(st).filter((u) => u.cfg.canMine && u.type === 'worker');
  assert(workers.length >= 2, 'на вылазке нет сборщиков: ' + workers.length);
  const waiting = workers.filter((u) => u.evacWait === true);
  assert(waiting.length === workers.length,
    'не все сборщики встали в ожидание: ' + waiting.length + '/' + workers.length +
    ' фазы ' + JSON.stringify(workers.map((u) => (u.order && u.order.kind) || '?')));
  const minedBefore = st.stats.mined;
  const oreBefore = oreTotal(st);
  ticks(240);
  assert(st.stats.mined === minedBefore,
    'добыча продолжилась при полном трюме: ' + minedBefore + ' → ' + st.stats.mined);
  assert(oreTotal(st) === oreBefore, 'эрг вынимался из жил при полном трюме: ' + oreBefore + ' → ' + oreTotal(st));
  assert(st.evacWaitToasted === true, 'игроку не сказали, что отряд ждёт эвакуации');
  const radPx = Math.max(TILE * 2.2, pad.r * TILE);
  const far = workers.filter((u) => Math.hypot(u.x - pad.x, u.y - pad.y) > radPx * 1.6);
  assert(!far.length, 'ожидающие не собрались у челнока: ' + far.length + ' далеко');
  pass(`G6 BUG-2: трюм ${cap}/${cap} → ${workers.length} сборщика встали у челнока, добыча остановлена, тост один`);
} catch (e) { fail('G6 стоп по трюму', e); }

// ---------- G7: авто-логика не выдёргивает; приказ игрока снимает флаг ----------
try {
  const st = launch(1, { worker: 2, marine: 1 }, 5);
  st.raidCargo = st.raidCargoCap;
  ticks(240);
  const w = fieldOf(st).find((u) => u.cfg.canMine && u.evacWait);
  assert(w, 'нет ожидающего сборщика для проверки');
  const crystal = (st.map.crystals || [])[0] || null;
  // Авто-возврат к добыче (внутренний путь диспетчера ремонта) не срабатывает.
  U.orderGather(st, w, crystal);
  assert(w.order.kind !== 'gather' && w.evacWait, 'авто-приказ добычи перебил ожидание эвакуации');
  // Явный приказ игрока: флаг снимается, рабочий снова может добывать.
  U.clearEvacFlags([w]);
  assert(!w.evacWait, 'явный приказ игрока не снял флаг evacWait');
  st.raidCargo = 0;                            // трюм освободили — проверяем сам приказ
  U.orderGather(st, w, crystal);
  assert(w.order.kind === 'gather', 'после приказа игрока рабочий не начал добычу: ' + w.order.kind);
  pass('G7 авто-логика не трогает ожидающего; приказ игрока снимает u.evacWait');
} catch (e) { fail('G7 приказы и ожидание', e); }

// ---------- G8: трюм меньше одного рейса — добычи нет ----------
try {
  const st = launch(1, { worker: 2, marine: 1 }, 5);
  const trip = st.raidTripYield;
  st.raidCargoCap = Math.max(1, trip - 1);     // cap - trip <= 0
  st.raidCargo = 0;
  const mined0 = st.stats.mined;
  ticks(300);
  const workers = fieldOf(st).filter((u) => u.cfg.canMine);
  assert(workers.every((u) => u.evacWait), 'при «трюм меньше рейса» рабочие продолжают бурить');
  assert(st.stats.mined === mined0, 'добыча шла в трюм, который не примет и рейс: ' + mined0 + ' → ' + st.stats.mined);
  pass('G8 cap < рейс: сборщики не бурят вовсе и ждут у челнока');
} catch (e) { fail('G8 трюм меньше рейса', e); }

// ---------- Итог ----------
if (failures.length) {
  console.log(`\n❌ SIM_EVAC36: провалено ${failures.length}: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n✅ SIM_EVAC36: эвакуация без дедлока, трюм останавливает добычу');
process.exit(0);
