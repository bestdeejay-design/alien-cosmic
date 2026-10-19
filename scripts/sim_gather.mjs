// ============================================================
// sim_gather.mjs — пакет F.1: месторождения, лимит 2, цепочка выбора.
//
// G1 fields: все кристаллы в месторождениях (fieldId), групп ≥ 2.
// G2 chain-free: 5 на одном кристалле → 6-й уходит на свободный того же поля.
// G3 chain-marginal: все заняты по 2 → следующий встаёт третьим.
// G4 chain-fallback: все по 3 → выбор не null (наименее людный).
// G5 exhaust: исчерпание → перевыбор внутри своего поля.
// G6 rally: точка сбора на кристалле — новички сразу на тот же кристалл.
// G7 crystal-tip: тултип остатков в свежей партии + гашение (Б1).
//
// Запуск: node scripts/sim_gather.mjs
// ============================================================
import './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(c, msg) { if (!c) throw new Error(msg); }

await import('../js/game.js');
const cfg = await import('../js/config.js');
const ui = await import('../js/ui.js');
const U = await import('../js/units.js');
const B = await import('../js/buildings.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

function testMission(over = {}) {
  return {
    id: -1, faction: 'human',
    map: { seed: 424242, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } },
    ai: {}, defense: null,
    objective: 'Тестовая цель',
    ...over,
  };
}
function ticks(n) { for (let i = 0; i < n; i++) game.tick(); }
function paint() { game.render(1); ui.update(game); ui.drawMinimap(game); }
// Стартовые рабочие уже разобрали жилы — распускаем для точных подсчётов.
function clearPlayerWorkers(st) {
  for (const u of st.units) {
    if (u.side === 'player' && u.type === 'worker' && !u.dead) U.orderStop(u);
  }
}
// Занятость кристалла — та же производная, что в движке (ордера gather/build).
function crowdOf(st, c, self) {
  let n = 0;
  for (const w of st.units) {
    if (w === self || w.dead || w.side !== 'player' || w.type !== 'worker') continue;
    const o = w.order;
    if ((o.kind === 'gather' && o.target === c) || (o.kind === 'build' && o.resume === c)) n++;
  }
  return n;
}
function playerCc(st) { return st.buildings.find((b) => b.side === 'player' && b.type === 'cc'); }
function mainCrystal(st) {
  const cc = playerCc(st);
  let best = null, bd = Infinity;
  for (const c of st.map.crystals) {
    const d = Math.hypot(c.x - cc.x, c.y - cc.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// ---------- G1: месторождения ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  const cs = st.map.crystals;
  assert(cs.length > 0, 'кристаллов нет');
  for (const c of cs) assert(Number.isInteger(c.fieldId) && c.fieldId >= 1, 'кристалл без поля');
  const fields = new Map();
  for (const c of cs) fields.set(c.fieldId, (fields.get(c.fieldId) || 0) + 1);
  assert(fields.size >= 2, 'групп меньше двух: ' + fields.size);
  const main = mainCrystal(st);
  assert(fields.get(main.fieldId) >= 5, 'домашнее поле мелкое: ' + fields.get(main.fieldId));
  paint();
  pass(`G1 fields: ${cs.length} кр. в ${fields.size} полях, домашнее ${fields.get(main.fieldId)}`);
} catch (e) { fail('G1 fields', e); }

// ---------- G2: цепочка — свободный слот ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  clearPlayerWorkers(st);
  const cc = playerCc(st);
  const c0 = mainCrystal(st);
  for (let i = 0; i < 5; i++) {
    const w = U.spawnUnit(st, 'player', 'worker', cc.x + i * 3, cc.y, false);
    U.orderGather(st, w, c0);
  }
  assert(crowdOf(st, c0) === 5, 'стопка не встала: ' + crowdOf(st, c0));
  const w6 = U.spawnUnit(st, 'player', 'worker', cc.x, cc.y, false);
  const pick = U.nearestCrystal(st, w6);
  assert(pick && pick !== c0, '6-й встал на переполненный кристалл');
  assert(pick.fieldId === c0.fieldId, '6-й ушёл из домашнего поля');
  assert(crowdOf(st, pick, w6) < cfg.WORKERS_PER_CRYSTAL, '6-й встал на занятый: crowd=' + crowdOf(st, pick, w6));
  paint();
  pass('G2 chain-free: 6-й ушёл на свободный слот того же поля');
} catch (e) { fail('G2 chain-free', e); }

// ---------- G3: цепочка — маржинальный третий ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  clearPlayerWorkers(st);
  const cc = playerCc(st);
  for (const c of st.map.crystals) {
    for (let i = 0; i < cfg.WORKERS_PER_CRYSTAL; i++) {
      const w = U.spawnUnit(st, 'player', 'worker', cc.x + i, cc.y, false);
      U.orderGather(st, w, c);
    }
  }
  const wNew = U.spawnUnit(st, 'player', 'worker', cc.x, cc.y, false);
  const pick = U.nearestCrystal(st, wNew);
  assert(pick, 'выбор пуст при живых кристаллах');
  assert(crowdOf(st, pick, wNew) === cfg.WORKERS_PER_CRYSTAL, 'не маржинальный третий: crowd=' + crowdOf(st, pick, wNew));
  paint();
  pass(`G3 chain-marginal: все по 2 → следующий встал третьим (${st.map.crystals.length} кр.)`);
} catch (e) { fail('G3 chain-marginal', e); }

// ---------- G4: цепочка — фолбэк, никогда null ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  clearPlayerWorkers(st);
  const cc = playerCc(st);
  for (const c of st.map.crystals) {
    for (let i = 0; i < cfg.WORKERS_PER_CRYSTAL + 1; i++) {
      const w = U.spawnUnit(st, 'player', 'worker', cc.x + i, cc.y, false);
      U.orderGather(st, w, c);
    }
  }
  const wNew = U.spawnUnit(st, 'player', 'worker', cc.x, cc.y, false);
  const pick = U.nearestCrystal(st, wNew);
  assert(pick, 'выбор null при живых кристаллах');
  assert(crowdOf(st, pick, wNew) === cfg.WORKERS_PER_CRYSTAL + 1, 'фолбэк не на наименее людный: crowd=' + crowdOf(st, pick, wNew));
  pass('G4 chain-fallback: все по 3 → выбор на наименее людный, не null');
} catch (e) { fail('G4 chain-fallback', e); }

// ---------- G5: исчерпание внутри поля ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  clearPlayerWorkers(st);
  const cc = playerCc(st);
  const c = mainCrystal(st);
  const w = U.spawnUnit(st, 'player', 'worker', cc.x, cc.y, false);
  U.orderGather(st, w, c);
  c.amount = 0; // жила выработана под рабочим
  ticks(5);
  assert(w.order.kind === 'gather', 'рабочий бросил добычу: ' + w.order.kind);
  assert(w.order.target && w.order.target !== c, 'рабочий не перевыбрал кристалл');
  assert(w.order.target.amount > 0, 'перевыбор на пустой кристалл');
  assert(w.order.target.fieldId === c.fieldId, 'перевыбор ушёл из поля ' + c.fieldId);
  paint();
  pass('G5 exhaust: исчерпание → перевыбор внутри своего поля');
} catch (e) { fail('G5 exhaust', e); }

// ---------- G6: ралли на кристалле ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  clearPlayerWorkers(st);
  const cc = playerCc(st);
  const c0 = mainCrystal(st);
  cc.rally = { crystal: c0, x: c0.x, y: c0.y };
  st.minerals.player = 99999;
  cc.queue.length = 0;
  assert(B.enqueueUnit(st, cc, 'worker') !== 'queue', 'очередь забита');
  cc.queue[0].t = 0.05;
  ticks(10);
  const rookie = st.units.find((u) => !u.dead && u.side === 'player' && u.type === 'worker' &&
    u.order.kind === 'gather' && u.order.target === c0);
  assert(rookie, 'новичок не встал на кристалл ралли');
  paint();
  pass('G6 rally: точка сбора на кристалле — новичок сразу добывает его');
} catch (e) { fail('G6 rally', e); }

// ---------- G7: тултип кристалла в свежей партии (Б1) ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  assert(!document.body.children.some((e) => e.id === 'cmd-tip'), 'тултип уже создан — партия не свежая');
  const c = st.map.crystals.find((k) => k.amount > 0);
  game.mouse = { x: 100, y: 100 };
  ui.updateCrystalTip(game, c.x, c.y);
  const tip = document.body.children.find((e) => e.id === 'cmd-tip');
  assert(tip, 'элемент тултипа не создан');
  assert(tip.classList.contains('show'), 'тултип не показан');
  assert(new RegExp('Эрг ' + c.amount + '/' + c.max).test(tip.innerHTML), 'текст остатков: ' + tip.innerHTML);
  assert(/Месторождение: [0-9]+/.test(tip.innerHTML), 'нет суммы месторождения');
  assert(!U.crystalAt(st, 8, 8), 'точка (8,8) не пуста');
  ui.updateCrystalTip(game, 8, 8); // пустая точка — тултип гаснет
  assert(!tip.classList.contains('show'), 'тултип не погас');
  pass('G7 crystal-tip: свежая партия → «Эрг N/M · Месторождение Σ», увод гасит');
} catch (e) { fail('G7 crystal-tip', e); }

console.log(failures.length ? `\nИТОГ SIM_GATHER: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_GATHER: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
