// ============================================================
// buildings.js — здания: размещение, строительство рабочими,
// очереди производства, население (supply), оборона (турели),
// гарнизоны (бункеры), отрисовка.
// ============================================================
import { TILE, BUILDINGS, UNITS, SUPPLY_MAX, BULLET_SPEED, COLORS, UPGRADES, fname } from './config.js';
import { nearestFreeTileAround } from './pathfinding.js';
import { orderBuild, orderGather, orderMove, spawnUnit, addEffect, shoot, acquireTarget, releaseGarrison } from './units.js';
import { distToRectPx } from './pathfinding.js';

let nextBId = 1;

export class Building {
  constructor(st, side, type, tx, ty, done = false) {
    this.id = nextBId++;
    this.kind = 'building';
    this.side = side;
    this.type = type;
    this.cfg = BUILDINGS[type];
    this.tx = tx; this.ty = ty;
    this.w = this.cfg.w; this.h = this.cfg.h;
    this.x = (tx + this.w / 2) * TILE;   // центр — для прицеливания и камеры
    this.y = (ty + this.h / 2) * TILE;
    this.done = done;
    this.faction = (st.factions && st.factions[side]) || 'human'; // облик и подписи
    this.progress = done ? 1 : 0;
    this.hp = done ? this.cfg.hp : Math.max(1, this.cfg.hp * 0.15);
    this.maxHp = this.cfg.hp;
    this.queue = [];                     // [{type, t, total, hold}]
    this.res = null;                     // текущее исследование лаборатории {key, lvl, t, total}
    this.rally = null;                   // точка сбора (ПКМ по земле)
    this.garrison = [];                  // пехота внутри (бункер)
    this.cd = 0;                         // перезарядка (турель)
    this.scanT = 0;                      // таймер автопоиска цели
    this.target = null;                  // текущая цель турели
    this.angle = side === 'player' ? -Math.PI / 4 : (Math.PI * 3) / 4;
    this.lastSpawn = null;               // точка прошлого выхода (анти-слипание)
    this.spotted = side === 'player';    // видел ли игрок это вражеское здание
    this.flashT = 0;
    this.selected = false;
    this.dead = false;
    st.buildings.push(this);
  }
}

// Свободно ли место под здание: границы, рельеф, кристаллы, другие здания.
export function canPlace(map, tx, ty, w, h) {
  for (let y = ty; y < ty + h; y++)
    for (let x = tx; x < tx + w; x++) {
      if (!map.inBounds(x, y)) return false;
      const i = map.idx(x, y);
      if (map.terrain[i] !== 0 || map.mineralGrid[i] || map.buildingGrid[i]) return false;
    }
  return true;
}

// Общая команда постройки (для игрока и ИИ): списывает минералы,
// создаёт недострой, выселяет юнитов с площадки, раздаёт приказ рабочим.
export function placeBuildingCmd(st, side, type, tx, ty, builders) {
  const cfg = BUILDINGS[type];
  if (!canPlace(st.map, tx, ty, cfg.w, cfg.h)) return null;
  if (st.minerals[side] < cfg.cost) return null;
  st.minerals[side] -= cfg.cost;
  const b = new Building(st, side, type, tx, ty, false);
  st.map.markBuilding(b);
  st.bcount[side]++;

  // Выселение с площадки: ТОЛЬКО стоящих без приказа. Маршевые, воюющие
  // и добывающие сохраняют приказ — их мягко выдавит из корпуса физика
  // (resolveBuildings), а маршрут перестроит repathIfBlocked. Раньше
  // выселение затирало приказ «идти туда-то» у идущих юнитов: после
  // выселения они замирали — класс жалоб «юнит встал и всё».
  const spot = nearestFreeTileAround(st.map, tx, ty, cfg.w, cfg.h);
  for (const u of st.units) {
    if (u.dead || u.garrison) continue;
    if (u.x > tx * TILE - u.r && u.x < (tx + cfg.w) * TILE + u.r &&
        u.y > ty * TILE - u.r && u.y < (ty + cfg.h) * TILE + u.r) {
      if (u.order.kind !== 'idle') continue; // занят своим делом — не трогаем
      if (spot) {
        orderMove(st, u, (spot.x + 0.5) * TILE, (spot.y + 0.5) * TILE);
      } else {
        const d = Math.hypot(u.x - b.x, u.y - b.y) || 1;
        orderMove(st, u, u.x + (u.x - b.x) / d * TILE * 3, u.y + (u.y - b.y) / d * TILE * 3);
      }
    }
  }
  // Рабочие получают приказ строить.
  if (builders) for (const w of builders) if (!w.dead && !w.garrison) orderBuild(st, w, b);
  return b;
}

// Поставить юнит в очередь производства. Коды: ok | money | queue | wrong.
export function enqueueUnit(st, b, type) {
  if (!b || b.dead || !b.done) return 'wrong';
  const list = Array.isArray(b.cfg.produces) ? b.cfg.produces : [b.cfg.produces];
  if (!list.includes(type)) return 'wrong';
  if (b.queue.length >= 5) return 'queue';
  const cost = UNITS[type].cost;
  if (st.minerals[b.side] < cost) return 'money';
  st.minerals[b.side] -= cost;
  b.queue.push({ type, t: UNITS[type].trainTime, total: UNITS[type].trainTime });
  return 'ok';
}

export function cancelQueueItem(st, b, i) {
  const item = b.queue[i];
  if (!item) return;
  st.minerals[b.side] += UNITS[item.type].cost;
  b.queue.splice(i, 1);
}

// Запустить исследование улучшения. Коды: ok | money | busy | max | wrong.
export function startResearch(st, b, key) {
  const u = UPGRADES[key];
  if (!u || !b || b.dead || !b.done || !b.cfg.research) return 'wrong';
  if (b.res) return 'busy';
  const lvl = (st.tech[b.side] && st.tech[b.side][key]) || 0;
  if (lvl >= u.max) return 'max';
  const cost = u.costs[lvl];
  if (st.minerals[b.side] < cost) return 'money';
  st.minerals[b.side] -= cost;
  b.res = { key, lvl: lvl + 1, t: u.times[lvl], total: u.times[lvl] };
  return 'ok';
}

// Отменить текущее исследование (возврат минералов).
export function cancelResearch(st, b) {
  if (!b.res) return;
  const u = UPGRADES[b.res.key];
  if (u) st.minerals[b.side] += u.costs[b.res.lvl - 1];
  b.res = null;
}

// Тик зданий: производство, автострельба турелей, огонь гарнизона
// бункера. Прогресс стройки ведут рабочие (updateBuild в units.js).
export function updateBuildings(st, dt, grid) {
  for (const b of st.buildings) {
    if (b.dead) continue;
    b.flashT = Math.max(0, b.flashT - dt);
    // Дым из повреждённого здания (арт): редкие клубы над корпусом.
    if (b.done && b.hp < b.maxHp * 0.5 && Math.random() < dt * 2.2) {
      addEffect(st, {
        kind: 'smoke',
        x: b.x + (Math.random() - 0.5) * b.w * TILE * 0.6,
        y: b.y + (Math.random() - 0.5) * b.h * TILE * 0.5,
        t: 0, life: 1.3,
      });
    }
    if (!b.done) continue;

    // --- Исследования (лаборатория) ---
    if (b.res) {
      b.res.t -= dt;
      if (b.res.t <= 0) {
        const key = b.res.key;
        st.tech[b.side][key] = b.res.lvl;
        b.res = null;
        if (b.side === 'player') {
          const u = UPGRADES[key];
          st.game.ui.toast('Улучшение завершено: ' + fname(u, b.faction) + ' ур. ' + st.tech.player[key]);
          st.game.sound.ready();
        }
      }
    }

    // --- Производство ---
    if (b.queue.length) {
      const q = b.queue[0];
      // Юнит «готов», но ждёт свободного населения.
      if (q.hold) {
        if (st.supply[b.side].used + UNITS[q.type].supply > st.supply[b.side].cap) {
          if (b.side === 'player' && st.time - st.lastSupplyToast > 6) {
            st.lastSupplyToast = st.time;
            st.game.ui.toast('Нужен дом — постройте ещё Дом', 'error');
          }
          continue;
        }
        q.hold = false;
      }
      q.t -= dt;
      if (q.t <= 0) {
        // Нет свободной точки выхода — юнит ждёт у ворот, но не
        // появляется внутри корпуса здания (анти-застревание).
        if (trySpawnTrained(st, b, q.type)) b.queue.shift();
        else q.t = 0;
      }
    }

    // --- Турель: сама ищет и обстреливает врагов ---
    if (b.cfg.attack) {
      b.cd = Math.max(0, b.cd - dt);
      b.scanT -= dt;
      // Проверяем актуальность цели: жива и в радиусе.
      if (b.target && (b.target.dead ||
          distToRectPx(b.target.x, b.target.y, b.tx * TILE, b.ty * TILE, b.w * TILE, b.h * TILE) > b.cfg.range + TILE)) {
        b.target = null;
      }
      if (!b.target && b.scanT <= 0) {
        b.scanT = 0.3;
        b.target = acquireTarget(st, b, grid);
      }
      if (b.target) {
        b.angle = Math.atan2(b.target.y - b.y, b.target.x - b.x);
        if (b.cd <= 0) {
          b.cd = b.cfg.cooldown;
          shoot(st, b, b.target);
        }
      }
    }

    // --- Бункер: пехота внутри стреляет сама ---
    if (b.type === 'bunker' && b.garrison.length) {
      const t = acquireTarget(st, b, grid);
      if (t) {
        b.angle = Math.atan2(t.y - b.y, t.x - b.x);
        for (const m of b.garrison) {
          m.cd = Math.max(0, m.cd - dt);
          if (m.cd <= 0) {
            m.cd = m.cfg.cooldown;
            st.projectiles.push({
              x: b.x, y: b.y, tx: t.x, ty: t.y,
              target: t, speed: BULLET_SPEED, dmg: m.cfg.dmg, src: b, dead: false,
            });
            addEffect(st, { kind: 'muzzle', x: b.x + Math.cos(b.angle) * 16, y: b.y + Math.sin(b.angle) * 16, ang: b.angle, t: 0, life: 0.06 });
            st.game.sound.shot();
          }
        }
      }
    }
  }
}

// Точка выхода новобранца: открытый тайл на периметре здания, по
// возможности не ближе 24px к живым юнитам и к точке прошлого выхода —
// очередь из казармы растягивается в цепочку, а не слипается у ворот
// (порт из «Рубежа 64», там порог 25px). Если база — сплошная пробка,
// берём самый свободный тайл; если периметр заперт целиком — null
// (юнит дождётся выхода в очереди, а не появится в корпусе).
function findSpawnSpot(st, b) {
  let best = null, bestClear = -1;
  for (let r = 1; r <= 6; r++) {
    for (let y = b.ty - r; y <= b.ty + b.h - 1 + r; y++) {
      for (let x = b.tx - r; x <= b.tx + b.w - 1 + r; x++) {
        const onEdge = x === b.tx - r || x === b.tx + b.w - 1 + r || y === b.ty - r || y === b.ty + b.h - 1 + r;
        if (!onEdge || !st.map.inBounds(x, y) || st.map.blockedAt(x, y)) continue;
        const px = (x + 0.5) * TILE, py = (y + 0.5) * TILE;
        let clear = Infinity;
        for (const u of st.units) {
          if (u.dead || u.garrison) continue;
          const d = Math.hypot(u.x - px, u.y - py);
          if (d < clear) clear = d;
        }
        if (b.lastSpawn) clear = Math.min(clear, Math.hypot(b.lastSpawn.x - px, b.lastSpawn.y - py));
        if (clear >= 24) { b.lastSpawn = { x: px, y: py }; return { x, y }; }
        if (clear > bestClear) { bestClear = clear; best = { x, y }; }
      }
    }
  }
  if (best) b.lastSpawn = { x: best.x, y: best.y };
  return best;
}

// Пытается выпустить обученного юнита; false — выход заперт, ждём.
function trySpawnTrained(st, b, type) {
  const spot = findSpawnSpot(st, b) || nearestFreeTileAround(st.map, b.tx, b.ty, b.w, b.h);
  if (!spot) return false;
  spawnTrainedUnit(st, b, type, (spot.x + 0.5) * TILE, (spot.y + 0.5) * TILE);
  return true;
}

function spawnTrainedUnit(st, b, type, x, y) {
  const u = spawnUnit(st, b.side, type, x, y, true);
  // Точка сбора на кристалле: новый рабочий сразу встаёт на добычу;
  // на землю — идёт туда (формационные точки не нужны: спавн уже разнесён).
  if (b.rally) {
    const rc = b.rally.crystal;
    if (type === 'worker' && rc && !rc.dead && rc.amount > 0) orderGather(st, u, rc);
    else orderMove(st, u, b.rally.x, b.rally.y);
  }
  addEffect(st, { kind: 'spark', x, y, ang: -Math.PI / 2, t: 0, life: 0.25 });
  if (b.side === 'player') st.game.sound.ready();
}

// Здание под точкой мира (для кликов).
export function buildingAt(st, wx, wy) {
  for (let i = st.buildings.length - 1; i >= 0; i--) {
    const b = st.buildings[i];
    if (b.dead) continue;
    if (wx >= b.tx * TILE && wx < (b.tx + b.w) * TILE &&
        wy >= b.ty * TILE && wy < (b.ty + b.h) * TILE) return b;
  }
  return null;
}

// ------------------------------------------------------------
// Отрисовка здания. camX/camY — смещение камеры (мир → экран).
// Визуальный язык «Рубежа 64»: скруглённый тёмный корпус с окантовкой
// команды, светящееся ядро, анимированные детали, стройплощадка со
// штриховкой и прогресс-баром. ghost=true — «память» о вражеском здании.
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

export function drawBuilding(ctx, b, ghost = false, camX = 0, camY = 0) {
  const px = b.tx * TILE - camX, py = b.ty * TILE - camY;
  const w = b.w * TILE, h = b.h * TILE;
  const isP = b.side === 'player';
  const main = isP ? COLORS.player : COLORS.enemy;
  const dark = isP ? COLORS.playerDark : COLORS.enemyDark;
  const bright = isP ? COLORS.playerBright : COLORS.enemyBright;
  const bio = '#9ff5b8';
  const amber = '#f3c579';
  const alien = b.faction === 'alien';
  const cx = px + w / 2, cy = py + h / 2;

  ctx.save();
  if (ghost) ctx.globalAlpha = 0.42;
  else if (!b.done) ctx.globalAlpha = 0.45 + 0.3 * b.progress;

  // Мягкая тень + подиум корпуса.
  ctx.fillStyle = 'rgba(0,7,13,0.48)';
  rr(ctx, px + 5, py + 8, w - 7, h - 4, 10); ctx.fill();
  ctx.fillStyle = b.done ? dark : '#20302e';
  ctx.strokeStyle = b.done ? main : '#9da79a';
  ctx.lineWidth = 2;
  rr(ctx, px + 4, py + 3, w - 8, h - 8, 9); ctx.fill(); ctx.stroke();

  if (alien) {
    // ============ КХАРИД: органика улья на скруглённом подиуме ============
    if (b.type === 'cc') {
      // Гнездо-улей: курган с светящимся кольцом и жерлами.
      ctx.fillStyle = '#1d3b46';
      rr(ctx, cx - w * 0.34, cy - h * 0.3, w * 0.68, h * 0.6, 12); ctx.fill();
      ctx.shadowColor = main; ctx.shadowBlur = 13;
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#16333c';
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = bright; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.19, -0.35 + Math.sin(b.id + px) * 0.12, 2.4); ctx.stroke();
      ctx.fillStyle = bio;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * w * 0.34, cy + Math.sin(a) * h * 0.3, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (b.type === 'barracks') {
      // Инкубатор: выводковая камера с икрой.
      ctx.fillStyle = '#1d3b46';
      rr(ctx, cx - w * 0.32, cy - h * 0.28, w * 0.64, h * 0.56, 8); ctx.fill();
      ctx.strokeStyle = main; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const yy = cy - h * 0.16 + i * (h * 0.14);
        ctx.beginPath(); ctx.moveTo(cx - w * 0.24, yy); ctx.lineTo(cx + w * 0.24, yy); ctx.stroke();
      }
      ctx.fillStyle = '#0b1b24';
      rr(ctx, cx - w * 0.14, cy - h * 0.1, w * 0.28, h * 0.26, 4); ctx.fill();
      ctx.fillStyle = main;
      ctx.fillRect(cx - w * 0.04, cy - h * 0.05, w * 0.08, h * 0.16);
      ctx.fillStyle = bio;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(cx - w * 0.2 + i * w * 0.14, cy + h * 0.26, 3, 0, Math.PI * 2); ctx.fill();
      }
    } else if (b.type === 'turret') {
      // Жвала: органическая башня с клешнями по углу на цель.
      ctx.fillStyle = '#152e36';
      ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = bright; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(b.angle != null ? b.angle : -Math.PI / 4);
      ctx.strokeStyle = '#3a4a40'; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.moveTo(2, -3); ctx.lineTo(19, -8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, 3); ctx.lineTo(19, 8); ctx.stroke();
      ctx.shadowColor = main; ctx.shadowBlur = 8;
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(0, 0, 7.4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(3, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (b.type === 'wall') {
      // Хитиновая стена: пластины со светлым швом.
      ctx.fillStyle = '#152e36';
      rr(ctx, px + 2, py + 2, w - 4, h - 4, 4); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.4, h * 0.34, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = bio; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + 6, py + h - 6); ctx.lineTo(cx, py + 6); ctx.lineTo(px + w - 6, py + h - 6); ctx.stroke();
    } else if (b.type === 'bunker') {
      // Кокон: пульсирующие кольца со светлой жилой.
      ctx.fillStyle = '#132f39';
      rr(ctx, cx - w * 0.34, cy - h * 0.3, w * 0.68, h * 0.6, 10); ctx.fill();
      ctx.strokeStyle = main; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * (0.1 + i * 0.09), h * (0.07 + i * 0.08), 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowColor = bio; ctx.shadowBlur = 6;
      ctx.fillStyle = bio;
      ctx.fillRect(cx - 1, py + 6, 2, h - 12);
      ctx.shadowBlur = 0;
    } else if (b.type === 'lab') {
      // Узел эволюции: жерло с парящими светящимися гранями.
      ctx.fillStyle = '#241c34';
      rr(ctx, cx - w * 0.32, cy - h * 0.26, w * 0.64, h * 0.52, 10); ctx.fill();
      ctx.strokeStyle = bio; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, w * 0.18, h * 0.13, 0, 0, Math.PI * 2); ctx.stroke();
      const floats = [[-10, -6, 5], [4, -12, 6], [12, -3, 4.4]];
      ctx.shadowColor = bio; ctx.shadowBlur = 7;
      ctx.fillStyle = bio;
      for (const [fx, fy, fr] of floats) {
        ctx.beginPath();
        ctx.moveTo(cx + fx - fr, cy + fy);
        ctx.lineTo(cx + fx, cy + fy - fr * 1.6);
        ctx.lineTo(cx + fx + fr, cy + fy);
        ctx.closePath(); ctx.fill();
      }
      ctx.shadowBlur = 0;
    } else if (b.type === 'factory') {
      // Яма выводка: кратер с икрой и щупальцами по краю.
      ctx.fillStyle = '#241c34';
      rr(ctx, cx - w * 0.32, cy - h * 0.28, w * 0.64, h * 0.56, 12); ctx.fill();
      ctx.fillStyle = main;
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5 + 0.5;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * w * 0.26, cy + Math.sin(a) * h * 0.24, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = bio; ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.8;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * w * 0.4, cy + Math.sin(a) * h * 0.34);
        ctx.quadraticCurveTo(
          cx + Math.cos(a) * w * 0.52, cy + Math.sin(a) * h * 0.44,
          cx + Math.cos(a) * w * 0.46, cy + Math.sin(a) * h * 0.54);
        ctx.stroke();
      }
    } else {
      // Нарост-кладовая: пузатый мешок-хранилище.
      ctx.fillStyle = '#1d3b46';
      rr(ctx, cx - w * 0.32, cy - h * 0.26, w * 0.64, h * 0.52, 12); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(cx - 3, cy + 1, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = bio; ctx.shadowBlur = 6;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(cx + 6, cy - 2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  } else {
    // ============ ГЕЛИОС: стальные ховер-постройки ============
    if (b.type === 'cc') {
      // Командный центр: площадка, светящееся ядро, антенна.
      ctx.fillStyle = '#1d3b46';
      rr(ctx, cx - w * 0.34, cy - h * 0.3, w * 0.68, h * 0.6, 10); ctx.fill();
      ctx.shadowColor = main; ctx.shadowBlur = 13;
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#16333c';
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = bright; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.17, 0.3 + Math.sin(b.id + px) * 0.12, 3.1); ctx.stroke();
      ctx.fillStyle = amber;
      ctx.fillRect(px + w - 12, py + 4, 3, 12);
      ctx.beginPath(); ctx.arc(px + w - 10.5, py + 4, 3, 0, Math.PI * 2); ctx.fill();
    } else if (b.type === 'barracks') {
      // Казарма: ворота, полосы, маячок.
      ctx.fillStyle = '#1d3b46';
      rr(ctx, cx - w * 0.32, cy - h * 0.26, w * 0.64, h * 0.52, 6); ctx.fill();
      ctx.fillStyle = '#0b1b24';
      rr(ctx, cx - w * 0.12, cy - h * 0.02, w * 0.24, h * 0.3, 3); ctx.fill();
      ctx.fillStyle = main;
      ctx.fillRect(cx - w * 0.05, cy + h * 0.06, w * 0.1, h * 0.18);
      ctx.strokeStyle = main; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const yy = cy - h * 0.18 + i * (h * 0.15);
        ctx.beginPath(); ctx.moveTo(cx - w * 0.26, yy); ctx.lineTo(cx + w * 0.26, yy); ctx.stroke();
      }
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(px + w - 8, py + 6, 2.6, 0, Math.PI * 2); ctx.fill();
    } else if (b.type === 'turret') {
      // Турель «Скорпион»: вращающаяся спарка на круглом основании.
      ctx.fillStyle = '#152e36';
      ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = bright; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(b.angle != null ? b.angle : -Math.PI / 4);
      ctx.fillStyle = main;
      rr(ctx, -5, -20, 10, 30, 3); ctx.fill();
      ctx.fillStyle = '#e5f7e8';
      ctx.fillRect(-2.4, -23, 4.8, 7);
      ctx.restore();
      ctx.fillStyle = main;
      ctx.fillRect(px + 7, py + 7, 5, 5); ctx.fillRect(px + w - 12, py + 7, 5, 5);
      ctx.fillRect(px + 7, py + h - 12, 5, 5); ctx.fillRect(px + w - 12, py + h - 12, 5, 5);
    } else if (b.type === 'wall') {
      // Секция стены: кладка со светлым швом.
      ctx.fillStyle = '#152e36';
      rr(ctx, px + 2, py + 2, w - 4, h - 4, 3); ctx.fill();
      ctx.strokeStyle = bright; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + 3, cy); ctx.lineTo(px + w - 3, cy); ctx.stroke();
      ctx.fillStyle = main;
      ctx.fillRect(px + 5, py + 5, 5, 3); ctx.fillRect(px + w - 10, py + h - 8, 5, 3);
    } else if (b.type === 'bunker') {
      // Бункер: толстые стены, бойница, светящаяся кромка.
      ctx.fillStyle = '#132f39';
      rr(ctx, cx - w * 0.34, cy - h * 0.3, w * 0.68, h * 0.6, 7); ctx.fill();
      ctx.fillStyle = '#0b1b24';
      ctx.fillRect(cx - w * 0.2, cy - 3, w * 0.4, 6);
      ctx.fillStyle = main;
      ctx.fillRect(px + 5, py + 5, w - 10, 4);
      ctx.fillStyle = amber;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(cx - 12 + i * 12, py + h - 8, 4.4, 2.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (b.type === 'lab') {
      // Лаборатория: купол-обсерватория с тарелкой и маяком.
      ctx.fillStyle = '#1d3b46';
      rr(ctx, cx - w * 0.32, cy - h * 0.2, w * 0.64, h * 0.44, 6); ctx.fill();
      ctx.fillStyle = '#2c4a52';
      ctx.beginPath(); ctx.arc(cx - 6, cy - 2, 12, Math.PI, 0); ctx.fill();
      ctx.fillStyle = main;
      ctx.fillRect(px + 6, cy - h * 0.2, w - 12, 4);
      ctx.strokeStyle = bright; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px + w - 10, cy - 2); ctx.lineTo(px + w - 10, py + 4); ctx.stroke();
      ctx.beginPath(); ctx.arc(px + w - 10, py + 3, 5, Math.PI * 0.15, Math.PI * 0.95); ctx.stroke();
      ctx.shadowColor = amber; ctx.shadowBlur = 6;
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(px + 9, py + 10, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (b.type === 'factory') {
      // Завод: цех с воротами, труба, вращающаяся шестерня.
      ctx.fillStyle = '#1d3b46';
      rr(ctx, cx - w * 0.32, cy - h * 0.26, w * 0.64, h * 0.52, 6); ctx.fill();
      ctx.fillStyle = '#0b1b24';
      rr(ctx, cx - 16, cy + h * 0.06, 32, h * 0.2, 3); ctx.fill();
      ctx.fillStyle = main;
      ctx.fillRect(cx - 16, cy + h * 0.06, 32, 5);
      ctx.fillStyle = '#2c4a52';
      ctx.fillRect(px + 8, py - 4, 8, 12);
      ctx.save();
      ctx.translate(px + w - 15, cy + 4);
      ctx.rotate(b.id + px * 0.001);
      ctx.fillStyle = main;
      for (let i = 0; i < 6; i++) { ctx.rotate(Math.PI / 3); ctx.fillRect(-2.6, -12, 5.2, 6); }
      ctx.restore();
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(px + w - 15, cy + 4, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      // Дом (депо): низкий блок с шевронами и маячком.
      ctx.fillStyle = '#1d3b46';
      rr(ctx, cx - w * 0.34, cy - h * 0.26, w * 0.68, h * 0.52, 6); ctx.fill();
      ctx.fillStyle = main;
      ctx.fillRect(px + 5, cy - h * 0.26, w - 10, 4);
      ctx.fillStyle = '#0b1b24';
      for (let i = 0; i < 2; i++) {
        const bx = px + 9 + i * 17;
        ctx.beginPath();
        ctx.moveTo(bx, cy - 4);
        ctx.lineTo(bx + 8, cy + 2);
        ctx.lineTo(bx, cy + 8);
        ctx.lineTo(bx + 4, cy + 2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Стройплощадка: тёмная заливка, штриховка, прогресс-бар.
  if (!b.done) {
    ctx.fillStyle = 'rgba(8,18,23,0.48)';
    ctx.fillRect(px + 4, py + 4, w - 8, h - 8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px + 5, py + 5, w - 10, h - 10);
    ctx.clip();
    ctx.strokeStyle = main; ctx.lineWidth = 1;
    for (let i = 0; i < w + h; i += 13) {
      ctx.beginPath();
      ctx.moveTo(px + 5 + i, py + 5);
      ctx.lineTo(px + 5 + i - (h - 10), py + h - 5);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(4,15,19,0.88)';
    ctx.fillRect(px + 4, py + h - 12, w - 8, 6);
    ctx.fillStyle = isP ? '#8cedcc' : '#ffb078';
    ctx.fillRect(px + 5, py + h - 11, (w - 10) * Math.min(1, b.progress), 4);
  } else {
    if (b.selected) {
      ctx.strokeStyle = bright;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 4]);
      ctx.strokeRect(px - 3, py - 3, w + 6, h + 6);
      ctx.setLineDash([]);
    }
    if (b.hp < b.maxHp || b.selected) {
      const frac = Math.max(0, b.hp / b.maxHp);
      ctx.fillStyle = 'rgba(4,15,19,0.88)';
      ctx.fillRect(px + 2, py - 9, w - 4, 6);
      ctx.fillStyle = frac < 0.33 ? '#ff806e' : isP ? '#8cedcc' : '#ffb078';
      ctx.fillRect(px + 3, py - 8, (w - 6) * frac, 4);
    }
  }

  // Вспышка от полученного урона.
  if (b.flashT > 0) {
    ctx.fillStyle = `rgba(255,255,255,${b.flashT * 1.8})`;
    rr(ctx, px + 5, py + 4, w - 10, h - 10, 8); ctx.fill();
  }
  ctx.restore();
}
