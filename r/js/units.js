// ============================================================
// units.js — юниты и техника: движение по пути (A*), расталкивание,
// добыча минералов, стройка, ремонт, бункеры, бой с автоагром,
// снаряды (пуля/снаряд с осколками/удар в упор) и эффекты.
// Единый контракт сущности: kind:'unit'|'building'|'mineral',
// side:'player'|'enemy', x/y (px мира), hp, dead, cfg.
// ============================================================
import {
  TILE, UNITS, BULLET_SPEED, SHELL_SPEED, MINERAL_PER_TRIP, MINE_TIME, WORKERS_PER_CRYSTAL, gradeDmg, gradeRange, gradeGar, REPAIRERS_PER_TARGET, REPAIR_SPREAD_PX,
  HOUSE,
} from './config.js?v=10271800';
import { HOUSE_LEVELS, raidTierAt, attackMul, armorFrac, MAX_LEVEL } from './economy.js?v=10271800';
import {
  REPAIR_HP_PER_MINERAL, COLORS, fname, BUILDERS_PER_SITE, AUTOREPAIR_RADIUS, AUTOREPAIR_TICK, AUTOREPAIR_WORKERS_PER_SIDE, AUTOHEAL_RADIUS, AUTOHEAL_TICK, AUTOHEAL_HEALERS_PER_SIDE, HEALERS_PER_TARGET, HEAL_SPREAD_PX, ALARM_BASE_RADIUS, RECON_TICK, RECON_FLEE_TILES, RECON_SAMPLES, CONTACT_COOLDOWN} from './config.js?v=10271800';
import { pathToPoint, pathToRect, distToRectPx, nearestFreeTileAround, hasLos, hasLosClear, nearestFreeFrom } from './pathfinding.js?v=10271800';
import { t, message } from './i18n.js?v=10271800';
import { drawUnitGrade, unitScale as skinUnitScale } from './skins.js?v=10271800';

let nextId = 1;

// ----------------------------------------------------------
// Детерминированный ГПСЧ боя (задел под сетевую игру): вся
// ЛОГИКА, которой нужна случайность (таймеры сканирования,
// углы выселения, спавн волн ИИ), берёт числа отсюда — один
// seed даёт один бой. Чисто визуальные разбросы (искры, дым,
// обломки) оставлены на Math.random: на симуляцию они не влияют.
// Состояние — st.rngState (uint32), инициализируется в newGame.
// ----------------------------------------------------------
export function srand(st) {
  let a = (st.rngState = ((st.rngState || 1) + 0x6D2B79F5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Габарит корпуса для сглаживания пути: юнит должен проходить
// коридор, а не чиркать углами (Г5). Берём 0.8 радиуса — тот же,
// что проверяет tryMove, иначе путь и физика спорят друг с другом.
function clearanceOf(u) { return u.r * 0.8; }

// ----------------------------------------------------------
// Технологии сторон: бонусы атак/брони из исследований лаборатории.
// attacker.kind==='building' (турель) считается пехотным оружием.
// ----------------------------------------------------------
export function atkBonus(st, attacker) {
  if (!st || !st.tech || !attacker || !attacker.side) return 0;
  if (attacker.kind === 'unit' && !(attacker.cfg.dmg > 0)) return 0; // H.3: затвор №1 — безоружный не вооружается ресерчами
  const t = st.tech[attacker.side];
  if (!t) return 0;
  const veh = attacker.kind === 'unit' && attacker.cfg.vehicle;
  const lvl = t[veh ? 'vehAtk' : 'infAtk'] || 0;
  // Э1: ранг даёт +4% БАЗОВОГО урона за уровень (на 20 ур. ×1.8).
  // Турель (здание) считается пехотным оружием, база — её грейдовый урон.
  const base = attacker.kind === 'building'
    ? gradeDmg(attacker.type, attacker.level || 1, attacker.cfg.dmg)
    : attacker.cfg.dmg;
  // Э7: во время обороны базы командир даёт своей стороне +X% урона.
  // Важно: бонус работает и без изученных рангов (lvl = 0), иначе на старте
  // командир был бы «невидимым».
  let bonus = lvl ? Math.round(base * (attackMul(lvl) - 1) * 10) / 10 : 0;
  if (st.homeRaid && st.homeRaid.active && attacker.side === 'player') {
    const buff = Number(st.homeRaid.active.buff) || 1;
    if (buff > 1) bonus = Math.round((bonus + base * (buff - 1)) * 10) / 10;
  }
  return bonus;
}
// Э1: доля снижения урона от ранга брони (2.5%/ур., потолок 50%).
export function damageTakenMul(st, victim) {
  if (!st || !st.tech || !victim || victim.kind !== 'unit') return 1;
  const t = st.tech[victim.side];
  if (!t) return 1;
  const lvl = t[victim.cfg.vehicle ? 'vehArm' : 'infArm'] || 0;
  return 1 - armorFrac(lvl);
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
    this.scanT = srand(st) * 0.3;     // таймер автопоиска цели (детерминирован)
    this.repathT = 0;
    // Анти-застревание (лестница эскалации):
    // stuckT — секунд топчемся прямо сейчас; stuckTotal — суммарно по
    // приказу (долго стоим → честно сдаёмся, а не дёргаемся вечно);
    // wallSide/wallT — память обхода стены (правило одной руки —
    // выход из вогнутых карманов); waitT — пауза уступания в толпе;
    // failCount — сколько одинаковых репутей подряд (разрыв цикла Г3).
    this.stuckT = 0;
    this.stuckTotal = 0;
    this.repaths = 0;
    this.forceRepath = false;
    this.nudgeT = 0;
    this.wallSide = 0;                // -1 лево / +1 право / 0 не выбран
    this.wallT = 0;
    this.waitT = 0;
    this.yielded = false;
    this.failCount = 0;
    this.idleReason = null;           // 'unreachable' — цель недостижима
    this.carrying = 0;                // груз минералов
    this.phase = null;                // подстадия добычи
    this.mineT = 0;
    this.flashT = 0;
    this.evacT = 0;                   // секунд подряд в зоне эвакуации (M0)
    this.evacuated = false;           // погружён: не считается погибшим
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

// Вместимость «отсека»: бункер — гарнизон по грейду, Дом — его вместимость
// (решение владельца 25.10: у Дома одно число на отряд и на рейд).
export function unitCapOf(b) {
  if (!b) return 0;
  if (b.type === 'depot') return HOUSE_LEVELS.slots(b.level || 1);
  return gradeGar(b.type, b.level || 1, b.cfg && b.cfg.garrisonCap);
}

// ------------------------------------------------------------
// Приказы
// ------------------------------------------------------------
export function orderMove(st, u, x, y) {
  if (u.garrison) return; // сидящего в бункере нельзя командовать
  u.order = { kind: 'move', x, y, gx: x, gy: y }; // цель помним для репаса
  u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, x, y, { clearance: clearanceOf(u) });
  u.pathI = 0;
  resetStuck(u);
}

function resetStuck(u) {
  u.repaths = 0; u.stuckT = 0; u.stuckTotal = 0; u.forceRepath = false;
  u.wallSide = 0; u.wallT = 0; u.waitT = 0; u.yielded = false;
  u.failCount = 0; u.idleReason = null;
}

// Группа идёт в точку строем: каждой единице свой слот вокруг цели —
// так отряд не пытается встать в одну точку. Слоты проверяются по
// карте: занятый слот (вода/скала/здание) сдвигается на ближайший
// свободный тайл (Г7), дубли слотов разводятся — «мёртвых пробок»
// из недостижимых целей больше нет.
export function orderMoveGroup(st, units, x, y) {
  const goals = formationGoals(st, units, x, y);
  for (let i = 0; i < units.length; i++) {
    orderMove(st, units[i], goals[i].x, goals[i].y);
  }
}

// Цели строя с валидацией по проходимости. Детерминировано: порядок
// слотов фиксирован, сдвиги — спиралью от слота наружу.
export function formationGoals(st, units, x, y) {
  const offs = formationOffsets(units.length);
  const used = new Set();
  const out = [];
  for (let i = 0; i < units.length; i++) {
    const wx = x + offs[i][0], wy = y + offs[i][1];
    // G.5/хотфикс L: кламп на РЕАЛЬНЫЙ размер карты (63 был легаси 64×64 —
    // на картах 80/96 строй у правого/нижнего края зажимался на тайл 63,
    // и войска не доходили до края). Ключ занятости — от map.w: занятость
    // строго в координатах карты, без завязки на былой 64×64.
    let tx = Math.max(0, Math.min(st.map.w - 1, (wx / TILE) | 0));
    let ty = Math.max(0, Math.min(st.map.h - 1, (wy / TILE) | 0));
    if (st.map.blockedAt(tx, ty) || used.has(ty * st.map.w + tx)) {
      // Ищем свободный НЕЗАНЯТЫЙ тайл спиралью (до 6 тайлов — дальше
      // строй уже не строй). Важно перебирать кольцо самим, а не звать
      // nearestFreeFrom с растущим радиусом: он возвращал бы один и тот
      // же ближайший тайл всем слотам, и строй схлопывался в точку.
      const spot = freeSlotNear(st.map, tx, ty, used, 6);
      tx = spot.x; ty = spot.y;
    }
    used.add(ty * st.map.w + tx);
    // Точка внутри тайла + детерминированный микро-сдвиг по id,
    // чтобы два юнита не целились в один пиксель.
    const u = units[i];
    const jx = ((u.id * 13) % 11 - 5) * 0.9, jy = ((u.id * 7) % 11 - 5) * 0.9;
    out.push({ x: (tx + 0.5) * TILE + jx, y: (ty + 0.5) * TILE + jy });
  }
  return out;
}

// Свободный незанятый тайл спиралью от (tx, ty). Детерминирован:
// кольца по возрастанию, внутри кольца — ближе к центру, при равной
// дальности — просторнее (openness: строй не жмётся к стенам), далее
// по (y, x). Fallback — ближайший свободный хоть и занятый (тесно,
// но приказ выполним), в крайнем случае — исходный тайл.
function freeSlotNear(map, tx, ty, used, maxR) {
  const key = (x, y) => y * map.w + x; // хотфикс L: тот же ключ, что и в formationGoals
  if (!map.blockedAt(tx, ty) && !used.has(key(tx, ty))) return { x: tx, y: ty };
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = Infinity, bo = -1;
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!map.inBounds(x, y) || map.blockedAt(x, y) || used.has(key(x, y))) continue;
        const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
        const o = map.opennessAt ? map.opennessAt(x, y) : 8;
        if (!best || d < bd ||
            (d === bd && (o > bo || (o === bo && (y < best.y || (y === best.y && x < best.x)))))) {
          bd = d; bo = o; best = { x, y };
        }
      }
    }
    if (best) return best;
  }
  return nearestFreeFrom(map, tx, ty, maxR) || { x: tx, y: ty };
}

export function orderAttack(st, u, target) {
  if (u.cfg.scout) return; // H.3: затвор №4 — разведчик игнорирует приказы атаковать
  if (u.garrison) return;
  u.order = { kind: 'attack', target, auto: false };
  u.path = null; u.pathI = 0; u.repathT = 0;
  resetStuck(u);
}

// Атака-движение (клавиша A + ЛКМ): идти к точке и вступать в бой
// со всеми врагами, встреченными по дороге. Явный приказ — без «поводка».
export function orderAttackMove(st, u, x, y) {
  if (u.garrison) return;
  u.order = { kind: 'attackMove', x, y, gx: x, gy: y, target: null };
  u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, x, y, { clearance: clearanceOf(u) });
  u.pathI = 0;
  resetStuck(u);
}

// ВЛАДЕЛЕЦ 25.10: ближайший к (tx,ty) проходимый тайл (спираль радиусом 3).
function walkableNear(map, tx, ty) {
  if (map.inBounds(tx, ty) && !map.blockedAt(tx, ty)) return { x: tx, y: ty };
  for (let r = 1; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (const dy of (Math.abs(dx) === r ? range2(-r, r) : [-r, r])) {
        if (map.inBounds(tx + dx, ty + dy) && !map.blockedAt(tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
      }
    }
  }
  return { x: tx, y: ty };
}
function range2(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; }

// ------------------------------------------------------------
// #36 З2: канон владельца «лимит — сколько Дом может увезти».
// Пока трюм Дома-шаттла не полон, рабочий бурит как обычно. Как только
// очередной рейс уже не влезает (raidCargo >= cap или cap - trip < 0),
// рабочий НЕ идёт за новой добычей: он едет к площадке челнока, встаёт и
// ждёт эвакуации. Флаг u.evacWait/evacHold говорит авто-логике (диспетчер
// ремонта, авто-возврат к кристаллу, авто-лечение), что юнита трогать нельзя.
// ------------------------------------------------------------
export function isAutoLocked(u) {
  return !!(u && (u.evacWait || u.evacHold));
}

// Явный приказ игрока снимает ожидание: игрок всегда главнее авто-логики.
export function clearEvacFlags(units) {
  for (const u of units || []) {
    if (!u) continue;
    u.evacWait = false;
    u.evacHold = false;
    if (u.order) { u.order.evacWait = false; u.order.evacHold = false; }
  }
}

// Полевые юниты стороны: не в отсеке, не на борту, живые.
export function fieldUnits(st, side = 'player') {
  return st.units.filter((u) => !u.dead && !u.evacuated && !u.garrison &&
    u.side === side && u.kind === 'unit');
}

// Трюм вылазки уже не примет ещё один рейс?
export function raidHoldFull(st, u) {
  if (!st || st.raidMode !== 'expedition' || !u || u.side !== 'player') return false;
  const cap = Number(st.raidCargoCap) || HOUSE.cargo;
  const cargo = Number(st.raidCargo) || 0;
  const trip = Number(st.raidTripYield) || MINERAL_PER_TRIP;
  // Трюм полон ИЛИ в него не влезает даже один рейс — бурить бессмысленно.
  return cargo >= cap || cap - trip <= 0;
}

// Рейс к площадке шаттла и ожидание эвакуации (п.1-2 спеки #36 З2).
export function parkWorkerAtShuttle(st, u) {
  if (!u || u.dead || u.garrison) return;
  const pad = st.raidDrop;
  u.evacWait = true;
  if (!pad || (st.raidHouse && st.raidHouse.dead)) {
    orderStop(u);
    u.order.evacWait = true;
    return;
  }
  const radPx = Math.max(TILE * 2.2, (pad.r || 2.2) * TILE);
  if (Math.hypot(u.x - pad.x, u.y - pad.y) <= radPx * 0.9) {
    // Уже у челнока — стоим и ждём (никакой авто-добычи: флаг держит).
    orderStop(u);
    u.order.evacWait = true;
  } else {
    // Тайлы Дома заняты зданием — идём к ближайшему свободному рядом.
    const near = nearestFreeTileAround(st.map, pad.tx, pad.ty, 1, 1) || { x: pad.tx, y: pad.ty };
    orderMove(st, u, (near.x + 0.5) * TILE, (near.y + 0.5) * TILE);
    u.order.evacWait = true;
  }
  if (!st.evacWaitToasted) {
    st.evacWaitToasted = true;
    try { st.game.ui.toast(t('ui.raid.toastEvacWait'), 'info', 3600); } catch { /* headless */ }
  }
}

// Сбор у площадки по команде «Эвакуация»: сбрасываем добычу/бой и держим
// юнита в кольце. Раньше перебивались только те, кто стоял ВНЕ кольца, и
// рабочий с приказом gather спокойно уходил бурить посреди эвакуации
// (репро SZ BUG-1a).
export function orderEvacHold(st, u, pad) {
  if (!u || u.dead || u.garrison) return;
  u.evacWait = false;
  u.evacT = 0;
  if (!pad) { orderStop(u); return; }
  const radPx = Math.max(TILE * 2.2, (pad.r || 2.2) * TILE);
  if (Math.hypot(u.x - pad.x, u.y - pad.y) <= radPx * 0.8) {
    orderStop(u);
    u.order.evacHold = true;
    u.evacHold = true;
  } else {
    const near = nearestFreeTileAround(st.map, pad.tx, pad.ty, 1, 1) || { x: pad.tx, y: pad.ty };
    orderMove(st, u, (near.x + 0.5) * TILE, (near.y + 0.5) * TILE);
    u.order.evacHold = true;
    u.evacHold = true;
  }
}

export function orderGather(st, u, crystal, excludeFail) {
  if (u.garrison) return;
  if (isAutoLocked(u)) return; // #36 З2: ждёт эвакуации у челнока — не бурит
  u.order = { kind: 'gather', target: crystal, phase: u.carrying > 0 ? 'toDrop' : 'toMineral' };
  if (excludeFail) u.lastFailed = crystal;
  u.path = null; u.pathI = 0;
  resetStuck(u);
}

// Стройка и ремонт помнят прежний кристалл: завершив работу, рабочий
// сам вернётся к добыче, а не замрёт у стены (авто-режим «вернуться
// к делу» — как у инженеров Рубежа 64).
export function orderBuild(st, u, building, auto = false) {
  if (u.garrison) return;
  u.order = { kind: 'build', target: building, resume: currentCrystal(u), auto };
  u.path = null; u.pathI = 0;
  resetStuck(u);
}

// Ремонт: рабочий «сваривает» здание или технику до полного HP.
// auto:true — приказ автоматической логики (idle-поиск или диспетчер),
// не команда игрока; маркер нужен для бюджета, лимита и безопасного снятия.
export function orderHeal(st, u, target, auto = false) {
  if (u.garrison || !u.cfg.canHeal) return false;
  if (auto && isAutoLocked(u)) return false; // #36 З2: ждёт эвакуации — не дёргаем
  if (!canBeHealed(target) || target.side !== u.side || target.faction !== u.faction) return false;
  if (target.hp >= target.maxHp) return false;
  u.order = { kind: 'heal', target, auto };
  u.path = null; u.pathI = 0;
  resetStuck(u);
  return true;
}

export function orderRepair(st, u, target, auto = false) {
  if (u.garrison) return;
  if (auto && isAutoLocked(u)) return; // #36 З2: отряд собран у челнока
  u.order = { kind: 'repair', target, resume: currentCrystal(u), auto };
  u.path = null; u.pathI = 0;
  resetStuck(u);
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

// G.3: цепочка строек — достроил → ближайший свободный недострой своей
// стороны (BUILDERS_PER_SITE на сайт в силе, учёт живой из ордеров);
// сайтов нет → к добыче.
export function chainBuild(st, u, doneB) {
  let best = null, bd = Infinity;
  for (const s of st.buildings) {
    if (s === doneB || s.dead || s.done || s.side !== u.side) continue;
    if (buildersOf(st, s) >= BUILDERS_PER_SITE) continue;
    const d = Math.hypot(s.x - u.x, s.y - u.y);
    if (d < bd) { bd = d; best = s; }
  }
  if (best) orderBuild(st, u, best);
  else resumeGather(st, u);
}

// G.4: сколько своих уже чинит цель (живой учёт из ордеров, приём F.1).
export function repairersOf(st, t, self) {
  let n = 0;
  for (const w of st.units) {
    if (w === self || w.dead || w.side !== t.side || !w.cfg.canRepair) continue;
    const o = w.order;
    if (o.kind === 'repair' && o.target === t) n++;
  }
  return n;
}

const REPAIR_BUDGET_EPSILON = 1e-6;
function remainingRepairCost(target) {
  if (!target || !Number.isFinite(target.maxHp) || !Number.isFinite(target.hp)) return Infinity;
  return Math.max(0, target.maxHp - target.hp) / REPAIR_HP_PER_MINERAL;
}
function activeRepairTargets(st, side) {
  const targets = new Set();
  for (const u of st.units) {
    const o = u.order, target = o && o.target;
    if (u.dead || u.side !== side || !u.cfg.canRepair || o.kind !== 'repair' ||
        !target || target.dead || target.side !== side || target.hp >= target.maxHp) continue;
    targets.add(target);
  }
  return targets;
}
function reservedRepairMinerals(st, side, extraTarget = null) {
  const targets = activeRepairTargets(st, side);
  if (extraTarget) targets.add(extraTarget);
  let total = 0;
  for (const target of targets) total += remainingRepairCost(target);
  return total;
}
function repairTargetPriorityCompare(a, b) {
  return (a.hp / a.maxHp) - (b.hp / b.maxHp) || (a.id || 0) - (b.id || 0);
}
function autoRepairBudgetThrough(st, side, target) {
  const manualTargets = new Set(), autoTargets = new Set();
  for (const u of st.units) {
    const o = u.order, t = o && o.target;
    if (u.dead || u.side !== side || !u.cfg.canRepair || o.kind !== 'repair' ||
        !t || t.dead || t.side !== side || t.hp >= t.maxHp) continue;
    (o.auto ? autoTargets : manualTargets).add(t);
  }
  let total = 0;
  for (const manual of manualTargets) total += remainingRepairCost(manual);
  if (manualTargets.has(target)) return total;
  const orderedAutoTargets = [...autoTargets].filter((t) => !manualTargets.has(t)).sort(repairTargetPriorityCompare);
  for (const autoTarget of orderedAutoTargets) {
    total += remainingRepairCost(autoTarget);
    if (autoTarget === target) return total;
  }
  return Infinity;
}
function autoRepairerCount(st, side) {
  return st.units.filter((u) => !u.dead && !u.garrison && u.side === side && u.cfg.canRepair &&
    u.order.kind === 'repair' && u.order.auto).length;
}
function canStartAutoRepair(st, side, target) {
  if (!target || target.dead || target.side !== side || target.hp >= target.maxHp) return false;
  if (autoRepairerCount(st, side) >= AUTOREPAIR_WORKERS_PER_SIDE) return false;
  if (repairersOf(st, target) >= REPAIRERS_PER_TARGET) return false;
  const budget = Number(st.minerals[side]) || 0;
  return budget + REPAIR_BUDGET_EPSILON >= reservedRepairMinerals(st, side, target);
}
function sendIdleRepairerToGather(st, u) {
  if (isAutoLocked(u)) return; // #36 З2: отряд собран у челнока — не выдёргиваем
  if (!u.cfg.canMine) { orderStop(u); return; }
  if (raidHoldFull(st, u)) { parkWorkerAtShuttle(st, u); return; }
  const crystal = nearestCrystal(st, u);
  if (crystal) orderGather(st, u, crystal);
  else orderStop(u);
}

// G.4: распределение ручного ремонта — кликнутая цель первая, дальше
// повреждённые техника+здания в радиусе по близости, по 2 на цель;
// излишек продолжает добычу (добывать не умеет — стоит).
export function orderRepairSpread(st, repairers, x, y, primary) {
  if (!repairers.length) return;
  const side = repairers[0].side;
  const pool = [];
  const seen = new Set();
  const push = (t) => {
    if (t && !t.dead && t.side === side && t.hp < t.maxHp && !seen.has(t.id)) {
      seen.add(t.id); pool.push(t);
    }
  };
  push(primary);
  const rest = [];
  for (const b of st.buildings) {
    if (b.side !== side || b.dead || b.hp >= b.maxHp || seen.has(b.id)) continue;
    rest.push([distToRectPx(x, y, b.tx * TILE, b.ty * TILE, b.w * TILE, b.h * TILE), b]);
  }
  for (const v of st.units) {
    // B3: в волне ремонта рядом — техника И раненые сборщики.
    if (v.kind !== 'unit' || v.side !== side || v.dead || !canBeRepaired(v) || v.hp >= v.maxHp || seen.has(v.id)) continue;
    rest.push([Math.hypot(v.x - x, v.y - y), v]);
  }
  rest.sort((a, b) => a[0] - b[0]);
  for (const [d, t] of rest) { if (d <= REPAIR_SPREAD_PX) push(t); }
  for (const u of repairers) {
    const slot = pool.find((t) => repairersOf(st, t, u) < REPAIRERS_PER_TARGET);
    if (slot) { orderRepair(st, u, slot); continue; }
    if (u.cfg.canMine) {
      const c = nearestCrystal(st, u);
      if (c) orderGather(st, u, c);
      else orderStop(u);
    } else orderStop(u);
  }
}

// H.3: разведка — приказ «Разведать» (КЦ Г3): расходятся по туману,
// огибают врага (в бой не вступают), докладывают о жилах и контактах.
export function orderScout(st, u) {
  if (u.garrison) return;
  u.order = { kind: 'scout', failed: [], evading: false };
  u.path = null; u.pathI = 0; u.scanT = 0;
  u.moveDir = null; u.moving = false;
  resetStuck(u);
}

function updateScout(st, u, dt, grid) {
  u.scanT -= dt;
  if (u.scanT <= 0) {
    u.scanT = RECON_TICK;
    scoutThink(st, u, grid);
    if (u.order.kind !== 'scout') return; // карта разведана
  }
  if (!u.path && !u.order.evading) scoutPickTarget(st, u);
  if (u.path && followPath(st, u)) {
    // Частичный/непроходимый путь: не зацикливаемся на том же тайле.
    const o = u.order;
    if (o.kind === 'scout' && !o.evading && o.tx !== undefined &&
        !st.fog.tileExplored(o.tx, o.ty)) {
      const k = o.tx + ',' + o.ty;
      o.failed = o.failed || [];
      if (!o.failed.includes(k)) { o.failed.push(k); if (o.failed.length > 64) o.failed.shift(); }
    }
    u.path = null;
    u.pathI = 0;
    u.moveDir = null; u.moving = false;
  }
}

function scoutThink(st, u, grid) {
  const R = u.cfg.sightTiles * TILE;
  // 1. Угрозы: ближайший видимый вражеский юнит — отход на 6 тайлов.
  let threat = null, td = Infinity;
  grid.query(u.x, u.y, R, (e) => {
    if (e.dead || e.side === u.side || e.kind !== 'unit' || e.garrison) return;
    if (u.side === 'player' && !e.visible) return;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < td) { td = d; threat = e; }
  });
  if (threat) {
    const o = u.order;
    o.evading = true; o.tx = undefined; o.ty = undefined;
    const dx = u.x - threat.x, dy = u.y - threat.y;
    const len = Math.hypot(dx, dy) || 1, ax = dx / len, ay = dy / len;
    const L = RECON_FLEE_TILES * TILE;
    // Прямо от врага; если там стена — боковой шаг, затем диагонали.
    const dirs = [
      [ax, ay], [ax + 0.7 * -ay, ay + 0.7 * ax], [ax - 0.7 * -ay, ay - 0.7 * ax],
      [-ay, ax], [ay, -ax], [1, 0], [-1, 0], [0, 1], [0, -1],
    ];
    let bestPath = null, bestScore = td;
    for (const [vx, vy] of dirs) {
      const vl = Math.hypot(vx, vy) || 1;
      const fx = Math.max(TILE, Math.min(st.map.pxW - TILE, u.x + (vx / vl) * L));
      const fy = Math.max(TILE, Math.min(st.map.pxH - TILE, u.y + (vy / vl) * L));
      if (st.map.blockedAt((fx / TILE) | 0, (fy / TILE) | 0)) continue;
      const path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, fx, fy, { clearance: clearanceOf(u) });
      if (!path || !path.length) continue;
      const end = path[path.length - 1];
      const score = Math.hypot(end.x - threat.x, end.y - threat.y);
      if (score > bestScore + 8) { bestScore = score; bestPath = path; }
    }
    u.path = bestPath;
    u.pathI = 0;
    u.moveDir = null; u.moving = false;
  } else {
    u.order.evading = false;
  }

  if (u.side !== 'player') return; // ИИ не строит разведчиков; доклады только игроку.
  // 2. Жилы: впервые увиденное месторождение поля — тост + пинг.
  // F.1 даёт fieldId; fallback на координаты для старых/тестовых карт.
  const fields = st.reportedFields || (st.reportedFields = new Set());
  for (const c of st.map.crystals) {
    if (c.amount <= 0 || Math.hypot(c.x - u.x, c.y - u.y) > R) continue;
    if (!st.fog.tileExplored(c.tx, c.ty)) continue;
    const key = c.fieldId ? 'f' + c.fieldId : 'c' + c.tx + ',' + c.ty;
    if (fields.has(key)) continue;
    fields.add(key);
    st.pings.push({ x: c.x, y: c.y, t: 0 });
    st.game.ui.toast(message('veinFound', st.factions.player), 'info');
  }
  // 3. Контакт: враг (юнит или строение) сейчас виден — пинг + тост, кд 10с.
  let contact = !!threat;
  if (!contact) {
    for (const b of st.buildings) {
      if (b.dead || b.side === u.side) continue;
      const tx = b.tx + (b.w >> 1), ty = b.ty + (b.h >> 1);
      if (st.fog.tileVisible(tx, ty) && Math.hypot(b.x - u.x, b.y - u.y) <= R) { contact = true; break; }
    }
  }
  const lastContact = st.lastContactT == null ? -99 : st.lastContactT;
  if (contact && st.time - lastContact > CONTACT_COOLDOWN) {
    st.lastContactT = st.time;
    st.pings.push({ x: u.x, y: u.y, t: 0 });
    st.game.ui.toast(message('contact', st.factions.player), 'warn');
  }
}

function scoutPickTarget(st, u) {
  const W = st.map.w, H = st.map.h, failed = u.order.failed || [];
  let best = null, bdd = Infinity;
  const consider = (tx, ty, allowFailed = false) => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H || st.fog.tileExplored(tx, ty) || st.map.blockedAt(tx, ty)) return;
    if (!allowFailed && failed.includes(tx + ',' + ty)) return;
    const d = Math.hypot((tx + 0.5) * TILE - u.x, (ty + 0.5) * TILE - u.y);
    if (d < bdd) { bdd = d; best = { tx, ty }; }
  };
  // K=12 deterministic samples; per-scout update order advances srand(st), so groups spread.
  for (let i = 0; i < RECON_SAMPLES; i++) consider((srand(st) * W) | 0, (srand(st) * H) | 0);
  if (!best) {
    // Exhaustive fallback: don't miss a lone unexplored tile between samples.
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) consider(tx, ty);
  }
  if (!best && failed.length) {
    // Every remaining passable tile failed pathing: permit a retry, but don't
    // falsely report the world fully explored.
    u.order.failed = [];
    for (let ty = 0; ty < H && !best; ty++) for (let tx = 0; tx < W && !best; tx++) consider(tx, ty, true);
  }
  if (!best) {
    orderStop(u);
    const lastDone = st.lastReconDoneT == null ? -99 : st.lastReconDoneT;
    if (u.side === 'player' && st.time - lastDone > 5) {
      st.lastReconDoneT = st.time;
      st.game.ui.toast(message('reconDone', st.factions.player), 'info');
    }
    return;
  }
  u.order.tx = best.tx; u.order.ty = best.ty;
  u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0,
    (best.tx + 0.5) * TILE, (best.ty + 0.5) * TILE, { clearance: clearanceOf(u) });
  u.pathI = 0;
}

// Гарнизон: пехота заходит в бункер.
export function orderGarrison(st, u, bunker) {
  if (u.garrison) return;
  u.order = { kind: 'garrison', target: bunker };
  u.path = null; u.pathI = 0;
  resetStuck(u);
}

export function orderStop(u) {
  u.order = { kind: 'idle' };
  u.path = null; u.pathI = 0;
  u.moveDir = null; u.moving = false;
  u.stuckT = 0; u.stuckTotal = 0; u.forceRepath = false;
  u.wallT = 0; u.waitT = 0; u.failCount = 0;
}

// Выпустить всех из бункера — рядом со стенками.
export function releaseGarrison(st, b) {
  if (!b.garrison) return;
  for (const m of b.garrison) {
    if (m.dead) continue;
    m.garrison = null;
    m.hidden = false;
    const a = srand(st) * Math.PI * 2; // детерминированный угол выхода
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

// F.1: жёсткий выбор по месторождениям (была «анти-толпа» штрафом).
// Свободный (crowd < 2) в ближайшем непустом поле → свободный в других →
// маржинальный (< 3) → наименее людный. Занятость — производная из ордеров
// (приём buildersOf); ремонтное resume не считаем — рабочий занят стройкой.
export function nearestCrystal(st, u, exclude) {
  const byField = new Map();
  for (const c of st.map.crystals) {
    if (c.amount <= 0 || c.dead || c === exclude) continue;
    const d = Math.hypot(c.x - u.x, c.y - u.y);
    const fid = c.fieldId === undefined ? -1 : c.fieldId;
    if (!byField.has(fid)) byField.set(fid, []);
    byField.get(fid).push({ c, d });
  }
  if (!byField.size) return null;
  const crowd = (c) => {
    let n = 0;
    for (const w of st.units) {
      if (w === u || w.dead || w.side !== u.side || w.type !== 'worker') continue;
      const o = w.order;
      if ((o.kind === 'gather' && o.target === c) ||
          (o.kind === 'build' && o.resume === c)) n++;
    }
    return n;
  };
  const fields = [...byField.values()]
    .map((list) => ({ list, near: Math.min(...list.map((e) => e.d)) }))
    .sort((a, b) => a.near - b.near);
  for (const lim of [WORKERS_PER_CRYSTAL, WORKERS_PER_CRYSTAL + 1]) {
    for (const f of fields) {
      let best = null, bd = Infinity;
      for (const { c, d } of f.list) {
        const n = crowd(c);
        if (n >= lim) continue;
        const s = d + n * TILE * 2.2;
        if (s < bd) { bd = s; best = c; }
      }
      if (best) return best;
    }
  }
  // Фолбэк: наименее людный, при равной толпе — ближайший.
  let best = null, bs = Infinity;
  for (const f of fields) for (const { c, d } of f.list) {
    const s = crowd(c) * 1e6 + d;
    if (s < bs) { bs = s; best = c; }
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
  updateAutoRepair(st, dt); // H.1
  updateAutoHeal(st, dt);   // правка 26.10: КЦ отправляет хилов к раненым
}

// Есть ли у стороны достроенный КЦ (для правила «хила отправляет КЦ»).
function hasOwnCC(st, side) {
  for (const b of st.buildings) {
    if (!b.dead && b.done && b.side === side && b.type === 'cc') return true;
  }
  return false;
}

// Диспетчер авто-лечения (правка владельца 26.10.2026): «авто лечение — когда
// хила отправляет КЦ лечить раненого». Работает только у достроенного КЦ и в
// его радиусе: КЦ находит раненое СУЩЕСТВО своей расы и отправляет к нему
// ближайшего свободного хила. Приказы игрока неприкосновенны — диспетчер
// берёт только простаивающих хилов и только когда у цели нет лекаря.
// P3/#35: ПКМ «лечить» — симметрично orderRepairSpread. Кликнутая цель
// первая, дальше раненые СУЩЕСТВА своей расы в радиусе по близости, по 2 хила
// на цель; излишек хилов возвращается к делу (добыча) или просто стоит.
// Технику и дронов лечить нельзя никогда (canBeHealed) — это ремонт сборщиков.
export function healersOf(st, t, self) {
  let n = 0;
  for (const h of st.units) {
    if (h === self || h.dead || h.side !== t.side || !h.cfg.canHeal) continue;
    if (h.faction !== t.faction) continue;
    const o = h.order;
    if (o && o.kind === 'heal' && o.target === t) n++;
  }
  return n;
}

export function orderHealSpread(st, healers, x, y, primary) {
  if (!healers.length) return false;
  const side = healers[0].side;
  const faction = healers[0].faction;
  const pool = [];
  const seen = new Set();
  const push = (t) => {
    if (!t || t.dead || t.garrison || t.side !== side) return;
    if (!canBeHealed(t) || t.faction !== faction || t.hp >= t.maxHp || seen.has(t.id)) return;
    seen.add(t.id); pool.push(t);
  };
  push(primary);
  const rest = [];
  for (const v of st.units) {
    if (v.kind !== 'unit' || v.side !== side || v.dead || v.garrison || seen.has(v.id)) continue;
    if (!canBeHealed(v) || v.faction !== faction || v.hp >= v.maxHp) continue;
    rest.push([Math.hypot(v.x - x, v.y - y), v]);
  }
  rest.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
  for (const [d, t] of rest) if (d <= HEAL_SPREAD_PX) push(t);
  if (!pool.length) return false;
  let any = false;
  for (const h of healers) {
    const slot = pool.find((t) => t !== h && healersOf(st, t, h) < HEALERS_PER_TARGET);
    if (slot && orderHeal(st, h, slot, false)) { any = true; continue; }
    if (h.cfg.canMine) {
      const c = nearestCrystal(st, h);
      if (c) orderGather(st, h, c);
      else orderStop(h);
    } else orderStop(h);
  }
  return any;
}

function healersOn(st, target) {
  let n = 0;
  for (const u of st.units) {
    if (u.dead || u.garrison || !u.cfg.canHeal) continue;
    if (u.order && u.order.kind === 'heal' && u.order.target === target) n++;
  }
  return n;
}

function autoHealersCount(st, side) {
  let n = 0;
  for (const u of st.units) {
    if (u.dead || u.garrison || u.side !== side || !u.cfg.canHeal) continue;
    if (u.order && u.order.kind === 'heal' && u.order.auto) n++;
  }
  return n;
}

function updateAutoHeal(st, dt) {
  st.autoHealT = (st.autoHealT || 0) + dt;
  if (st.autoHealT < AUTOHEAL_TICK) return;
  st.autoHealT = 0;
  for (const side of ['player', 'enemy']) {
    const ccs = [];
    for (const b of st.buildings) {
      if (!b.dead && b.done && b.side === side && b.type === 'cc') ccs.push(b);
    }
    if (!ccs.length) continue; // без КЦ авто-лечения нет (хил действует сам, см. idle)
    const nearCC = (x, y) => ccs.some((cc) => Math.hypot(x - cc.x, y - cc.y) <= AUTOHEAL_RADIUS);
    const wounded = [];
    for (const u of st.units) {
      if (u.dead || u.garrison || u.side !== side) continue;
      if (!canBeHealed(u) || u.hp >= u.maxHp) continue; // только существа
      if (!nearCC(u.x, u.y)) continue;
      wounded.push(u);
    }
    if (!wounded.length) continue;
    // Тяжелее всех — первым; при равной доле HP стабильный порядок по id.
    wounded.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id - b.id);
    let assigned = autoHealersCount(st, side);
    const pool = st.units.filter((u) => !u.dead && !u.garrison && u.side === side &&
      u.cfg.canHeal && u.order.kind === 'idle' && !isAutoLocked(u) && nearCC(u.x, u.y));
    for (const target of wounded) {
      if (assigned >= AUTOHEAL_HEALERS_PER_SIDE) break;
      if (healersOn(st, target) > 0) continue;
      if (!pool.length) break;
      // R1 (аудит SZ): пул фильтруется по РАСЕ ЦЕЛИ. Раньше при несовпадении
      // orderHeal возвращал false, а assigned уже сгорел — хил выпадал из
      // диспетчера до следующего тика, и раненый оставался без лекаря.
      const same = pool.filter((h) => h.faction === target.faction);
      if (!same.length) continue;
      same.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) -
        Math.hypot(b.x - target.x, b.y - target.y) || a.id - b.id);
      const healer = same[0];
      if (!orderHeal(st, healer, target, true)) continue; // слот не сгорает
      pool.splice(pool.indexOf(healer), 1);
      assigned++;
    }
  }
}

// H.1: диспетчер авторемонта — тратит только на полностью оплачиваемые
// работы, резервирует активные цели и набирает не более двух авто-ремонтников
// на сторону. Сначала самые повреждённые доступные цели, внутри — ближайшие
// свободные рабочие; остальные продолжают/начинают добывать.
function updateAutoRepair(st, dt) {
  st.autoRepairT = (st.autoRepairT || 0) + dt;
  if (st.autoRepairT < AUTOREPAIR_TICK) return;
  st.autoRepairT = 0;
  for (const side of ['player', 'enemy']) {
    if (!((st.tech[side] && st.tech[side].autoRepair) > 0)) continue;
    const ccs = [];
    for (const b of st.buildings) if (!b.dead && b.side === side && b.type === 'cc') ccs.push(b);
    if (!ccs.length) continue;
    const near = (x, y) => ccs.some((cc) => Math.hypot(x - cc.x, y - cc.y) <= AUTOREPAIR_RADIUS);
    const targets = [];
    for (const b of st.buildings) {
      if (b.dead || b.side !== side || !b.done || b.hp >= b.maxHp) continue;
      if (near(b.x, b.y)) targets.push(b);
    }
    for (const u of st.units) {
      // B3: диспетчер авторемонта тоже видит раненых сборщиков, не только технику.
      if (u.dead || u.garrison || u.side !== side || !canBeRepaired(u) || u.hp >= u.maxHp) continue;
      if (near(u.x, u.y)) targets.push(u);
    }
    if (!targets.length) continue;
    targets.sort(repairTargetPriorityCompare); // триаж: сначала самые битые, стабильный id при равной доле HP
    const priority = new Map(targets.map((t, i) => [t, i]));

    // Нормализуем старые/загруженные состояния, в которых авто-приказов
    // уже больше нового глобального лимита; сохраняем ремонт самых важных
    // целей, а излишек сразу возвращаем к кристаллам.
    const autoWorkers = st.units.filter((u) => !u.dead && !u.garrison && u.side === side &&
      u.cfg.canRepair && u.order.kind === 'repair' && u.order.auto);
    const released = new Set();
    if (autoWorkers.length > AUTOREPAIR_WORKERS_PER_SIDE) {
      autoWorkers.sort((a, b) => {
        const ap = priority.has(a.order.target) ? priority.get(a.order.target) : Number.MAX_SAFE_INTEGER;
        const bp = priority.has(b.order.target) ? priority.get(b.order.target) : Number.MAX_SAFE_INTEGER;
        return ap - bp || Math.hypot(a.x - a.order.target.x, a.y - a.order.target.y) -
          Math.hypot(b.x - b.order.target.x, b.y - b.order.target.y) || a.id - b.id;
      });
      for (const u of autoWorkers.slice(AUTOREPAIR_WORKERS_PER_SIDE)) {
        released.add(u);
        resumeGather(st, u);
      }
    }

    const repairTargets = activeRepairTargets(st, side);
    let reservedCost = 0;
    for (const target of repairTargets) reservedCost += remainingRepairCost(target);
    let autoCount = autoRepairerCount(st, side);
    const pool = st.units.filter((u) => !released.has(u) && !u.dead && !u.garrison &&
      !isAutoLocked(u) && u.side === side && u.cfg.canRepair &&
      (u.order.kind === 'idle' || u.order.kind === 'gather'));
    const minerals = Number(st.minerals[side]) || 0;
    let waiting = false; // H.1v2: ремонт востребован, но не по карману (для тоста)

    for (const target of targets) {
      let assigned = repairersOf(st, target);
      if (assigned >= REPAIRERS_PER_TARGET || autoCount >= AUTOREPAIR_WORKERS_PER_SIDE) continue;
      const alreadyReserved = repairTargets.has(target);
      const extraCost = alreadyReserved ? 0 : remainingRepairCost(target);
      if (minerals + REPAIR_BUDGET_EPSILON < reservedCost + extraCost) { waiting = true; continue; }
      while (assigned < REPAIRERS_PER_TARGET && autoCount < AUTOREPAIR_WORKERS_PER_SIDE && pool.length) {
        pool.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) -
          Math.hypot(b.x - target.x, b.y - target.y) ||
          (a.order.kind === 'idle' ? 0 : 1) - (b.order.kind === 'idle' ? 0 : 1) || a.id - b.id);
        const worker = pool.shift();
        orderRepair(st, worker, target, true);
        assigned++;
        autoCount++;
        if (!repairTargets.has(target)) {
          repairTargets.add(target);
          reservedCost += extraCost;
        }
      }
    }

    // Если ремонт востребован, но полный job не в бюджете, не оставляем
    // простаивающих рабочих вокруг базы: отправляем их добывать. Gatherers
    // уже добывают и не меняют кристалл.
    for (const worker of pool) {
      if (worker.order.kind === 'idle') sendIdleRepairerToGather(st, worker);
    }

    // H.1v2: прозрачность — почему ремонт стоит. Один раз в 14 c объясняем,
    // что задачи не оплачены (полная стоимость всех ремонтов против банка).
    if (waiting && side === 'player' && st.time - (st.lastAutoWaitToast ?? -99) > 14) {
      st.lastAutoWaitToast = st.time;
      st.game.ui.toast(message('autoRepairWait', st.factions.player), 'warn');
    }
  }
}

function updateOrderByKind(st, u, dt, grid) {
  const o = u.order;
  switch (o.kind) {
    case 'idle': {
      // ВЛАДЕЛЕЦ 26.10.2026: «авто-лечение — когда хила отправляет КЦ лечить
      // раненого». Пока у стороны есть КЦ, хил НЕ бегает сам: цель ему выдаёт
      // диспетчер у КЦ (updateAutoHeal ниже) — так отряд не разбредается.
      // Без КЦ (миссии без базы, десант на вылазке) хил ищет раненого рядом
      // сам, иначе его способность там просто умерла бы.
      if (u.cfg.canHeal && !hasOwnCC(st, u.side)) {
        u.scanT -= dt;
        if (u.scanT <= 0) {
          u.scanT = 0.4;
          const hurt = findHealTarget(st, u);
          if (hurt) { u.order = { kind: 'heal', target: hurt }; break; }
        }
      }
      // Рабочий в простое сам латает повреждённую технику рядом —
      // зеркально медику: после рейда ремонт никто не заказал, а
      // покалеченные машины копятся на базе. Здания не трогаем: они
      // стоят на виду, и их ремонт — решение игрока (минералы).
      if (u.cfg.canRepair) {
        u.scanT -= dt;
        if (u.scanT <= 0) {
          u.scanT = 0.5;
          const veh = findRepairTarget(st, u);
          if (veh) {
            // В радиусе активного H.1 приоритеты и ближайших работников
            // выбирает общий диспетчер после обхода всех юнитов.
            const coveredByDispatcher = (st.tech[u.side] && st.tech[u.side].autoRepair) > 0 &&
              st.buildings.some((cc) => !cc.dead && cc.side === u.side && cc.type === 'cc' &&
                Math.hypot(veh.x - cc.x, veh.y - cc.y) <= AUTOREPAIR_RADIUS);
            if (coveredByDispatcher) break;
            if (canStartAutoRepair(st, u.side, veh)) {
              // B3: цель ремонта — сборщик, поэтому сам раненый тоже «свободный
              // рабочий». Без исключения он оказывался «ближайшим» к самому
              // себе, ремонт не начинался, и никто из соседей не подхватывал.
              const nearestIdle = st.units.filter((worker) => !worker.dead && !worker.garrison &&
                worker !== veh && worker.side === u.side && worker.cfg.canRepair && worker.order.kind === 'idle')
                .sort((a, b) => Math.hypot(a.x - veh.x, a.y - veh.y) -
                  Math.hypot(b.x - veh.x, b.y - veh.y) || a.id - b.id)[0];
              if (nearestIdle === u) orderRepair(st, u, veh, true);
            } else sendIdleRepairerToGather(st, u);
            break;
          }
          // П3 (B.7.6): некому строить — рабочий в простое подхватывает
          // ближайший голодный недострой сам. Приказ игрока свят:
          // подхват только из idle, после ремонта техники.
          if (u.cfg.canBuild) {
            const site = findUnfinishedSite(st, u);
            if (site) { orderBuild(st, u, site, true); break; }
          }
        }
      }
      // Бойцы без приказа сами ищут цель в радиусе обзора.
      if (!u.cfg.canMine && !u.cfg.canHeal && !u.cfg.scout) { // H.3: затвор №2
        u.scanT -= dt;
        if (u.scanT <= 0) {
          u.scanT = 0.25 + srand(st) * 0.15;
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
      repathIfBlocked(st, u, () => pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, o.gx, o.gy, { clearance: clearanceOf(u) }), 0.5);
      if (followPath(st, u)) {
        // Путь кончился, а до цели ещё далеко (частичный путь из A*) —
        // достраиваем; после трёх неудач честно останавливаемся и
        // запоминаем причину — стоим спокойно, без дёрганий (R4).
        const gd = Math.hypot(o.gx - u.x, o.gy - u.y);
        if (gd > TILE && (u.repaths || 0) < 3) {
          u.repaths = (u.repaths || 0) + 1;
          u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, o.gx, o.gy, { clearance: clearanceOf(u) });
          u.pathI = 0;
        } else {
          if (gd > TILE * 2) u.idleReason = 'unreachable';
          orderStop(u);
          if (gd > TILE * 2) u.idleReason = 'unreachable';
        }
      }
      break;
    }
    case 'scout': updateScout(st, u, dt, grid); break; // H.3
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
      u.stuckTotal = 0;
      u.angle = Math.atan2(t.y - u.y, t.x - u.x);
      if (u.cd <= 0) { u.cd = u.cfg.cooldown; shoot(st, u, t); }
    } else {
      if (!u.path || u.repathT <= 0) {
        u.path = t.kind === 'building'
          ? pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: t.tx, y: t.ty, w: t.w, h: t.h }, { clearance: clearanceOf(u) })
          : pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y, { clearance: clearanceOf(u) });
        u.pathI = 0;
        u.repathT = 0.4;
      }
      followPath(st, u);
    }
    return;
  }
  // Врагов нет — идём дальше к назначенной точке.
  repathIfBlocked(st, u, () => pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, o.x, o.y, { clearance: clearanceOf(u) }), 0.6);
  if (followPath(st, u)) {
    // Как у move: частичный путь достраиваем, недостижимую цель
    // бросаем спокойно, без вечного дёргания у стены.
    const gx = o.gx != null ? o.gx : o.x, gy = o.gy != null ? o.gy : o.y;
    const gd = Math.hypot(gx - u.x, gy - u.y);
    if (gd > TILE && (u.repaths || 0) < 3) {
      u.repaths = (u.repaths || 0) + 1;
      u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, gx, gy, { clearance: clearanceOf(u) });
      u.pathI = 0;
    } else orderStop(u);
  }
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

// РАЗДЕЛЕНИЕ РОЛЕЙ (правка владельца 26.10.2026, «мы всё напутали»):
//   • СУЩЕСТВА (живые/люди своей расы) — лечат только хилы (canHeal);
//   • МАШИНЫ (техника и дрон-техник-сборщик) — чинят только сборщики.
// Поэтому один и тот же юнит не может попасть в обе категории: дрон-техник
// (canMine) — машина, ей нужен ремонт; марин/нанит/плазмер — существо, ему
// нужно лечение. Раса = u.faction: хил не лечит чужую расу даже на своей
// стороне (зеркальные миссии, смешанные отряды).
export function canBeHealed(a) {
  return !!(a && a.kind === 'unit' && a.cfg && !a.cfg.vehicle && !a.cfg.canMine);
}
// Совместимость: ремонт — только машины (техника + дрон-техник), см. B3.
export function canBeRepaired(a) {
  return !!(a && a.kind === 'unit' && a.cfg && (a.cfg.vehicle || a.cfg.canMine));
}

// Ближайшее раненое СУЩЕСТВО своей расы (технику и дронов лечить нельзя).
function findHealTarget(st, u) {
  let best = null, bd = Infinity;
  for (const a of st.units) {
    if (a.dead || a.garrison || a === u || a.side !== u.side) continue;
    if (!canBeHealed(a) || a.faction !== u.faction) continue;
    if (a.hp >= a.maxHp) continue;
    const d = Math.hypot(a.x - u.x, a.y - u.y);
    if (d < bd && d <= u.cfg.sightTiles * TILE) { bd = d; best = a; }
  }
  return best;
}

// Ближайшая повреждённая техника своих (зеркало findHealTarget; здания —
// только по приказу игрока: их повреждение видно, и траты решает он).
// П3: сколько живых своих рабочих уже идёт/строит на этой стройке.
// Считаем приказы (не прибытие): заказ мгновенно резервирует место.
export function buildersOf(st, b) {
  let n = 0;
  for (const w of st.units) {
    if (w.dead || w.garrison || w.side !== b.side) continue;
    const o = w.order;
    if (o && o.kind === 'build' && o.target === b) n++;
  }
  return n;
}

// П3: ближайший недострой своих с местом (< BUILDERS_PER_SITE) в обзоре.
export function findUnfinishedSite(st, u) {
  let best = null, bd = Infinity;
  for (const b of st.buildings) {
    if (b.dead || b.done || b.side !== u.side) continue;
    if (buildersOf(st, b) >= BUILDERS_PER_SITE) continue;
    const d = Math.hypot(b.x - u.x, b.y - u.y);
    if (d < bd && d <= u.cfg.sightTiles * TILE) { bd = d; best = b; }
  }
  return best;
}

function findRepairTarget(st, u) {
  let best = null, bd = Infinity;
  for (const a of st.units) {
    if (a.dead || a.garrison || a === u || a.side !== u.side) continue;
    if (!canBeRepaired(a) || a.hp >= a.maxHp) continue;
    const d = Math.hypot(a.x - u.x, a.y - u.y);
    if (d < bd && d <= u.cfg.sightTiles * TILE) { bd = d; best = a; }
  }
  return best;
}

// Лечение: подойти вплотную и восстанавливать ОЗ, пока цель не здорова.
function updateHeal(st, u, dt) {
  const t = u.order.target;
  // Лечим только существо своей расы (технику/дронов — никогда).
  if (!t || t.dead || t.side !== u.side || !canBeHealed(t) || t.faction !== u.faction
      || t.hp >= t.maxHp) {
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
    u.path = pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y, { clearance: clearanceOf(u) });
    u.pathI = 0;
  }
  repathIfBlocked(st, u, () => pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y, { clearance: clearanceOf(u) }));
  if (followPath(st, u)) u.path = null;
}

// ----------------------------------------------------------
// Пересчёт «протухшего» пути. Три проверки:
//   1) ближайшие точки пути попали в запрещённые тайлы (дом построили
//      прямо на точке маршрута);
//   2) ОТРЕЗКИ пути перестали быть прямыми — с габаритом корпуса:
//      сглаженный путь состоит из LOS-отрезков, и часто это вообще
//      одна точка-цель. Новый дом на отрезке точки не портит, но
//      прямой проход перекрывает. Проверка идёт коридором шириной
//      с корпус (Г8): ловит и «срез угла тайла» по диагонали.
//   3) forceRepath от интегратора (долго топчемся).
// Разрыв цикла одинаковых репутей (Г3): если новый путь совпал со
// старым дважды подряд — включаем обход стены и подставляем боковую
// точку-ступеньку, а не тот же маршрут. Бюджет: не больше 6 свежих
// A* на тик — толпа не устраивает лавину пересчётов.
// Не чаще раза в interval секунд.
// ----------------------------------------------------------
const REPATH_BUDGET_PER_TICK = 6;
function repathIfBlocked(st, u, make, interval = 0.7) {
  if (!u.path || !u.path.length) return;
  const force = u.forceRepath;
  if (u.repathT > 0 && !force) return;
  const need =
    nearPointBlocked(st, u) || segmentBlocked(st, u) || force;
  if (!need) {
    // Путь здоров — следующая проверка через интервал, а не каждый
    // тик (иначе hasLosClear-цепочка крутится вхолостую на каждом
    // идущем юните; задержка обнаружения новой стены — как раньше,
    // не больше interval).
    u.repathT = interval;
    return;
  }
  // Бюджет пересчётов на тик (анти-лавина при толпе в пробке).
  if (st.repathsThisTick == null) st.repathsThisTick = 0;
  if (st.repathsThisTick >= REPATH_BUDGET_PER_TICK && !force) {
    u.repathT = 0.12; // повторим чуть позже, а не через весь интервал
    return;
  }
  u.repathT = interval;
  u.forceRepath = false;
  st.repathsThisTick++;
  const oldFirst = u.path[u.pathI] || u.path[0];
  const oldLen = u.path.length;
  let fresh = make() || [];
  // Одинаковый репуть? (та же первая точка и та же длина — дёшево
  // и достаточно для детерминированного A* на статичной карте).
  const same = oldFirst && fresh.length === oldLen && fresh.length > 0 &&
    Math.hypot(fresh[0].x - oldFirst.x, fresh[0].y - oldFirst.y) < 6;
  if (same) u.failCount = (u.failCount || 0) + 1;
  else u.failCount = 0;
  if (u.failCount >= 2) {
    // Эскалация: тот же путь дважды не помог — уходим в обход стены
    // с фиксированной рукой и боковой ступенькой (разрыв цикла Г3).
    if (!u.wallSide) u.wallSide = (u.id % 2 === 0) ? 1 : -1;
    u.wallT = Math.max(u.wallT, 1.4);
    const step = sideStepPoint(st, u);
    if (step) fresh = [step, ...fresh];
    u.failCount = 0;
  }
  u.path = fresh; u.pathI = 0;
}

// Первые 3 точки пути — в blocked?
function nearPointBlocked(st, u) {
  for (let k = u.pathI; k < Math.min(u.path.length, u.pathI + 3); k++) {
    const wp = u.path[k];
    if (st.map.blockedAt((wp.x / TILE) | 0, (wp.y / TILE) | 0)) return true;
  }
  return false;
}

// Какой-то отрезок пути от текущей позиции перекрыт? Проверка —
// коридором с габаритом корпуса (ловит диагональный срез угла).
function segmentBlocked(st, u) {
  const clear = u.r * 0.55;
  let ax = (u.x / TILE) | 0, ay = (u.y / TILE) | 0;
  for (let k = u.pathI; k < u.path.length; k++) {
    const bx = (u.path[k].x / TILE) | 0, by = (u.path[k].y / TILE) | 0;
    if (!hasLosClear(st.map, ax, ay, bx, by, clear)) return true;
    ax = bx; ay = by;
  }
  return false;
}

// Боковая ступенька для разрыва цикла репутей: точка в ~1.5 тайлах
// вбок от направления на первую точку пути, в сторону wallSide.
// Ищем свободную пробой; если обе стороны заняты — null.
function sideStepPoint(st, u) {
  const wp = u.path[u.pathI] || u.path[0];
  if (!wp) return null;
  const base = Math.atan2(wp.y - u.y, wp.x - u.x);
  const r2 = u.r * 0.7;
  const dist = TILE * 1.5;
  const sides = u.wallSide >= 0 ? [1, -1] : [-1, 1];
  for (const s of sides) {
    for (const off of [Math.PI / 2 * s, Math.PI / 3 * s, Math.PI * 0.75 * s]) {
      const a = base + off;
      const px = u.x + Math.cos(a) * dist, py = u.y + Math.sin(a) * dist;
      if (!hitWall(st.map, px, py, r2)) return { x: px, y: py };
    }
  }
  return null;
}

// Движение по пути: true — путь завершён.
// Пропуск точек — только если следующая видна напрямую коридором
// (Г4): после расталкивания юнит не перескакивает угол в стену.
function followPath(st, u) {
  if (!u.path || u.pathI >= u.path.length) return true;
  const ux = (u.x / TILE) | 0, uy = (u.y / TILE) | 0;
  const clear = u.r * 0.5;
  // Текущая точка протухла (там теперь стена)? Пробуем перепрыгнуть
  // на следующую видимую — иначе стоим и ждём репаса, а не лезем в стену.
  while (u.pathI < u.path.length) {
    const wp = u.path[u.pathI];
    const wtx = (wp.x / TILE) | 0, wty = (wp.y / TILE) | 0;
    if (!st.map.blockedAt(wtx, wty)) break;
    // Точка в стене: есть ли дальше видимая?
    let jumped = false;
    for (let k = u.pathI + 1; k < u.path.length; k++) {
      const nx = (u.path[k].x / TILE) | 0, ny = (u.path[k].y / TILE) | 0;
      if (!st.map.blockedAt(nx, ny) && hasLosClear(st.map, ux, uy, nx, ny, clear)) {
        u.pathI = k; jumped = true; break;
      }
    }
    // Просим репас не чаще его кулдауна: иначе каждый тик по A* —
    // лавина пересчётов у каждого застрявшего (repathIfBlocked идёт
    // раньше followPath в обработчиках, так что флаг съестся на
    // следующем тике, когда кулдаун истечёт).
    if (!jumped) { if (u.repathT <= 0) u.forceRepath = true; return false; }
  }
  if (u.pathI >= u.path.length) return true;
  // Анти-«пила»: следующая точка ближе текущей И видна напрямую —
  // пропускаем текущую. Без LOS-условия пропуск вёл в стену (Г4).
  while (u.pathI + 1 < u.path.length) {
    const a = u.path[u.pathI], b = u.path[u.pathI + 1];
    if (!(Math.hypot(b.x - u.x, b.y - u.y) + 4 < Math.hypot(a.x - u.x, a.y - u.y))) break;
    const bx = (b.x / TILE) | 0, by = (b.y / TILE) | 0;
    if (st.map.blockedAt(bx, by)) break;
    if (!hasLosClear(st.map, ux, uy, bx, by, clear)) break;
    u.pathI++;
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
        ? pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: t.tx, y: t.ty, w: t.w, h: t.h }, { clearance: clearanceOf(u) })
        : pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y, { clearance: clearanceOf(u) });
      u.pathI = 0;
      u.repathT = 0.4;
      u.lastChase = { x: tx, y: ty };
    } else {
      // Цель догоняем, но стена на отрезке могла вырасти — проверяем.
      repathIfBlocked(st, u, () => t.kind === 'building'
        ? pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: t.tx, y: t.ty, w: t.w, h: t.h }, { clearance: clearanceOf(u) })
        : pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y, { clearance: clearanceOf(u) }), 0.5);
    }
    followPath(st, u);
  }
}

// Универсальная стрельба: по cfg.projectile выбираем оружие.
// Стрелять может и здание (турель) — важно, чтобы был cfg.projectile.
export function shoot(st, u, t) {
  const cfg = u.cfg;
  const base = u.kind === 'building' ? gradeDmg(u.type, u.level || 1, cfg.dmg) : cfg.dmg; // F.2: грейд турели
  const dmg = base + atkBonus(st, u);   // исследования усиливают выстрел
  const reach = u.r || Math.max(cfg.w, cfg.h) * TILE * 0.5;
  u.angle = Math.atan2(t.y - u.y, t.x - u.x);
  const muzzleX = u.x + Math.cos(u.angle) * (reach + 4);
  const muzzleY = u.y + Math.sin(u.angle) * (reach + 4);
  addEffect(st, { kind: 'muzzle', x: muzzleX, y: muzzleY, ang: u.angle, t: 0, life: cfg.projectile === 'shell' ? 0.1 : 0.06, faction: u.faction });
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
    addEffect(st, { kind: 'spark', x: t.x, y: t.y, ang: u.angle, t: 0, life: 0.22, faction: t.faction });
    st.game.sound.mine();
  }
}

// Добыча: к кристаллу → майним → к командному центру → сдаём → повтор.
function updateGather(st, u, dt) {
  const o = u.order;
  // Груз Priority: сначала сдаём, потом за новым кристаллом.
  if (u.carrying > 0 && o.phase !== 'toDrop' && o.phase !== 'mining') o.phase = 'toDrop';

  if (o.phase === 'toMineral') {
    // #36 З2: трюм полон — за новой добычей не идём, ждём у челнока.
    if (raidHoldFull(st, u)) { parkWorkerAtShuttle(st, u); return; }
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
      u.path = pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: c.tx, y: c.ty, w: 1, h: 1 }, { clearance: clearanceOf(u) });
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
    repathIfBlocked(st, u, () => pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: c.tx, y: c.ty, w: 1, h: 1 }, { clearance: clearanceOf(u) }));
    if (followPath(st, u)) u.path = null;
    return;
  }

  if (o.phase === 'mining') {
    // Трюм заполнился, пока бурили: не вынимаем эрг из жилы «в никуда».
    if (raidHoldFull(st, u)) { parkWorkerAtShuttle(st, u); return; }
    const c = o.target;
    if (!c || c.dead || c.amount <= 0) { o.phase = 'toMineral'; u.path = null; return; }
    u.mineT -= dt;
    if (Math.random() < dt * 3) addEffect(st, { kind: 'spark', x: c.x + (Math.random() - 0.5) * 14, y: c.y + (Math.random() - 0.5) * 14, ang: Math.random() * Math.PI, t: 0, life: 0.2 });
    if (Math.random() < dt * 2) st.game.sound.mine();
    if (u.mineT <= 0) {
      const perTrip = u.side === 'player' && st.raidTripYield ? st.raidTripYield : MINERAL_PER_TRIP; // Э1: бур тира
      const take = Math.min(perTrip, c.amount);
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
    if (!drop && u.side === 'player' && st.raidDrop
      && !(st.raidHouse && st.raidHouse.dead)) {
      // Рейдовая вылазка без корабля-КЦ: Дом-шаттл И ЕСТЬ КЦ на этой карте —
      // рабочие сдают эрг в его трюм. Радиус приёма = радиус кольца, которое
      // игрок видит на карте (pad.r тайлов), иначе «в зоне, а не сдаёт».
      const pad = st.raidDrop;
      const padR = Math.max(TILE * 2.2, (pad.r || 2.2) * TILE);
      if (Math.hypot(u.x - pad.x, u.y - pad.y) <= padR) {
        const cap = st.raidCargoCap || HOUSE.cargo; // Э1: трюм Дома по его грейду
        const before = st.raidCargo || 0;
        const next = Math.min(cap, before + u.carrying);
        // Э4: «не вся добыча поместится» — считаем излишек, он теряется.
        st.raidCargoLost = (st.raidCargoLost || 0) + (before + u.carrying - next);
        if (before + u.carrying > cap && !st.raidCargoFullToasted) {
          st.raidCargoFullToasted = true;
          st.game.ui.toast(t('ui.raid.toastCargoFull', { cap }), 'warn');
        }
        st.raidCargo = next;
        st.stats.mined += u.carrying;
        addFloat(st, u.x, u.y - 14, '+' + u.carrying, COLORS.mineral);
        u.carrying = 0;
        u.lastFailed = null; u.lastFailedT = 0;
        o.phase = 'toMineral';
        u.path = null;
        st.game.sound.deposit();
        // Сдали последний влезающий рейс — к площадке, ждать эвакуации.
        if (raidHoldFull(st, u)) parkWorkerAtShuttle(st, u);
        return;
      }
      // ВЛАДЕЛЕЦ 25.10: сдаём эрг в ДОМ-шаттл; его тайлы заняты зданием —
      // идём к ближайшему свободному соседнему тайлу.
      // ВАЖНО: pathToPoint принимает МИРОВЫЕ ПИКСЕЛИ, а не индексы тайлов
      // (баг 26.10.2026: сюда передавали near.x/near.y в тайлах → путь вёл в
      // угол карты (0,0), сборщики «искали КЦ» и никогда не сдавали эрг).
      const dropGoal = () => {
        const near = walkableNear(st.map, pad.tx, pad.ty);
        return pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0,
          (near.x + 0.5) * TILE, (near.y + 0.5) * TILE, { clearance: clearanceOf(u) });
      };
      if (!u.path) {
        u.path = dropGoal();
        u.pathI = 0;
      }
      repathIfBlocked(st, u, dropGoal);
      if (followPath(st, u)) u.path = null;
      return;
    }
    if (!drop) { u.moving = false; return; } // базы нет — стоим с грузом
    const rx = drop.tx * TILE, ry = drop.ty * TILE, rw = drop.w * TILE, rh = drop.h * TILE;
    if (distToRectPx(u.x, u.y, rx, ry, rw, rh) <= TILE * 0.9) {
      // Э6: бустер добычи из капсулы (×mul на время) — применяем на сдаче.
      const boost = st.boost && st.boost.until > Date.now() ? st.boost.mul : 1;
      st.minerals[u.side] += Math.round(u.carrying * boost);
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
      u.path = pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: drop.tx, y: drop.ty, w: drop.w, h: drop.h }, { clearance: clearanceOf(u) });
      u.pathI = 0;
    }
    repathIfBlocked(st, u, () => pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: drop.tx, y: drop.ty, w: drop.w, h: drop.h }, { clearance: clearanceOf(u) }));
    if (followPath(st, u)) u.path = null;
    return;
  }
}

// Стройка: подойти к площадке и «сваривать» — прогресс и HP растут.
// Завершив (или стройка отменена/готова) — дальше по цепочке G.3 или к добыче.
function updateBuild(st, u, dt) {
  const b = u.order.target;
  if (!b || b.dead || b.done) { chainBuild(st, u, b); return; } // G.3
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
        st.game.ui.toast(message('builtDone', st.factions.player) + fname(b.cfg, b.faction));
      }
      chainBuild(st, u, b); // G.3: дальше по цепочке или к добыче
    }
    return;
  }
  if (!u.path) {
    u.path = pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: b.tx, y: b.ty, w: b.w, h: b.h }, { clearance: clearanceOf(u) });
    u.pathI = 0;
  }
  repathIfBlocked(st, u, () => pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: b.tx, y: b.ty, w: b.w, h: b.h }, { clearance: clearanceOf(u) }));
  if (followPath(st, u)) u.path = null;
}

// Ремонт: рабочий варит повреждённое здание или технику своей стороны.
// Скорость зависит от цели; минералы тратятся пропорционально фактически
// восстановленным HP. Авто-заказ держится только пока можно оплатить всю
// оставшуюся работу; ручной заказ при нехватке ресурсов не меняется.
const REPAIR_RATE = { building: 26, unit: 18 }; // HP/сек
function toastRepairShortage(st, u) {
  if (u.side === 'player' && st.time - (st.lastRepairToast ?? -99) > 6) {
    st.lastRepairToast = st.time;
    st.game.ui.toast(message('repairStop', st.factions.player) + message('noMinerals', st.factions.player).toLowerCase(), 'error');
  }
}
function updateRepair(st, u, dt) {
  const t = u.order.target;
  if (!t || t.dead || t.side !== u.side || t.hp >= t.maxHp) { resumeGather(st, u); return; }
  const auto = !!u.order.auto;
  const minerals = Number(st.minerals[u.side]) || 0;
  // Резервируем ручные работы и более приоритетные автоцели: после
  // внешнего списания низкоприоритетные авто-заказы снимаются первыми.
  if (auto && minerals + REPAIR_BUDGET_EPSILON < autoRepairBudgetThrough(st, u.side, t)) {
    toastRepairShortage(st, u);
    resumeGather(st, u);
    return;
  }
  const isB = t.kind === 'building';
  const rx = isB ? t.tx * TILE : t.x - t.r;
  const ry = isB ? t.ty * TILE : t.y - t.r;
  const rw = isB ? t.w * TILE : t.r * 2;
  const rh = isB ? t.h * TILE : t.r * 2;
  if (distToRectPx(u.x, u.y, rx, ry, rw, rh) <= TILE * 1.1) {
    u.path = null; u.moving = false;
    u.angle = Math.atan2(t.y - u.y, t.x - u.x);
    const rate = REPAIR_RATE[isB ? 'building' : 'unit'];
    const hpToRestore = Math.min(rate * dt, Math.max(0, t.maxHp - t.hp));
    const cost = hpToRestore / REPAIR_HP_PER_MINERAL;
    if (minerals + REPAIR_BUDGET_EPSILON < cost) {
      // Ручной приказ остаётся при нехватке; авто-работник освобождается
      // и возвращается к добыче (либо спокойно останавливается без жил).
      toastRepairShortage(st, u);
      if (auto) resumeGather(st, u);
      return;
    }
    st.minerals[u.side] = Math.max(0, minerals - cost);
    t.hp = Math.min(t.maxHp, t.hp + hpToRestore);
    if (Math.random() < dt * 5) {
      addEffect(st, { kind: 'spark', x: rx + Math.random() * rw, y: ry + Math.random() * rh, ang: Math.random() * Math.PI, t: 0, life: 0.2 });
    }
    if (Math.random() < dt * 2.5) st.game.sound.repair();
    if (t.hp >= t.maxHp && t.side === 'player') {
      st.game.ui.toast(message('repairDone', st.factions.player) + fname(t.cfg, t.faction));
    }
    return;
  }
  if (!u.path) {
    u.path = isB
      ? pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: t.tx, y: t.ty, w: t.w, h: t.h }, { clearance: clearanceOf(u) })
      : pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y, { clearance: clearanceOf(u) });
    u.pathI = 0;
  }
  repathIfBlocked(st, u, () => isB
    ? pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: t.tx, y: t.ty, w: t.w, h: t.h }, { clearance: clearanceOf(u) })
    : pathToPoint(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, t.x, t.y, { clearance: clearanceOf(u) }));
  if (followPath(st, u)) u.path = null;
}

// Гарнизон: пехота идёт к бункеру и заходит внутрь.
function updateGarrison(st, u) {
  const b = u.order.target;
  if (!b || b.dead || !b.done) { orderStop(u); return; }
  const rx = b.tx * TILE, ry = b.ty * TILE, rw = b.w * TILE, rh = b.h * TILE;
  if (distToRectPx(u.x, u.y, rx, ry, rw, rh) <= TILE * 1.0) {
    if (b.garrison.length >= unitCapOf(b)) { orderStop(u); return; } // F.2 / Э4: у Дома — его вместимость
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
    u.path = pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: b.tx, y: b.ty, w: b.w, h: b.h }, { clearance: clearanceOf(u) });
    u.pathI = 0;
  }
  // Раньше гарнизон не пересчитывал путь вовсе: стена на отрезке =
  // вечный бег в стену. Теперь как у всех — с проверкой отрезков.
  repathIfBlocked(st, u, () => pathToRect(st.map, (u.x / TILE) | 0, (u.y / TILE) | 0, { x: b.tx, y: b.ty, w: b.w, h: b.h }, { clearance: clearanceOf(u) }));
  if (followPath(st, u)) u.path = null;
}

// Автопоиск цели в радиусе обзора (только для своей стороны; для игрока —
// с учётом тумана войны). Юниты в приоритете, здания — если в зоне боя.
export function acquireTarget(st, u, grid) {
  const R = u.cfg.sightTiles * TILE;
  const rng = u.kind === 'building' ? gradeRange(u.type, u.level || 1, u.cfg.range) : u.cfg.range; // F.2
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
      if (d <= rng + Math.max(b.w, b.h) * TILE * 0.5) return b;
    }
  } else {
    // ИИ видит всю карту (допустимое «читерство» простого ИИ).
    for (const b of st.buildings) {
      if (b.dead || b.side === u.side) continue;
      const d = distToRectPx(u.x, u.y, b.tx * TILE, b.ty * TILE, b.w * TILE, b.h * TILE);
      if (d <= rng + Math.max(b.w, b.h) * TILE * 0.5) return b;
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
// скольжение вдоль стен + лестница анти-застревания:
//   stuckT 0–0.35   — идём прямо;
//   stuckT > 0.35   — веер руления: пробуем направления от ±0.4 до
//                     разворота, с памятью руки обхода (выход из
//                     вогнутых карманов правилом одной руки — Г1);
//   толпа, а не стена — уступание: короткая пауза waitT, пропускаем
//                     соседей вместо спама репутей;
//   stuckT > 1.1    — форс-репас; при повторных циклах репас сам
//                     подставит боковую ступеньку (см. repathIfBlocked);
//   stuckTotal > 5  — честная сдача: приказ невыполним, стоим
//                     спокойно (R4), а не долбимся в стену вечно.
// Всё детерминировано: выборы сторон — по u.id, без Math.random.
// ------------------------------------------------------------
function integrate(st, u, dt, grid) {
  // Пауза уступания: стоим и пропускаем толпу, застревание не копим.
  if (u.waitT > 0) {
    u.waitT -= dt;
    u.moving = false;
    u.moveDir = null;
    return;
  }
  let vx = 0, vy = 0;
  let slowK = 1;
  if (u.moveDir) {
    let dir = u.moveDir;
    u.wallT = Math.max(0, (u.wallT || 0) - dt);
    if (u.wallT <= 0) u.wallSide = 0;
    if (u.stuckT > 0.3) {
      const base = Math.atan2(dir.y, dir.x);
      const r2 = u.r * 0.7;
      // Дальность пробы растёт со скоростью: быстрому скифу нужно
      // смотреть дальше своих 10px, иначе он «не видит» стену.
      const look = 12 + u.cfg.speed * 0.22;
      const free = (a) => !hitWall(st.map, u.x + Math.cos(a) * look, u.y + Math.sin(a) * look, r2);
      const aheadFree = free(base);
      // Впереди свободно, но стоим — это толпа, а не стена: уступаем.
      if (aheadFree && u.stuckT > 0.55 && !u.yielded && u.wallT <= 0) {
        u.yielded = true;
        u.waitT = 0.3 + (u.id % 3) * 0.14; // детерминированный разброс очереди
        u.stuckT = 0.3;
        u.moving = false;
        u.moveDir = null;
        return;
      }
      // Веер руления: от малых углов к развороту. В режиме обхода
      // стены сначала пробуем свою руку (правило одной руки выводит
      // из «П»-кармана, где старый «танец» из 6 проб сдавался — Г1).
      const hand = u.wallSide || ((u.id % 2 === 0) ? 1 : -1);
      const fan = u.wallT > 0
        ? [0.45 * hand, 0.9 * hand, 1.35 * hand, 1.8 * hand, 2.4 * hand, Math.PI,
           -0.45 * hand, -0.9 * hand, -1.35 * hand]
        : [0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4, Math.PI];
      // В обычном режиме уважаем руку, если она уже выбрана репасом.
      if (u.wallT <= 0 && u.wallSide) {
        fan.sort((a, b) => (Math.sign(b) === u.wallSide ? 1 : 0) - (Math.sign(a) === u.wallSide ? 1 : 0));
      }
      let picked = null, pickedOff = 0;
      for (const off of fan) {
        if (free(base + off)) { picked = base + off; pickedOff = off; break; }
      }
      if (picked != null) {
        dir = { x: Math.cos(picked), y: Math.sin(picked) };
        // Крутой доворот = входим в обход стены: запоминаем руку.
        if (Math.abs(pickedOff) > 1.1) {
          u.wallSide = Math.sign(pickedOff) || hand;
          u.wallT = Math.max(u.wallT, 0.9);
        }
      } else {
        // Окружён со всех сторон: не долбимся на полной скорости
        // «только вперёд», а ползём медленно и скоро попросим репас.
        slowK = 0.3;
        if (!u.wallSide) u.wallSide = hand;
        u.wallT = Math.max(u.wallT, 0.8);
      }
    }
    // G.1: встречный разъезд — сосед идёт навстречу → смещаемся к своей
    // правой стороне (мировой базис: встречные всегда расходятся, в отличие
    // от чётности id). Рулевой уровень, A* не трогаем.
    if (!u.yielded && u.stuckT < 1.0) {
      const ux = Math.cos(u.angle), uy = Math.sin(u.angle);
      let headOn = false;
      grid.query(u.x, u.y, 44, (o) => {
        if (headOn || o === u || o.dead || !o.moving) return;
        if (ux * Math.cos(o.angle) + uy * Math.sin(o.angle) < -0.35) headOn = true;
      });
      if (headOn) {
        const mx = dir.x - dir.y * 0.55, my = dir.y + dir.x * 0.55;
        const l = Math.hypot(mx, my) || 1;
        dir = { x: mx / l, y: my / l };
      }
    }
    vx = dir.x * u.cfg.speed * slowK;
    vy = dir.y * u.cfg.speed * slowK;
    const sep = separation(u, grid);
    vx += sep.x * 42; vy += sep.y * 42;
    // Вышли на свободную воду: обход завершён.
    if (u.wallT > 0 && u.stuckT < 0.15 && slowK >= 1) { u.wallT = 0; u.wallSide = 0; }
  }
  u.moving = Math.abs(vx) + Math.abs(vy) > 1;
  if (vx || vy) tryMove(st.map, u, vx * dt, vy * dt);
  // Учёт застревания: сколько секунд фактически стоим при активном
  // приказе. Долго стоим — форсируем пересчёт пути от текущей точки;
  // очень долго (5 c) — приказ невыполним: останавливаемся спокойно.
  const disp = Math.hypot(u.x - u.prevX, u.y - u.prevY);
  if (u.moveDir) {
    if (disp < u.cfg.speed * dt * 0.3) {
      u.stuckT += dt;
      u.stuckTotal += dt;
      if (u.stuckT > 1.1) { u.stuckT = 0.7; u.forceRepath = true; }
      if (u.stuckTotal > 5) {
        // Капитуляция без дёрганий: цель недостижима или пробка вечна.
        const k = u.order.kind;
        if (k === 'move' || k === 'attackMove') {
          u.idleReason = 'unreachable';
          orderStop(u);
          u.idleReason = 'unreachable';
          return;
        }
        // Добыча/стройка/ремонт: не убиваем приказ, но даём соседям
        // разойтись и пробуем снова (сброс с уступкой).
        u.stuckTotal = 0;
        u.waitT = 0.5 + (u.id % 4) * 0.12;
        u.forceRepath = true;
      }
    } else {
      u.stuckT = Math.max(0, u.stuckT - dt * 2);
      u.stuckTotal = Math.max(0, u.stuckTotal - dt * 3);
      u.yielded = false;
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

// Жёсткое разрешение пересечений (позиционная поправка) с
// приоритетом движения: идущий теснит стоящего, а не наоборот —
// иначе колонна вязнет в каждом зеваке, а зеваки разлетаются от
// каждого прохожего. Пара обрабатывается дважды (по разу на юнит),
// поэтому доли 0.25/0.75 дают суммарный честный развод.
function resolveHard(st, u, grid) {
  grid.query(u.x, u.y, u.r * 2 + 4, (o) => {
    if (o === u || o.dead) return;
    const dx = u.x - o.x, dy = u.y - o.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const min = u.r + o.r;
    if (d < min) {
      let k = 0.5;
      if (u.moving && !o.moving) k = 0.25;       // идущий держит курс
      else if (!u.moving && o.moving) k = 0.75;  // стоящий уступает
      const push = (min - d) * k;
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
      // Старый маршрут мог стать бессмысленным — но приказ жив:
      // сбрасываем путь и даём свежие попытки достройки (Г9), иначе
      // вытолкнутый юнит молча «умирал» с исчерпанным счётчиком.
      u.path = null; u.pathI = 0;
      u.repaths = 0; u.forceRepath = true; u.stuckT = 0;
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
      u.path = null; u.pathI = 0;
      u.repaths = 0; u.forceRepath = true; u.stuckT = 0;
    }
  }
}

// Скольжение вдоль стен: по осям раздельно, с проверкой 4 углов корпуса.
// Если упёрлись сразу в обе оси (угол blocked-тайла) — пробуем половинный
// шаг: так юнит огибает острые углы ползком, а не приклеивается к ним (Г10).
function tryMove(map, u, dx, dy) {
  const r = u.r * 0.8;
  let movedX = false, movedY = false;
  if (dx && !hitWall(map, u.x + dx, u.y, r)) { u.x += dx; movedX = true; }
  if (dy && !hitWall(map, u.x, u.y + dy, r)) { u.y += dy; movedY = true; }
  if (dx && dy && !movedX && !movedY) {
    const hx = dx / 2, hy = dy / 2;
    if (!hitWall(map, u.x + hx, u.y, r)) { u.x += hx; movedX = true; }
    if (!hitWall(map, u.x, u.y + hy, r)) { u.y += hy; movedY = true; }
  }
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
      addEffect(st, { kind: 'spark', x: p.tx, y: p.ty, ang: Math.random() * Math.PI * 2, t: 0, life: 0.18, faction: p.target ? p.target.faction : undefined });
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
        addEffect(st, { kind: 'boom', x: p.tx, y: p.ty, t: 0, life: 0.5, big: true, faction: p.src ? p.src.faction : undefined });
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
// H.2: точка под присмотром своего КЦ Г2+ (уровень и дистанция — одним проходом)?
function nearBaseCC(st, x, y) {
  for (const b of st.buildings) {
    if (b.dead || b.side !== 'player' || b.type !== 'cc') continue;
    if ((b.level || 1) < 2) continue;
    if (Math.hypot(x - b.x, y - b.y) <= ALARM_BASE_RADIUS) return true;
  }
  return false;
}

// Э4: в вылазке разрушенное вражеское здание отдаёт эрг. Это и есть «рейд на
// чужой КЦ»: после сноса КЦ на карте остаётся куча обломков, и в трюм Дома
// влезает НЕ ВСЁ — излишек теряется при эвакуации (канон владельца).
export function dropLoot(st, b) {
  if (!st || !b || b.side !== 'enemy') return 0;
  if (st.raidMode !== 'expedition') return 0;
  const pool = st.raidLootPool || 0;
  if (pool <= 0) return 0;
  const weight = (b.cfg && b.cfg.cost) || 50;
  const share = weight / Math.max(1, st.raidLootWeight || 1);
  const amount = Math.max(1, Math.round(pool * share));
  st.raidLootLeft = Math.max(0, (st.raidLootLeft || pool) - amount);
  const tx = Math.max(1, Math.min(st.map.w - 2, b.tx + ((b.w / 2) | 0)));
  const ty = Math.max(1, Math.min(st.map.h - 2, b.ty + ((b.h / 2) | 0)));
  if (!st.map.inBounds(tx, ty)) return 0;
  st.map.addCrystal(tx, ty, amount, -1);
  addFloat(st, b.x, b.y - 20, '+' + amount, COLORS.mineral);
  return amount;
}

export function damageEntity(st, victim, dmg, attacker) {
  if (!victim || victim.dead) return;
  // Неуязвима в бункере только пехота. У зданий garrison — это массив
  // гарнизона (пустой массив истинен!), раньше эта строка делала ВСЕ
  // постройки бессмертными — вражескую базу было невозможно разрушить.
  if (victim.kind === 'unit' && victim.garrison) return;
  // Э1: броня — ПРОЦЕНТ от ранга (2.5%/ур., потолок 50%), минимум 1 урона.
  dmg = Math.max(1, dmg * damageTakenMul(st, victim));
  victim.hp -= dmg;
  victim.flashT = 0.14;
  // Тревога для игрока — не чаще раза в 8 секунд.
  if (victim.side === 'player' && !st.gameOver && st.time - st.lastAlertT > 8) {
    st.lastAlertT = st.time;
    st.lastAlertPos = { x: victim.x, y: victim.y };
    st.game.ui.toast(message('underAttack', st.factions.player), 'error'); // H.2: строка одна на оба тира
    st.pings.push({ x: victim.x, y: victim.y, t: 0 });
    // H.2: базовый тир — сирена (свой КЦ Г2+ и урон в R15 от КЦ), иначе мягкий пинг.
    if (nearBaseCC(st, victim.x, victim.y)) st.game.sound.alarm();
    else st.game.sound.ping();
  }
  // Ответка: юнит БЕЗ приказа отвечает тому, кто его бьёт (баг 26.10.2026 —
  // охрану аванпоста можно было расстреливать по одному, она не реагировала).
  // Приказы игрока не трогаем: реагируем только из 'idle'.
  if (victim.kind === 'unit' && !victim.dead && attacker && !attacker.dead
      && attacker.side !== victim.side && victim.cfg && victim.cfg.dmg > 0
      && victim.order && victim.order.kind === 'idle') {
    orderAttack(st, victim, attacker);
  }
  if (victim.hp <= 0) killEntity(st, victim, attacker);
}

function killEntity(st, v, attacker) {
  v.dead = true;
  // П8: №17 — гибель ключевого юнита игрока (цветня) взводит поражение.
  if (v.side === 'player' && st.win && st.win.guardType && v.type === st.win.guardType) st.guardLost = true;
  v.selected = false;
  if (v.kind === 'unit') {
    addEffect(st, { kind: 'boom', x: v.x, y: v.y, t: 0, life: v.cfg.vehicle ? 0.6 : 0.4, big: !!v.cfg.vehicle, faction: v.faction });
    // Обломки/шипики разлетаются веером — техника даёт больше мусора.
    const n = v.cfg.vehicle ? 7 : 4;
    for (let i = 0; i < n; i++) {
      addEffect(st, {
        kind: 'debris', x: v.x, y: v.y,
        ang: Math.random() * Math.PI * 2,
        dist: 10 + Math.random() * 22,
        t: 0, life: 0.4 + Math.random() * 0.3, faction: v.faction,
      });
    }
    if (v.cfg.vehicle) addShake(st, 3, 0.16);
    st.game.sound.boom(!!v.cfg.vehicle);
  } else {
    if (v.kind === 'building') dropLoot(st, v); // Э4: лут с вражеского здания
    if (v.garrison && v.garrison.length) releaseGarrison(st, v); // выжившие выпрыгивают
    st.map.unmarkBuilding(v);
    st.bcount[v.side]--;
    addEffect(st, { kind: 'boom', x: v.x, y: v.y, t: 0, life: 0.8, big: true, faction: v.faction });
    for (let i = 0; i < 10; i++) {
      addEffect(st, {
        kind: 'debris', x: v.x + (Math.random() - 0.5) * v.w * TILE * 0.6,
        y: v.y + (Math.random() - 0.5) * v.h * TILE * 0.6,
        ang: Math.random() * Math.PI * 2,
        dist: 14 + Math.random() * 30,
        t: 0, life: 0.5 + Math.random() * 0.4, faction: v.faction,
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
// Маленький помощник: многоугольник из плоского массива [x0,y0,x1,y1...].
function poly(ctx, p) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.closePath();
}

// ------------------------------------------------------------
// Свет и объём (шлифовка #31). Канон DESIGN_SYSTEM.md §1: мир тёмный,
// сущности светятся, свет сверху-слева. У всего объёмного есть кромка
// света — иначе корпус читается плоской заливкой и «мыло» на биоме.
// Полоса обрезается по фигуре, поэтому повторяет силуэт точно.
// ------------------------------------------------------------

// Световая полоса по верхней кромке многоугольника.
function topLight(ctx, pts, h = 2.2, a = 0.42) {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i + 1] < minY) minY = pts[i + 1];
    if (pts[i + 1] > maxY) maxY = pts[i + 1];
    if (pts[i] < minX) minX = pts[i];
    if (pts[i] > maxX) maxX = pts[i];
  }
  ctx.save();
  poly(ctx, pts); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
  ctx.fillRect(minX, minY, maxX - minX, h);
  ctx.restore();
}

// То же для скруглённого прямоугольника (корпуса-«утюги», платформы).
function topLightRect(ctx, x, y, w, h, a = 0.4, rh = 2.2) {
  ctx.save();
  rr(ctx, x, y, w, h, 6); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
  ctx.fillRect(x, y, w, rh);
  ctx.restore();
}

// То же для круга/овала (диск медика, купола).
function topLightEllipse(ctx, cx, cy, rx, ry, a = 0.38, rh = 2.2) {
  ctx.save();
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
  ctx.fillRect(cx - rx, cy - ry, rx * 2, rh);
  ctx.restore();
}

// Влажный блик органики кхарид: тёплое пятно сверху-слева, без резкой
// кромки — плоть «мокрая», а не пластиковая. Делаётся слоями эллипсов,
// а не createRadialGradient: на 200 юнитов градиент в кадр — это аллокации,
// а здесь только fill. Симуляцию не трогает.
function wetLight(ctx, cx, cy, rx, ry, a = 0.3) {
  const gx = cx - rx * 0.32, gy = cy - ry * 0.44;
  ctx.save();
  for (let i = 3; i >= 1; i--) {
    const k = i / 3;
    ctx.fillStyle = 'rgba(255,226,232,' + (a * (0.28 + 0.52 * (1 - k))).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(gx, gy, rx * 0.6 * k, ry * 0.6 * k, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- Аура лечения (V-3): поле вокруг аптечка, «+» здоровья и рой
// нанодронов у Гелиоса. Цвет — как у эффекта 'heal' в drawEffects
// (#7dff9b), чтобы поле юнита и плюсики над леченым читались одним.
// Рисуется в МИРОВОЙ СК (вызывается до rotate): «+» всегда всплывают
// вверх, куда бы ни смотрел юнит. Без градиентов и без shadowBlur —
// A9-стаб не умеет createRadialGradient, а «одно свечение на спрайт»
// остаётся за ядром-крестом. Симуляцию не трогает.
function healAura(ctx, u, rx, ry, t) {
  const A = '#7dff9b';
  const alien = u.faction === 'alien';
  const R = u.r + 8;
  const ph = 0.5 + 0.5 * Math.sin(t * 3.4 + u.id);
  if (alien) {
    // Кхарид: облако спор — плотнее и зеленее, чем у техники: пыльца
    // стелется вокруг тела и висит в воздухе.
    for (let i = 0; i < 7; i++) {
      const a = i * 1.35 + u.id * 0.8;
      const d = R * (0.4 + 0.36 * ((i * 37) % 11) / 11);
      const rr2 = R * (0.46 + 0.18 * ((i * 53) % 7) / 7);
      ctx.globalAlpha = 0.12 + 0.06 * ph;
      ctx.fillStyle = A;
      ctx.beginPath();
      ctx.ellipse(rx + Math.cos(a) * d, ry + Math.sin(a) * d * 0.72,
        rr2, rr2 * 0.76, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Пыльца: точки по краю облака — крутятся, мигают и меняют размер.
    for (let i = 0; i < 10; i++) {
      const a = i * 0.9 + u.id * 0.6 + t * 0.22;
      const d = R * (0.7 + 0.22 * ((i * 29) % 5) / 5);
      const blink = 0.5 + 0.5 * Math.sin(t * 2.6 + i * 1.3);
      ctx.globalAlpha = 0.28 + 0.45 * blink;
      ctx.fillStyle = blink > 0.6 ? '#c8ffbe' : '#8fe87f';
      ctx.beginPath();
      ctx.arc(rx + Math.cos(a) * d, ry + Math.sin(a) * d * 0.8,
        0.9 + blink * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Гелиос: ровный купол-поле с кромкой и расходящейся волной.
    ctx.globalAlpha = 0.1 + ph * 0.06;
    ctx.fillStyle = A;
    ctx.beginPath(); ctx.arc(rx, ry, R, 0, Math.PI * 2); ctx.fill();
    // Ядро-крест: мягкое зелёное сияние вокруг аппарата (слоями, без blur).
    ctx.globalAlpha = 0.24 + 0.1 * ph;
    ctx.beginPath(); ctx.arc(rx, ry, u.r + 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = A; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(rx, ry, R, 0, Math.PI * 2); ctx.stroke();
    const wave = (t * 0.85 + u.id * 0.37) % 1;
    ctx.globalAlpha = (1 - wave) * 0.5;
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(rx, ry, u.r + 2 + wave * 8, 0, Math.PI * 2); ctx.stroke();
    // Рой нанодронов: пять настоящих блюдец на орбите — корпус, ободок,
    // окошко и свой крестик; к ядру каждый tied дугой «связи».
    const orbR = u.r + 3.6;
    for (let i = 0; i < 5; i++) {
      const a = i * 1.256 + t * 0.5 + u.id * 0.4;
      const dx = rx + Math.cos(a) * orbR;
      const dy = ry + Math.sin(a) * orbR * 0.72;
      ctx.globalAlpha = 0.28 + 0.22 * ph;
      ctx.strokeStyle = A; ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.quadraticCurveTo(rx + Math.cos(a) * orbR * 0.55,
        ry + Math.sin(a) * orbR * 0.36, dx, dy);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#e8eef2';
      ctx.beginPath(); ctx.ellipse(dx, dy, 3.5, 2.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#596069';
      ctx.beginPath(); ctx.ellipse(dx, dy - 0.7, 3.5, 1.6, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#7df3e2';
      ctx.fillRect(dx - 1.6, dy - 0.5, 3.2, 1.3);
      ctx.fillStyle = A;
      ctx.fillRect(dx - 0.35, dy - 2, 0.7, 4);
      ctx.fillRect(dx - 2, dy - 0.35, 4, 0.7);
    }
  }
  // «+» здоровья: три плюсика дрейфуют вверх и тают (обе расы).
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.5 + i * 0.34 + u.id * 0.21) % 1;
    const a = i * 2.09 + u.id * 0.7;
    const pr = u.r + 1 + k * 7;
    const ps = 1.9 + k * 1.1;
    const x = rx + Math.cos(a) * pr;
    const y = ry + Math.sin(a) * pr - k * 4;
    // Мягкое сияние плюсика — слоем, без shadowBlur.
    ctx.globalAlpha = (1 - k) * 0.16;
    ctx.fillStyle = A;
    ctx.beginPath(); ctx.arc(x, y, ps * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = (1 - k) * 0.9;
    ctx.fillRect(x - ps * 0.26, y - ps, ps * 0.52, ps * 2);
    ctx.fillRect(x - ps, y - ps * 0.26, ps * 2, ps * 0.52);
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------
// Отрисовка юнита (rx, ry — уже интерполированная позиция).
// Стиль-гайд v2 «семейства»:
//   Гелиос — угловатая ховер-техника: шестигранники, прямые кромки,
//   тёмный корпус + светлая панель + янтарные мелочи; под корпусом —
//   светлая ховер-подложка, тяга видна по соплам (мерцание, сильнее
//   на ходу). Читается как «машина» даже без цвета — по углам.
//   кхарид — круглая органика: эллипсы-сегменты, шипы, лапы, пасти;
//   светится био-зелёным + яркое ядро стороны. Читается как «зверь».
// Слои: подложка → силуэт с тёмным контуром → панели → оружие →
// ОДНО светящееся ядро (shadowBlur ≤ 9, один вызов на юнит).
// Анимация — только рендерная (performance.now + u.id): пульс ядер,
// мерцание тяги, покачивание лап на ходу, откат стволов по u.cd.
// Контракт §3: нос по +X, габарит ±(r+8), тень/кольцо/HP снаружи.
// ------------------------------------------------------------
// rank (0…20) — ранг юнита из лаборатории; влияет ТОЛЬКО на вид:
// масштаб картинки и «сегменты брони» (см. skins.drawUnitGrade).
export function drawUnit(ctx, u, rx, ry, rank = 0) {
  const isP = u.side === 'player';
  const main = isP ? COLORS.player : COLORS.enemy;
  const dark = isP ? COLORS.playerDark : COLORS.enemyDark;
  const bright = isP ? COLORS.playerBright : COLORS.enemyBright;
  const bio = '#9ff5b8';        // свечение органики кхарид
  const amber = '#f3c579';      // акценты техники Гелиоса
  const heat = '#ffb36b';       // дульное пламя / раскалённые сопла
  const hull = '#0e2028';       // тёмный корпус Гелиоса
  const hull2 = '#223c46';      // светлая панель Гелиоса
  const flesh = '#241b33';      // тёмная плоть кхарид
  const maw = '#150d1c';        // пасть / нутро
  const bone = '#bcc7ae';       // рога и клыки
  const outline = isP ? '#081418' : '#2a1113'; // контур силуэта
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

  // Аура лечения (V-3): у аптечков поле видно всегда — это их подпись.
  if (u.cfg && u.cfg.canHeal) {
    healAura(ctx, u, rx, ry, performance.now() * 0.001 + u.id * 1.618);
  }

  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(u.angle);
  // Э5+: ранг чуть увеличивает картинку юнита (до +8 %), хитбокс не меняется.
  const rankScale = skinUnitScale(rank);
  if (rankScale !== 1) ctx.scale(rankScale, rankScale);

  // Рендерное время анимации (на симуляцию не влияет).
  const t = performance.now() * 0.001 + u.id * 1.618;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.4);       // пульс ядер 0..1
  const flick = 0.72 + 0.28 * Math.sin(t * 23 + u.id); // мерцание тяги
  const step = u.moving ? Math.sin(t * 14) : 0;      // шаг лап на ходу
  const sway = Math.sin(t * 2.1) * 0.5;              // ленивое покачивание
  const cdMax = u.cfg.cooldown || 1;
  const recoil = u.cd > 0 ? Math.min(1, u.cd / cdMax) : 0; // 1 — только выстрелил
  const heatGlow = Math.max(pulse * 0.35, recoil);   // жар сопла/дула
  const eng = u.moving ? 1 : 0.45;                   // тяга двигателей

  if (alien) {
    // ============ КХАРИД: кристаллическая органика ============
    // Ховер-подложка здесь — тёмное пятно слизи под телом.
    ctx.fillStyle = 'rgba(20,8,26,0.4)';
    ctx.beginPath(); ctx.ellipse(0, 4, u.r + 1, u.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();

    if (u.type === 'worker') {
      // Собиратель: grub из 3 сегментов, 6 качающихся лап, жвалы и фонарь.
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const lx = -6 + i * 6, sw = (i % 2 ? step : -step) * 1.6;
        ctx.beginPath(); ctx.moveTo(lx, -4); ctx.lineTo(lx + 2 + sw, -10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx, 4); ctx.lineTo(lx + 2 - sw, 10); ctx.stroke();
      }
      ctx.fillStyle = flesh;
      ctx.beginPath(); ctx.ellipse(-7, 0, 5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-1, 0, 5.5, 7.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(5, 0, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(-1, 0, 5.5, 7.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(5, 0, 5, 6, 0, 0, Math.PI * 2); ctx.stroke();
      wetLight(ctx, -1, -1.5, 5.5, 7.5, 0.32);
      wetLight(ctx, 5, -1, 5, 6, 0.22);
      // Спинные шипики.
      ctx.fillStyle = bio;
      poly(ctx, [-4, -7, -2, -11, 0, -7]); ctx.fill();
      poly(ctx, [2, -6, 4, -10, 6, -6]); ctx.fill();
      // Жвалы.
      ctx.strokeStyle = bright; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(9, -3); ctx.quadraticCurveTo(13, -3, 14, -6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(9, 3); ctx.quadraticCurveTo(13, 3, 14, 6); ctx.stroke();
      // Ядро-фонарь.
      ctx.shadowColor = bio; ctx.shadowBlur = 6;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(7, 0, 2.4 + pulse * 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'marine') {
      // Кристожал: капля-тело, гребень из 5 шипов, пасть с глоткой, хвост.
      ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.quadraticCurveTo(-13, step * 2, -15, step * 3); ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-1, 0, 10.5, 7.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(-1, 0, 10.5, 7.2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(1, 0, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
      wetLight(ctx, -1, -1.5, 10.5, 7.2, 0.3);
      // Гребень: шипы с био-кончиками.
      for (let i = 0; i < 5; i++) {
        const sx = -7 + i * 3.4, h = 5 + (i % 2) * 2.5;
        ctx.fillStyle = flesh;
        poly(ctx, [sx - 1.6, -4.5, sx, -4.5 - h, sx + 1.6, -4.5]); ctx.fill();
        ctx.fillStyle = bio;
        ctx.beginPath(); ctx.arc(sx, -4.5 - h, 1.2, 0, Math.PI * 2); ctx.fill();
      }
      // Боковые глаза.
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(3, -5.2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(3, 5.2, 1.5, 0, Math.PI * 2); ctx.fill();
      // Пасть и светящаяся глотка.
      ctx.fillStyle = maw;
      ctx.beginPath(); ctx.arc(8.5, 0, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bright;
      poly(ctx, [10.5, -2.6, 13, -1.4, 10.5, -0.4]); ctx.fill();
      poly(ctx, [10.5, 2.6, 13, 1.4, 10.5, 0.4]); ctx.fill();
      ctx.shadowColor = bright; ctx.shadowBlur = 7;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(8.5, 0, 1.6 + pulse * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'buggy') {
      // Скользень: поджарый бегун — длинные лапы в шаге, голова с 3 глазами.
      ctx.strokeStyle = dark; ctx.lineWidth = 2.6;
      const f = step * 3;
      ctx.beginPath(); ctx.moveTo(5, -4); ctx.lineTo(12, -10 - f); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(5, 4); ctx.lineTo(12, 10 + f); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-13, -9 + f); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(-13, 9 - f); ctx.stroke();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.quadraticCurveTo(-14, -sway * 3, -17, -sway * 4); ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(-1, 0, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(-1, 0, 10, 6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(-2, 0, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      // Спинные плавники: два ряда — «скользень» читается по хребту.
      ctx.fillStyle = flesh;
      poly(ctx, [-5, -4, -2, -11, 1, -4]); ctx.fill();
      poly(ctx, [-9, -3.5, -7, -8, -4, -3.5]); ctx.fill();
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(-2, -11, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-7, -8, 1.1, 0, Math.PI * 2); ctx.fill();
      wetLight(ctx, -1, -1.5, 10, 6, 0.3);
      // Голова, клыки и тройка глаз.
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(8, 0, 4.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bright;
      poly(ctx, [11.5, -2.5, 14, -1.5, 11.5, -0.5]); ctx.fill();
      poly(ctx, [11.5, 2.5, 14, 1.5, 11.5, 0.5]); ctx.fill();
      ctx.shadowColor = bio; ctx.shadowBlur = 6;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(9.5, -2.6, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(11, 0, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(9.5, 2.6, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'tank') {
      // Громила: гора мышц — наплечники, изогнутые рога, ядро во лбу.
      ctx.fillStyle = flesh;
      ctx.fillRect(-12, -14, 6, 4); ctx.fillRect(-12, 10, 6, 4);
      ctx.fillRect(4, -13.5, 6, 4); ctx.fillRect(4, 9.5, 6, 4);
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(0, 0, 15, 11.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 15, 11.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(3, 0, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      wetLight(ctx, 0, -2, 15, 11.5, 0.26);
      ctx.fillStyle = flesh; // крап панциря
      ctx.beginPath(); ctx.arc(0, -3, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(5, 4, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-2, 5, 1.4, 0, Math.PI * 2); ctx.fill();
      // Наплечники с био-заклёпками.
      ctx.fillStyle = flesh;
      ctx.beginPath(); ctx.ellipse(-4, -9.5, 6, 4.2, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-4, 9.5, 6, 4.2, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(-4, -9.5, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-4, 9.5, 1.5, 0, Math.PI * 2); ctx.fill();
      // Рога костяные, с био-основанием.
      for (const s of [-1, 1]) {
        ctx.fillStyle = bone;
        ctx.beginPath();
        ctx.moveTo(0, 8 * s);
        ctx.quadraticCurveTo(6, 13 * s, 12, 19 * s);
        ctx.quadraticCurveTo(13.5, 16.5 * s, 13, 15 * s);
        ctx.quadraticCurveTo(8, 11 * s, 4, 7 * s);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = outline; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = bio;
        ctx.beginPath(); ctx.arc(2, 7.5 * s, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      // Пасть с зубами и ядро во лбу.
      ctx.fillStyle = maw;
      ctx.beginPath(); ctx.ellipse(13, 0, 2.6, 4.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bone;
      for (let i = -1; i <= 1; i++) {
        poly(ctx, [12, i * 2.4 - 0.8, 14.6, i * 2.4, 12, i * 2.4 + 0.8]); ctx.fill();
      }
      ctx.shadowColor = bright; ctx.shadowBlur = 9;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(8, 0, 3.2 + pulse * 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = maw;
      ctx.beginPath(); ctx.arc(8, 0, 1.3, 0, Math.PI * 2); ctx.fill();
    } else if (u.type === 'medic') {
      // Цветень: капля с венчиком из 6 лепестков и свечой-ростком.
      // Облако спор с «+» — в healAura (мировая СК, орг-вариант поля).
      const pr = 8.6 + pulse * 0.9;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + t * 0.6;
        const px = Math.cos(a) * pr, py = Math.sin(a) * pr;
        ctx.save();
        ctx.translate(px, py); ctx.rotate(a);
        ctx.fillStyle = flesh;
        ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 2.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = bio; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 2.1, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = bio; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-7, -3); ctx.quadraticCurveTo(-11, -4, -13, -6 + step * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7, 3); ctx.quadraticCurveTo(-11, 4, -13, 6 - step * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      // Сияние мякоти: спора лечит изнутри — зелёный ореол вокруг капли
      // (слоями, без shadowBlur: свечение остаётся за свечой-ростком).
      ctx.globalAlpha = 0.2 + 0.12 * pulse;
      ctx.fillStyle = '#a8ff9e';
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 7, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(1, 0, 5.5, 5, 0, 0, Math.PI * 2); ctx.fill();
      wetLight(ctx, 0, -1.5, 8, 7, 0.34);
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(4, 0, 2, 0, Math.PI * 2); ctx.fill();
      // Свеча-росток с пульсирующим пламенем — «соска» няньки, она же
      // ориентир: по ней видно, кто здесь лечит.
      ctx.strokeStyle = bio; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-2, -5); ctx.lineTo(-2 + sway, -11); ctx.stroke();
      ctx.shadowColor = bio; ctx.shadowBlur = 8;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(-2 + sway, -12.5, 2.4 + pulse * 1, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.4 + 0.3 * pulse;
      ctx.beginPath(); ctx.arc(-2 + sway, -12.5, 4.4 + pulse * 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    } else if (u.type === 'flamer') {
      // Кислотник: пузатый плевун — бородавки, боковые мешки, рыло-сопло.
      ctx.fillStyle = dark;
      ctx.fillRect(-9, -11, 5, 3.4); ctx.fillRect(-9, 7.6, 5, 3.4);
      ctx.fillRect(2, -11.4, 5, 3.4); ctx.fillRect(2, 8, 5, 3.4);
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(3.5, 0, 7, 6.6, 0, 0, Math.PI * 2); ctx.fill();
      wetLight(ctx, 0, -2, 10.5, 10.5, 0.26);
      // Бородавки и пульсирующие мешки.
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(-4, -6.5, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-7, 0, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-4, 6.5, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(-6, -8.5, 3.6 + pulse, 2.6, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-6, 8.5, 3.6 + pulse, 2.6, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Рыло и раскалённое сопло.
      ctx.fillStyle = flesh;
      poly(ctx, [8, -4.5, 14.5, -3, 14.5, 3, 8, 4.5]); ctx.fill();
      ctx.fillStyle = heat;
      ctx.fillRect(13.5, -3.4, 2.6, 6.8);
      ctx.shadowColor = heat; ctx.shadowBlur = 8;
      ctx.fillStyle = heat;
      ctx.beginPath(); ctx.arc(16.5, 0, 1.8 + heatGlow * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'scout') {
      // Слухач: юркий зверёк — уши-локаторы, тройка глаз, спора-спутник.
      ctx.strokeStyle = dark; ctx.lineWidth = 2.2;
      const f = step * 2.4;
      ctx.beginPath(); ctx.moveTo(4, -3); ctx.lineTo(10, -8 - f); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4, 3); ctx.lineTo(10, 8 + f); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, -3); ctx.lineTo(-11, -7 + f); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(-11, 7 - f); ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = flesh;
      poly(ctx, [2, -4, 5, -11, 7, -3]); ctx.fill();
      poly(ctx, [-3, -4, -1, -11, 1, -3]); ctx.fill();
      wetLight(ctx, 0, -1, 8, 5, 0.32);
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(5, -11, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-1, -11, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = bio; ctx.shadowBlur = 5;
      ctx.beginPath(); ctx.arc(6, -2, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7.4, 0, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, 2, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      const sx = -9 + Math.sin(t * 2.6) * 1.8, sy = -6 + Math.cos(t * 3.4) * 1.6;
      ctx.shadowColor = bio; ctx.shadowBlur = 5;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(sx, sy, 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      // Спогром: червь из 4 сегментов, мортира на спине, споровые мешки.
      const segX = [-12, -5, 2, 9], segR = [7.5, 9, 9, 7];
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? flesh : dark;
        ctx.beginPath(); ctx.ellipse(segX[i], 0, 5.5, segR[i], 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(-12, 0, 5.5, 7.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(9, 0, 5.5, 7, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = main; ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const gx = segX[i] + 3;
        ctx.beginPath(); ctx.moveTo(gx, -7.5); ctx.quadraticCurveTo(gx + 1.5, 0, gx, 7.5); ctx.stroke();
      }
      wetLight(ctx, -1, -2.5, 12, 9, 0.24);
      // Споровые мешки.
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(4, -8.5, 2.4 + pulse * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-6, 9, 2.8 + pulse * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, 8.2, 2.2, 0, Math.PI * 2); ctx.fill();
      // Мортира: толстая труба вверх-назад с био-кольцами.
      ctx.lineCap = 'round';
      ctx.strokeStyle = outline; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(-2, -4); ctx.lineTo(-8, -17); ctx.stroke();
      ctx.strokeStyle = flesh; ctx.lineWidth = 5.4;
      ctx.beginPath(); ctx.moveTo(-2, -4); ctx.lineTo(-8, -17); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.strokeStyle = bio; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-4.6, -9.4); ctx.lineTo(-1.4, -11.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6.6, -13.4); ctx.lineTo(-3.4, -15.4); ctx.stroke();
      if (recoil > 0.25) {
        ctx.fillStyle = heat;
        ctx.beginPath(); ctx.arc(-8.5, -18, 1.5 + recoil * 2, 0, Math.PI * 2); ctx.fill();
      }
      // Голова: пасть и глаза.
      ctx.fillStyle = maw;
      ctx.beginPath(); ctx.arc(13.5, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bright;
      poly(ctx, [13, -2.4, 15.5, -1.2, 13, -0.2]); ctx.fill();
      poly(ctx, [13, 2.4, 15.5, 1.2, 13, 0.2]); ctx.fill();
      ctx.shadowColor = bio; ctx.shadowBlur = 7;
      ctx.fillStyle = bio;
      ctx.beginPath();
      ctx.arc(8, -4.6, 1.6, 0, Math.PI * 2);
      ctx.arc(8, 4.6, 1.6, 0, Math.PI * 2);
      ctx.arc(-2, -5, 2.2 + pulse * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  } else {
    // ============ ГЕЛИОС: ховер-техника и плазма ============
    // Ховер-подложка: светлое пятно тяги под корпусом.
    ctx.fillStyle = main;
    ctx.globalAlpha = 0.1 + 0.09 * eng * flick;
    ctx.beginPath(); ctx.ellipse(0, 4, u.r + 3, u.r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    if (u.type === 'worker') {
      // Дрон-техник: шестигранник, 4 лифта, манипуляторы, мачта-маяк.
      ctx.fillStyle = hull;
      ctx.fillRect(-9, -11, 6, 3.4); ctx.fillRect(-9, 7.6, 6, 3.4);
      ctx.fillRect(3, -11, 6, 3.4); ctx.fillRect(3, 7.6, 6, 3.4);
      ctx.fillStyle = main;
      ctx.globalAlpha = 0.55 + 0.45 * flick * eng;
      ctx.fillRect(-8, -10.6, 4, 2.4); ctx.fillRect(-8, 8.2, 4, 2.4);
      ctx.fillRect(4, -10.6, 4, 2.4); ctx.fillRect(4, 8.2, 4, 2.4);
      ctx.globalAlpha = 1;
      // Манипуляторы с клешнями.
      ctx.strokeStyle = hull2; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(6, -5); ctx.lineTo(12, -7 + step); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(12, 7 - step); ctx.stroke();
      ctx.strokeStyle = amber; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(12, -7 + step); ctx.lineTo(14.5, -8 + step); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(12, 7 - step); ctx.lineTo(14.5, 8 - step); ctx.stroke();
      // Корпус.
      ctx.fillStyle = hull;
      poly(ctx, [11, 0, 5, -8, -6, -8, -11, 0, -6, 8, 5, 8]); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = hull2;
      poly(ctx, [7, 0, 3, -5, -4, -5, -7, 0, -4, 5, 3, 5]); ctx.fill();
      topLight(ctx, [7, 0, 3, -5, -4, -5, -7, 0, -4, 5, 3, 5], 1.8, 0.5);
      ctx.strokeStyle = main; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(3, -5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, 5); ctx.lineTo(3, 5); ctx.stroke();
      // Заклёпки-пиксели на панели: «инженерия», а не заливка.
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(-5, -3.4, 1.6, 1.6); ctx.fillRect(-1, -3.4, 1.6, 1.6);
      ctx.fillRect(-5, 2, 1.6, 1.6); ctx.fillRect(-1, 2, 1.6, 1.6);
      // Мачта с маяком.
      ctx.strokeStyle = hull2; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(-6, -12); ctx.stroke();
      ctx.fillStyle = amber;
      ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 6));
      ctx.beginPath(); ctx.arc(-6, -13, 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Ядро.
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(2, 0, 2.6 + pulse * 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'marine') {
      // Рейнджер: броня с наплечниками, визор-щель, ствол с откатом.
      ctx.fillStyle = main;
      ctx.globalAlpha = 0.5 + 0.5 * flick * eng;
      ctx.fillRect(-5, -10.6, 5, 2.4); ctx.fillRect(-5, 8.2, 5, 2.4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hull2;
      ctx.fillRect(-13.5, -4, 3, 8);
      ctx.fillStyle = main;
      ctx.globalAlpha = 0.4 + 0.6 * eng * flick;
      ctx.fillRect(-14.5, -3, 1.8, 6);
      ctx.globalAlpha = 1;
      // Ствол (откат после выстрела) с дульным тормозом.
      const bl = 13 - recoil * 3.5;
      ctx.fillStyle = '#0a1418';
      ctx.fillRect(6, -1.9, bl, 3.8);
      ctx.fillStyle = hull2;
      ctx.fillRect(6 + bl - 2.5, -2.8, 2.5, 5.6);
      if (recoil > 0.55) {
        ctx.fillStyle = heat;
        ctx.beginPath(); ctx.arc(6 + bl + 1.5, 0, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      // Корпус-шестигранник и нагрудник.
      ctx.fillStyle = hull;
      poly(ctx, [8, 0, 3, -9, -8, -9, -11, 0, -8, 9, 3, 9]); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = hull2;
      poly(ctx, [4, 0, 0, -6, -6, -6, -8, 0, -6, 6, 0, 6]); ctx.fill();
      topLight(ctx, [4, 0, 0, -6, -6, -6, -8, 0, -6, 6, 0, 6], 1.8, 0.5);
      // Бортовые панели с заклёпками.
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.fillRect(-6.5, -4.6, 1.5, 1.5); ctx.fillRect(-3, -4.6, 1.5, 1.5);
      ctx.fillRect(-6.5, 3.2, 1.5, 1.5); ctx.fillRect(-3, 3.2, 1.5, 1.5);
      // Наплечники.
      ctx.fillStyle = amber;
      ctx.fillRect(-10, -11.5, 6, 3.6); ctx.fillRect(-10, 7.9, 6, 3.6);
      ctx.strokeStyle = outline; ctx.lineWidth = 1;
      ctx.strokeRect(-10, -11.5, 6, 3.6); ctx.strokeRect(-10, 7.9, 6, 3.6);
      // Визор-щель — светящееся «лицо».
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.fillRect(-1, -1.4 + sway * 0.4, 6.5, 2.8);
      ctx.shadowBlur = 0;
    } else if (u.type === 'buggy') {
      // Скиф: стрела с кабиной, спарка носовых пушек, пламя движков.
      const fl = (4 + 8 * flick) * eng;
      ctx.fillStyle = heat;
      ctx.globalAlpha = 0.85;
      poly(ctx, [-12, -7.5, -12 - fl, -5.5, -12, -3.5]); ctx.fill();
      poly(ctx, [-12, 7.5, -12 - fl, 5.5, -12, 3.5]); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = hull;
      ctx.fillRect(-13, -8.5, 4, 5); ctx.fillRect(-13, 3.5, 4, 5);
      // Крыло-стрела с окантовкой.
      ctx.fillStyle = hull;
      poly(ctx, [15, 0, -6, -11, -11, -11, -3, 0, -11, 11, -6, 11]); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = main; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(11, -1.5); ctx.lineTo(-5, -9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(11, 1.5); ctx.lineTo(-5, 9); ctx.stroke();
      topLight(ctx, [15, 0, -6, -11, -11, -11, -3, 0, -11, 11, -6, 11], 2, 0.4);
      // Хребет и кабина.
      ctx.fillStyle = main;
      ctx.fillRect(-9, -1.4, 14, 2.8);
      ctx.fillStyle = hull2;
      ctx.beginPath(); ctx.ellipse(4, 0, 5, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bright;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(5, -0.6, 2.6, 1.4, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Носовая спарка.
      ctx.fillStyle = '#0a1418';
      ctx.fillRect(11, -3.6, 6.5 - recoil * 2, 1.7);
      ctx.fillRect(11, 1.9, 6.5 - recoil * 2, 1.7);
      // Ядро тяги.
      ctx.shadowColor = bright; ctx.shadowBlur = 7;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(-4, 0, 2 + pulse * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'tank') {
      // Бастион: широкий корпус на юбках, башня, спарка с откатом, отвал.
      ctx.fillStyle = hull;
      ctx.fillRect(-15, -15, 24, 5); ctx.fillRect(-15, 10, 24, 5);
      ctx.fillStyle = main;
      ctx.globalAlpha = 0.5 + 0.5 * flick * eng;
      ctx.fillRect(-13, -14.2, 20, 3.2); ctx.fillRect(-13, 11, 20, 3.2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hull;
      rr(ctx, -14, -11, 28, 22, 6); ctx.fill();
      topLightRect(ctx, -14, -11, 28, 22, 0.4);
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.stroke();
      // Отвал с шевроном.
      ctx.fillStyle = hull2;
      poly(ctx, [14, -8, 19.5, 0, 14, 8]); ctx.fill();
      ctx.strokeStyle = amber; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(15, -5); ctx.lineTo(18, 0); ctx.lineTo(15, 5); ctx.stroke();
      // Башня с заклёпками.
      ctx.fillStyle = hull2;
      rr(ctx, -9, -7, 18, 14, 5); ctx.fill();
      topLightRect(ctx, -9, -7, 18, 14, 0.46, 1.8);
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(-6, -4.5, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-6, 4.5, 1.3, 0, Math.PI * 2); ctx.fill();
      // Спарка.
      const bl = 15 - recoil * 4;
      ctx.fillStyle = '#0a1418';
      ctx.fillRect(7, -5.6, bl, 3.4); ctx.fillRect(7, 2.2, bl, 3.4);
      ctx.fillStyle = main;
      ctx.fillRect(7 + bl - 2.5, -6.4, 2.5, 5); ctx.fillRect(7 + bl - 2.5, 1.4, 2.5, 5);
      if (recoil > 0.5) {
        ctx.fillStyle = heat;
        ctx.beginPath(); ctx.arc(7 + bl + 1.5, -3.9, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(7 + bl + 1.5, 3.9, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      // Ядро башни и кормовые огни.
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(-3, 0, 2.6 + pulse * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = amber;
      ctx.fillRect(-15.5, -4, 2.2, 3); ctx.fillRect(-15.5, 1, 2.2, 3);
    } else if (u.type === 'medic') {
      // Нанит: ядро-крест роя — блюдце с куполом, пульсирующий крест и
      // дюзы. Рой нанодронов на орбите, купол-поле и всплывающие «+» —
      // в healAura (мировая СК, чтобы «+» всегда шли вверх).
      ctx.fillStyle = main;
      ctx.globalAlpha = 0.55 + 0.45 * flick;
      ctx.fillRect(-13.5, -2.6, 3.4, 5.2); ctx.fillRect(10.1, -2.6, 3.4, 5.2);
      ctx.fillRect(-2.6, -13.5, 5.2, 3.4); ctx.fillRect(-2.6, 10.1, 5.2, 3.4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hull;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      topLightEllipse(ctx, 0, 0, 10, 10, 0.42, 2.2);
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = main; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, 7.6, t * 0.8, t * 0.8 + Math.PI * 1.5); ctx.stroke();
      // Иллюминаторы по бокам: блюдце читается аппаратом, а не шариком.
      ctx.fillStyle = '#7df3e2';
      ctx.fillRect(-8.4, -2.6, 3.4, 5.2); ctx.fillRect(5, -2.6, 3.4, 5.2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-8.4, -2.6, 3.4, 1.2); ctx.fillRect(5, -2.6, 3.4, 1.2);
      ctx.fillStyle = hull2;
      ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, Math.PI * 2); ctx.fill();
      // Крест наномедицины — дышит. Цвет лечащего «+» из drawEffects,
      // чтобы ядро роя и плюсики над раненым были одного языка.
      const cw = 1.7 + pulse * 0.5;
      ctx.shadowColor = '#7dff9b'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#7dff9b';
      ctx.fillRect(-cw / 2, -6.4, cw, 12.8);
      ctx.fillRect(-6.4, -cw / 2, 12.8, cw);
      ctx.shadowBlur = 0;
      // Антенна.
      ctx.strokeStyle = hull2; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(-10, -10); ctx.stroke();
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(-10.5, -10.5, 1.5, 0, Math.PI * 2); ctx.fill();
    } else if (u.type === 'flamer') {
      // Плазмер: приземистый корпус, баки, раскалённое сопло-жерло.
      ctx.fillStyle = '#4a2c22';
      rr(ctx, -12, -11, 11, 4, 2); ctx.fill();
      rr(ctx, -12, 7, 11, 4, 2); ctx.fill();
      ctx.fillStyle = amber;
      ctx.fillRect(-12.5, -10.4, 2.4, 2.8); ctx.fillRect(-12.5, 7.6, 2.4, 2.8);
      ctx.fillRect(-3.5, -10.4, 2.4, 2.8); ctx.fillRect(-3.5, 7.6, 2.4, 2.8);
      ctx.fillStyle = hull;
      rr(ctx, -11, -8, 19, 16, 5); ctx.fill();
      topLightRect(ctx, -11, -8, 19, 16, 0.42);
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = hull2;
      poly(ctx, [8, -8, 13.5, -5, 13.5, 5, 8, 8]); ctx.fill();
      // Пилотская щель и рёбра охлаждения.
      ctx.fillStyle = bright;
      ctx.fillRect(-3, -5.5, 7, 2); ctx.fillRect(-3, 3.5, 7, 2);
      ctx.strokeStyle = main; ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(-9 + i * 3, -7); ctx.lineTo(-9 + i * 3, -4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-9 + i * 3, 4); ctx.lineTo(-9 + i * 3, 7); ctx.stroke();
      }
      // Сопло: тёмный раструб + жар внутри.
      ctx.fillStyle = '#0a1418';
      poly(ctx, [13, -4.6, 18.5, -2.8, 18.5, 2.8, 13, 4.6]); ctx.fill();
      ctx.shadowColor = heat; ctx.shadowBlur = 8;
      ctx.fillStyle = heat;
      ctx.beginPath(); ctx.arc(18.5, 0, 1.6 + heatGlow * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (u.type === 'scout') {
      // Следопыт: клин-ховер без пушек, мачта-антенна, парящий дрон-точка.
      ctx.fillStyle = hull;
      poly(ctx, [12, 0, -8, -8, -4, 0, -8, 8]); ctx.fill();
      topLight(ctx, [12, 0, -8, -8, -4, 0, -8, 8], 1.8, 0.44);
      ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = main; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.moveTo(9, 0); ctx.lineTo(-6, 6); ctx.stroke();
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(2, 0, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hull2; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-6, -10); ctx.stroke();
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(-6, -11, 1.6 + pulse * 0.7, 0, Math.PI * 2); ctx.fill();
      const dx = 10 + Math.sin(t * 2.2) * 2, dy = -8 + Math.cos(t * 3.1) * 1.6;
      ctx.strokeStyle = bright; ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(dx, dy); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(dx, dy, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = heat; ctx.globalAlpha = 0.7;
      poly(ctx, [-8, -3, -8 - 4 * eng, 0, -8, 3]); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // Мортира «Нова»: длинная платформа, барабан, поднятый ствол.
      ctx.fillStyle = hull;
      ctx.fillRect(-16, -13, 28, 4.6); ctx.fillRect(-16, 8.4, 28, 4.6);
      ctx.fillStyle = main;
      ctx.globalAlpha = 0.5 + 0.5 * flick * eng;
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(-14 + i * 8, -12.4, 5, 3.2);
        ctx.fillRect(-14 + i * 8, 9.2, 5, 3.2);
      }
      ctx.globalAlpha = 1;
      // Аутригеры.
      ctx.strokeStyle = hull2; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(-14, -7); ctx.lineTo(-19, -11); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-14, 7); ctx.lineTo(-19, 11); ctx.stroke();
      ctx.fillStyle = hull;
      rr(ctx, -14, -7.5, 26, 15, 4); ctx.fill();
      topLightRect(ctx, -14, -7.5, 26, 15, 0.4);
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.stroke();
      // Барабан боепитания с янтарными секторами.
      ctx.fillStyle = hull2;
      ctx.beginPath(); ctx.arc(-9, 0, 4.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = amber;
      for (let i = 0; i < 3; i++) {
        const a = t * 0.7 + (i * Math.PI * 2) / 3;
        ctx.beginPath(); ctx.arc(-9 + Math.cos(a) * 2.8, Math.sin(a) * 2.8, 1.2, 0, Math.PI * 2); ctx.fill();
      }
      // Поворотный круг и длинный ствол.
      ctx.fillStyle = hull2;
      ctx.beginPath(); ctx.arc(2, 0, 6.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = main; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(2, 0, 6.4, 0, Math.PI * 2); ctx.stroke();
      const bl = 23 - recoil * 5;
      ctx.fillStyle = '#0a1418';
      ctx.fillRect(4, -2.1, bl, 4.2);
      ctx.fillStyle = main;
      ctx.fillRect(4 + bl - 3, -3.1, 3, 6.2);
      if (recoil > 0.5) {
        ctx.fillStyle = heat;
        ctx.beginPath(); ctx.arc(4 + bl + 1.5, 0, 2.6, 0, Math.PI * 2); ctx.fill();
      }
      // Ядро наведения.
      ctx.shadowColor = amber; ctx.shadowBlur = 6;
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(2, 0, 1.8 + pulse * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Груз кристалла на спине (рабочие) — гранёный, с бликом.
  if (u.carrying > 0) {
    ctx.shadowColor = COLORS.mineral; ctx.shadowBlur = 8;
    ctx.fillStyle = COLORS.mineral;
    poly(ctx, [-10, -3, -6, -8.5, -2, -3, -6, 2.5]); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    poly(ctx, [-6, -8.5, -4.4, -3.4, -6, -1]); ctx.fill();
  }
  if (u.flashT > 0) {
    ctx.fillStyle = `rgba(255,255,255,${u.flashT * 2.8})`;
    ctx.beginPath(); ctx.arc(0, 0, u.r + 2, 0, Math.PI * 2); ctx.fill();
  }
  // Э5+: слой ранга — сегменты брони, огни, антенна, неон/призма.
  if (rank > 0 && u.side === 'player') drawUnitGrade(ctx, u, rank, t);
  ctx.restore();

  // Метка недостижимой цели: красный «!» — игрок видит, что приказ
  // упёрся и юнит встал осознанно, а не «забаговал».
  if (u.selected && u.idleReason === 'unreachable') {
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff6a5e';
    ctx.fillText('!', rx + u.r + 6, ry - u.r - 2);
    ctx.textAlign = 'left';
  }

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
