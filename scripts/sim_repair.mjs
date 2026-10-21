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
// H.1v2 «умные деньги» (регресс пата «нет кристаллов + авторемонт»):
//   S7. Деньги вперёд: банк 0 + авторемонт → рабочие ПРОДОЛЖАЮТ добычу
//       (никто не стянут к цели), доход растёт; деньги дали — экипаж поехал.
//   S8. Отзыв голодных: банк съели посреди сварки → сварщик сам
//       вернулся к добыче; банк наполнили — ремонт возобновился.
//   S9. Кристаллов нет вовсе: без денег — честный простой без маяты
//       приказами; банк есть — ремонт от казны работает.
//   S10. Ближние, не все: три битых здания, денег много → экипажей
//       ≤ AUTOREPAIR_MAX_CREWS, приоритет самым битым, третье ждёт.
//   S11. Ручной приказ свят: заказанный ремонт без денег стоит (не
//       отзывается), по деньгам — доводит до конца.
//   S12. Детерминизм v2: прогон с отзывом — побитовый дубль.
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

const { TILE, BUILDINGS, AUTOREPAIR_MAX_CREWS } = await import('../js/config.js');
const { GameMap } = await import('../js/map.js');
const B = await import('../js/buildings.js');
const U = await import('../js/units.js');

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = fileURLToPath(import.meta.url);

const DT = 1 / 30;
let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails++;
};

const nullSound = new Proxy({}, { get: () => () => {} });

// Дочерний режим (S12): изолированный прогон — свежий nextId, как в новой партии.
// В одном процессе счётчик id юнитов течёт между сценариями и через wallSide
// (u.id % 2 — сторона обхода стены) меняет траектории: это артефакт стенда,
// а не игры. Поэтому детерминизм v2 проверяем двумя подпроцессами.
if (process.argv[2] === '--s12-run') {
  console.log(JSON.stringify(s12Finale(Number(process.argv[3]) || 2718)));
  process.exit(0);
}
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
function mkDamagedDepot(st, side, tx, ty, frac = 0.5) {
  const b = B.placeBuildingCmd(st, side, 'depot', tx, ty);
  if (!b) return null;
  b.done = true;
  b.hp = Math.round(b.maxHp * frac);
  return b;
}

// H.1v2: плацдарм для диспетчера — КЦ (готовый) + техника/здания рядом.
// Возвращает центр КЦ; всё в радиусе AUTOREPAIR_RADIUS, если смещаться
// от него на ≤ 8 тайлов.
function mkCC(st, side, tx, ty) {
  const save = st.minerals[side];
  st.minerals[side] = Math.max(st.minerals[side], 500);
  const cc = B.placeBuildingCmd(st, side, 'cc', tx, ty);
  st.minerals[side] = save;
  if (!cc) return null;
  cc.done = true;
  cc.progress = 1;
  cc.hp = cc.maxHp; // иначе недострой с 15% HP — фантомная цель диспетчера
  return cc;
}
const repairersIn = (st, side) =>
  st.units.filter((u) => !u.dead && u.side === side && u.order.kind === 'repair');

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

// ---------- S7. H.1v2 главный пат: банк 0 + авторемонт = добыча продолжается ----------
{
  const st = makeState(5551);
  const pad = findClear(st, 12);
  const cc = mkCC(st, 'player', pad.x, pad.y);
  const depot = mkDamagedDepot(st, 'player', pad.x + 6, pad.y + 1, 0.2);
  ok('S7pre. плацдарм готов (КЦ + битое депо)', !!cc && !!depot);
  st.tech.player.autoRepair = 1;
  st.minerals.player = 0; // банк пуст — сценарий владельца «нет кристаллов»
  const workers = [];
  for (let i = 0; i < 3; i++) workers.push(U.spawnUnit(st, 'player', 'worker', (pad.x + 2 + i) * TILE, (pad.y + 4) * TILE, true));
  const toasts = [];
  st.game.ui.toast = (msg, kind) => toasts.push({ msg, kind });
  runTicks(st, 30 * 10); // 10 c: старый код стянул бы ВСЕХ к депо и заморозил
  ok('S7a. при пустом банке никто не пущен в ремонт',
    repairersIn(st, 'player').length === 0, `ремонтников=${repairersIn(st, 'player').length}`);
  ok('S7b. рабочие не брошены — продолжают добычу',
    workers.every((w) => w.order.kind === 'gather'),
    workers.map((w) => w.order.kind).join(','));
  ok('S7c. доход капает: банк растёт с нуля', st.minerals.player > 0,
    `минералы=${Math.round(st.minerals.player)}`);
  ok('S7d. игроку объяснили ожидание: тост «ждёт минералов» ровно один',
    toasts.length === 1 && toasts[0].kind === 'warn', `тостов=${toasts.length}`);
  st.minerals.player = 200; // деньги дали
  runTicks(st, 30 * 2);
  const reps = repairersIn(st, 'player');
  ok('S7e. после пополнения экипаж назначен на депо',
    reps.some((w) => w.order.target === depot), `ремонтников=${reps.length}`);
  runTicks(st, 30 * 25);
  ok('S7f. депо долечено до полного HP', depot.hp >= depot.maxHp, `hp=${Math.round(depot.hp)}`);
  ok('S7g. экипаж вернулся к добыче, а не застыл у стены',
    workers.every((w) => w.order.kind === 'gather'),
    workers.map((w) => w.order.kind).join(','));
}

// ---------- S8. Отзыв голодных посреди сварки и возврат ----------
{
  const st = makeState(6612);
  const pad = findClear(st, 12);
  const cc = mkCC(st, 'player', pad.x, pad.y);
  const depot = mkDamagedDepot(st, 'player', pad.x + 6, pad.y + 1, 0.5);
  st.tech.player.autoRepair = 1;
  st.minerals.player = 300;
  U.spawnUnit(st, 'player', 'worker', (pad.x + 2) * TILE, (pad.y + 3) * TILE, true);
  U.spawnUnit(st, 'player', 'worker', (pad.x + 3) * TILE, (pad.y + 3) * TILE, true);
  runTicks(st, 30 * 2);
  ok('S8a. экипаж назначен', repairersIn(st, 'player').length >= 1);
  runTicks(st, 30 * 3); // дойти и начать варить
  ok('S8b. сварка идёт', depot.hp > Math.round(depot.maxHp * 0.5), `hp=${Math.round(depot.hp)}`);
  st.minerals.player = 0; // банк съело что-то ещё (очередь юнитов и т.п.)
  runTicks(st, 30 * 2); // тик диспетчера ≤ 0.5 c — отзыв укладывается
  ok('S8c. голодный экипаж отозван — никто не замер у цели',
    repairersIn(st, 'player').length === 0,
    repairersIn(st, 'player').map((w) => w.order.kind).join(','));
  ok('S8d. отозванные добывают',
    st.units.some((u) => u.side === 'player' && u.type === 'worker' && u.order.kind === 'gather'));
  const frozen = depot.hp;
  runTicks(st, 30 * 2);
  ok('S8e. без денег HP не растёт', depot.hp === frozen, `hp=${Math.round(depot.hp)}`);
  st.minerals.player = 300; // банк снова оплачен
  runTicks(st, 30 * 1); // 1 c: тик диспетчера 0.5 c — экипаж уже в ремонте
  // (долечить остаток он успевает быстрее 2 c, потому окно короче,
  //  иначе к проверке экипаж уже вернулся к добыче — это и есть цель)
  ok('S8f. ремонт возобновился', repairersIn(st, 'player').length >= 1,
    `ремонтников=${repairersIn(st, 'player').length}`);
  runTicks(st, 30 * 25);
  ok('S8g. депо долечено', depot.hp >= depot.maxHp, `hp=${Math.round(depot.hp)}`);
}

// ---------- S9. Кристаллов нет вовсе: простой без маяты, ремонт от казны ----------
{
  const st = makeState(7723);
  const pad = findClear(st, 12);
  const cc = mkCC(st, 'player', pad.x, pad.y);
  const depot = mkDamagedDepot(st, 'player', pad.x + 6, pad.y + 1, 0.2);
  st.tech.player.autoRepair = 1;
  st.minerals.player = 0;
  for (const c of [...st.map.crystals]) st.map.removeCrystal(c); // поля выработаны
  const w1 = U.spawnUnit(st, 'player', 'worker', (pad.x + 2) * TILE, (pad.y + 3) * TILE, true);
  const w2 = U.spawnUnit(st, 'player', 'worker', (pad.x + 3) * TILE, (pad.y + 3) * TILE, true);
  runTicks(st, 30 * 6);
  ok('S9a. без денег и без жил никто не пущен в ремонт',
    repairersIn(st, 'player').length === 0);
  ok('S9b. честный простой: рабочие стоят в idle',
    w1.order.kind === 'idle' && w2.order.kind === 'idle',
    `${w1.order.kind}/${w2.order.kind}`);
  const seq = [];
  for (let i = 0; i < 6; i++) { seq.push(w1.order.kind); runTicks(st, 10); }
  ok('S9c. приказ не мечется (маяты нет)', seq.every((k) => k === 'idle'), seq.join('→'));
  st.minerals.player = 300; // казна есть — ремонт от неё
  runTicks(st, 30 * 2);
  ok('S9d. ремонт от казны назначен', repairersIn(st, 'player').length >= 1);
  runTicks(st, 30 * 25);
  ok('S9e. депо долечено без единой жилы на карте', depot.hp >= depot.maxHp, `hp=${Math.round(depot.hp)}`);
  ok('S9f. после — снова честный простой',
    repairersIn(st, 'player').length === 0 &&
    [w1, w2].every((w) => w.order.kind === 'idle'),
    `${w1.order.kind}/${w2.order.kind}`);
}

// ---------- S10. Ближние, не все: потолок экипажей и триаж ----------
{
  const st = makeState(8834);
  const pad = findClear(st, 14);
  const cc = mkCC(st, 'player', pad.x, pad.y);
  const a = mkDamagedDepot(st, 'player', pad.x + 6, pad.y, 0.3);     // самое битое
  const b = mkDamagedDepot(st, 'player', pad.x + 6, pad.y + 4, 0.6);
  const c = mkDamagedDepot(st, 'player', pad.x + 6, pad.y + 8, 0.85); // самое целое
  ok('S10pre. три депо поставлены', !!cc && !!a && !!b && !!c);
  st.tech.player.autoRepair = 1;
  st.minerals.player = 9999;
  for (let i = 0; i < 8; i++) {
    U.spawnUnit(st, 'player', 'worker',
      (pad.x + 1 + (i % 2)) * TILE, (pad.y + 2 + (i >> 1)) * TILE, true);
  }
  runTicks(st, 30 * 3);
  const reps = repairersIn(st, 'player');
  const targets = new Set(reps.map((w) => w.order.target));
  ok('S10a. экипажей не больше AUTOREPAIR_MAX_CREWS',
    reps.length <= AUTOREPAIR_MAX_CREWS, `ремонтников=${reps.length}`);
  ok('S10b. триаж: варят два самых битых, третье ждёт',
    targets.has(a) && targets.has(b) && !targets.has(c), `целей=${targets.size}`);
  ok('S10c. на цели не больше двух техников',
    U.repairersOf(st, a) <= 2 && U.repairersOf(st, b) <= 2);
  ok('S10d. остальные не брошены (добыча/простой), без толпы у стен',
    st.units.filter((u) => u.side === 'player' && u.type === 'worker' && u.order.kind !== 'repair').length >= 4);
}

// ---------- S11. Ручной приказ свят: без денег стоит, по деньгам доводит ----------
{
  const st = makeState(9945);
  const pad = findClear(st, 12);
  const depot = mkDamagedDepot(st, 'player', pad.x + 6, pad.y + 1, 0.5);
  const w = U.spawnUnit(st, 'player', 'worker', (pad.x + 2) * TILE, (pad.y + 2) * TILE, true);
  st.minerals.player = 0;
  U.orderRepair(st, w, depot); // ручной: auto=false, без КЦ диспетчер не мешает
  runTicks(st, 30 * 2);
  ok('S11a. ручной приказ не отзывается без денег',
    w.order.kind === 'repair' && w.order.auto === false, `order=${w.order.kind}`);
  ok('S11b. без денег HP стоит', depot.hp === Math.round(depot.maxHp * 0.5),
    `hp=${Math.round(depot.hp)}`);
  st.minerals.player = 9999;
  runTicks(st, 30 * 12); // с запасом на дорогу + 250 HP при 26 HP/с
  ok('S11c. по деньгам ручной доводит до конца', depot.hp >= depot.maxHp, `hp=${Math.round(depot.hp)}`);
}

// S12: изолированный прогон (см. шапку дочернего режима).
function s12Finale(seed) {
  const st = makeState(seed);
  const pad = findClear(st, 12);
  const cc = mkCC(st, 'player', pad.x, pad.y);
  const depot = mkDamagedDepot(st, 'player', pad.x + 6, pad.y + 1, 0.5);
  st.tech.player.autoRepair = 1;
  st.minerals.player = 120;
  const ws = [];
  for (let i = 0; i < 3; i++) ws.push(U.spawnUnit(st, 'player', 'worker', (pad.x + 2 + i) * TILE, (pad.y + 3) * TILE, true));
  runTicks(st, 30 * 4);       // экипаж варит, банк тает
  st.minerals.player = 0;     // внешний слив → отзыв
  runTicks(st, 30 * 3);       // добыча
  st.minerals.player = 150;   // снова оплачено → возврат
  runTicks(st, 30 * 30);
  return {
    hp: depot.hp, m: Math.round(st.minerals.player * 100),
    orders: ws.map((w) => w.order.kind).join('|'),
    x: Math.round(ws[0].x * 100), y: Math.round(ws[0].y * 100),
  };
}

// ---------- S12. Детерминизм v2: прогон с отзывом — побитовый дубль ----------
{
  const run = (seed) => JSON.parse(
    execFileSync(process.execPath, [HERE, '--s12-run', String(seed)], { encoding: 'utf8' }));
  const a = run(2718), b = run(2718);
  ok('S12. прогон с отзывом побитово повторим (изолированные процессы)',
    a.hp === b.hp && a.m === b.m && a.orders === b.orders && a.x === b.x && a.y === b.y,
    JSON.stringify(a) + ' vs ' + JSON.stringify(b));
}

console.log(fails ? `\n${fails} FAIL` : '\nВСЕ PASS');
process.exit(fails ? 1 : 0);
