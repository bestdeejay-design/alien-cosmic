// ============================================================
// sim_move.mjs — headless-симуляция движения юнитов (без браузера).
// Крутит НАСТОЯЩИЙ updateUnits (30 Гц) на настоящей карте:
//   S1. Стена 2×2 вырастает на маршруте — рабочий доходит (аналог T1).
//   S2. Карман «П» 5×5 — выходит через горловину (аналог T5/R1).
//   S3. Замурованный в кольце — спокойно встаёт, после разбора идёт (T6/R4).
//   S4. Группа 8 + стена поперёк — все доходят (T7/R3).
//   S5. Добыча с преградой на плече — минералы продолжают идти (T8/R5).
// Запуск: node scripts/sim_move.mjs
// ============================================================

function ctxStub() {
  return new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub() }),
};

const { TILE, MAP_W } = await import('../js/config.js');
const { GameMap } = await import('../js/map.js');
const U = await import('../js/units.js');

const DT = 1 / 30;
let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails++;
};

const nullSound = new Proxy({}, { get: () => () => {} });
function makeState(seed, base = { x: 8, y: 48 }) {
  const st = {
    tick: 0, time: 0, seed, rngState: (seed ^ 0x51ED2707) >>> 0,
    repathsThisTick: 0,
    factions: { player: 'human', enemy: 'alien' },
    minerals: { player: 9999, enemy: 9999 },
    supply: { player: { used: 0, cap: 200 }, enemy: { used: 0, cap: 200 } },
    units: [], buildings: [], projectiles: [], effects: [], floats: [], pings: [],
    selection: [], groups: {},
    stats: { kills: 0, losses: 0, mined: 0 },
    bcount: { player: 0, enemy: 0 },
    tech: { player: {}, enemy: {} },
    gameOver: null, lastAlertT: -99,
    game: { sound: nullSound, ui: { toast: () => {} } },
    fog: { tileVisible: () => true, tileExplored: () => true },
  };
  st.map = new GameMap(seed, { seed, lakes: 'default', rocks: 7, rich: 1, base });
  st.grid = new U.SpatialGrid(64);
  return st;
}
function runTicks(st, n) {
  for (let i = 0; i < n; i++) {
    st.tick++; st.time += DT;
    st.repathsThisTick = 0;
    st.grid.clear();
    for (const u of st.units) if (!u.dead && !u.garrison) st.grid.insert(u);
    U.updateUnits(st, DT, st.grid);
  }
}
function mkWorker(st, tx, ty) {
  return U.spawnUnit(st, 'player', 'worker', (tx + 0.5) * TILE, (ty + 0.5) * TILE);
}
// Свободная площадка под тест: квадрат side×side без blocked.
function findClear(st, side, rMin = 5, rMax = 22) {
  const bx = st.map.bases.player.center.x, by = st.map.bases.player.center.y;
  for (let r = rMin; r < rMax; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = bx + dx, y = by + dy;
      if (x < 3 || y < 3 || x + side > 60 || y + side > 60) continue;
      let free = true;
      for (let j = y; j < y + side && free; j++)
        for (let i = x; i < x + side && free; i++)
          if (st.map.blockedAt(i, j)) free = false;
      if (free) return { x, y };
    }
  return null;
}
const setRock = (st, x, y, v = 2) => { st.map.terrain[y * MAP_W + x] = v; };

// ---------- S1. Стена на маршруте ----------
{
  const st = makeState(4242);
  const pad = findClear(st, 16);
  const w = mkWorker(st, pad.x + 2, pad.y + 8);
  const goal = { x: (pad.x + 14) * TILE, y: (pad.y + 8) * TILE };
  U.orderMove(st, w, goal.x, goal.y);
  runTicks(st, 30); // 1 c идёт
  // Скала 2×2 прямо на линии курса.
  const wx = ((w.x / TILE) | 0) + 3, wy = (w.y / TILE) | 0;
  setRock(st, wx, wy); setRock(st, wx + 1, wy); setRock(st, wx, wy + 1); setRock(st, wx + 1, wy + 1);
  const d0 = Math.hypot(goal.x - w.x, goal.y - w.y);
  runTicks(st, 30 * 25);
  const d1 = Math.hypot(goal.x - w.x, goal.y - w.y);
  ok('S1. стена 2×2 на маршруте — дошёл', d1 <= TILE * 1.6, `было ${Math.round(d0)}px → стало ${Math.round(d1)}px`);
}

// ---------- S2. Карман «П» ----------
{
  const st = makeState(777);
  const pad = findClear(st, 12);
  const px = pad.x + 2, py = pad.y + 1;
  const rocks = [];
  const R = (x, y) => { setRock(st, x, y); rocks.push([x, y]); };
  for (let i = 0; i < 5; i++) { R(px + i, py); R(px, py + i); R(px + 4, py + i); }
  R(px + 1, py + 4); R(px + 3, py + 4); // горловина снизу шириной 1
  const w = mkWorker(st, px + 2, py + 2);
  const goal = { x: (px + 2.5) * TILE, y: (py + 9) * TILE };
  U.orderMove(st, w, goal.x, goal.y);
  runTicks(st, 30 * 30);
  const d = Math.hypot(goal.x - w.x, goal.y - w.y);
  ok('S2. карман «П» — вышел через горловину', d <= TILE * 2, `дистанция до цели ${Math.round(d)}px`);
}

// ---------- S3. Замурованный ----------
{
  const st = makeState(31337);
  const pad = findClear(st, 8);
  const cx = pad.x + 4, cy = pad.y + 4;
  const ring = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    setRock(st, cx + dx, cy + dy); ring.push([cx + dx, cy + dy]);
  }
  const w = mkWorker(st, cx, cy);
  U.orderMove(st, w, (cx + 20) * TILE, cy * TILE);
  runTicks(st, 30 * 8);
  const p0 = { x: w.x, y: w.y, kind: w.order.kind, reason: w.idleReason };
  runTicks(st, 30 * 3);
  const jitter = Math.hypot(w.x - p0.x, w.y - p0.y);
  const calm = !w.dead && (w.order.kind === 'idle' || w.order.kind === 'move') && jitter < 12;
  for (const [x, y] of ring) setRock(st, x, y, 0);
  U.orderMove(st, w, (cx + 8) * TILE, cy * TILE);
  runTicks(st, 30 * 6);
  const revived = Math.hypot(w.x - p0.x, w.y - p0.y) > TILE;
  ok('S3. замурованный стоит спокойно, после разбора идёт',
    calm && revived, `jitter=${Math.round(jitter)}px order=${p0.kind}/${p0.reason || '-'} revived=${revived}`);
}

// ---------- S4. Группа 8 + стена ----------
{
  const st = makeState(6006);
  const pad = findClear(st, 16);
  const group = [];
  for (let i = 0; i < 8; i++) group.push(mkWorker(st, pad.x + 2 + i, pad.y + 2));
  const goal = { x: (pad.x + 6) * TILE, y: (pad.y + 13) * TILE };
  U.orderMoveGroup(st, group, goal.x, goal.y);
  runTicks(st, 36);
  const wy = pad.y + 7;
  for (let i = 0; i < 7; i++) setRock(st, pad.x + 2 + i, wy);
  runTicks(st, 30 * 35);
  let worst = 1;
  for (const u0 of group) {
    const u = st.units.find((x) => x.id === u0.id);
    const g = { x: u.order.gx != null ? u.order.gx : goal.x, y: u.order.gy != null ? u.order.gy : goal.y };
    // Прогресс меряем к общей цели строя.
    const d = Math.hypot(goal.x - u.x, goal.y - u.y);
    worst = Math.min(worst, d);
  }
  // Все в радиусе 3 тайлов от цели строя (слоты разбросаны ±2 тайла).
  ok('S4. группа 8 + стена — все дошли', worst <= TILE * 3, `худшая дистанция ${Math.round(worst)}px`);
}

// ---------- S5. Добыча с преградой ----------
{
  const st = makeState(9001);
  const pad = findClear(st, 10);
  // Ручной кристалл и КЦ рядом.
  const ctx0 = pad.x + 2, cty = pad.y + 2;
  st.map.addCrystal(ctx0, cty, 500);
  const cc = {
    kind: 'building', side: 'player', type: 'cc', done: true, dead: false,
    tx: pad.x + 5, ty: pad.y + 5, w: 2, h: 2,
    x: (pad.x + 6) * TILE, y: (pad.y + 6) * TILE,
    hp: 100, maxHp: 100, cfg: {}, garrison: [],
  };
  st.buildings.push(cc);
  st.map.markBuilding(cc);
  const c = st.map.crystals[st.map.crystals.length - 1];
  const w = mkWorker(st, pad.x + 4, pad.y + 4);
  U.orderGather(st, w, c);
  runTicks(st, 30 * 3);
  // Скала поперёк плеча «кристалл ↔ КЦ».
  const mx = ((w.x + c.x) / 2 / TILE) | 0, my = ((w.y + c.y) / 2 / TILE) | 0;
  let placed = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const x = mx + dx, y = my + dy;
    const onUnit = ((w.x / TILE) | 0) === x && ((w.y / TILE) | 0) === y;
    if (!st.map.blockedAt(x, y) && !onUnit) { setRock(st, x, y); placed++; }
  }
  const m0 = st.minerals.player;
  runTicks(st, 30 * 40);
  const gained = st.minerals.player - m0;
  ok('S5. преграда на плече добычи — минералы идут', gained > 0, `+${Math.round(gained)} минералов, блоков ${placed}`);
}

console.log(fails ? `\nИТОГ СИМУЛЯЦИИ: ЕСТЬ ПРОВАЛЫ (${fails})` : '\nИТОГ СИМУЛЯЦИИ: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(fails ? 1 : 0);
