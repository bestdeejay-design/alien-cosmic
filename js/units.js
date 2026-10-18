// ============================================================
// units.js — юниты и техника: движение по пути (A*), расталкивание,
// добыча минералов, стройка, ремонт, бункеры, бой с автоагром,
// снаряды (пуля/снаряд с осколками/удар в упор) и эффекты.
// Единый контракт сущности: kind:'unit'|'building'|'mineral',
// side:'player'|'enemy', x/y (px мира), hp, dead, cfg.
// ============================================================
import {
  TILE, UNITS, BULLET_SPEED, SHELL_SPEED, MINERAL_PER_TRIP, MINE_TIME,
  REPAIR_HP_PER_MINERAL, COLORS, fname,
} from './config.js';
import { pathToPoint, pathToRect, distToRectPx } from './pathfinding.js';

let nextId = 1;

// ----------------------------------------------------------
// Технологии сторон: бонусы атак/брони из исследований лаборатории.
// attacker.kind==='building' (турель) считается пехотным оружием.
// ----------------------------------------------------------
export function atkBonus(st, attacker) {
  if (!st || !st.tech || !attacker || !attacker.side) return 0;
  const t = st.tech[attacker.side];
  if (!t) return 0;
  const veh = attacker.kind === 'unit' && attacker.cfg.vehicle;
  return (t[veh ? 'vehAtk' : 'infAtk'] || 0) * (veh ? 5 : 3);
}
export function armorVal(st, victim) {
  if (!st || !st.tech || !victim || victim.kind !== 'unit') return 0;
  const t = st.tech[victim.side];
  if (!t) return 0;
  return (t[victim.cfg.vehicle ? 'vehArm' : 'infArm'] || 0) * (victim.cfg.vehicle ? 3 : 2);
}

// Тряска экрана (в пикселях и секундах) — вызывается при взрывах.
export function addShake(st, mag, time = 0.22) {
  if (!st) return;
  st.shakeMag = Math.max(st.shakeMag || 0, mag);
  st.shakeT = Math.max(st.shakeT || 0, time);
}

export class Unit {
  constructor(st, side, type, x, y) {
    this.id = nextId++;
    this.kind = 'unit';
    this.side = side;
    this.type = type;
    this.cfg = UNITS[type];
    this.faction = (st.factions && st.factions[side]) || 'human'; // облик и подписи
    this.x = x; this.y = y;
    this.prevX = x; this.prevY = y;   // для интерполяции между тиками
    this.hp = this.cfg.hp; this.maxHp = this.cfg.hp;
    this.r = this.cfg.r;
    this.angle = side === 'player' ? -Math.PI / 4 : (Math.PI * 3) / 4;
    this.order = { kind: 'idle' };    // idle|move|attack|gather|build|repair|garrison
    this.path = null; this.pathI = 0;
    this.moveDir = null;              // намерение движения на этот тик
    this.moving = false;
    this.cd = 0;                      // перезарядка атаки
    this.scanT = Math.random() * 0.3; // таймер автопоиска цели
    this.repathT = 0;
    this.carrying = 0;                // груз минералов
    this.phase = null;                // подстадия добычи
    this.mineT = 0;
    this.flashT = 0;
    this.garrison = null;             // бункер, в котором сидит юнит
    this.hidden = false;              // true — сидит в бункере (не рисуем)
    this.visible = side === 'player'; // для врагов считает туман войны
    this.selected = false;
    this.dead = false;
    st.units.push(this);
  }
}

// Пространственный хэш: пересобирается каждый тик, даёт быстрые
// запросы соседей (расталкивание, автопоиск цели).
export class SpatialGrid {
  constructor(cell = 64) { this.cell = cell; this.buckets = new Map(); }
  clear() { this.buckets.clear(); }
  insert(e) {
    const k = (((e.x / this.cell) | 0) * 512) + ((e.y / this.cell) | 0);
    let arr = this.buckets.get(k);
    if (!arr) { arr = []; this.buckets.set(k, arr); }
    arr.push(e);
  }
  query(x, y, r, cb) {
    const c = this.cell;
    const x0 = ((x - r) / c) | 0, x1 = ((x + r) / c) | 0;
    const y0 = ((y - r) / c) | 0, y1 = ((y + r) / c) | 0;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.buckets.get(cx * 512 + cy);
        if (arr) for (let i = 0; i < arr.length; i++) cb(arr[i]);
      }
  }
}

// ------------------------------------------------------------
// Приказы
// ------------------------------------------------------------
export function orderMove(st, u, x, y) {
  if (u.garrison) return; // сидящего в бункере нельзя командовать
  u.order = { kind: 'move', x, y };
  u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, x, y);
  u.pathI = 0;
}

// Группа идёт в точку «перемешанным строем»: каждой единице свой
// офсет вокруг цели — так отряд не пытается встать в одну точку.
export function orderMoveGroup(st, units, x, y) {
  const offs = formationOffsets(units.length);
  for (let i = 0; i < units.length; i++) {
    orderMove(st, units[i], x + offs[i][0], y + offs[i][1]);
  }
}

export function orderAttack(st, u, target) {
  if (u.garrison) return;
  u.order = { kind: 'attack', target, auto: false };
  u.path = null; u.pathI = 0; u.repathT = 0;
}

// Атака-движение (клавиша A + ЛКМ): идти к точке и вступать в бой
// со всеми врагами, встреченными по дороге. Явный приказ — без «поводка».
export function orderAttackMove(st, u, x, y) {
  if (u.garrison) return;
  u.order = { kind: 'attackMove', x, y, target: null };
  u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, x, y);
  u.pathI = 0;
}

export function orderGather(st, u, crystal, excludeFail) {
  if (u.garrison) return;
  u.order = { kind: 'gather', target: crystal, phase: u.carrying > 0 ? 'toDrop' : 'toMineral' };
  if (excludeFail) u.lastFailed = crystal;
  u.path = null; u.pathI = 0;
}

// Стройка и ремонт помнят прежний кристалл: завершив работу, рабочий
// сам вернётся к добыче, а не замрёт у стены (авто-режим «вернуться
// к делу» — как у инженеров Рубежа 64).
export function orderBuild(st, u, building) {
  if (u.garrison) return;
  u.order = { kind: 'build', target: building, resume: currentCrystal(u) };
  u.path = null; u.pathI = 0;
}

// Ремонт: рабочий «сваривает» здание или технику до полного HP.
export function orderRepair(st, u, target) {
  if (u.garrison) return;
  u.order = { kind: 'repair', target, resume: currentCrystal(u) };
  u.path = null; u.pathI = 0;
}

// Кристалл, за которым рабочий был закреплён прямо сейчас.
function currentCrystal(u) {
  const o = u.order;
  if (o.kind === 'gather' && o.target && !o.target.dead && o.target.amount > 0) return o.target;
  if (o.resume && !o.resume.dead && o.resume.amount > 0) return o.resume;
  return null;
}

// Авто-возврат к добыче после стройки/ремонта: к прежнему кристаллу,
// если он жив, иначе к ближайшему свободному (с анти-толпой).
function resumeGather(st, u) {
  const r = u.order.resume;
  orderStop(u);
  if (!u.cfg.canMine) return;
  const c = (r && !r.dead && r.amount > 0) ? r : nearestCrystal(st, u);
  if (c) orderGather(st, u, c);
}

// Гарнизон: пехота заходит в бункер.
export function orderGarrison(st, u, bunker) {
  if (u.garrison) return;
  u.order = { kind: 'garrison', target: bunker };
  u.path = null; u.pathI = 0;
}

export function orderStop(u) {
  u.order = { kind: 'idle' };
  u.path = null; u.pathI = 0;
}

// Выпустить всех из бункера — рядом со стенками.
export function releaseGarrison(st, b) {
  if (!b.garrison) return;
  for (const m of b.garrison) {
    if (m.dead) continue;
    m.garrison = null;
    m.hidden = false;
    const a = Math.random() * Math.PI * 2;
    m.x = b.x + Math.cos(a) * (b.w * TILE / 2 + 14);
    m.y = b.y + Math.sin(a) * (b.h * TILE / 2 + 14);
    m.prevX = m.x; m.prevY = m.y;
    orderStop(m);
  }
  b.garrison = [];
}

// Офсоты строя: сетка 3×N, отсортированная по удалённости от центра.
const formationCache = new Map();
export function formationOffsets(n) {
  if (formationCache.has(n)) return formationCache.get(n);
  const list = [];
  const span = Math.ceil(Math.sqrt(n)) + 1;
  for (let dy = -span; dy <= span; dy++)
    for (let dx = -span; dx <= span; dx++)
      list.push([dx, dy, dx * dx + dy * dy]);
  list.sort((a, b) => a[2] - b[2]);
  const step = TILE * 0.95;
  const out = list.slice(0, n).map(([dx, dy]) => [dx * step, dy * step]);
  formationCache.set(n, out);
  return out;
}

// ------------------------------------------------------------
// Спавн. autoGather — новые рабочие сразу идут добывать.
// ------------------------------------------------------------
export function spawnUnit(st, side, type, x, y, autoGather = false) {
  const u = new Unit(st, side, type, x, y);
  if (autoGather && type === 'worker') {
    const c = nearestCrystal(st, u);
    if (c) orderGather(st, u, c);
  }
  return u;
}

// Ближайший кристалл с «анти-толпой»: к дистанции добавляется штраф
// за каждого своего рабочего, уже закреплённого за кристаллом. Так
// новая смена распределяется по жилам, а не кучкуется на одном месте.
export function nearestCrystal(st, u, exclude) {
  let best = null, bd = Infinity;
  for (const c of st.map.crystals) {
    if (c.amount <= 0 || c.dead || c === exclude) continue;
    let crowd = 0;
    for (const w of st.units) {
      if (w === u || w.dead || w.side !== u.side || w.type !== 'worker') continue;
      const o = w.order;
      if ((o.kind === 'gather' && o.target === c) ||
          (o.kind === 'build' && o.resume === c)) crowd++;
    }
    const d = Math.hypot(c.x - u.x, c.y - u.y) + crowd * TILE * 2.2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// ------------------------------------------------------------
// Главный апдейт юнитов: логика приказов → интеграция движения →
// жёсткое расталкивание → выталкивание из зданий.
// ------------------------------------------------------------
export function updateUnits(st, dt, grid) {
  for (const u of st.units) {
    if (u.dead) continue;
    u.prevX = u.x; u.prevY = u.y;
    if (u.garrison) continue; // сидит в бункере — не обновляется
    u.cd = Math.max(0, u.cd - dt);
    u.flashT = Math.max(0, u.flashT - dt);
    u.repathT = Math.max(0, u.repathT - dt);
    updateOrderByKind(st, u, dt, grid);
    // Огонь «на задаче»: занятые юниты (идут, добывают, строят, чинят)
    // отстреливаются от врага, зашедшего в радиус оружия, не бросая дела.
    busyDefence(st, u, dt, grid);
    integrate(st, u, dt, grid);
  }
  for (const u of st.units) {
    if (!u.dead && !u.garrison) resolveHard(st, u, grid);
  }
  for (const u of st.units) {
    if (!u.dead && !u.garrison) resolveBuildings(st, u);
  }
}

function updateOrderByKind(st, u, dt, grid) {
  const o = u.order;
  switch (o.kind) {
    case 'idle': {
      // Медики прежде всего ищут раненых — только потом драку.
      if (u.cfg.canHeal) {
        u.scanT -= dt;
        if (u.scanT <= 0) {
          u.scanT = 0.4;
          const hurt = findHealTarget(st, u);
          if (hurt) { u.order = { kind: 'heal', target: hurt }; break; }
        }
      }
      // Бойцы без приказа сами ищут цель в радиусе обзора.
      if (!u.cfg.canMine && !u.cfg.canHeal) {
        u.scanT -= dt;
        if (u.scanT <= 0) {
          u.scanT = 0.25 + Math.random() * 0.15;
          const t = acquireTarget(st, u, grid);
          if (t) u.order = { kind: 'attack', target: t, auto: true, homeX: u.x, homeY: u.y };
        }
      }
      break;
    }
    case 'move': {
      if (followPath(u)) orderStop(u);
      break;
    }
    case 'attack': updateAttack(st, u, dt, grid); break;
    case 'attackMove': updateAttackMove(st, u, dt, grid); break;
    case 'gather': updateGather(st, u, dt); break;
    case 'build': updateBuild(st, u, dt); break;
    case 'repair': updateRepair(st, u, dt); break;
    case 'garrison': updateGarrison(st, u); break;
    case 'heal': updateHeal(st, u, dt); break;
  }
}

// Атака-движение: есть цель в обзоре — бьём её; нет — продолжаем путь.
// Цель считаем живой, пока она в радиусе обзора (иначе «прилипаем» к убежавшему).
function targetInSight(st, u, t) {
  const rx = t.kind === 'building' ? t.tx * TILE : t.x - t.r;
  const ry = t.kind === 'building' ? t.ty * TILE : t.y - t.r;
  const rw = t.kind === 'building' ? t.w * TILE : t.r * 2;
  const rh = t.kind === 'building' ? t.h * TILE : t.r * 2;
  return distToRectPx(u.x, u.y, rx, ry, rw, rh) <= u.cfg.sightTiles * TILE + TILE * 0.5;
}

function updateAttackMove(st, u, dt, grid) {
  const o = u.order;
  let t = o.target;
  if (t && (t.dead || !targetInSight(st, u, t))) { t = null; o.target = null; }
  if (!t) {
    t = acquireTarget(st, u, grid);
    if (t) { o.target = t; u.path = null; u.pathI = 0; u.repathT = 0; }
  }
  if (t) {
    const rw = t.kind === 'building' ? t.w * TILE : t.r * 2;
    const rh = t.kind === 'building' ? t.h * TILE : t.r * 2;
    const rx = t.kind === 'building' ? t.tx * TILE : t.x - t.r;
    const ry = t.kind === 'building' ? t.ty * TILE : t.y - t.r;
    const d = distToRectPx(u.x, u.y, rx, ry, rw, rh);
    if (d <= u.cfg.range) {
      u.path = null;
      u.moving = false;
      u.angle = Math.atan2(t.y - u.y, t.x - u.x);
      if (u.cd <= 0) { u.cd = u.cfg.cooldown; shoot(st, u, t); }
    } else {
      if (!u.path || u.repathT <= 0) {
        u.path = t.kind === 'building'
          ? pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: t.tx, y: t.ty, w: t.w, h: t.h })
          : pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y);
        u.pathI = 0;
        u.repathT = 0.4;
      }
      followPath(u);
    }
    return;
  }
  // Врагов нет — идём дальше к назначенной точке.
  if (followPath(u)) orderStop(u);
}

// Самозащита без срыва приказа: занятые юниты стреляют по врагу
// в радиусе оружия (юниты — из пространственной сетки). Медики на
// марше вдобавок подлечивают раненых, проходя мимо.
function busyDefence(st, u, dt, grid) {
  const k = u.order.kind;
  if (k !== 'move' && k !== 'gather' && k !== 'build' && k !== 'repair') return;
  if (u.cfg.canHeal) {
    const hurt = findHealTarget(st, u);
    if (hurt) {
      const d = Math.hypot(hurt.x - u.x, hurt.y - u.y);
      if (d <= u.r + hurt.r + 16) {
        hurt.hp = Math.min(hurt.maxHp, hurt.hp + u.cfg.healRate * dt);
        if (Math.random() < dt * 2) {
          addEffect(st, { kind: 'heal', x: hurt.x + (Math.random() - 0.5) * 14, y: hurt.y - 8 - Math.random() * 8, t: 0, life: 0.7 });
        }
      }
    }
  }
  u.scanT -= dt;
  if (u.scanT > 0 || u.cd > 0) return;
  u.scanT = 0.3;
  const R = u.cfg.range;
  let best = null, bd = Infinity;
  grid.query(u.x, u.y, R, (e) => {
    if (e.dead || e.side === u.side || e.garrison) return;
    if (u.side === 'player' && !e.visible) return;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < bd && d <= R) { bd = d; best = e; }
  });
  if (best) { u.cd = u.cfg.cooldown; shoot(st, u, best); }
}

// Ближайший раненый «органический» союзник (технику чинят только рабочие).
function findHealTarget(st, u) {
  let best = null, bd = Infinity;
  for (const a of st.units) {
    if (a.dead || a.garrison || a === u || a.side !== u.side) continue;
    if (a.cfg.vehicle || a.hp >= a.maxHp) continue;
    const d = Math.hypot(a.x - u.x, a.y - u.y);
    if (d < bd && d <= u.cfg.sightTiles * TILE) { bd = d; best = a; }
  }
  return best;
}

// Лечение: подойти вплотную и восстанавливать ОЗ, пока цель не здорова.
function updateHeal(st, u, dt) {
  const t = u.order.target;
  if (!t || t.dead || t.side !== u.side || t.cfg.vehicle || t.hp >= t.maxHp) {
    orderStop(u);
    return;
  }
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  if (d <= u.r + t.r + 16) {
    u.path = null; u.moving = false;
    u.angle = Math.atan2(t.y - u.y, t.x - u.x);
    t.hp = Math.min(t.maxHp, t.hp + u.cfg.healRate * dt);
    if (Math.random() < dt * 3) {
      addEffect(st, { kind: 'heal', x: t.x + (Math.random() - 0.5) * 14, y: t.y - 8 - Math.random() * 8, t: 0, life: 0.7 });
    }
    return;
  }
  if (!u.path) {
    u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y);
    u.pathI = 0;
  }
  if (followPath(u)) u.path = null;
}

// Движение по пути: true — путь завершён.
function followPath(u) {
  if (!u.path || u.pathI >= u.path.length) return true;
  const wp = u.path[u.pathI];
  const dx = wp.x - u.x, dy = wp.y - u.y;
  const d = Math.hypot(dx, dy);
  const tol = u.pathI === u.path.length - 1 ? 8 : TILE * 0.35;
  if (d <= tol) { u.pathI++; return u.pathI >= u.path.length; }
  u.moveDir = { x: dx / d, y: dy / d };
  return false;
}

// Атака: подойти в пределах range и стрелять с перезарядкой.
function updateAttack(st, u, dt, grid) {
  let t = u.order.target;
  if (!t || t.dead) {
    // Цель погибла: авто-агро ищет следующую, приказ — ближайшего врага.
    const next = u.order.auto ? acquireTarget(st, u, grid)
      : nearestEnemyEntity(st, u, TILE * 10);
    if (next) { u.order.target = next; t = next; }
    else { orderStop(u); return; }
  }
  // Авто-агро с «поводком»: не убегаем далеко от места обнаружения.
  if (u.order.auto && u.order.homeX !== undefined &&
      Math.hypot(u.x - u.order.homeX, u.y - u.order.homeY) > TILE * 13) {
    orderMove(st, u, u.order.homeX, u.order.homeY);
    u.scanT = 2.5;
    return;
  }
  const rw = t.kind === 'building' ? t.w * TILE : t.r * 2;
  const rh = t.kind === 'building' ? t.h * TILE : t.r * 2;
  const rx = t.kind === 'building' ? t.tx * TILE : t.x - t.r;
  const ry = t.kind === 'building' ? t.ty * TILE : t.y - t.r;
  const d = distToRectPx(u.x, u.y, rx, ry, rw, rh);
  if (d <= u.cfg.range) {
    u.path = null;
    u.moving = false;
    u.angle = Math.atan2(t.y - u.y, t.x - u.x);
    if (u.cd <= 0) {
      u.cd = u.cfg.cooldown;
      shoot(st, u, t);
    }
  } else {
    // Догоняем цель; путь перестраиваем не чаще 0.4 c или при уходе цели.
    if (!u.path || u.repathT <= 0) {
      const tx = t.kind === 'building' ? t.tx + (t.w >> 1) : (t.x / TILE) | 0;
      const ty = t.kind === 'building' ? t.ty + (t.h >> 1) : (t.y / TILE) | 0;
      u.path = t.kind === 'building'
        ? pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: t.tx, y: t.ty, w: t.w, h: t.h })
        : pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y);
      u.pathI = 0;
      u.repathT = 0.4;
      u.lastChase = { x: tx, y: ty };
    }
    followPath(u);
  }
}

// Универсальная стрельба: по cfg.projectile выбираем оружие.
// Стрелять может и здание (турель) — важно, чтобы был cfg.projectile.
export function shoot(st, u, t) {
  const cfg = u.cfg;
  const dmg = cfg.dmg + atkBonus(st, u);   // исследования усиливают выстрел
  const reach = u.r || Math.max(cfg.w, cfg.h) * TILE * 0.5;
  u.angle = Math.atan2(t.y - u.y, t.x - u.x);
  const muzzleX = u.x + Math.cos(u.angle) * (reach + 4);
  const muzzleY = u.y + Math.sin(u.angle) * (reach + 4);
  addEffect(st, { kind: 'muzzle', x: muzzleX, y: muzzleY, ang: u.angle, t: 0, life: cfg.projectile === 'shell' ? 0.1 : 0.06 });
  // Тяжёлая артиллерия отдаёт тряской.
  if (cfg.projectile === 'shell' && cfg.splash && cfg.splash.r >= 50) addShake(st, 5, 0.18);

  if (cfg.projectile === 'bullet') {
    st.projectiles.push({
      x: muzzleX, y: muzzleY, tx: t.x, ty: t.y,
      target: t, speed: BULLET_SPEED, dmg, src: u, dead: false,
    });
    st.game.sound.shot();
  } else if (cfg.projectile === 'shell') {
    st.projectiles.push({
      x: muzzleX, y: muzzleY, tx: t.x, ty: t.y,
      target: t, speed: SHELL_SPEED, dmg, src: u, dead: false,
      splash: cfg.splash,
    });
    st.game.sound.cannon();
  } else {
    // Удар в упор (рабочий) — урон сразу + искра.
    damageEntity(st, t, dmg, u);
    addEffect(st, { kind: 'spark', x: t.x, y: t.y, ang: u.angle, t: 0, life: 0.22 });
    st.game.sound.mine();
  }
}

// Добыча: к кристаллу → майним → к командному центру → сдаём → повтор.
function updateGather(st, u, dt) {
  const o = u.order;
  // Груз Priority: сначала сдаём, потом за новым кристаллом.
  if (u.carrying > 0 && o.phase !== 'toDrop' && o.phase !== 'mining') o.phase = 'toDrop';

  if (o.phase === 'toMineral') {
    let c = o.target;
    if (!c || c.dead || c.amount <= 0) {
      c = nearestCrystal(st, u, u.lastFailed);
      if (!c) { orderStop(u); return; }
      o.target = c; u.path = null;
    }
    // Порог 1.75 тайла: покрывает центр любого смежного тайла (диагональ
    // даёт ~45px) плюс погрешность расталкивания. Меньший порог оставлял
    // рабочего стоять в 47–52px от кристалла навсегда (путь уже пуст,
    // а майнинг не стартовал) — «вечное зависание» добычи.
    if (Math.hypot(c.x - u.x, c.y - u.y) < TILE * 1.75) {
      u.path = null; u.moving = false;
      o.phase = 'mining'; u.mineT = MINE_TIME;
      u.angle = Math.atan2(c.y - u.y, c.x - u.x);
      u.lastFailedT = 0;
      return;
    }
    if (!u.path) {
      u.path = pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: c.tx, y: c.ty, w: 1, h: 1 });
      u.pathI = 0;
      if (u.path && u.path.length === 0) {
        // По сетке мы уже соседний тайл, но физически не дошли до порога.
        // Считаем отказы и через несколько попыток переключаемся на другой
        // кристалл (раньше счётчик сбрасывался в том же тике — висели вечно).
        if ((u.lastFailedT = (u.lastFailedT || 0) + 1) > 4) {
          const other = nearestCrystal(st, u, c);
          if (other) orderGather(st, u, other, true);
          else orderStop(u);
          return;
        }
      }
    }
    if (followPath(u)) u.path = null;
    return;
  }

  if (o.phase === 'mining') {
    const c = o.target;
    if (!c || c.dead || c.amount <= 0) { o.phase = 'toMineral'; u.path = null; return; }
    u.mineT -= dt;
    if (Math.random() < dt * 3) addEffect(st, { kind: 'spark', x: c.x + (Math.random() - 0.5) * 14, y: c.y + (Math.random() - 0.5) * 14, ang: Math.random() * Math.PI, t: 0, life: 0.2 });
    if (Math.random() < dt * 2) st.game.sound.mine();
    if (u.mineT <= 0) {
      const take = Math.min(MINERAL_PER_TRIP, c.amount);
      u.carrying = take;
      c.amount -= take;
      if (c.amount <= 0) st.map.removeCrystal(c);
      o.phase = 'toDrop';
      u.path = null;
    }
    return;
  }

  if (o.phase === 'toDrop') {
    // Ближайший достроенный командный центр своей стороны.
    let drop = null, bd = Infinity;
    for (const b of st.buildings) {
      if (b.dead || b.side !== u.side || b.type !== 'cc' || !b.done) continue;
      const d = Math.hypot(b.x - u.x, b.y - u.y);
      if (d < bd) { bd = d; drop = b; }
    }
    if (!drop) { u.moving = false; return; } // базы нет — стоим с грузом
    o.drop = drop;
    const rx = drop.tx * TILE, ry = drop.ty * TILE, rw = drop.w * TILE, rh = drop.h * TILE;
    if (distToRectPx(u.x, u.y, rx, ry, rw, rh) <= TILE * 0.9) {
      st.minerals[u.side] += u.carrying;
      if (u.side === 'player') {
        st.stats.mined += u.carrying;
        addFloat(st, u.x, u.y - 14, '+' + u.carrying, COLORS.mineral);
      }
      u.carrying = 0;
      u.lastFailed = null; u.lastFailedT = 0;
      o.phase = 'toMineral';
      u.path = null;
      st.game.sound.deposit();
      return;
    }
    if (!u.path) {
      u.path = pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: drop.tx, y: drop.ty, w: drop.w, h: drop.h });
      u.pathI = 0;
    }
    if (followPath(u)) u.path = null;
    return;
  }
}

// Стройка: подойти к площадке и «сваривать» — прогресс и HP растут.
// Завершив (или если стройка отменена/готова) — рабочий сам идёт добывать.
function updateBuild(st, u, dt) {
  const b = u.order.target;
  if (!b || b.dead || b.done) { resumeGather(st, u); return; }
  const rx = b.tx * TILE, ry = b.ty * TILE, rw = b.w * TILE, rh = b.h * TILE;
  if (distToRectPx(u.x, u.y, rx, ry, rw, rh) <= TILE * 1.1) {
    u.path = null; u.moving = false;
    u.angle = Math.atan2(b.y - u.y, b.x - u.x);
    b.progress += dt / b.cfg.buildTime;
    b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * 0.85) * (dt / b.cfg.buildTime));
    if (Math.random() < dt * 4) {
      addEffect(st, {
        kind: 'spark', x: rx + Math.random() * rw, y: ry + Math.random() * rh,
        ang: Math.random() * Math.PI, t: 0, life: 0.2,
      });
    }
    if (b.progress >= 1) {
      b.progress = 1; b.done = true; b.hp = b.maxHp;
      if (b.side === 'player') {
        st.game.sound.ready();
        st.game.ui.toast('Постройка завершена: ' + fname(b.cfg, b.faction));
      }
      resumeGather(st, u);
    }
    return;
  }
  if (!u.path) {
    u.path = pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: b.tx, y: b.ty, w: b.w, h: b.h });
    u.pathI = 0;
  }
  if (followPath(u)) u.path = null;
}

// Ремонт: рабочий варит повреждённое здание или технику своей стороны.
// Скорость зависит от цели; минералы тратятся пропорционально HP.
const REPAIR_RATE = { building: 26, unit: 18 }; // HP/сек
function updateRepair(st, u, dt) {
  const t = u.order.target;
  if (!t || t.dead || t.side !== u.side || t.hp >= t.maxHp) { resumeGather(st, u); return; }
  const isB = t.kind === 'building';
  const rx = isB ? t.tx * TILE : t.x - t.r;
  const ry = isB ? t.ty * TILE : t.y - t.r;
  const rw = isB ? t.w * TILE : t.r * 2;
  const rh = isB ? t.h * TILE : t.r * 2;
  if (distToRectPx(u.x, u.y, rx, ry, rw, rh) <= TILE * 1.1) {
    u.path = null; u.moving = false;
    u.angle = Math.atan2(t.y - u.y, t.x - u.x);
    const rate = REPAIR_RATE[isB ? 'building' : 'unit'];
    const cost = (rate * dt) / REPAIR_HP_PER_MINERAL;
    if (st.minerals[u.side] < cost) {
      // Нет минералов — простой (игроку подсказка не чаще раза в 6 c).
      if (u.side === 'player' && st.time - (st.lastRepairToast || -99) > 6) {
        st.lastRepairToast = st.time;
        st.game.ui.toast('Ремонт остановлен: не хватает минералов', 'error');
      }
      return;
    }
    st.minerals[u.side] -= cost;
    t.hp = Math.min(t.maxHp, t.hp + rate * dt);
    if (Math.random() < dt * 5) {
      addEffect(st, { kind: 'spark', x: rx + Math.random() * rw, y: ry + Math.random() * rh, ang: Math.random() * Math.PI, t: 0, life: 0.2 });
    }
    if (Math.random() < dt * 2.5) st.game.sound.repair();
    if (t.hp >= t.maxHp && t.side === 'player') {
      st.game.ui.toast('Ремонт завершён: ' + fname(t.cfg, t.faction));
    }
    return;
  }
  if (!u.path) {
    u.path = isB
      ? pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: t.tx, y: t.ty, w: t.w, h: t.h })
      : pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y);
    u.pathI = 0;
  }
  if (followPath(u)) u.path = null;
}

// Гарнизон: пехота идёт к бункеру и заходит внутрь.
function updateGarrison(st, u) {
  const b = u.order.target;
  if (!b || b.dead || !b.done) { orderStop(u); return; }
  const rx = b.tx * TILE, ry = b.ty * TILE, rw = b.w * TILE, rh = b.h * TILE;
  if (distToRectPx(u.x, u.y, rx, ry, rw, rh) <= TILE * 1.0) {
    if (b.garrison.length >= b.cfg.garrisonCap) { orderStop(u); return; }
    // Заход внутрь: юнит исчезает с карты, живёт внутри бункера.
    u.garrison = b;
    b.garrison.push(u);
    u.hidden = true;
    u.selected = false;
    st.selection = st.selection.filter((s) => s !== u);
    u.order = { kind: 'idle' };
    u.path = null;
    st.game.sound.enter();
    return;
  }
  if (!u.path) {
    u.path = pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: b.tx, y: b.ty, w: b.w, h: b.h });
    u.pathI = 0;
  }
  if (followPath(u)) u.path = null;
}

// Автопоиск цели в радиусе обзора (только для своей стороны; для игрока —
// с учётом тумана войны). Юниты в приоритете, здания — если в зоне боя.
export function acquireTarget(st, u, grid) {
  const R = u.cfg.sightTiles * TILE;
  let best = null, bd = Infinity;
  grid.query(u.x, u.y, R, (e) => {
    if (e.dead || e.side === u.side || e.garrison) return;
    if (u.side === 'player' && !e.visible) return; // туман войны
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < bd && d <= R) { bd = d; best = e; }
  });
  if (best) return best;
  if (u.side === 'player') {
    for (const b of st.buildings) {
      if (b.dead || b.side === u.side) continue;
      if (!st.fog.tileVisible(b.tx + (b.w >> 1), b.ty + (b.h >> 1))) continue;
      const d = distToRectPx(u.x, u.y, b.tx * TILE, b.ty * TILE, b.w * TILE, b.h * TILE);
      if (d <= u.cfg.range + Math.max(b.w, b.h) * TILE * 0.5) return b;
    }
  } else {
    // ИИ видит всю карту (допустимое «читерство» простого ИИ).
    for (const b of st.buildings) {
      if (b.dead || b.side === u.side) continue;
      const d = distToRectPx(u.x, u.y, b.tx * TILE, b.ty * TILE, b.w * TILE, b.h * TILE);
      if (d <= u.cfg.range + Math.max(b.w, b.h) * TILE * 0.5) return b;
    }
  }
  return null;
}

function nearestEnemyEntity(st, u, maxD) {
  let best = null, bd = maxD;
  for (const e of st.units) {
    if (e.dead || e.side === u.side || e.garrison) continue;
    if (u.side === 'player' && !e.visible) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < bd) { bd = d; best = e; }
  }
  if (best) return best;
  for (const b of st.buildings) {
    if (b.dead || b.side === u.side) continue;
    if (u.side === 'player' && !b.spotted) continue;
    const d = Math.hypot(b.x - u.x, b.y - u.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// ------------------------------------------------------------
// Интеграция движения: скорость по пути + мягкое расталкивание,
// скольжение вдоль стен (раздельно по осям).
// ------------------------------------------------------------
function integrate(st, u, dt, grid) {
  let vx = 0, vy = 0;
  if (u.moveDir) {
    vx = u.moveDir.x * u.cfg.speed;
    vy = u.moveDir.y * u.cfg.speed;
    const sep = separation(u, grid);
    vx += sep.x * 42; vy += sep.y * 42;
  }
  u.moving = Math.abs(vx) + Math.abs(vy) > 1;
  if (vx || vy) tryMove(st.map, u, vx * dt, vy * dt);
  if (u.moving) u.angle = Math.atan2(vy, vx);
  u.moveDir = null;
}

// Мягкое расталкивание — чтобы идущие юниты не слипались в точку.
function separation(u, grid) {
  let sx = 0, sy = 0;
  grid.query(u.x, u.y, 26, (o) => {
    if (o === u || o.dead) return;
    const dx = u.x - o.x, dy = u.y - o.y;
    const d = Math.hypot(dx, dy) || 0.01;
    if (d < 26) { const w = (26 - d) / 26; sx += (dx / d) * w; sy += (dy / d) * w; }
  });
  const len = Math.hypot(sx, sy);
  return len > 0.01 ? { x: sx / len, y: sy / len } : { x: 0, y: 0 };
}

// Жёсткое разрешение пересечений (позиционная поправка).
function resolveHard(st, u, grid) {
  grid.query(u.x, u.y, u.r * 2 + 4, (o) => {
    if (o === u || o.dead) return;
    const dx = u.x - o.x, dy = u.y - o.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const min = u.r + o.r;
    if (d < min) {
      const push = (min - d) * 0.5;
      tryMove(st.map, u, (dx / d) * push, (dy / d) * push);
    }
  });
}

// Выталкивание из прямоугольников зданий (юнит не может пройти сквозь).
function resolveBuildings(st, u) {
  for (const b of st.buildings) {
    if (b.dead) continue;
    const rx = b.tx * TILE, ry = b.ty * TILE, rw = b.w * TILE, rh = b.h * TILE;
    const cx = Math.max(rx, Math.min(u.x, rx + rw));
    const cy = Math.max(ry, Math.min(u.y, ry + rh));
    let dx = u.x - cx, dy = u.y - cy;
    let d = Math.hypot(dx, dy);
    if (d === 0) {
      // центр внутри здания — выталкиваем к ближайшей грани
      const left = u.x - rx, right = rx + rw - u.x, top = u.y - ry, bottom = ry + rh - u.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) tryMove(st.map, u, -(left + u.r), 0);
      else if (m === right) tryMove(st.map, u, right + u.r, 0);
      else if (m === top) tryMove(st.map, u, 0, -(top + u.r));
      else tryMove(st.map, u, 0, bottom + u.r);
    } else if (d < u.r + 1) {
      dx /= d; dy /= d;
      tryMove(st.map, u, dx * (u.r + 1 - d), dy * (u.r + 1 - d));
    }
  }
}

// Скольжение вдоль стен: по осям раздельно, с проверкой 4 углов корпуса.
function tryMove(map, u, dx, dy) {
  const r = u.r * 0.8;
  if (dx && !hitWall(map, u.x + dx, u.y, r)) u.x += dx;
  if (dy && !hitWall(map, u.x, u.y + dy, r)) u.y += dy;
}
function hitWall(map, x, y, r) {
  return map.blockedAt(((x - r) / TILE) | 0, ((y - r) / TILE) | 0) ||
         map.blockedAt(((x + r) / TILE) | 0, ((y - r) / TILE) | 0) ||
         map.blockedAt(((x - r) / TILE) | 0, ((y + r) / TILE) | 0) ||
         map.blockedAt(((x + r) / TILE) | 0, ((y + r) / TILE) | 0);
}

// ------------------------------------------------------------
// Снаряды: самонаводящиеся; урон приходит в момент попадания.
// Снаряд танка («shell») бьёт по площади — осколки задевают всех
// врагов вокруг точки попадания.
// ------------------------------------------------------------
export function updateProjectiles(st, dt) {
  for (const p of st.projectiles) {
    if (p.dead) continue;
    if (p.target && !p.target.dead) { p.tx = p.target.x; p.ty = p.target.y; }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if (d <= step + 6) {
      p.dead = true;
      if (p.target && !p.target.dead) damageEntity(st, p.target, p.dmg, p.src);
      addEffect(st, { kind: 'spark', x: p.tx, y: p.ty, ang: Math.random() * Math.PI * 2, t: 0, life: 0.18 });
      // Осколочный урон по площади.
      if (p.splash) {
        const r = p.splash.r, frac = p.splash.frac;
        for (const e of st.units) {
          if (e.dead || e.garrison || e === p.target) continue;
          if (p.src && e.side === p.src.side) continue;
          if (Math.hypot(e.x - p.tx, e.y - p.ty) <= r) damageEntity(st, e, p.dmg * frac, p.src);
        }
        for (const b of st.buildings) {
          if (b.dead || b === p.target) continue;
          if (p.src && b.side === p.src.side) continue;
          if (distToRectPx(p.tx, p.ty, b.tx * TILE, b.ty * TILE, b.w * TILE, b.h * TILE) <= r) {
            damageEntity(st, b, p.dmg * frac, p.src);
          }
        }
        addEffect(st, { kind: 'boom', x: p.tx, y: p.ty, t: 0, life: 0.5, big: true });
      }
    } else {
      p.x += (dx / d) * step; p.y += (dy / d) * step;
    }
  }
  st.projectiles = st.projectiles.filter((p) => !p.dead);
}

// ------------------------------------------------------------
// Урон и смерть. Смерть помечает объект — массивы чистятся в тике.
// ------------------------------------------------------------
export function damageEntity(st, victim, dmg, attacker) {
  if (!victim || victim.dead) return;
  // Неуязвима в бункере только пехота. У зданий garrison — это массив
  // гарнизона (пустой массив истинен!), раньше эта строка делала ВСЕ
  // постройки бессмертными — вражескую базу было невозможно разрушить.
  if (victim.kind === 'unit' && victim.garrison) return;
  // Исследования брони снижают входящий урон (минимум 1 — кровь всегда течёт).
  dmg = Math.max(1, dmg - armorVal(st, victim));
  victim.hp -= dmg;
  victim.flashT = 0.14;
  // Тревога для игрока — не чаще раза в 8 секунд.
  if (victim.side === 'player' && !st.gameOver && st.time - st.lastAlertT > 8) {
    st.lastAlertT = st.time;
    st.game.ui.toast('Мы под атакой!', 'error');
    st.pings.push({ x: victim.x, y: victim.y, t: 0 });
    st.game.sound.ping();
  }
  if (victim.hp <= 0) killEntity(st, victim, attacker);
}

function killEntity(st, v, attacker) {
  v.dead = true;
  v.selected = false;
  if (v.kind === 'unit') {
    addEffect(st, { kind: 'boom', x: v.x, y: v.y, t: 0, life: v.cfg.vehicle ? 0.6 : 0.4, big: !!v.cfg.vehicle });
    // Обломки/шипики разлетаются веером — техника даёт больше мусора.
    const n = v.cfg.vehicle ? 7 : 4;
    for (let i = 0; i < n; i++) {
      addEffect(st, {
        kind: 'debris', x: v.x, y: v.y,
        ang: Math.random() * Math.PI * 2,
        dist: 10 + Math.random() * 22,
        t: 0, life: 0.4 + Math.random() * 0.3,
      });
    }
    if (v.cfg.vehicle) addShake(st, 3, 0.16);
    st.game.sound.boom(!!v.cfg.vehicle);
  } else {
    if (v.garrison && v.garrison.length) releaseGarrison(st, v); // выжившие выпрыгивают
    st.map.unmarkBuilding(v);
    st.bcount[v.side]--;
    addEffect(st, { kind: 'boom', x: v.x, y: v.y, t: 0, life: 0.8, big: true });
    for (let i = 0; i < 10; i++) {
      addEffect(st, {
        kind: 'debris', x: v.x + (Math.random() - 0.5) * v.w * TILE * 0.6,
        y: v.y + (Math.random() - 0.5) * v.h * TILE * 0.6,
        ang: Math.random() * Math.PI * 2,
        dist: 14 + Math.random() * 30,
        t: 0, life: 0.5 + Math.random() * 0.4,
      });
    }
    addShake(st, 6, 0.3);
    st.game.sound.boom(true);
  }
  if (attacker && attacker.side === 'player' && v.side !== 'player') st.stats.kills++;
  if (v.side === 'player') st.stats.losses++;
}

// ------------------------------------------------------------
// Эффекты и всплывающий текст
// ------------------------------------------------------------
export function addEffect(st, e) {
  if (st.effects.length < 320) st.effects.push(e);
}
export function addFloat(st, x, y, text, color) {
  st.floats.push({ x, y, text, color, t: 0, life: 1.0 });
}

export function updateEffects(st, dt) {
  for (const e of st.effects) e.t += dt;
  st.effects = st.effects.filter((e) => e.t < e.life);
  for (const f of st.floats) { f.t += dt; f.y -= 26 * dt; }
  st.floats = st.floats.filter((f) => f.t < f.life);
  for (const p of st.pings) p.t += dt;
  st.pings = st.pings.filter((p) => p.t < 2.5);
}

// ------------------------------------------------------------
// Синхронизация визуальных флагов выделения (кольца на карте).
// Вызывается каждый тик: раньше флаги вообще не ставились, и кольцо
// выделения не рисовалось — игрок не видел, кем управляет.
export function syncSelectionFlags(st) {
  const sel = new Set(st.selection);
  for (const u of st.units) u.selected = !u.dead && !u.garrison && sel.has(u);
  for (const b of st.buildings) b.selected = !b.dead && sel.has(b);
}

// Пикирование мышью: юнит под точкой / здание / кристалл
// ------------------------------------------------------------
export function unitAt(st, wx, wy, sideFilter) {
  let best = null, bd = Infinity;
  for (const u of st.units) {
    if (u.dead || u.garrison) continue;
    if (sideFilter && u.side !== sideFilter) continue;
    const d = Math.hypot(u.x - wx, u.y - wy);
    if (d <= u.r + 5 && d < bd) { bd = d; best = u; }
  }
  return best;
}

export function crystalAt(st, wx, wy) {
  const tx = (wx / TILE) | 0, ty = (wy / TILE) | 0;
  return st.map.crystals.find((c) => c.tx === tx && c.ty === ty) || null;
}

// ------------------------------------------------------------
// Отрисовка юнита (rx, ry — уже интерполированная позиция).
// ------------------------------------------------------------
export function drawUnit(ctx, u, rx, ry) {
  const isP = u.side === 'player';
  const base = isP ? COLORS.player : COLORS.enemy;
  const dark = isP ? COLORS.playerDark : COLORS.enemyDark;

  // Тень.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(rx, ry + 5, u.r * 0.95, u.r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(u.angle);
  const alien = u.faction === 'alien';
  if (u.type === 'worker') {
    if (alien) {
      // Сборщик кхарид: кольчатое тельце с лапками и сумкой для кристаллов.
      ctx.strokeStyle = dark; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const lx = -6 + i * 6;
        ctx.beginPath(); ctx.moveTo(lx, -4); ctx.lineTo(lx + 2, -11); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx, 4); ctx.lineTo(lx + 2, 11); ctx.stroke();
      }
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-3, 0, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.ellipse(2, 0, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b7f0c8';
      ctx.beginPath(); ctx.arc(6, 0, 3, 0, Math.PI * 2); ctx.fill();
    } else {
      // Корпус + оранжевый рюкзак-инструментарий.
      ctx.fillStyle = dark;
      ctx.fillRect(-9, -5, 5, 10);
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0a53a';
      ctx.fillRect(-12, -4, 4, 8);
      ctx.fillStyle = '#d7e3f5';
      ctx.beginPath(); ctx.arc(3, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    }
  } else if (u.type === 'marine') {
    if (alien) {
      // Жалящий: ползун с гребнем шипов и светящейся пастью.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-2, 0, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.ellipse(1, 0, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9ff5b8';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-8 + i * 5, -4); ctx.lineTo(-6 + i * 5, -12); ctx.lineTo(-4 + i * 5, -4);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#eafff0';
      ctx.beginPath(); ctx.arc(9, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    } else {
      // Морпех: корпус + плечи + ствол.
      ctx.fillStyle = dark;
      ctx.fillRect(-7, -8, 5, 16);
      ctx.fillRect(-7, 3, 5, 5);
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2c3138';
      ctx.fillRect(4, -2, 14, 4);
      ctx.fillStyle = '#d7e3f5';
      ctx.beginPath(); ctx.arc(3, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    }
  } else if (u.type === 'buggy') {
    if (alien) {
      // Скорч: четвероногий хищник с хвостом.
      ctx.strokeStyle = dark; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(-13, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 5); ctx.lineTo(-13, 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, -5); ctx.lineTo(13, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(13, 12); ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-4, 0, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.ellipse(3, 0, 8, 5.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9ff5b8';
      ctx.beginPath(); ctx.arc(9, -2, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(9, 2, 2.2, 0, Math.PI * 2); ctx.fill();
    } else {
      // Багги: колёса, клиновидный корпус, пулемёт.
      ctx.fillStyle = '#23262b';
      ctx.fillRect(-9, -11, 7, 5); ctx.fillRect(3, -11, 7, 5);
      ctx.fillRect(-9, 6, 7, 5);  ctx.fillRect(3, 6, 7, 5);
      ctx.fillStyle = dark;
      ctx.fillRect(-11, -6, 7, 12);
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.moveTo(-6, -7); ctx.lineTo(10, -3); ctx.lineTo(10, 3); ctx.lineTo(-6, 7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2c3138';
      ctx.fillRect(7, -1.5, 11, 3);
      ctx.fillStyle = '#d7e3f5';
      ctx.beginPath(); ctx.arc(2, 0, 3, 0, Math.PI * 2); ctx.fill();
    }
  } else if (u.type === 'tank') {
    if (alien) {
      // Колосс: исполин с кристалльными рогами и светящимся ядром.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.ellipse(2, 0, 13, 9.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b7f0c8';
      ctx.beginPath(); ctx.moveTo(-2, -9); ctx.lineTo(3, -20); ctx.lineTo(8, -8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-2, 9); ctx.lineTo(3, 20); ctx.lineTo(8, 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#eafff0';
      ctx.beginPath(); ctx.arc(10, 0, 4, 0, Math.PI * 2); ctx.fill();
    } else {
      // Танк: гусеницы, корпус, башня со стволом.
      ctx.fillStyle = '#23262b';
      ctx.fillRect(-15, -13, 30, 7);
      ctx.fillRect(-15, 6, 30, 7);
      ctx.fillStyle = dark;
      ctx.fillRect(-13, -8, 25, 16);
      ctx.fillStyle = base;
      ctx.fillRect(-11, -6, 22, 12);
      ctx.fillStyle = '#2c3138';
      ctx.fillRect(3, -2.5, 21, 5);
      ctx.beginPath(); ctx.arc(-1, 0, 8.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d7e3f5';
      ctx.beginPath(); ctx.arc(2, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    }
  } else if (u.type === 'medic') {
    if (alien) {
      // Спорыш: приземистая капля с растущим ростком-свечой.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-2, 0, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.ellipse(1, 0, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#b7f0c8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-2, -4); ctx.lineTo(-2, -12); ctx.stroke();
      ctx.fillStyle = '#9ff5b8';
      ctx.beginPath(); ctx.arc(-2, -13, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#eafff0';
      ctx.beginPath(); ctx.arc(6, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    } else {
      // Медик: белый комбинезон, красный крест, короткий карабин.
      ctx.fillStyle = dark;
      ctx.fillRect(-8, -6, 4, 12);
      ctx.fillStyle = '#e8edf4';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e04b3f';
      ctx.fillRect(-2, -6, 4, 12); ctx.fillRect(-6, -2, 12, 4);
      ctx.fillStyle = '#2c3138';
      ctx.fillRect(5, -1.5, 9, 3);
      ctx.fillStyle = '#d7e3f5';
      ctx.beginPath(); ctx.arc(3, 0, 3, 0, Math.PI * 2); ctx.fill();
    }
  } else if (u.type === 'flamer') {
    if (alien) {
      // Жгут: пузатый ползун с оранжевой пастью-соплом.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-1, 0, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.ellipse(2, 0, 8, 6.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0a53a';
      ctx.fillRect(8, -3, 8, 6);
      ctx.fillStyle = '#9ff5b8';
      ctx.beginPath(); ctx.arc(-5, -5, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-5, 5, 2.4, 0, Math.PI * 2); ctx.fill();
    } else {
      // Огнемётчик: широкий корпус, баллон за спиной, толстое сопло.
      ctx.fillStyle = '#7a3428';
      ctx.fillRect(-11, -5, 5, 10);
      ctx.fillStyle = dark;
      ctx.fillRect(-6, -8, 5, 16);
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e04b3f';
      ctx.fillRect(4, -3.5, 6, 7);
      ctx.fillStyle = '#2c3138';
      ctx.fillRect(10, -2, 8, 4);
      ctx.fillStyle = '#d7e3f5';
      ctx.beginPath(); ctx.arc(3, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    }
  } else if (u.type === 'arty') {
    if (alien) {
      // Метатель: огромный червь с вздутой спиной-мортирой.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(0, 0, 18, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.ellipse(3, 0, 13, 9.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#241c34';
      ctx.beginPath(); ctx.ellipse(-4, 0, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2c3138'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(-14, -16); ctx.stroke();
      ctx.fillStyle = '#b7f0c8';
      ctx.beginPath(); ctx.arc(-14, -17, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#eafff0';
      ctx.beginPath(); ctx.arc(12, 0, 3.6, 0, Math.PI * 2); ctx.fill();
    } else {
      // САУ: длинное орудие на гусеничной платформе, сошник сзади.
      ctx.fillStyle = '#23262b';
      ctx.fillRect(-14, -12, 26, 6);
      ctx.fillRect(-14, 6, 26, 6);
      ctx.fillStyle = dark;
      ctx.fillRect(-12, -7, 22, 14);
      ctx.fillStyle = base;
      ctx.fillRect(-9, -5, 18, 10);
      ctx.fillStyle = '#2c3138';
      ctx.fillRect(6, -2, 26, 4);
      ctx.fillRect(-13, -3, 4, 6);
      ctx.fillStyle = '#d7e3f5';
      ctx.beginPath(); ctx.arc(1, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Груз минералов на спине.
  if (u.carrying > 0) {
    ctx.fillStyle = COLORS.mineral;
    ctx.beginPath(); ctx.arc(-8, 0, 4, 0, Math.PI * 2); ctx.fill();
  }
  if (u.flashT > 0) {
    ctx.fillStyle = `rgba(255,255,255,${u.flashT * 3})`;
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Кольцо выделения.
  if (u.selected) {
    ctx.strokeStyle = '#4dff7a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(rx, ry + 3, 13, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Полоска здоровья — у выделенных и раненых.
  if (u.selected || u.hp < u.maxHp) {
    const w = u.cfg.vehicle ? 34 : 24, x0 = rx - w / 2, y0 = ry - 19;
    const frac = Math.max(0, u.hp / u.maxHp);
    ctx.fillStyle = '#1a1012';
    ctx.fillRect(x0 - 1, y0 - 1, w + 2, 5);
    ctx.fillStyle = frac > 0.5 ? '#4be36a' : frac > 0.25 ? '#e8c04a' : '#e04b3f';
    ctx.fillRect(x0, y0, w * frac, 3);
  }
}
