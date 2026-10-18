// ============================================================
// sim_repair.mjs — headless-симуляция авто-ремонта (без браузера).
// Проверяет, что рабочий в простое сам чинит повреждённую ТЕХНИКУ
// (зеркально авто-лечению медика), и что рядом ничего не сломалось:
//   S1. Idle-рабочий + подбитый танк → сам идёт, варит до полного HP,
//       минералы тратятся, после — сам возвращается к добыче.
//   S2. Ручной приказ перебивает авто-ремонт; дойдя, рабочий
//       возвращается к недочиненной технике сам.
//   S3. Повреждено только ЗДАНИЕ — авто-ремонта нет; ручной работает.
//   S4. Медик по-прежнему не лечит технику (и лечит пехоту).
//   S5. Симметрия сторон: собиратель кхарид чинит громилу (enemy-минералы).
//   S6. Детерминизм: два одинаковых прогона — побитово одинаковый итог.
// Запуск: node scripts/sim_repair.mjs
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

const { TILE, BUILDINGS } = await import('../js/config.js');
const { GameMap } = await import('../js/map.js');
const B = await import('../js/buildings.js');
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
const mk = (st, side, type, tx, ty) =>
  U.spawnUnit(st, side, type, (tx + 0.5) * TILE, (ty + 0.5) * TILE);
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
// Готовое повреждённое здание (сайт достроен вручную для теста).
function mkDamagedDepot(st, side, tx, ty) {
  const b = B.placeBuildingCmd(st, side, 'depot', tx, ty);
  if (!b) return null;
  b.done = true;
  b.hp = Math.round(b.maxHp * 0.5);
  return b;
}

// ---------- S1. Ядро: idle-рабочий сам чинит технику ----------
{
  const st = makeState(4242);
  const pad = findClear(st, 10);
  const w = mk(st, 'player', 'worker', pad.x + 2, pad.y + 2);
  const tank = mk(st, 'player', 'tank', pad.x + 6, pad.y + 6);
  tank.hp = 60; // 60/260 — после рейда
  const m0 = st.minerals.player;
  runTicks(st, 30 * 2); // 2 c: скан 0.5 c + дорога
  ok('S1a. idle-рабочий сам взял технику в ремонт',
    w.order.kind === 'repair' && w.order.target === tank && w.order.auto === true,
    `order=${w.order.kind}`);
  runTicks(st, 30 * 18); // +18 c: хватает на дорогу + 200 HP при 18 HP/с
  ok('S1b. танк отремонтирован до полного HP',
    tank.hp >= tank.maxHp, `hp=${Math.round(tank.hp)}/${tank.maxHp}`);
  ok('S1c. минералы потрачены на ремонт', st.minerals.player < m0,
    `было ${m0}, стало ${Math.round(st.minerals.player)}`);
  runTicks(st, 30 * 2);
  ok('S1d. после ремонта рабочий вернулся к добыче',
    w.order.kind === 'gather', `order=${w.order.kind}`);
}

// ---------- S2. Ручной приказ перебивает авто-ремонт ----------
{
  const st = makeState(777);
  const pad = findClear(st, 14);
  const w = mk(st, 'player', 'worker', pad.x + 2, pad.y + 2);
  const tank = mk(st, 'player', 'tank', pad.x + 6, pad.y + 6);
  tank.hp = 100;
  runTicks(st, 30 * 2);
  const wasAuto = w.order.kind === 'repair';
  U.orderMove(st, w, (pad.x + 12) * TILE, (pad.y + 2) * TILE);
  runTicks(st, 30); // 1 c в пути
  ok('S2a. ручной приказ перебил авто-ремонт',
    wasAuto && w.order.kind === 'move', `order=${w.order.kind}`);
  ok('S2b. в пути повторного захвата нет',
    w.order.kind === 'move' && tank.hp < tank.maxHp, `tank=${Math.round(tank.hp)}`);
  runTicks(st, 30 * 8); // дойти и пересканировать
  ok('S2c. дойдя, рабочий сам вернулся к недочиненной технике',
    w.order.kind === 'repair' && w.order.target === tank, `order=${w.order.kind}`);
}

// ---------- S3. Здания авто-ремонтом не трогаем, ручной работает ----------
{
  const st = makeState(911);
  const pad = findClear(st, 12);
  const w = mk(st, 'player', 'worker', pad.x + 2, pad.y + 2);
  const depot = mkDamagedDepot(st, 'player', pad.x + 6, pad.y + 6);
  ok('S3pre. площадка дала поставить дом', !!depot);
  runTicks(st, 30 * 3);
  ok('S3a. повреждённое здание НЕ вызывает авто-ремонт',
    w.order.kind === 'idle', `order=${w.order.kind}`);
  U.orderRepair(st, w, depot);
  runTicks(st, 30 * 6);
  ok('S3b. ручной ремонт здания по-прежнему работает',
    w.order.kind === 'repair' && depot.hp > Math.round(depot.maxHp * 0.5),
    `order=${w.order.kind}, hp=${Math.round(depot.hp)}`);
}

// ---------- S4. Медик не лечит технику, пехоту лечит ----------
{
  const st = makeState(1313);
  const pad = findClear(st, 12);
  const med = mk(st, 'player', 'medic', pad.x + 2, pad.y + 2);
  const tank = mk(st, 'player', 'tank', pad.x + 6, pad.y + 6);
  tank.hp = 100;
  const marine = mk(st, 'player', 'marine', pad.x + 3, pad.y + 3);
  marine.hp = 20;
  runTicks(st, 30 * 2);
  ok('S4a. медик выбрал пехоту, а не технику',
    med.order.kind === 'heal' && med.order.target === marine, `order=${med.order.kind}`);
  const hpTankMid = tank.hp;
  runTicks(st, 30 * 4);
  ok('S4b. техника от медика не лечится',
    tank.hp === hpTankMid, `hp=${Math.round(tank.hp)}`);
}

// ---------- S5. Симметрия: кхарид чинит своих ----------
{
  const st = makeState(2024);
  const pad = findClear(st, 10);
  const w = mk(st, 'enemy', 'worker', pad.x + 2, pad.y + 2);
  const tank = mk(st, 'enemy', 'tank', pad.x + 6, pad.y + 6);
  tank.hp = 80;
  const m0 = st.minerals.enemy;
  runTicks(st, 30 * 2);
  ok('S5a. собиратель кхарид сам взял громилу в ремонт',
    w.order.kind === 'repair' && w.order.target === tank, `order=${w.order.kind}`);
  runTicks(st, 30 * 18);
  ok('S5b. громила починена, минералы улья потрачены',
    tank.hp >= tank.maxHp && st.minerals.enemy < m0,
    `hp=${Math.round(tank.hp)}, минералы ${m0}→${Math.round(st.minerals.enemy)}`);
}

// ---------- S6. Детерминизм: два прогона = побитовый дубль ----------
{
  const finale = (seed) => {
    const st = makeState(seed);
    const pad = findClear(st, 10);
    const w = mk(st, 'player', 'worker', pad.x + 2, pad.y + 2);
    const tank = mk(st, 'player', 'tank', pad.x + 6, pad.y + 6);
    tank.hp = 90;
    runTicks(st, 30 * 12);
    return { hp: tank.hp, wx: w.x, wy: w.y, order: w.order.kind,
             minerals: st.minerals.player };
  };
  const a = finale(31337), b = finale(31337);
  ok('S6. два прогона побитово одинаковы',
    a.hp === b.hp && a.wx === b.wx && a.wy === b.wy && a.minerals === b.minerals,
    `hp ${a.hp}/${b.hp}, минералы ${Math.round(a.minerals)}/${Math.round(b.minerals)}`);
}

console.log(fails ? `\n${fails} FAIL` : '\nВСЕ PASS');
process.exit(fails ? 1 : 0);
