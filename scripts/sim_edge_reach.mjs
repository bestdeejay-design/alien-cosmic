// ============================================================
// sim_edge_reach.mjs — доходят ли юниты до КРАЯ карты на всех
// размерах/формах (жалоба владельца: после смены размера карты
// войска не доходят до края).
//   E1. Проходимость границы: кольцо тайлов у края не замуровано.
//   E2. Marine идёт к проходному тайлу на каждом краю (N/S/W/E) —
//       доходит до цели (< 1.5 тайла) за 30 игровых секунд.
//   E3. То же на клампе мира: u.x/u.y не залетают за [0, pxW/H].
// Запуск: node scripts/sim_edge_reach.mjs
// ============================================================

function ctxStub() {
  return new Proxy({}, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern') {
        return (...a) => ({ addColorStop() {} });
      }
      return (...a) => undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub() }),
};

const { TILE } = await import('../js/config.js');
const { GameMap } = await import('../js/map.js');
const U = await import('../js/units.js');

const DT = 1 / 30;
let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails++;
};

const nullSound = new Proxy({}, { get: () => () => {} });
function makeState(seed, dims) {
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
  st.map = new GameMap(seed, { seed, lakes: 'default', rocks: 7, rich: 1, ...dims });
  st.grid = new U.SpatialGrid(Math.max(st.map.w, st.map.h));
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
const mk = (st, type, tx, ty) =>
  U.spawnUnit(st, 'player', type, (tx + 0.5) * TILE, (ty + 0.5) * TILE);

// Проходной тайл на краю: сам край и его сосед свободны, база не в зоне.
function edgeSpot(st, side) {
  const { w, h } = st.map;
  const mid = side === 'N' || side === 'S' ? { axis: 'x', len: w } : { axis: 'y', len: h };
  for (let i = 4; i < mid.len - 4; i++) {
    const tx = side === 'N' || side === 'S' ? i : side === 'W' ? 0 : w - 1;
    const ty = side === 'N' ? 0 : side === 'S' ? h - 1 : i;
    if (st.map.blockedAt(tx, ty)) continue;
    const nx = side === 'W' ? 1 : side === 'E' ? w - 2 : tx;
    const ny = side === 'N' ? 1 : side === 'S' ? h - 2 : ty;
    if (st.map.blockedAt(nx, ny)) continue;
    return { tx, ty };
  }
  return null;
}

const FORMS = [
  ['квадрат 64×64', {}],
  ['wide 96×64', { w: 96, h: 64 }],
  ['tall 64×96', { w: 64, h: 96 }],
  ['малая 48×48', { w: 48, h: 48 }],
  ['большая 96×96', { w: 96, h: 96 }],
];

for (const [label, dims] of FORMS) {
  const st = makeState(777 + dims.w * 1000 + (dims.h || 0), dims);
  const { w, h } = st.map;
  ok(`${label}: размер применился`, st.map.w === (dims.w || 64) && st.map.h === (dims.h || 64), `${st.map.w}×${st.map.h}`);

  // E1: границы не замурованы (≥ 60% крайних тайлов проходимы).
  let freeB = 0, totB = 0;
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { totB++; if (!st.map.blockedAt(x, y)) freeB++; }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { totB++; if (!st.map.blockedAt(x, y)) freeB++; }
  ok(`${label}: граница проходима`, freeB / totB >= 0.6, `${freeB}/${totB}`);

  // E2: marine с центра к каждому краю.
  for (const side of ['N', 'S', 'W', 'E']) {
    const spot = edgeSpot(st, side);
    if (!spot) { ok(`${label}: край ${side} — есть проходной тайл`, false); continue; }
    const u = mk(st, 'marine', (w / 2) | 0, (h / 2) | 0);
    const gx = (spot.tx + 0.5) * TILE, gy = (spot.ty + 0.5) * TILE;
    U.orderMove(st, u, gx, gy);
    runTicks(st, 30 * 30); // 30 игровых секунд
    const dist = Math.hypot(u.x - gx, u.y - gy) / TILE;
    ok(`${label}: marine дошёл до края ${side} (${spot.tx},${spot.ty})`, !u.dead && dist < 1.5, `дистанция ${dist.toFixed(2)} тайла`);
    st.units.length = 0;
  }

  // E3: кламп мира — юнит не за границей.
  for (const u of st.units) {
    ok(`${label}: юнит в границах мира`,
      u.x >= -1 && u.x <= st.map.pxW + 1 && u.y >= -1 && u.y <= st.map.pxH + 1);
  }
}

console.log(fails ? `ПРОВАЛ: ${fails}` : 'ИТОГ EDGE_REACH: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(fails ? 1 : 0);
