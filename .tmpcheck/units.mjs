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
import { pathToPoint, pathToRect, distToRectPx, nearestFreeTileAround, hasLos } from './pathfinding.js';

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
    // Анти-застревание: сколько секунд «топчемся на месте» с активным
    // приказом; счётчик неудачных достроек пути; окно бокового обхода.
    this.stuckT = 0;
    this.repaths = 0;
    this.forceRepath = false;
    this.nudgeT = 0;
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
  u.order = { kind: 'move', x, y, gx: x, gy: y }; // цель помним для репаса
  u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, x, y);
  u.pathI = 0;
  u.repaths = 0; u.stuckT = 0; u.forceRepath = false;
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
  u.repaths = 0; u.stuckT = 0; u.forceRepath = false;
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
      // Маршрут мог стать непроходимым (на дороге построили здание) —
      // раз в 0.5 c проверяем ближайшие точки пути; глубоко застрявших
      // (толпа в узком проходе) тоже пересчитываем.
      repathIfBlocked(st, u, () => pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, o.gx, o.gy), 0.5);
      if (followPath(u)) {
        // Путь кончился, а до цели ещё далеко (частичный путь из A*) —
        // достраиваем; после двух неудач честно останавливаемся.
        const gd = Math.hypot(o.gx - u.x, o.gy - u.y);
        if (gd > TILE && (u.repaths || 0) < 2) {
          u.repaths = (u.repaths || 0) + 1;
          u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, o.gx, o.gy);
          u.pathI = 0;
        } else orderStop(u);
      }
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
  repathIfBlocked(st, u, () => pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y));
  if (followPath(u)) u.path = null;
}

// ----------------------------------------------------------
// Пересчёт «протухшего» пути. Две проверки:
//   1) ближайшие точки пути попали в запрещённые тайлы (дом построили
//      прямо на точке маршрута);
//   2) ОТРЕЗКИ пути перестали быть прямыми: сглаженный путь состоит из
//      LOS-отрезков, и часто это вообще одна точка-цель. Новый дом на
//      отрезке точки не портит, но прямой проход перекрывает — раньше
//      юнит в этом случае навсегда шёл в стену (проверки точек не видели
//      проблемы, а путь пересчитывался только по ним).
// Застрявших в толпе (forceRepath от интегратора) тоже пересчитываем.
// Не чаще раза в interval секунд.
// ----------------------------------------------------------
function repathIfBlocked(st, u, make, interval = 0.7) {
  if (!u.path || !u.path.length) return;
  const force = u.forceRepath;
  if (u.repathT > 0 && !force) return;
  u.repathT = interval;
  u.forceRepath = false;
  for (let k = u.pathI; k < Math.min(u.path.length, u.pathI + 3); k++) {
    const wp = u.path[k];
    if (st.map.blockedAt((wp.x / TILE) | 0, (wp.y / TILE) | 0)) {
      u.path = make(); u.pathI = 0;
      return;
    }
  }
  let ax = (u.x / TILE) | 0, ay = (u.y / TILE) | 0;
  for (let k = u.pathI; k < u.path.length; k++) {
    const bx = (u.path[k].x / TILE) | 0, by = (u.path[k].y / TILE) | 0;
    if (!hasLos(st.map, ax, ay, bx, by)) { u.path = make(); u.pathI = 0; return; }
    ax = bx; ay = by;
  }
  if (force) { u.path = make(); u.pathI = 0; }
}

// Движение по пути: true — путь завершён.
function followPath(u) {
  if (!u.path || u.pathI >= u.path.length) return true;
  // Расталкивание могло сместить юнита с линии маршрута: если следующая
  // точка уже ближе текущей — пропускаем её (анти-«пила» на поворотах).
  while (u.pathI + 1 < u.path.length) {
    const a = u.path[u.pathI], b = u.path[u.pathI + 1];
    if (Math.hypot(b.x - u.x, b.y - u.y) + 4 < Math.hypot(a.x - u.x, a.y - u.y)) u.pathI++;
    else break;
  }
  const wp = u.path[u.pathI];
  const dx = wp.x - u.x, dy = wp.y - u.y;
  const d = Math.hypot(dx, dy);
  const final = u.pathI === u.path.length - 1;
  // Допуск растёт вместе с корпусом: крупная единица (r=14) не должна
  // вечно «крутиться» вокруг точки, к которой не может подойти вплотную
  // из-за соседей/стен — раньше это выглядело как застревание на маршруте.
  const tol = final ? Math.max(9, u.r * 0.75) : Math.max(TILE * 0.4, u.r * 0.7);
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
    repathIfBlocked(st, u, () => pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: c.tx, y: c.ty, w: 1, h: 1 }));
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
    repathIfBlocked(st, u, () => pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: drop.tx, y: drop.ty, w: drop.w, h: drop.h }));
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
  repathIfBlocked(st, u, () => pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: b.tx, y: b.ty, w: b.w, h: b.h }));
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
  repathIfBlocked(st, u, () => isB
    ? pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: t.tx, y: t.ty, w: t.w, h: t.h })
    : pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y));
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
// скольжение вдоль стен (раздельно по осям) + анти-застревание:
// детекция «топтания на месте» с боковым обходом и форс-репасом.
// ------------------------------------------------------------
function integrate(st, u, dt, grid) {
  let vx = 0, vy = 0;
  if (u.moveDir) {
    let dir = u.moveDir;
    u.nudgeT = Math.max(0, (u.nudgeT || 0) - dt);
    // Застревание: намерение идти есть, но позиции почти не меняются —
    // пробуем обойти препятствие под углом («танец» вокруг пробки).
    if (u.stuckT > 0.35 && u.nudgeT <= 0) {
      const base = Math.atan2(dir.y, dir.x);
      const r2 = u.r * 0.8;
      const free = (a) => !hitWall(st.map, u.x + Math.cos(a) * 10, u.y + Math.sin(a) * 10, r2);
      let picked = null;
      for (const off of [0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
        const a = base + off;
        if (free(a)) { picked = a; break; }
      }
      if (picked != null) {
        dir = { x: Math.cos(picked), y: Math.sin(picked) };
        u.nudgeT = 0.35;
      }
    }
    vx = dir.x * u.cfg.speed;
    vy = dir.y * u.cfg.speed;
    const sep = separation(u, grid);
    vx += sep.x * 42; vy += sep.y * 42;
  }
  u.moving = Math.abs(vx) + Math.abs(vy) > 1;
  if (vx || vy) tryMove(st.map, u, vx * dt, vy * dt);
  // Учёт застревания: сколько секунд фактически стоим при активном
  // приказе. Долго стояим — форсируем пересчёт пути от текущей точки.
  const disp = Math.hypot(u.x - u.prevX, u.y - u.prevY);
  if (u.moveDir) {
    if (disp < u.cfg.speed * dt * 0.3) {
      u.stuckT += dt;
      if (u.stuckT > 1.1) { u.stuckT = 0.7; u.forceRepath = true; }
    } else {
      u.stuckT = Math.max(0, u.stuckT - dt * 2);
    }
  } else {
    u.stuckT = 0;
  }
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

// Выталкивание из прямоугольников зданий. Ключевой фикс «застрял в
// здании»: раньше толкали через tryMove, но у юнита внутри корпуса ВСЕ
// соседние клетки — «стены», проверка стен блокировала любое движение,
// и юнит оставался внутри навсегда. Теперь толкаем напрямую (направление
// всё равно наружу), с запасом, чтобы углы корпуса вышли из blocked-зоны.
function resolveBuildings(st, u) {
  for (const b of st.buildings) {
    if (b.dead) continue;
    const rx = b.tx * TILE, ry = b.ty * TILE, rw = b.w * TILE, rh = b.h * TILE;
    const cx = Math.max(rx, Math.min(u.x, rx + rw));
    const cy = Math.max(ry, Math.min(u.y, ry + rh));
    let dx = u.x - cx, dy = u.y - cy;
    let d = Math.hypot(dx, dy);
    if (d === 0) {
      // Центр внутри корпуса — выталкиваем к ближайшей грани напрямую.
      const left = u.x - rx, right = rx + rw - u.x, top = u.y - ry, bottom = ry + rh - u.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) u.x -= left + u.r + 3;
      else if (m === right) u.x += right + u.r + 3;
      else if (m === top) u.y -= top + u.r + 3;
      else u.y += bottom + u.r + 3;
      u.prevX = u.x; u.prevY = u.y; // без рывка интерполяции
      u.path = null;                // старый маршрут мог стать бессмысленным
    } else if (d < u.r) {
      dx /= d; dy /= d;
      u.x += dx * (u.r + 3 - d);
      u.y += dy * (u.r + 3 - d);
      u.prevX = u.x; u.prevY = u.y;
    }
  }
  // Страховка: если центр юнита оказался в непроходимой клетке (зажат
  // между зданиями и скалой) — переносим на ближайший свободный тайл.
  // Срабатывает редко, зато «застрявших в зданиях» больше не остаётся.
  const tx = (u.x / TILE) | 0, ty = (u.y / TILE) | 0;
  if (st.map.blockedAt(tx, ty)) {
    const spot = nearestFreeTileAround(st.map, tx, ty, 1, 1);
    if (spot) {
      u.x = (spot.x + 0.5) * TILE;
      u.y = (spot.y + 0.5) * TILE;
      u.prevX = u.x; u.prevY = u.y;
      u.path = null;
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
// Визуальный язык «Рубежа 64»: тёмные корпуса, командная палитра
// (бирюза игрока / оранж врага), светящиеся ядра, мягкие тени.
// ------------------------------------------------------------
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawUnit(ctx, u, rx, ry) {
  const isP = u.side === 'player';
  const main = isP ? COLORS.player : COLORS.enemy;
  const dark = isP ? COLORS.playerDark : COLORS.enemyDark;
  const bright = isP ? COLORS.playerBright : COLORS.enemyBright;
  const bio = '#9ff5b8';        // свечение органики кхарид
  const amber = '#f3c579';      // акценты техники Гелиоса
  const alien = u.faction === 'alien';

  // Тень под корпусом.
  ctx.fillStyle = 'rgba(0,8,13,0.47)';
  ctx.beginPath();
  ctx.ellipse(rx, ry + 6, u.r + 3, u.r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Кольцо выделения.
  if (u.selected) {
    ctx.strokeStyle = bright;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(rx, ry + 2, u.r + 6, u.r + 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(u.angle);

  if (alien) {
    // ============ КХАРИД: кристаллическая органика ============
    if (u.type === 'worker') {
      // Собиратель: кольчатое тельце, лапки, светлое ядро-фонарь.
      ctx.strokeStyle = dark; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const lx = -6 + i * 6;
        ctx.beginPath(); ctx.moveTo(lx, -4); ctx.lineTo(lx + 2, -11); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx, 4); ctx.lineTo(lx + 2, 11); ctx.stroke();
      }
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-3, 0, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(2, 0, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = bio; ctx.shadowBlur = 6;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(6, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'marine') {
      // Кристожал: ползун с гребнем светящихся шипов и пастью.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-2, 0, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(1, 0, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bio;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-8 + i * 5, -4); ctx.lineTo(-6 + i * 5, -12); ctx.lineTo(-4 + i * 5, -4);
        ctx.closePath(); ctx.fill();
      }
      ctx.shadowColor = bright; ctx.shadowBlur = 7;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(9, 0, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'buggy') {
      // Скользень: четвероногий хищник, светящиеся глаза-точки.
      ctx.strokeStyle = dark; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(-13, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 5); ctx.lineTo(-13, 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, -5); ctx.lineTo(13, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(13, 12); ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-4, 0, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(3, 0, 8, 5.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = bio; ctx.shadowBlur = 6;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(9, -2, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(9, 2, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'tank') {
      // Громила: исполин с кристаллическими рогами и ядром во лбу.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(2, 0, 13, 9.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.moveTo(-2, -9); ctx.lineTo(3, -20); ctx.lineTo(8, -8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-2, 9); ctx.lineTo(3, 20); ctx.lineTo(8, 8); ctx.closePath(); ctx.fill();
      ctx.shadowColor = bright; ctx.shadowBlur = 9;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(10, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'medic') {
      // Цветень: капля с ростком-свечой на спине.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-2, 0, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(1, 0, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = bio; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-2, -4); ctx.lineTo(-2, -12); ctx.stroke();
      ctx.shadowColor = bio; ctx.shadowBlur = 8;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(-2, -13, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(6, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    } else if (u.type === 'flamer') {
      // Кислотник: пузатый плевун с раскалённым соплом.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-1, 0, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(2, 0, 8, 6.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = '#ffb36b'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffb36b';
      ctx.fillRect(8, -3, 8, 6);
      ctx.shadowBlur = 0;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(-5, -5, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-5, 5, 2.4, 0, Math.PI * 2); ctx.fill();
    } else {
      // Спогром: огромный червь со спорной мортирой на спине.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(0, 0, 18, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(3, 0, 13, 9.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#241c34';
      ctx.beginPath(); ctx.ellipse(-4, 0, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#241c34'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(-14, -16); ctx.stroke();
      ctx.shadowColor = bio; ctx.shadowBlur = 7;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(-14, -17, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(12, 0, 3.6, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    // ============ ГЕЛИОС: ховер-техника и плазма ============
    if (u.type === 'worker') {
      // Дрон-техник: парящий корпус, лифты-подсветка, манипуляторы.
      ctx.fillStyle = '#0f232b';
      ctx.fillRect(-3, -11, 6, 3); ctx.fillRect(-3, 8, 6, 3);
      ctx.shadowColor = main; ctx.shadowBlur = 5;
      ctx.fillStyle = main;
      ctx.fillRect(-3, -9, 6, 2); ctx.fillRect(-3, 7, 6, 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = dark;
      rr(ctx, -9, -7, 18, 14, 5); ctx.fill();
      ctx.fillStyle = main;
      rr(ctx, -6, -4, 12, 8, 3); ctx.fill();
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(3, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = amber;
      ctx.fillRect(7, -6, 4, 3); ctx.fillRect(7, 3, 4, 3);
    } else if (u.type === 'marine') {
      // Рейнджер: шестигранный корпус, ствол, визор-ядро.
      ctx.fillStyle = '#1c2f36';
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(4, -9); ctx.lineTo(-7, -9); ctx.lineTo(-10, 0);
      ctx.lineTo(-7, 9); ctx.lineTo(4, 9);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath();
      ctx.moveTo(7, 0); ctx.lineTo(2, -6); ctx.lineTo(-6, -6); ctx.lineTo(-8, 0);
      ctx.lineTo(-6, 6); ctx.lineTo(2, 6);
      ctx.closePath(); ctx.fill();
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.fillRect(0, -3, 5, 6);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#16262b';
      ctx.fillRect(6, -1.6, 12, 3.2);
      ctx.fillStyle = amber;
      ctx.fillRect(-9, -10, 4, 4); ctx.fillRect(-9, 6, 4, 4);
    } else if (u.type === 'buggy') {
      // Скиф: стреловидный ховер, свечение двигателей.
      ctx.fillStyle = '#12303a';
      ctx.beginPath();
      ctx.moveTo(13, 0); ctx.lineTo(-8, -10); ctx.lineTo(-5, 0); ctx.lineTo(-8, 10);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = main; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#0d1f26';
      ctx.fillRect(-9, -12, 5, 4); ctx.fillRect(-9, 8, 5, 4);
      ctx.shadowColor = bright; ctx.shadowBlur = 7;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(1, 0, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(197,255,241,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(-2, 0, 13 + Math.sin(u.id * 1.7) * 2, -0.5, 0.6); ctx.stroke();
    } else if (u.type === 'tank') {
      // Бастион: широкий ховер-корпус, спарка осколочных стволов.
      ctx.fillStyle = '#0d2129';
      ctx.fillRect(-16, -14, 8, 5); ctx.fillRect(-16, 9, 8, 5);
      ctx.shadowColor = main; ctx.shadowBlur = 4;
      ctx.fillStyle = main;
      ctx.fillRect(-14, -14, 5, 4); ctx.fillRect(-14, 10, 5, 4);
      ctx.shadowBlur = 0;
      ctx.fillStyle = dark;
      rr(ctx, -15, -12, 29, 24, 7); ctx.fill();
      ctx.fillStyle = main;
      rr(ctx, -11, -9, 22, 18, 5); ctx.fill();
      ctx.fillStyle = bright;
      ctx.fillRect(-1, -4, 6, 8);
      ctx.fillStyle = '#16262b';
      ctx.fillRect(9, -7, 16, 3.4); ctx.fillRect(9, 3.6, 16, 3.4);
      ctx.fillStyle = amber;
      ctx.fillRect(-17, -6, 4, 12);
    } else if (u.type === 'medic') {
      // Нанит: круглый дрон-носитель с крестом наномедицины.
      ctx.fillStyle = '#223a42';
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = main; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 8.4, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.fillRect(-2, -7, 4, 14); ctx.fillRect(-7, -2, 14, 4);
      ctx.shadowBlur = 0;
      ctx.fillStyle = main;
      ctx.fillRect(-14, -3, 4, 6); ctx.fillRect(10, -3, 4, 6);
    } else if (u.type === 'flamer') {
      // Плазмер: приземистый корпус с раскалённым плазменным соплом.
      ctx.fillStyle = '#4a2c22';
      rr(ctx, -12, -5, 6, 10, 2); ctx.fill();
      ctx.fillStyle = dark;
      rr(ctx, -8, -8, 15, 16, 5); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = '#ffb36b'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffb36b';
      ctx.fillRect(4, -3.5, 7, 7);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#16262b';
      ctx.fillRect(10, -2, 9, 4);
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(-4, -6, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-4, 6, 2, 0, Math.PI * 2); ctx.fill();
    } else {
      // Мортира «Нова»: длинная платформа, поднятый ствол-мортира.
      ctx.fillStyle = '#0d2129';
      ctx.fillRect(-15, -12, 27, 5); ctx.fillRect(-15, 7, 27, 5);
      ctx.fillStyle = dark;
      rr(ctx, -13, -7, 23, 14, 4); ctx.fill();
      ctx.fillStyle = main;
      rr(ctx, -10, -5, 18, 10, 3); ctx.fill();
      ctx.fillStyle = '#16262b';
      ctx.fillRect(5, -2, 24, 4);
      ctx.fillStyle = amber;
      ctx.fillRect(-14, -3, 4, 6);
      ctx.shadowColor = bright; ctx.shadowBlur = 5;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Груз кристалла на спине (рабочие) — светится, как в Рубеже 64.
  if (u.carrying > 0) {
    ctx.shadowColor = COLORS.mineral; ctx.shadowBlur = 8;
    ctx.fillStyle = COLORS.mineral;
    ctx.beginPath();
    ctx.moveTo(-9, -4); ctx.lineTo(-5, -8); ctx.lineTo(-2, -4); ctx.lineTo(-6, 0);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (u.flashT > 0) {
    ctx.fillStyle = `rgba(255,255,255,${u.flashT * 2.8})`;
    ctx.beginPath(); ctx.arc(0, 0, u.r + 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Полоска здоровья — у выделенных и раненых (цвета команды).
  if (u.selected || u.hp < u.maxHp) {
    const w = u.cfg.vehicle ? 34 : 25, x0 = rx - w / 2, y0 = ry - u.r - 12;
    const frac = Math.max(0, u.hp / u.maxHp);
    ctx.fillStyle = 'rgba(4,15,19,0.88)';
    ctx.fillRect(x0 - 1, y0 - 1, w + 2, 6);
    ctx.fillStyle = frac < 0.33 ? '#ff806e' : isP ? '#8cedcc' : '#ffb078';
    ctx.fillRect(x0, y0, w * frac, 4);
  }
}
