// ============================================================
// sim_traffic.mjs — пакет G: пробки, цепочки строек, ремонт.
//
// T1 corridor: 10 рабочих строем через коридор 1 тайл — 0 застреваний.
// T2 chain: 2 сайта × 2 рабочих — достроены оба (цепочка G.3).
// T3 repair: 2 повреждённые машины + 6 техников ПКМ — 2+2 чинят, 2 добывают.
// T4 rally-spread: точка сбора раздаёт строй, а не стек (G.1).
//
// Запуск: node scripts/sim_traffic.mjs
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
function playerCc(st) { return st.buildings.find((b) => b.side === 'player' && b.type === 'cc'); }
function playerWorkers(st) {
  return st.units.filter((u) => !u.dead && u.side === 'player' && u.type === 'worker');
}

// ---------- T1: коридор ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.enemy = 99999;
  // Коридор: две стенки 1×13 с зазором 1 тайл. Стенки чужие (ИИ свои не бьёт).
  let cor = null;
  for (let x0 = 10; x0 <= 44 && !cor; x0++) {
    for (let y0 = 10; y0 <= 38 && !cor; y0++) {
      let ok = true;
      for (let dy = 0; dy < 13 && ok; dy++) {
        ok = B.canPlace(st.map, x0, y0 + dy, 1, 1) && B.canPlace(st.map, x0 + 2, y0 + dy, 1, 1) &&
          !st.map.blockedAt(x0 + 1, y0 + dy);
      }
      if (ok && !st.map.blockedAt(x0 - 6, y0 + 6) && !st.map.blockedAt(x0 + 8, y0 + 6)) cor = [x0, y0];
    }
  }
  assert(cor, 'коридору негде встать');
  const [x0, y0] = cor;
  for (let dy = 0; dy < 13; dy++) {
    for (const dx of [0, 2]) {
      const w = B.placeBuildingCmd(st, 'enemy', 'wall', x0 + dx, y0 + dy, []);
      w.done = true; w.hp = w.maxHp;
    }
  }
  const T = cfg.TILE;
  const sx = (x0 - 6 + 0.5) * T, sy = (y0 + 6 + 0.5) * T;
  const gx = (x0 + 8 + 0.5) * T, gy = (y0 + 6 + 0.5) * T;
  const cc = playerCc(st);
  while (playerWorkers(st).length < 10) {
    U.spawnUnit(st, 'player', 'worker', cc.x, cc.y, false);
  }
  const crew = playerWorkers(st).slice(0, 10);
  // Стартовая шеренга на свободных тайлах (проверяем — иначе телепорт в стену).
  let si = 0;
  for (const w of crew) {
    U.orderStop(w);
    let px = sx + (si % 5) * 14, py = sy + ((si / 5) | 0) * 14;
    for (let k = 0; k < 12 && st.map.blockedAt((px / T) | 0, (py / T) | 0); k++) px += 14;
    assert(!st.map.blockedAt((px / T) | 0, (py / T) | 0), 'старту негде встать');
    w.x = px; w.y = py; si++;
  }
  U.orderMoveGroup(st, crew, gx, gy);
  let done = false;
  for (let i = 0; i < 60 && !done; i++) {
    ticks(60);
    done = crew.every((w) => !w.dead && w.order.kind === 'idle');
  }
  assert(done, 'колонна не дошла за 120с');
  for (const w of crew) {
    assert(!w.idleReason, 'застревание: ' + w.idleReason);
    assert(Math.hypot(w.x - gx, w.y - gy) < T * 6, 'рабочий далеко от цели: ' +
      Math.round(Math.hypot(w.x - gx, w.y - gy)));
  }
  paint();
  pass('T1 corridor: 10 рабочих через зазор 1 тайл — все дошли, застреваний 0');
} catch (e) { fail('T1 corridor', e); }

// ---------- T2: цепочка строек ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.player = 99999;
  const cc = playerCc(st);
  const spots = [];
  for (let r = 2; r < 14 && spots.length < 2; r++) {
    for (let dy = -r; dy <= r && spots.length < 2; dy++) {
      for (let dx = -r; dx <= r && spots.length < 2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cc.tx + dx, ty = cc.ty + dy;
        if (!B.canPlace(st.map, tx, ty, 1, 1)) continue;
        if (spots.some(([sx, sy]) => Math.abs(sx - tx) + Math.abs(sy - ty) < 4)) continue;
        spots.push([tx, ty]);
      }
    }
  }
  assert(spots.length === 2, 'сайтам негде встать');
  const siteA = B.placeBuildingCmd(st, 'player', 'wall', spots[0][0], spots[0][1], []);
  const siteB = B.placeBuildingCmd(st, 'player', 'wall', spots[1][0], spots[1][1], []);
  const crew = playerWorkers(st).slice(0, 2);
  assert(crew.length === 2, 'нет двух рабочих');
  for (const w of crew) U.orderBuild(st, w, siteA); // оба — только на A
  let both = false;
  for (let i = 0; i < 25 && !both; i++) {
    ticks(60);
    both = siteA.done && siteB.done;
  }
  assert(siteA.done, 'сайт A не достроен');
  assert(siteB.done, 'цепочка не сработала: сайт B стоит');
  for (let i = 0; i < 10 && !crew.every((w) => w.order.kind === 'gather'); i++) ticks(30);
  assert(crew.every((w) => w.order.kind === 'gather'), 'после цепочки не вернулись к добыче');
  paint();
  pass('T2 chain: 2 сайта × 2 рабочих — оба достроены, рабочие добывают');
} catch (e) { fail('T2 chain', e); }

// ---------- T3: ремонт распределяется ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.player = 99999;
  const cc = playerCc(st);
  const spots = [];
  for (let r = 3; r < 12 && spots.length < 2; r++) {
    for (let dy = -r; dy <= r && spots.length < 2; dy++) {
      for (let dx = -r; dx <= r && spots.length < 2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cc.tx + dx, ty = cc.ty + dy;
        if (st.map.blockedAt(tx, ty)) continue;
        if (spots.some(([sx, sy]) => Math.hypot(sx - tx, sy - ty) < 3)) continue;
        spots.push([tx, ty]);
      }
    }
  }
  assert(spots.length === 2, 'машинам негде встать');
  const T = cfg.TILE;
  const bugs = spots.map(([tx, ty]) => {
    const v = U.spawnUnit(st, 'player', 'buggy', (tx + 0.5) * T, (ty + 0.5) * T, false);
    v.hp = Math.round(v.maxHp * 0.5);
    return v;
  });
  while (playerWorkers(st).length < 6) {
    U.spawnUnit(st, 'player', 'worker', cc.x, cc.y, false);
  }
  const crew = playerWorkers(st).slice(0, 6);
  for (const w of crew) U.orderStop(w);
  st.selection = [...crew];
  game.issueRMB(bugs[0].x, bugs[0].y); // ПКМ по первой машине
  const on = (t) => crew.filter((w) => w.order.kind === 'repair' && w.order.target === t).length;
  const mining = crew.filter((w) => w.order.kind === 'gather').length;
  assert(on(bugs[0]) === 2, 'на первой машине не 2: ' + on(bugs[0]));
  assert(on(bugs[1]) === 2, 'на второй машине не 2: ' + on(bugs[1]));
  assert(mining === 2, 'излишек не добывает: ' + mining);
  const hp0 = bugs[0].hp;
  for (let i = 0; i < 20 && bugs[0].hp <= hp0; i++) ticks(30);
  assert(bugs[0].hp > hp0, 'ремонт не идёт');
  st.selection = [];
  paint();
  pass('T3 repair: ПКМ — 2+2 чинят две машины, излишек 2 добывает');
} catch (e) { fail('T3 repair', e); }

// ---------- T4: точка сбора раздаёт строй ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  st.minerals.player = 99999;
  const cc = playerCc(st);
  const bc = cfg.BUILDINGS.barracks;
  let spot = null;
  for (let r = 2; r < 14 && !spot; r++) {
    for (let dy = -r; dy <= r && !spot; dy++) {
      for (let dx = -r; dx <= r && !spot; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (B.canPlace(st.map, cc.tx + dx, cc.ty + dy, bc.w, bc.h)) spot = [cc.tx + dx, cc.ty + dy];
      }
    }
  }
  assert(spot, 'казарме негде встать');
  const bar = B.placeBuildingCmd(st, 'player', 'barracks', spot[0], spot[1], []);
  bar.done = true; bar.hp = bar.maxHp;
  let rally = null;
  for (let r = 4; r < 16 && !rally; r++) {
    for (let dy = -r; dy <= r && !rally; dy++) {
      for (let dx = -r; dx <= r && !rally; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = bar.tx + dx, ty = bar.ty + dy;
        if (!st.map.blockedAt(tx, ty)) rally = [(tx + 0.5) * cfg.TILE, (ty + 0.5) * cfg.TILE];
      }
    }
  }
  assert(rally, 'ралли негде встать');
  bar.rally = { x: rally[0], y: rally[1] };
  for (let i = 0; i < 3; i++) B.enqueueUnit(st, bar, 'marine');
  const maxId = Math.max(...st.units.map((u) => u.id));
  const rookies = [];
  for (let i = 0; i < 60 && rookies.length < 3; i++) {
    if (bar.queue[0]) bar.queue[0].t = Math.min(bar.queue[0].t, 0.05);
    ticks(5);
    for (const u of st.units) {
      if (u.id > maxId && u.type === 'marine' && !rookies.includes(u)) rookies.push(u);
    }
  }
  assert(rookies.length === 3, 'выпустилось не 3: ' + rookies.length);
  const goals = rookies.map((u) => [u.order.gx, u.order.gy]);
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const d = Math.hypot(goals[i][0] - goals[j][0], goals[i][1] - goals[j][1]);
      assert(d > 5, 'стек на ралли: цели совпали');
    }
    assert(Math.hypot(goals[i][0] - rally[0], goals[i][1] - rally[1]) < 80, 'цель далеко от ралли');
  }
  paint();
  pass('T4 rally-spread: 3 новичка — 3 разные цели у точки сбора');
} catch (e) { fail('T4 rally-spread', e); }

console.log(failures.length ? `\nИТОГ SIM_TRAFFIC: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_TRAFFIC: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
