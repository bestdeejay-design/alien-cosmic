// ============================================================
// economy.js — ЭКОНОМИКА ПОЛИГОНА r/ НА 20 УРОВНЕЙ (один источник чисел).
//
// Зачем: в S1 (v1) грейды были Г1→Г3 и стоили 60–2600 — весь техдерево
// выкупалось за десять минут домашней добычи, поэтому «экономики» не было.
// Здесь просчитана длинная игра: КЦ 1→20, грейды зданий 1→20, юниты
// (лабораторные ранги) 1→20 и рейдовые локации 1→20.
//
// Все числа выводятся формулами от якорей, поэтому перекос правится одной
// константой, а не сотней литералов. Якоря низких уровней взяты из
// действующего баланса (КЦ-II 240, КЦ-III 400, Дом-II 1200/Дом-III 2600,
// казарма 90/150, турель 60/100), чтобы первые шаги игры не менялись.
//
// ПРАВИЛА ВЛАДЕЛЬЦА (канон 25.10.2026), зашитые здесь:
//   R1. Ни одно здание не грейдится выше уровня КЦ: цель ≤ уровень КЦ.
//   R2. КЦ грейдится только при выполнении условия по зданиям:
//       КЦ→L требует не менее L зданий уровня (L−1) и выше.
//       КЦ→3 = 3 здания II ур., КЦ→4 = 4 здания III ур. (пример владельца).
//   R3. Ранги юнитов (лаборатория) тоже не выше уровня КЦ.
//   R4. Рейд открывает Дом уровня II+, сам рейд — уровень КЦ.
//
// Тестовый режим стенда: ?econ=0.1 в адресе страницы удешевляет ВСЁ в 10 раз
// (только полигон, для быстрого прощупывания контента). Значение читается
// один раз при импорте.
// ============================================================

export const MAX_LEVEL = 20;

// ------------------------------------------------------------
// Масштаб для стенда: ?econ=0.25 → цены ×0.25. Канон: 1.
// ------------------------------------------------------------
function readScale() {
  try {
    if (typeof location === 'undefined' || !location.search) return 1;
    const v = Number(new URLSearchParams(location.search).get('econ'));
    if (!Number.isFinite(v) || v <= 0) return 1;
    return Math.max(0.01, Math.min(100, v));
  } catch { return 1; }
}
export const ECON_SCALE = readScale();

const scaleCost = (n) => Math.max(5, Math.round(n * ECON_SCALE));

// Округление цены до трёх значащих цифр: 12 340 → 12 300, 987 → 987.
export function niceCost(n) {
  const v = Math.max(1, Math.round(n));
  if (v < 100) return v;
  const digits = String(v).length;
  const step = Math.pow(10, digits - 3);
  return Math.max(step, Math.round(v / step) * step);
}

// ------------------------------------------------------------
// 1. ГРЕЙДЫ ЗДАНИЙ 1→20
// cost2/time2 — цена и время ГРЕЙДА НА УРОВЕНЬ 2 (якорь действующего баланса),
// growth/tGrowth — множитель за каждый следующий уровень.
// ------------------------------------------------------------
const GRADE_DEF = {
  cc:       { cost2: 240, growth: 1.50, time2: 30, tGrowth: 1.13 },
  // Дом: якоря владельца 1200 (II) и 2600 (III), дальше кривая 1.34.
  depot:    { cost2: 1200, cost3: 2600, growth: 1.34, time2: 30, time3: 45, tGrowth: 1.12 },
  barracks: { cost2: 90, growth: 1.38, time2: 30, tGrowth: 1.10 },
  factory:  { cost2: 150, growth: 1.38, time2: 30, tGrowth: 1.10 },
  turret:   { cost2: 60, growth: 1.38, time2: 30, tGrowth: 1.10 },
  bunker:   { cost2: 72, growth: 1.38, time2: 30, tGrowth: 1.10 },
  lab:      { cost2: 250, growth: 1.36, time2: 32, tGrowth: 1.10 },
  wall:     { cost2: 25, growth: 1.50, time2: 12, tGrowth: 1.08 },
};

// Статы, которые грейд даёт ЦЕЛЕВОМУ уровню (их читают функции grade*).
function gradeStats(type, level) {
  const l = level - 1; // сколько грейдов пройдено
  switch (type) {
    case 'turret':
      return { dmg: Math.round(8 * Math.pow(1.055, l) * 10) / 10, range: 150 + 2 * l };
    case 'barracks':
    case 'factory':
      return { rate: Math.round((1 + 0.035 * l) * 100) / 100, queue: 5 + 2 * l };
    case 'bunker':
      return { gar: 4 + 2 * l, hpMul: Math.round((1 + 0.12 * l) * 100) / 100 };
    case 'cc':
      return { hpMul: Math.round((1 + 0.10 * l) * 100) / 100 };
    case 'depot':
      return { hpMul: Math.round((1 + 0.08 * l) * 100) / 100 };
    case 'wall':
      return { hpMul: Math.round((1 + 0.15 * l) * 100) / 100 };
    case 'lab':
      return { rate: Math.round((1 + 0.05 * l) * 100) / 100, queue: 5 + 2 * l };
    default:
      return {};
  }
}

// Полная таблица грейдов типа: индекс = целевой уровень (0,1 — null).
export function buildGradeTable(type) {
  const def = GRADE_DEF[type];
  const table = [null, null];
  if (!def) return table;
  for (let to = 2; to <= MAX_LEVEL; to++) {
    let cost;
    if (def.cost2 && to === 2) cost = def.cost2;
    else if (def.cost3 && to === 3) cost = def.cost3;
    else {
      const anchor = def.cost3 ? def.cost3 : def.cost2;
      const anchorLevel = def.cost3 ? 3 : 2;
      cost = anchor * Math.pow(def.growth, to - anchorLevel);
    }
    let time;
    if (to === 2) time = def.time2;
    else if (def.time3 && to === 3) time = def.time3;
    else {
      const anchorT = def.time3 ? def.time3 : def.time2;
      const anchorLevel = def.time3 ? 3 : 2;
      time = anchorT * Math.pow(def.tGrowth, to - anchorLevel);
    }
    table[to] = {
      cost: niceCost(scaleCost(cost)),
      time: Math.max(10, Math.round(time / 5) * 5),
      ...gradeStats(type, to),
      level: to,
    };
  }
  return table;
}

export const GRADE_TABLE = Object.freeze(
  Object.fromEntries(Object.keys(GRADE_DEF).map((k) => [k, buildGradeTable(k)])),
);

export function gradeEntry(type, to) {
  const t = GRADE_TABLE[type];
  return t && to >= 2 && to <= MAX_LEVEL ? t[to] || null : null;
}

// ------------------------------------------------------------
// 2. ПРАВИЛО КЦ: сколько зданий и какого уровня нужно для перехода.
//    КЦ→L требует L зданий уровня (L−1)+; сам КЦ тоже считается зданием
//    (он на уровне L−1), поэтому «КЦ→3» = КЦ-II + 2 здания II ур.
// ------------------------------------------------------------
export const CC_GATE_COUNTS_CC = true;

export function ccGate(targetLevel) {
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(targetLevel)));
  if (L <= 2) return { count: 0, minLevel: 1 };
  return { count: L, minLevel: L - 1 };
}

// Уровень КЦ стороны.
export function ccLevel(st, side = 'player') {
  if (!st || !Array.isArray(st.buildings)) return 1;
  let lv = 1;
  for (const b of st.buildings) {
    if (!b || b.dead || b.side !== side || b.type !== 'cc' || !b.done) continue;
    lv = Math.max(lv, b.level || 1);
  }
  return lv;
}

// Сколько зданий стороны уже достигли уровня minLevel.
export function countBuildingsAtLeast(st, side, minLevel) {
  let n = 0;
  if (!st || !Array.isArray(st.buildings)) return n;
  for (const b of st.buildings) {
    if (!b || b.dead || b.side !== side || !b.done) continue;
    if (!b.cfg || !b.cfg.key) continue;
    if ((b.level || 1) >= minLevel) n++;
  }
  return n;
}

export function ccGateProgress(st, side, targetLevel) {
  const gate = ccGate(targetLevel);
  const need = CC_GATE_COUNTS_CC ? gate.count : Math.max(0, gate.count - 1);
  const have = countBuildingsAtLeast(st, side, gate.minLevel);
  return { ...gate, need, have: Math.min(have, need), ok: have >= need };
}

// ------------------------------------------------------------
// 3. ЕДИНЫЙ ПРЕДИКАТ «можно ли грейдить» с кодом причины.
//    Коды: ok | max | busy | wrong | cclow | gate | money | notech
// ------------------------------------------------------------
export function canGradeBuilding(st, side, b) {
  if (!b || b.dead || !b.done) return { ok: false, code: 'wrong' };
  if (b.side !== side) return { ok: false, code: 'wrong' };
  const to = (b.level || 1) + 1;
  if (to > MAX_LEVEL) return { ok: false, code: 'max' };
  const g = gradeEntry(b.type, to);
  if (!g) return { ok: false, code: 'wrong' };
  if (b.gradeUp) return { ok: false, code: 'busy', to };
  const ccl = ccLevel(st, side);
  if (b.type === 'cc') {
    const prog = ccGateProgress(st, side, to);
    if (!prog.ok) return { ok: false, code: 'gate', to, gate: prog };
  } else if (to > ccl) {
    return { ok: false, code: 'cclow', to, needCc: to, cc: ccl };
  }
  const money = Math.floor(Number(st && st.minerals && st.minerals[side]) || 0);
  if (money < g.cost) return { ok: false, code: 'money', to, cost: g.cost, have: money };
  return { ok: true, code: 'ok', to, cost: g.cost, time: g.time, entry: g };
}

// Стоимость прокачки здания с 1 до нужного уровня (для документов и симуляций).
export function chainCost(type, toLevel) {
  let sum = 0;
  for (let to = 2; to <= Math.min(MAX_LEVEL, toLevel); to++) {
    const g = gradeEntry(type, to);
    if (g) sum += g.cost;
  }
  return sum;
}

// ------------------------------------------------------------
// 4. ДОМ: места, трюм, лечение, ход — эволюция в рейдовую станцию.
// ------------------------------------------------------------
export const HOUSE_LEVELS = Object.freeze({
  slots(level) {
    const L = Math.max(1, Math.min(MAX_LEVEL, level | 0));
    if (L < 2) return 8;          // Г1 — 8 мест (канон владельца)
    if (L < 5) return 10;         // Г2–Г4 — 10 мест
    return 14 + 4 * (L - 5);      // Г5+ — +4 за уровень (Г20 → 74)
  },
  cargo(level) {
    const L = Math.max(1, Math.min(MAX_LEVEL, level | 0));
    if (L < 2) return 0;          // до Г2 рейдов нет
    if (L < 5) return 3000;       // Г2–Г4 — 3000 (канон владельца)
    return 8000 + 5000 * (L - 5); // Г5+ — +5000 за уровень (Г20 → 83 000)
  },
  heal(level) {
    const L = Math.max(1, Math.min(MAX_LEVEL, level | 0));
    if (L < 4) return 0;          // лечение открывается с Г4
    return Math.min(15, 5 + (L - 4));
  },
  moveFrom: 3,                    // ход как у юнита — с Г3
  moveSpeed: 96,                  // как у рабочего (канон)
  healRadius: 4,                  // тайлов, аура лечения
});

// ------------------------------------------------------------
// 5. РЕЙДЫ 1→20: локации, добыча, состав, трюм.
//    Тир открывается уровнем КЦ (тиру 20 нужен КЦ 20) — «новая карта за
//    ресурсами» = следующая ступень развития базы.
// ------------------------------------------------------------
const RAID_TIER_DEF = {
  baseYield: 900,        // суммарный эрг месторождения тира 1
  yieldGrowth: 1.30,
  baseTrip: 8,           // эрг за рейс рабочего на тире 1 (= MINERAL_PER_TRIP)
  tripGrowth: 1.19,      // «бур/тягач эрга»: чем глубже сектор, тем больше за рейс
  baseUnits: 4,
  budgetStep: 50,
  baseBudget: 100,
};

// Базовый размер поля в map.js при rich=1 (8 кристаллов × ~1500).
const FIELD_BASE_AMOUNT = 12000;

export function raidTier(tier) {
  const T = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(tier) || 1)));
  const yieldTotal = Math.round(RAID_TIER_DEF.baseYield * Math.pow(RAID_TIER_DEF.yieldGrowth, T - 1));
  const trip = Math.max(1, Math.round(RAID_TIER_DEF.baseTrip * Math.pow(RAID_TIER_DEF.tripGrowth, T - 1)));
  const units = RAID_TIER_DEF.baseUnits + 2 * Math.floor((T - 1) / 2);
  return {
    tier: T,
    unlockCC: T,                                     // нужен КЦ уровня T
    maxUnits: units,
    maxBudget: RAID_TIER_DEF.baseBudget + RAID_TIER_DEF.budgetStep * (T - 1),
    w: Math.min(72, 48 + 2 * Math.floor((T - 1) / 2)),
    h: Math.min(72, 48 + 2 * Math.floor((T - 1) / 2)),
    rocks: 6 + Math.floor(T / 2),
    rich: Math.round((yieldTotal / FIELD_BASE_AMOUNT) * 1000) / 1000,
    yieldTotal,
    tripYield: trip,
  };
}

export const RAID_TIERS = Object.freeze(
  Array.from({ length: MAX_LEVEL }, (_, i) => Object.freeze(raidTier(i + 1))),
);

export function raidTierAt(tier) {
  const T = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(tier) || 1)));
  return RAID_TIERS[T - 1];
}

// Открытый тир рейда: КЦ уровня T открывает тир T (Дом Г2+ нужен отдельно).
export function unlockedRaidTierByCC(st) {
  return Math.max(1, Math.min(MAX_LEVEL, ccLevel(st, 'player')));
}

// Трюм рейда: Дом-шаттл уровня L. На карте трюм = raidCargoCap.
export function houseLevelOf(st) {
  if (!st || !Array.isArray(st.buildings)) return 0;
  let best = 0;
  for (const b of st.buildings) {
    if (!b || b.dead || b.side !== 'player' || b.type !== 'depot' || !b.done) continue;
    best = Math.max(best, b.level || 1);
  }
  return best;
}

// ------------------------------------------------------------
// 6. ЮНИТЫ: ранги лаборатории 1→20 (не выше КЦ, не выше ранга здания-лабы).
//    Эффекты — проценты, а не плоские числа: на 20 уровнях плоские бонусы
//    ломают единицы (пехота 7→67 урона).
// ------------------------------------------------------------
const TECH_DEF = {
  infAtk: { cost: [100, 175, 250], growth: 1.34, time: [40, 55, 70], tGrowth: 1.10, perLevel: 0.04, kind: 'atk' },
  vehAtk: { cost: [100, 175, 250], growth: 1.34, time: [45, 60, 75], tGrowth: 1.10, perLevel: 0.04, kind: 'atk' },
  infArm: { cost: [100, 175, 250], growth: 1.34, time: [40, 55, 70], tGrowth: 1.10, perLevel: 0.025, kind: 'arm' },
  vehArm: { cost: [100, 175, 250], growth: 1.34, time: [45, 60, 75], tGrowth: 1.10, perLevel: 0.025, kind: 'arm' },
  autoRepair: { cost: [150], growth: 1, time: [60], tGrowth: 1, perLevel: 0, kind: 'special', requiresCC: 2 },
};

export function buildTech(key) {
  const def = TECH_DEF[key];
  const max = Math.max(def.cost.length, def.growth > 1 ? MAX_LEVEL : def.cost.length);
  const costs = [];
  const times = [];
  for (let lvl = 1; lvl <= max; lvl++) {
    const c = lvl <= def.cost.length
      ? def.cost[lvl - 1]
      : def.cost[def.cost.length - 1] * Math.pow(def.growth, lvl - def.cost.length);
    const t = lvl <= def.time.length
      ? def.time[lvl - 1]
      : def.time[def.time.length - 1] * Math.pow(def.tGrowth, lvl - def.time.length);
    costs.push(niceCost(scaleCost(c)));
    times.push(Math.max(10, Math.round(t / 5) * 5));
  }
  return {
    key, max, costs, times,
    perLevel: def.perLevel, kind: def.kind,
    requiresGrade: def.requiresCC ? { type: 'cc', level: def.requiresCC } : undefined,
  };
}

export const TECH_KEYS = Object.keys(TECH_DEF);
export const TECH = Object.freeze(Object.fromEntries(TECH_KEYS.map((k) => [k, buildTech(k)])));

// Ранг юнита стороны = изученный уровень соответствующей ветки.
export function unitRank(st, side, unitCfg) {
  if (!st || !st.tech || !st.tech[side]) return 0;
  const t = st.tech[side];
  const veh = !!(unitCfg && unitCfg.vehicle);
  return veh ? (t.vehAtk || 0) : (t.infAtk || 0);
}

// Доля бонуса урона от ранга (0.04 → +96% на 20 ур.).
export function attackMul(level) {
  const l = Math.max(0, Math.min(MAX_LEVEL, Number(level) || 0));
  return 1 + (TECH.infAtk.perLevel) * l;
}

// Доля снижения получаемого урона (2.5%/ур., потолок 50%).
export function armorFrac(level) {
  const l = Math.max(0, Math.min(MAX_LEVEL, Number(level) || 0));
  return Math.min(0.5, TECH.infArm.perLevel * l);
}

// ------------------------------------------------------------
// 7. ДОБЫЧА и ОКУПАЕМОСТЬ: сколько минут/рейдов стоит следующий уровень.
//    Опирается на реальные константы игры (MINE_TIME, скорость рабочего).
// ------------------------------------------------------------
export const MINING = Object.freeze({
  perTrip: 8,        // config.MINERAL_PER_TRIP (тир 1)
  mineTime: 1.8,     // config.MINE_TIME
  workerSpeed: 92,   // config.UNITS.worker.speed
  tile: 32,          // config.TILE
  fieldTiles: 7,     // расстояние до главного месторождения от КЦ
});

// Полный цикл рабочего (шахта → КЦ → шахта) на домашней базе, сек.
export function homeCycleSeconds() {
  const travel = (MINING.fieldTiles * 2 * MINING.tile) / MINING.workerSpeed;
  return MINING.mineTime + travel;
}

// Домашний доход одного рабочего, эрг/мин.
export function homeIncomePerWorker() {
  return (MINING.perTrip / homeCycleSeconds()) * 60;
}

// Доход рейда: рабочих W, тир T — эрг/мин (ограничен трюмом Дома).
export function raidIncomePerMinute(tier, workers) {
  const t = raidTier(tier);
  const cycle = MINING.mineTime + (MINING.fieldTiles * 2 * MINING.tile) / MINING.workerSpeed;
  return ((t.tripYield * workers) / cycle) * 60;
}

// ------------------------------------------------------------
// 8. СВОДКА «сколько стоит база на максимум» (для документов и симуляций).
//    Состав канонической базы-20: КЦ 1 + 2 Дома + 2 казармы + 2 завода +
//    1 лаба + 8 турелей + 4 бункера = 20 зданий (условие КЦ→20: 20 зданий
//    19 уровня).
// ------------------------------------------------------------
export const BASE_PLAN = Object.freeze({
  cc: 1, depot: 1, barracks: 2, factory: 2, lab: 1, turret: 8, bunker: 5, wall: 0,
});

// Самая дешёвая база, проходящая условие КЦ→20: 20 зданий 19 уровня.
// Дешевле всего это ТУРЕЛИ (на высоких уровнях кривая 1.38 мягче стены 1.5),
// но игроку нужны и казармы/заводы — поэтому это «пол», а не рекомендация.
export function cheapestWidePlan({ level = MAX_LEVEL } = {}) {
  const to = level - 1;
  let best = null;
  for (const type of Object.keys(GRADE_TABLE)) {
    if (type === 'cc') continue;
    const each = chainCost(type, to);
    if (!best || each < best.each) best = { type, each };
  }
  return {
    cc: chainCost('cc', level),
    type: best.type,
    each: best.each,
    count: level,
    wide: best.each * level,
    total: chainCost('cc', level) + best.each * level,
  };
}

export function basePlanCost({ level = MAX_LEVEL } = {}) {
  const perType = {};
  let total = 0;
  for (const [type, count] of Object.entries(BASE_PLAN)) {
    const target = type === 'cc' ? level : Math.min(level - 1, MAX_LEVEL);
    const cost = chainCost(type, target);
    perType[type] = { count, target, each: cost, total: cost * count };
    total += cost * count;
  }
  let tech = 0;
  for (const key of TECH_KEYS) {
    const t = TECH[key];
    const sum = t.costs.reduce((a, b) => a + b, 0);
    perType[key] = { count: 1, target: t.max, each: sum, total: sum };
    tech += sum;
  }
  return { perType, buildings: total, tech, total: total + tech, level };
}

// Сводка по уровням КЦ: цена грейда, условие, что открывается.
export function ccProgression() {
  const rows = [];
  for (let to = 2; to <= MAX_LEVEL; to++) {
    const g = gradeEntry('cc', to);
    const gate = ccGate(to);
    rows.push({
      level: to,
      cost: g ? g.cost : 0,
      time: g ? g.time : 0,
      gateNeed: gate.count,
      gateLevel: gate.minLevel,
      raidTier: to,
      houseNeeded: 2,
    });
  }
  return rows;
}
