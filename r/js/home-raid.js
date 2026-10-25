// ============================================================
// home-raid.js — ВХОДЯЩИЕ РЕЙДЫ НА БАЗУ И ОБОРОНА (Э7).
//
// До этого полигон умел только летать «туда»: игрок сам нападал на чужие КЦ.
// Теперь база живёт: раз в несколько минут сканер ловит входящий рейд,
// враг высаживается с края карты и идёт ломать постройки. Командир КЦ
// (см. commander.js) поднимает войска и держит оборону.
//
// Канон владельца:
//   • никаких новых кнопок в топбаре — тревога приходит тостом/сиреной,
//     а «Учебная тревога» живёт в карточке командира (команда КЦ);
//   • приз/опыт не заменяют игру: опыт идёт за реальные отражения;
//   • хитбоксы/экономика не меняются — только поведение боя на своей базе.
//
// МОДЕЛЬ: st.homeRaid = { t, nextAt, wave, active, warned, lastAlive }
//   active: { wave, training, spawned, startedAt, buff }
// ============================================================
import { spawnUnit, orderAttack } from './units.js?v=10262510';
import { nearestFreeTileAround } from './pathfinding.js?v=10262510';
import { TILE } from './config.js?v=10262510';
import { t } from './i18n.js?v=10262510';
import { ensureCommander, addXp, bonuses, logEvent } from './commander.js?v=10262510';

export const HOME_RAID = Object.freeze({
  first: 240,        // первый входящий рейд — через 4 минуты игры (не сразу)
  interval: 300,     // дальше раз в 5 минут
  warn: 25,          // предупреждение за 25 секунд
  maxWave: 14,
  maxAlive: 24,      // защита от «мясорубки» на слабых машинах
});

const EDGE_PAD = 2;

export function initHomeRaid(st) {
  st.homeRaid = {
    t: 0,
    nextAt: HOME_RAID.first,
    wave: 0,
    active: null,
    warned: false,
    lastAlive: 0,
    total: 0,
    repelled: 0,
  };
  ensureCommander(st);
  return st.homeRaid;
}

export function homeRaidStatus(st) {
  const hr = st && st.homeRaid;
  if (!hr) return { active: false, countdown: HOME_RAID.first, wave: 0, alive: 0 };
  const alive = st.units ? st.units.filter((u) => u.side === 'enemy' && !u.dead).length : 0;
  return {
    active: !!hr.active,
    countdown: hr.active ? 0 : Math.max(0, Math.ceil(hr.nextAt - hr.t)),
    wave: hr.active ? hr.active.wave : hr.wave,
    alive,
    total: hr.total,
    repelled: hr.repelled,
    training: !!(hr.active && hr.active.training),
  };
}

// ------------------------------------------------------------
// Волна: состав растёт с номером рейда и уровнем КЦ.
// ------------------------------------------------------------
export function waveSize(st, wave) {
  const cc = (st.buildings || []).find((b) => !b.dead && b.done && b.side === 'player' && b.type === 'cc');
  const ccL = cc ? (cc.level || 1) : 1;
  return Math.max(3, Math.min(HOME_RAID.maxWave, 3 + Math.floor(wave * 1.6) + Math.floor(ccL / 3)));
}

function pickEdgeSpot(st, index) {
  const map = st.map;
  const side = index % 4;
  let tx;
  let ty;
  if (side === 0) { tx = EDGE_PAD + ((index * 7) % Math.max(1, map.w - EDGE_PAD * 2)); ty = EDGE_PAD; }
  else if (side === 1) { tx = map.w - EDGE_PAD - 1; ty = EDGE_PAD + ((index * 11) % Math.max(1, map.h - EDGE_PAD * 2)); }
  else if (side === 2) { tx = EDGE_PAD + ((index * 13) % Math.max(1, map.w - EDGE_PAD * 2)); ty = map.h - EDGE_PAD - 1; }
  else { tx = EDGE_PAD; ty = EDGE_PAD + ((index * 17) % Math.max(1, map.h - EDGE_PAD * 2)); }
  const spot = nearestFreeTileAround(map, tx, ty, 1, 1);
  const fx = spot ? spot.x : tx;
  const fy = spot ? spot.y : ty;
  return { x: (fx + 0.5) * TILE, y: (fy + 0.5) * TILE };
}

function nearestPlayerBuilding(st, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const b of st.buildings || []) {
    if (!b || b.dead || b.side !== 'player') continue;
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

// Спавн волны. Возвращает {ok, wave, count}.
export function spawnHomeWave(st, { training = false, wave = null } = {}) {
  if (!st || !st.homeRaid) initHomeRaid(st);
  const hr = st.homeRaid;
  if (hr.active) return { ok: false, error: 'рейд уже идёт', wave: hr.wave, count: 0 };
  hr.wave = Math.max(1, wave == null ? hr.wave + 1 : Math.floor(wave));
  const w = hr.wave;
  const size = training ? Math.max(2, Math.floor(waveSize(st, w) * 0.6)) : waveSize(st, w);
  const types = ['marine'];
  if (w >= 2) types.push('buggy');
  if (w >= 3) types.push('flamer');
  if (w >= 5) types.push('arty');

  const spawned = [];
  for (let i = 0; i < size; i++) {
    const type = types[i % types.length];
    const spot = pickEdgeSpot(st, i + w * 3);
    const u = spawnUnit(st, 'enemy', type, spot.x, spot.y, false);
    if (!u) continue;
    u.visible = true;                 // защита базы: врага видно сразу (это тревога)
    u.homeRaider = true;
    const target = nearestPlayerBuilding(st, u.x, u.y);
    if (target) orderAttack(st, u, target);
    spawned.push(u);
  }
  hr.active = {
    wave: w,
    training: !!training,
    spawned: spawned.length,
    startedAt: st.time || 0,
    buff: training ? 1 : bonuses(ensureCommander(st).level).defense,
  };
  hr.lastAlive = spawned.length;
  hr.total++;
  logEvent(st, t(training ? 'ui.commander.logTraining' : 'ui.commander.logIncoming', { n: w }), training ? 'info' : 'warn');
  return { ok: true, wave: w, count: spawned.length, training: !!training };
}

// Командир поднимает войска: свободные бойцы идут на ближайшего врага.
// Возвращает число выданных приказов.
export function autoDefendOrders(st) {
  if (!st || !st.homeRaid || !st.homeRaid.active) return 0;
  const enemies = (st.units || []).filter((u) => u.side === 'enemy' && !u.dead);
  if (!enemies.length) return 0;
  let issued = 0;
  for (const u of st.units) {
    if (!u || u.dead || u.side !== 'player' || u.garrison || u.hidden) continue;
    if (!u.cfg || !(u.cfg.dmg > 0)) continue;
    if (u.order && u.order.kind === 'attack' && u.order.target && !u.order.target.dead) continue;
    let best = null;
    let bestD = Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) continue;
    orderAttack(st, u, best);
    issued++;
  }
  return issued;
}

// Ремонт у КЦ (бонус командира во время обороны).
function commanderRepair(st, dt) {
  const c = st.commander;
  if (!c) return;
  const rate = bonuses(c.level).repair;
  if (!rate) return;
  const cc = (st.buildings || []).find((b) => !b.dead && b.done && b.side === 'player' && b.type === 'cc');
  if (!cc) return;
  const R = TILE * 7;
  for (const u of st.units || []) {
    if (!u || u.dead || u.side !== 'player' || u.hidden || u.garrison) continue;
    if ((u.x - cc.x) ** 2 + (u.y - cc.y) ** 2 > R * R) continue;
    if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + rate * dt);
  }
}

// ------------------------------------------------------------
// Главный тик: таймер, тревога, спавн, автооборона, итог.
// Возвращает события [{type, ...}] — их показывает вызывающий (game.js).
// ------------------------------------------------------------
export function updateHomeRaid(game, st, dt) {
  if (!st || st.raidMode !== 'home' || st.gameOver) return [];
  const events = [];
  if (!st.homeRaid) initHomeRaid(st);
  const hr = st.homeRaid;
  const c = ensureCommander(st);

  if (hr.active) {
    const enemies = (st.units || []).filter((u) => u.side === 'enemy' && !u.dead);
    const alive = enemies.length;
    // XP за уничтоженных (считаем по убыли живых).
    if (alive < hr.lastAlive) {
      const killed = hr.lastAlive - alive;
      c.stats.kills += killed;
      addXp(st, killed * 4);
    }
    hr.lastAlive = alive;

    if (c.autoDefense) autoDefendOrders(st);
    commanderRepair(st, dt);

    if (!alive) {
      const wave = hr.active.wave;
      const training = !!hr.active.training;
      hr.active = null;
      hr.repelled++;
      hr.t = 0;
      hr.nextAt = HOME_RAID.interval;
      hr.warned = false;
      c.stats.defenses++;
      if (training) {
        addXp(st, 15);
        logEvent(st, t('ui.commander.logTrainingWin'), 'good');
        events.push({ type: 'repelled', wave, training: true, reward: 0 });
      } else {
        const reward = 250 + wave * 90;
        st.minerals.player = (st.minerals.player || 0) + reward;
        const res = addXp(st, 70 + wave * 12);
        logEvent(st, t('ui.commander.logRepelled', { n: wave, erg: reward }), 'good');
        events.push({ type: 'repelled', wave, training: false, reward, levelUp: res.levelUp, level: res.level });
      }
      return events;
    }
    return events;
  }

  // Мирное время: тикает таймер следующего рейда.
  hr.t += dt;
  const left = hr.nextAt - hr.t;
  if (!hr.warned && left <= HOME_RAID.warn) {
    hr.warned = true;
    logEvent(st, t('ui.commander.logWarn', { s: Math.ceil(left) }), 'warn');
    events.push({ type: 'warn', seconds: Math.max(1, Math.ceil(left)) });
  }
  if (left <= 0) {
    const res = spawnHomeWave(st, {});
    if (res.ok) events.push({ type: 'incoming', wave: res.wave, count: res.count });
  }
  return events;
}
