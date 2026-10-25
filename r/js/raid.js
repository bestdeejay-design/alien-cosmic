// ============================================================
// raid.js — R0-a локальный raid-loop (карта и петля без боя):
//   - постоянная домашняя база (корабль-КЦ) на планете новичка;
//   - стартовый отряд — разовый подарок (не комплект на каждый рейд);
//   - консоль вылазки loadout tier 1–5 из живого гарнизона базы;
//   - детерминированный по seed сектор цели, сбор эрга в трюм челнока,
//     эвакуация в кольце посадки и возврат на ту же домашнюю базу;
//   - хранение домашней базы на время вылазки через явный whitelist-DTO
//     со schemaVersion (без сериализации живого графа state).
// Бой с обороной цели и экран отчёта/повреждений — в R0-b;
// межсессионный локальный снапшот и одноразовый raid ticket — в R0-c.
// ============================================================

import { TILE, UNITS, BUILDINGS, GRADES, HOUSE } from './config.js';
import * as U from './units.js';
import * as B from './buildings.js';
import { nearestFreeTileAround } from './pathfinding.js';
import { t, message } from './i18n.js';

export const RAID_SCHEMA_VERSION = 1;

export const RAID_PLANET = Object.freeze({
  id: 'actan4-beginner',
  biome: 'mars',
  w: 64,
  h: 64,
  homeSeed: 20260401,
  base: Object.freeze({ x: 8, y: 48 }),
});

// Разовый стартовый подарок при первой посадке корабля-КЦ (канон #25).
export const RAID_STARTER_MINERALS = 200;
export const RAID_STARTER_SQUAD = Object.freeze([
  Object.freeze(['worker', 2]),
  Object.freeze(['marine', 2]),
]);

export const RAID_UNIT_ORDER = Object.freeze([
  'worker', 'marine', 'flamer', 'medic', 'buggy', 'tank', 'arty', 'scout',
]);

// Диапазон новичка: уровни допуска 1–5 (лимит отряда и стройбюджета вылазки).
export const RAID_TIERS = Object.freeze([
  Object.freeze({ tier: 1, maxUnits: 4, maxBudget: 100, w: 48, h: 48, rocks: 6, rich: 1.0 }),
  Object.freeze({ tier: 2, maxUnits: 6, maxBudget: 150, w: 56, h: 56, rocks: 7, rich: 1.1 }),
  Object.freeze({ tier: 3, maxUnits: 8, maxBudget: 220, w: 64, h: 64, rocks: 8, rich: 1.2 }),
  Object.freeze({ tier: 4, maxUnits: 10, maxBudget: 300, w: 64, h: 64, rocks: 9, rich: 1.3 }),
  Object.freeze({ tier: 5, maxUnits: 12, maxBudget: 400, w: 72, h: 72, rocks: 10, rich: 1.4 }),
]);

export function getRaidTierConfig(tier) {
  const n = Math.max(1, Math.min(5, Math.floor(Number(tier) || 1)));
  return RAID_TIERS[n - 1];
}

// Чистый детерминированный миксер uint32 для выбора seed сектора цели.
export function deriveTargetSeed(homeSeed, raidSeq, tier = 1) {
  let x = ((homeSeed >>> 0) ^ Math.imul((raidSeq + 1) >>> 0, 0x9E3779B1) ^ Math.imul(tier >>> 0, 0x85EBCA6B)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7FEB352D) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846CA68B) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x || 1;
}

// Открытый уровень вылазки (1–5) по развитию постоянной домашней базы.
export function unlockedRaidTier(st) {
  if (!st || !Array.isArray(st.buildings)) return 1;
  let hasDepot = false, hasBarracks = false, hasFactory = false, hasLab = false, ccLevel = 1;
  for (const b of st.buildings) {
    if (!b || b.dead || b.side !== 'player' || !b.done) continue;
    if (b.type === 'cc') ccLevel = Math.max(ccLevel, b.level || 1);
    else if (b.type === 'depot') hasDepot = true;
    else if (b.type === 'barracks') hasBarracks = true;
    else if (b.type === 'factory') hasFactory = true;
    else if (b.type === 'lab') hasLab = true;
  }
  if (ccLevel >= 3 || (hasFactory && hasLab)) return 5;
  if (hasFactory || hasLab) return 4;
  if (hasBarracks && ccLevel >= 2) return 3;
  if (hasDepot || hasBarracks || ccLevel >= 2) return 2;
  return 1;
}

// Живой свободный состав домашней базы (вне бункеров), доступный для посадки в челнок.
export function countHomeRoster(st) {
  const counts = {};
  for (const key of RAID_UNIT_ORDER) counts[key] = 0;
  if (!st || !Array.isArray(st.units)) return counts;
  for (const u of st.units) {
    if (!u || u.dead || u.garrison || u.side !== 'player' || u.kind !== 'unit') continue;
    if (counts[u.type] !== undefined) counts[u.type]++;
  }
  return counts;
}

export function validateRaidLoadout(st, draft = {}) {
  // ВЛАДЕЛЕЦ 25.10: рейд открывает ДОМ Г2+ (карман рейдов), не КЦ.
  const house = (st.buildings || []).find((b) => !b.dead && b.side === 'player' && b.type === 'depot' && (b.level || 1) >= 2 && b.done);
  if (!house) {
    return { ok: false, reasonKey: 'ui.raid.errNoHouse', reasonParams: {} };
  }
  if (!st || st.raidMode !== 'home' || st.gameOver) {
    return { ok: false, reasonKey: 'ui.raid.errNotHome', reasonParams: {} };
  }
  const rawTier = Math.floor(Number(draft.tier));
  if (!Number.isFinite(rawTier) || rawTier < 1 || rawTier > 5) {
    return { ok: false, reasonKey: 'ui.raid.errTierRange', reasonParams: {} };
  }
  const maxUnlocked = unlockedRaidTier(st);
  if (rawTier > maxUnlocked) {
    return {
      ok: false,
      reasonKey: 'ui.raid.errTierLocked',
      reasonParams: { tier: rawTier, hint: t('ui.raid.tierUnlock.' + rawTier) },
    };
  }
  const tierCfg = getRaidTierConfig(rawTier);
  const roster = countHomeRoster(st);
  const units = {};
  let totalUnits = 0;
  const reqUnits = (draft.units && typeof draft.units === 'object') ? draft.units : {};
  for (const type of RAID_UNIT_ORDER) {
    const raw = reqUnits[type] === undefined ? 0 : Number(reqUnits[type]);
    if (!Number.isFinite(raw) || raw < 0 || Math.floor(raw) !== raw) {
      return { ok: false, reasonKey: 'ui.raid.errInvalidSquad', reasonParams: {} };
    }
    if (raw > roster[type]) {
      return { ok: false, reasonKey: 'ui.raid.errNotEnoughUnits', reasonParams: {} };
    }
    units[type] = raw;
    totalUnits += raw;
  }
  if (totalUnits <= 0) {
    return { ok: false, reasonKey: 'ui.raid.errEmptySquad', reasonParams: {} };
  }
  // ВЛАДЕЛЕЦ 25.10: Дом вмещает HOUSE.slots юнитов (тиры тоже ограничивают).
  if (totalUnits > HOUSE.slots) {
    return { ok: false, reasonKey: 'ui.raid.errSlots', reasonParams: { n: HOUSE.slots } };
  }
  if (totalUnits > tierCfg.maxUnits) {
    return {
      ok: false,
      reasonKey: 'ui.raid.errSquadCap',
      reasonParams: { n: totalUnits, max: tierCfg.maxUnits },
    };
  }
  const rawBudget = draft.budget === undefined ? 0 : Number(draft.budget);
  if (!Number.isFinite(rawBudget) || rawBudget < 0 || Math.floor(rawBudget) !== rawBudget) {
    return { ok: false, reasonKey: 'ui.raid.errBudgetCap', reasonParams: { max: tierCfg.maxBudget } };
  }
  if (rawBudget > tierCfg.maxBudget) {
    return { ok: false, reasonKey: 'ui.raid.errBudgetCap', reasonParams: { max: tierCfg.maxBudget } };
  }
  const homeMinerals = Math.max(0, Math.floor(Number(st.minerals.player) || 0));
  if (rawBudget > homeMinerals) {
    return { ok: false, reasonKey: 'ui.raid.errBudgetHome', reasonParams: { have: homeMinerals } };
  }
  const rawSeed = Number(draft.seed);
  const seed = (Number.isFinite(rawSeed) && rawSeed > 0) ? (Math.floor(rawSeed) >>> 0) : 0;
  if (!seed) {
    return { ok: false, reasonKey: 'ui.raid.errSeed', reasonParams: {} };
  }
  return {
    ok: true,
    reasonKey: '',
    reasonParams: {},
    tier: rawTier,
    tierCfg,
    units,
    totalUnits,
    budget: rawBudget,
    seed,
  };
}

export function createRaidSession(faction) {
  const side = faction === 'alien' ? 'alien' : 'human';
  return {
    schemaVersion: RAID_SCHEMA_VERSION,
    planetId: RAID_PLANET.id,
    faction: side,
    starterGiftClaimed: false,
    raidSeq: 0,
    homeDto: null,
    activeExpedition: null,
    pendingReturn: null,
    lastReturn: null,
  };
}

// Явный whitelist-DTO домашней базы (без живых ссылок и без сериализации state).
export function captureHomeBaseDTO(st, session, dispatchedIds = new Set()) {
  const crystals = [];
  for (const c of st.map.crystals) {
    if (!c || c.dead || c.amount <= 0) continue;
    crystals.push({
      tx: c.tx | 0,
      ty: c.ty | 0,
      amount: Math.max(1, Math.floor(c.amount)),
      max: Math.max(1, Math.floor(c.max || c.amount)),
      fieldId: c.fieldId | 0,
    });
  }
  const buildings = [];
  for (const b of st.buildings) {
    if (!b || b.dead || b.side !== 'player' || !BUILDINGS[b.type]) continue;
    const queue = Array.isArray(b.queue)
      ? b.queue.filter((q) => q && UNITS[q.type]).map((q) => ({
        type: q.type,
        t: Number(q.t) || UNITS[q.type].trainTime,
        total: Number(q.total) || UNITS[q.type].trainTime,
        hold: !!q.hold,
      }))
      : [];
    const garrison = Array.isArray(b.garrison)
      ? b.garrison.filter((u) => u && !u.dead && UNITS[u.type]).map((u) => ({
        type: u.type,
        hp: Math.max(1, Math.min(u.maxHp, Number(u.hp) || UNITS[u.type].hp)),
      }))
      : [];
    buildings.push({
      type: b.type,
      tx: b.tx | 0,
      ty: b.ty | 0,
      hp: Math.max(1, Number(b.hp) || 1),
      maxHp: Math.max(1, Number(b.maxHp) || BUILDINGS[b.type].hp),
      done: !!b.done,
      progress: Number(b.progress) || 0,
      level: Math.max(1, Math.min(3, b.level || 1)),
      gradeUp: b.gradeUp ? {
        to: b.gradeUp.to,
        t: Number(b.gradeUp.t) || 1,
        total: Number(b.gradeUp.total) || 1,
      } : null,
      res: b.res ? {
        key: b.res.key,
        lvl: b.res.lvl,
        t: Number(b.res.t) || 1,
        total: Number(b.res.total) || 1,
      } : null,
      queue,
      garrison,
      rally: b.rally ? {
        x: Number(b.rally.x) || 0,
        y: Number(b.rally.y) || 0,
        crystalTx: b.rally.crystal ? (b.rally.crystal.tx | 0) : null,
        crystalTy: b.rally.crystal ? (b.rally.crystal.ty | 0) : null,
      } : null,
    });
  }
  const units = [];
  for (const u of st.units) {
    if (!u || u.dead || u.garrison || u.side !== 'player' || !UNITS[u.type]) continue;
    if (dispatchedIds && dispatchedIds.has(u.id)) continue;
    units.push({
      type: u.type,
      x: Number(u.x) || TILE * 4,
      y: Number(u.y) || TILE * 4,
      hp: Math.max(1, Math.min(u.maxHp, Number(u.hp) || UNITS[u.type].hp)),
      carrying: Math.max(0, Math.floor(Number(u.carrying) || 0)),
    });
  }
  const tp = (st.tech && st.tech.player) || {};
  return {
    schemaVersion: RAID_SCHEMA_VERSION,
    planetId: RAID_PLANET.id,
    seed: RAID_PLANET.homeSeed,
    faction: session.faction,
    starterGiftClaimed: true,
    raidSeq: session.raidSeq | 0,
    minerals: Math.max(0, Math.floor(Number(st.minerals.player) || 0)),
    tech: {
      infAtk: tp.infAtk | 0,
      infArm: tp.infArm | 0,
      vehAtk: tp.vehAtk | 0,
      vehArm: tp.vehArm | 0,
      autoRepair: tp.autoRepair | 0,
    },
    crystals,
    buildings,
    units,
  };
}

export function buildRaidHomeMission(session) {
  return {
    id: -2,
    raidMode: 'home',
    noEnemyBase: true,
    faction: session.faction,
    enemyFaction: session.faction === 'alien' ? 'human' : 'alien',
    map: {
      seed: RAID_PLANET.homeSeed,
      biome: RAID_PLANET.biome,
      w: RAID_PLANET.w,
      h: RAID_PLANET.h,
      lakes: 'default',
      rocks: 6,
      rich: 1.1,
      base: { x: RAID_PLANET.base.x, y: RAID_PLANET.base.y },
    },
    ai: {},
    defense: null,
  };
}

export function buildSeededTargetMapPreset(seed, tier) {
  const s = seed >>> 0;
  const tc = getRaidTierConfig(tier);
  const w = tc.w;
  const h = tc.h;
  const baseVariants = [
    { x: 7, y: h - 15 },
    { x: 7, y: 8 },
    { x: w - 13, y: h - 15 },
    { x: w - 13, y: 8 },
  ];
  const base = baseVariants[s % baseVariants.length];
  return {
    seed: s,
    biome: RAID_PLANET.biome,
    w,
    h,
    lakes: 'default',
    rocks: tc.rocks + ((s >>> 3) % 3),
    rich: +(tc.rich + (((s >>> 7) % 3) * 0.08)).toFixed(2),
    base,
  };
}

export function buildRaidExpeditionMission(session, validated) {
  return {
    id: -3,
    raidMode: 'expedition',
    noBase: true,
    noEnemyBase: true,
    banBuild: ['cc'], // Корабль-КЦ остаётся постоянной домашней базой
    faction: session.faction,
    enemyFaction: session.faction === 'alien' ? 'human' : 'alien',
    raidTier: validated.tier,
    raidTargetSeed: validated.seed,
    map: buildSeededTargetMapPreset(validated.seed, validated.tier),
    ai: {},
    defense: null,
  };
}

function spawnAroundTile(st, side, type, cx, cy, index, hp, autoGather = false) {
  const spot = nearestFreeTileAround(st.map, cx, cy, 1, 1) || { x: cx, y: cy };
  const angle = (index * 2.399963229728653) % (Math.PI * 2);
  let tx = Math.round(cx + Math.cos(angle) * (1.5 + (index >> 2)));
  let ty = Math.round(cy + Math.sin(angle) * (1.5 + (index >> 2)));
  if (!st.map.inBounds(tx, ty) || st.map.blockedAt(tx, ty)) {
    tx = spot.x;
    ty = spot.y;
  }
  const u = U.spawnUnit(st, side, type, (tx + 0.5) * TILE, (ty + 0.5) * TILE, autoGather);
  if (Number.isFinite(hp) && hp > 0) u.hp = Math.min(u.maxHp, hp);
  return u;
}

function hydrateHomeBaseIntoState(st, dto, pendingReturn) {
  // 1) Восстанавливаем остатки кристаллов домашнего участка.
  for (const c of [...st.map.crystals]) st.map.removeCrystal(c);
  for (const c of dto.crystals) {
    st.map.addCrystal(c.tx, c.ty, c.amount, c.fieldId);
    const created = st.map.crystals[st.map.crystals.length - 1];
    if (created && c.max > created.max) created.max = c.max;
  }
  // 2) Технологии и минералы (+ возврат неистраченного стройбюджета и добытого эрга).
  for (const k of ['infAtk', 'infArm', 'vehAtk', 'vehArm', 'autoRepair']) {
    if (dto.tech && Number.isFinite(dto.tech[k])) st.tech.player[k] = dto.tech[k] | 0;
  }
  const addCargo = pendingReturn ? (pendingReturn.cargo | 0) : 0;
  const addBudget = pendingReturn ? (pendingReturn.returnedBudget | 0) : 0;
  st.minerals.player = Math.max(0, (dto.minerals | 0) + addCargo + addBudget);

  // 3) Здания домашней базы (включая грейды, очереди, исследования и гарнизоны).
  for (const bd of dto.buildings) {
    if (!BUILDINGS[bd.type]) continue;
    const b = new B.Building(st, 'player', bd.type, bd.tx, bd.ty, bd.done);
    b.level = bd.level || 1;
    const gEntry = b.level > 1 && GRADES[b.type] ? GRADES[b.type][b.level] : null;
    if (gEntry && gEntry.hpMul) b.maxHp = Math.round(b.cfg.hp * gEntry.hpMul);
    b.hp = Math.max(1, Math.min(b.maxHp, bd.hp));
    b.progress = bd.done ? 1 : Math.max(0, Math.min(0.99, bd.progress || 0));
    b.gradeUp = bd.gradeUp ? { ...bd.gradeUp } : null;
    b.res = bd.res ? { ...bd.res } : null;
    b.queue = Array.isArray(bd.queue) ? bd.queue.map((q) => ({ ...q })) : [];
    if (bd.rally) {
      const crystal = (bd.rally.crystalTx !== null && bd.rally.crystalTy !== null)
        ? st.map.crystals.find((c) => !c.dead && c.tx === bd.rally.crystalTx && c.ty === bd.rally.crystalTy)
        : null;
      b.rally = crystal ? { x: bd.rally.x, y: bd.rally.y, crystal } : { x: bd.rally.x, y: bd.rally.y };
    }
    st.map.markBuilding(b);
    st.bcount.player++;
    if (Array.isArray(bd.garrison) && bd.garrison.length && b.cfg.garrisonCap) {
      for (const gu of bd.garrison) {
        if (!UNITS[gu.type]) continue;
        const u = U.spawnUnit(st, 'player', gu.type, b.x, b.y, false);
        u.hp = Math.max(1, Math.min(u.maxHp, gu.hp));
        u.garrison = b;
        u.hidden = true;
        b.garrison.push(u);
      }
    }
  }

  // 4) Оставшиеся дома юниты + вернувшийся на челноке отряд.
  for (const ud of dto.units) {
    if (!UNITS[ud.type]) continue;
    const u = U.spawnUnit(st, 'player', ud.type, ud.x, ud.y, ud.type === 'worker' && !(ud.carrying > 0));
    u.hp = Math.max(1, Math.min(u.maxHp, ud.hp));
    if (ud.carrying > 0) {
      u.carrying = ud.carrying;
      const c = U.nearestCrystal(st, u);
      if (c) U.orderGather(st, u, c);
    }
  }
  if (pendingReturn && Array.isArray(pendingReturn.boarded)) {
    const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc') || null;
    const anchorX = cc ? cc.tx + 2 : st.map.bases.player.cc.x + 2;
    const anchorY = cc ? cc.ty + 4 : st.map.bases.player.cc.y + 4;
    pendingReturn.boarded.forEach((bu, idx) => {
      if (!UNITS[bu.type]) return;
      spawnAroundTile(st, 'player', bu.type, anchorX, anchorY, idx, bu.hp, bu.type === 'worker');
    });
  }
}

// ВЛАДЕЛЕЦ 25.10: карта вылазки — рандом «есть соперник / нет соперника»,
// детерминированный по seed вылазки: один и тот же сектор всегда одинаков.
function spawnRandomOutpost(game, st, m) {
  const seed = (m.raidTargetSeed || 1) >>> 0;
  let h = seed ^ 0x9e3779b9;
  h = (h ^ (h >>> 13)) >>> 0; h = (h * 2246822519) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  if ((h % 100) >= 50) return; // 50%: пустая карта
  const w = st.map.w, h2 = st.map.h;
  const pb = st.map.bases.player.cc;
  const corner = {
    x: pb.x < w / 2 ? w - 7 : 6,
    y: pb.y < h2 / 2 ? h2 - 7 : 6,
  };
  const put = (type, dx, dy) => {
    const tx = Math.max(1, Math.min(w - 3, corner.x + dx));
    const ty = Math.max(1, Math.min(h2 - 3, corner.y + dy));
    if (!st.map.inBounds(tx, ty) || st.map.blockedAt(tx, ty)) return null;
    const b = new B.Building(st, 'enemy', type, tx, ty, true);
    st.map.markBuilding(b);
    st.bcount.enemy++;
    return b;
  };
  const ccE = put('cc', 0, 0);
  if (!ccE) return;
  put('barracks', -4, 0);
  put('turret', 0, -3);
  put('turret', 0, 3);
  const tier = m.raidTier || 1;
  const guards = tier >= 3 ? ['marine', 'marine', 'tank'] : ['marine', 'marine'];
  let i = 0;
  for (const gt of guards) {
    const u = U.spawnUnit(st, 'enemy', gt, (corner.x + 2 + i) * TILE, (corner.y + 2) * TILE, false);
    if (u) U.orderMove(st, u, ccE.x, ccE.y);
    i++;
  }
}

export function populateRaidState(game, st, m) {
  const session = game.raidSession;
  st.raidMode = m.raidMode;
  if (!session) return;

  if (m.raidMode === 'home') {
    if (!session.homeDto) {
      const base = st.map.bases.player;
      const cc = new B.Building(st, 'player', 'cc', base.cc.x, base.cc.y, true);
      st.map.markBuilding(cc);
      st.bcount.player++;
      st.minerals.player = RAID_STARTER_MINERALS;
      if (!session.starterGiftClaimed) {
        session.starterGiftClaimed = true;
        let idx = 0;
        for (const [type, count] of RAID_STARTER_SQUAD) {
          for (let k = 0; k < count; k++) {
            const isWorker = type === 'worker';
            const wx = (base.cc.x + (isWorker ? k * 2 : 1 + k * 2) + 0.5) * TILE;
            const wy = (base.cc.y + (isWorker ? 4 : 5) + 0.5) * TILE;
            U.spawnUnit(st, 'player', type, wx, wy, isWorker);
            idx++;
          }
        }
      }
      session.homeDto = captureHomeBaseDTO(st, session, new Set());
    } else {
      hydrateHomeBaseIntoState(st, session.homeDto, session.pendingReturn);
      session.pendingReturn = null;
      session.homeDto = captureHomeBaseDTO(st, session, new Set());
    }
    return;
  }

  if (m.raidMode === 'expedition') {
    const exp = session.activeExpedition;
    spawnRandomOutpost(game, st, m);
    const pb = st.map.bases.player.cc;
    const padTx = Math.max(2, Math.min(st.map.w - 3, pb.x + 2));
    const padTy = Math.max(2, Math.min(st.map.h - 3, pb.y + 2));
    st.raidDrop = {
      tx: padTx,
      ty: padTy,
      x: (padTx + 0.5) * TILE,
      y: (padTy + 0.5) * TILE,
      r: 3.5,
      hold: 2.0,
    };
    st.raidCargo = 0;
    st.raidEvacuating = false;
    st.raidBoarded = [];
    st.raidTier = (exp && exp.tier) || m.raidTier || 1;
    st.raidTargetSeed = (exp && exp.seed) || m.raidTargetSeed || st.seed;
    const list = (exp && Array.isArray(exp.units)) ? exp.units : [];
    st.raidInitialCount = list.length;
    st.minerals.player = exp ? (exp.budget | 0) : 0;
    list.forEach((item, idx) => {
      if (!UNITS[item.type]) return;
      spawnAroundTile(st, 'player', item.type, padTx, padTy, idx, item.hp, item.type === 'worker');
    });
  }
}

export function updateRaidTick(game, st, dt) {
  if (!st || st.raidMode !== 'expedition' || st.gameOver) return;
  const pad = st.raidDrop;
  if (st.raidEvacuating && pad) {
    const radPx = pad.r * TILE;
    for (const u of st.units) {
      if (u.dead || u.evacuated || u.garrison || u.side !== 'player' || u.kind !== 'unit') continue;
      if (Math.hypot(u.x - pad.x, u.y - pad.y) <= radPx) {
        u.evacT = (u.evacT || 0) + dt;
        if (u.evacT >= pad.hold) {
          if (u.carrying > 0) {
            st.raidCargo = Math.min(HOUSE.cargo, (st.raidCargo || 0) + u.carrying);
            st.stats.mined += u.carrying;
            u.carrying = 0;
          }
          st.raidBoarded.push({ type: u.type, hp: Math.max(1, Math.ceil(u.hp)) });
          u.evacuated = true;
          u.dead = true;
          u.selected = false;
          st.evacuated++;
          U.addEffect(st, { kind: 'spark', x: u.x, y: u.y, ang: -Math.PI / 2, t: 0, life: 0.3 });
          U.addFloat(st, u.x, u.y - 16, message('evacOne', st.factions.player), '#9be29e');
          game.sound.ready();
        }
      } else {
        u.evacT = 0;
      }
    }
    st.selection = st.selection.filter((e) => !e.evacuated);
    if (st.evacuated > 0) st.units = st.units.filter((u) => !u.evacuated);
  }

  let aliveLeft = 0;
  for (const u of st.units) {
    if (!u.dead && !u.evacuated && u.side === 'player' && u.kind === 'unit') aliveLeft++;
  }
  if (st.raidEvacuating && aliveLeft === 0 && st.raidBoarded.length > 0) {
    game.finishRaidExpedition('evac');
  } else if (aliveLeft === 0 && st.raidBoarded.length === 0) {
    game.finishRaidExpedition('wiped');
  }
}

export function checkRaidEnd(game, st) {
  if (!st || st.gameOver) return;
  if (st.raidMode === 'home' && st.bcount.player <= 0) {
    game.lose(message('loseBase', st.factions.player));
  }
}

export function raidObjectiveText(game, st) {
  if (!st) return '';
  if (st.raidMode === 'home') {
    const tier = unlockedRaidTier(st);
    const raids = (game.raidSession && game.raidSession.raidSeq) || 0;
    return t('ui.raid.hudHome', { tier, raids });
  }
  if (st.raidMode === 'expedition') {
    let alive = 0;
    for (const u of st.units) {
      if (!u.dead && !u.evacuated && u.side === 'player' && u.kind === 'unit') alive++;
    }
    const cargo = Math.floor(st.raidCargo || 0);
    if (st.raidEvacuating) {
      const boarded = st.raidBoarded ? st.raidBoarded.length : 0;
      return t('ui.raid.hudEvac', { boarded, total: boarded + alive, cargo });
    }
    return t('ui.raid.hudExpedition', { tier: st.raidTier || 1, cargo, alive });
  }
  return '';
}

export function drawRaidZone(ctx, st, cam, inView) {
  if (!st || st.raidMode !== 'expedition' || !st.raidDrop) return;
  const pad = st.raidDrop;
  if (!inView(pad.x, pad.y, pad.r * TILE)) return;
  const ex = pad.x - cam.x;
  const ey = pad.y - cam.y;
  const fast = st.raidEvacuating ? 0.008 : 0.0035;
  const pulse = 0.45 + 0.35 * Math.sin(performance.now() * fast);
  ctx.save();
  ctx.globalAlpha = st.raidEvacuating ? Math.min(1, pulse + 0.2) : pulse;
  ctx.strokeStyle = st.raidEvacuating ? '#f3c579' : '#8ff5e2';
  ctx.lineWidth = st.raidEvacuating ? 3 : 2.2;
  ctx.setLineDash([10, 7]);
  ctx.beginPath();
  ctx.arc(ex, ey, pad.r * TILE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Посадочный ромб-маяк челнока в центре зоны приёма груза и эвакуации.
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(14, 37, 45, 0.82)';
  ctx.beginPath();
  ctx.moveTo(ex, ey - 16);
  ctx.lineTo(ex + 16, ey);
  ctx.lineTo(ex, ey + 16);
  ctx.lineTo(ex - 16, ey);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = st.raidEvacuating ? '#f3c579' : '#76e3d7';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = st.raidEvacuating ? '#f3c579' : '#c5fff1';
  ctx.beginPath();
  ctx.arc(ex, ey, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
