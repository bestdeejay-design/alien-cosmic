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
// Маленький помощник: многоугольник из плоского массива [x0,y0,x1,y1...].
function poly(ctx, p) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.closePath();
}

// ------------------------------------------------------------
// Отрисовка здания. camX/camY — смещение камеры (мир → экран).
// Стиль-гайд v2 (тот же, что у юнитов): семейства «угловатые машины /
// круглая органика», тёмный контур силуэта, слои
// тень→подиум→корпус→панели→механизмы→ОДНО светящееся ядро
// (shadowBlur ≤ 9). Анимация рендерная (performance.now + b.id):
// радары, маяки, шестерни, дыхание мешков, покачивание щупалец.
// Живые детали по состоянию: ствол турели смотрит в b.angle,
// жвала схлопываются после выстрела (b.cd), в бойнице бункера —
// по стволу на каждого сидящего внутри, у повреждённых — трещины.
// ghost=true — «память» о вражеском здании.
// ------------------------------------------------------------
export function drawBuilding(ctx, b, ghost = false, camX = 0, camY = 0) {
  const px = b.tx * TILE - camX, py = b.ty * TILE - camY;
  const w = b.w * TILE, h = b.h * TILE;
  const isP = b.side === 'player';
  const main = isP ? COLORS.player : COLORS.enemy;
  const dark = isP ? COLORS.playerDark : COLORS.enemyDark;
  const bright = isP ? COLORS.playerBright : COLORS.enemyBright;
  const bio = '#9ff5b8';
  const amber = '#f3c579';
  const heat = '#ffb36b';
  const hull = '#101f27';       // тёмный металл Гелиоса
  const hull2 = '#23414c';      // светлая панель
  const flesh = '#221a33';      // тёмная плоть кхарид
  const flesh2 = '#322645';     // светлая плоть
  const maw = '#150d1c';        // пасть / нутро / жерло
  const bone = '#bcc7ae';       // хитин, зубы, рога
  const sand = '#7a6a4a';       // мешки бункера
  const outline = isP ? '#081418' : '#2a1113';
  const alien = b.faction === 'alien';
  const cx = px + w / 2, cy = py + h / 2;

  // Рендерное время (на симуляцию не влияет). b.id может отсутствовать
  // у призрака стройки — тогда анимация общая, без фазового сдвига.
  const bid = b.id || 0;
  const t = performance.now() * 0.001 + bid * 1.618;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);   // пульс ядер 0..1
  const blink = (ph) => 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(t * 5 + ph));
  const breathe = Math.sin(t * 2 + bid);         // дыхание органики −1..1
  const cdMax = (b.cfg && b.cfg.cooldown) || 1;
  const recoil = b.cd > 0 ? Math.min(1, b.cd / cdMax) : 0; // 1 — только выстрелил
  const gar = (b.garrison && b.garrison.length) || 0;      // сидящие внутри

  ctx.save();
  if (ghost) ctx.globalAlpha = 0.42;
  else if (!b.done) ctx.globalAlpha = 0.45 + 0.3 * b.progress;

  // Мягкая тень.
  ctx.fillStyle = 'rgba(0,7,13,0.48)';
  rr(ctx, px + 5, py + 8, w - 7, h - 4, 10); ctx.fill();

  if (alien) {
    // ---- Подиум улья: ложе крипа с био-прожилками ----
    ctx.fillStyle = '#1c1428';
    rr(ctx, px + 4, py + 3, w - 8, h - 8, 12); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = bio; ctx.lineWidth = 1;
    ctx.globalAlpha *= 0.5;
    ctx.beginPath(); ctx.moveTo(px + 8, py + h - 10); ctx.quadraticCurveTo(cx, cy + h * 0.3, px + w - 8, py + h - 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + 10, py + 10); ctx.quadraticCurveTo(cx - w * 0.2, cy, px + w * 0.3, py + h - 8); ctx.stroke();
    ctx.globalAlpha /= 0.5;

    if (b.type === 'cc') {
      // Гнездо-улей: сердце роя — курган с бьющимся ядром и жерлами.
      for (const [sx, sy, ex, ey] of [[-1, -1, -0.42, -0.4], [1, -1, 0.42, -0.4], [-1, 1, -0.42, 0.42], [1, 1, 0.42, 0.42]]) {
        ctx.strokeStyle = dark; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx + ex * w, cy + ey * h);
        ctx.quadraticCurveTo(cx + sx * w * 0.3, cy + sy * h * 0.3, cx + sx * (w / 2 - 8), cy + sy * (h / 2 - 8)); ctx.stroke();
      }
      ctx.fillStyle = flesh;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.4, h * 0.37, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.4, h * 0.37, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.3, h * 0.27, 0, 0, Math.PI * 2); ctx.fill();
      // Венец шипов.
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI * 0.85 + (i * Math.PI * 0.7) / 4;
        const sx = cx + Math.cos(a) * w * 0.38, sy = cy + 3 + Math.sin(a) * h * 0.35;
        ctx.fillStyle = flesh2;
        poly(ctx, [sx - 4, sy + 2, sx + Math.cos(a) * 12, sy + Math.sin(a) * 12 - 3, sx + 4, sy + 2]); ctx.fill();
        ctx.fillStyle = bio;
        ctx.beginPath(); ctx.arc(sx + Math.cos(a) * 12, sy + Math.sin(a) * 12 - 3, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      // Жерла-венты дышат.
      ctx.fillStyle = bio;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + 0.4;
        const ph = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * w * 0.34, cy + 3 + Math.sin(a) * h * 0.31, 2.4 + ph * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Пасть и бьющееся сердце.
      ctx.fillStyle = maw;
      ctx.beginPath(); ctx.arc(cx, cy + 3, Math.min(w, h) * 0.17, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = bright; ctx.shadowBlur = 9;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(cx, cy + 3, 4 + pulse * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = bright; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy + 3, Math.min(w, h) * 0.21, t * 1.3, t * 1.3 + Math.PI * 1.2); ctx.stroke();
    } else if (b.type === 'barracks') {
      // Инкубатор: выводковая камера — три икринки, одна вот-вот лопнет.
      ctx.fillStyle = flesh;
      rr(ctx, cx - w * 0.36, cy - h * 0.32, w * 0.72, h * 0.64, 14); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const yy = cy - h * 0.18 + i * h * 0.18;
        ctx.beginPath(); ctx.moveTo(cx - w * 0.3, yy); ctx.quadraticCurveTo(cx, yy + 5, cx + w * 0.3, yy); ctx.stroke();
      }
      // Питательный бассейн.
      ctx.fillStyle = maw;
      ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.26, w * 0.28, h * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(cx - 8, cy + h * 0.25, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 6, cy + h * 0.28, 1.3, 0, Math.PI * 2); ctx.fill();
      // Икринки: средняя светится, крайняя справа трескается и дрожит.
      const eggs = [-0.22, 0, 0.22];
      for (let i = 0; i < 3; i++) {
        const ex = cx + eggs[i] * w + (i === 2 ? Math.sin(t * 9) * 1.2 : 0);
        const ey = cy - h * 0.02, er = Math.min(w, h) * 0.16;
        ctx.fillStyle = i === 1 ? dark : flesh2;
        ctx.beginPath(); ctx.ellipse(ex, ey, er * 0.8, er, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = outline; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(ex, ey, er * 0.8, er, 0, 0, Math.PI * 2); ctx.stroke();
        if (i === 2) {
          ctx.strokeStyle = bright; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(ex - 3, ey - er * 0.7); ctx.lineTo(ex + 1, ey - 1); ctx.lineTo(ex - 2, ey + er * 0.5); ctx.stroke();
        }
      }
      ctx.shadowColor = bio; ctx.shadowBlur = 7;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(cx, cy - h * 0.02, 3 + pulse * 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (b.type === 'turret') {
      // Жвала: охотничья башня — клешни наводятся на цель и схлопываются.
      ctx.fillStyle = flesh;
      ctx.beginPath(); ctx.arc(cx, cy + 1, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(cx, cy + 1, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = bio;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + 0.78;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 11, cy + 1 + Math.sin(a) * 11, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(b.angle != null ? b.angle : -Math.PI / 4);
      // Раствор клешней: после выстрела — схлопнуты, к концу перезарядки — раскрыты.
      const open = 3 + (1 - recoil) * 5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = outline; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -open - 1, 17, -open - 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, open + 1, 17, open + 3); ctx.stroke();
      ctx.strokeStyle = flesh2; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -open - 1, 17, -open - 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, open + 1, 17, open + 3); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(-4, -5, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-4, 5, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = bio; ctx.shadowBlur = 7;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(2, 0, 2.2 + pulse * 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    } else if (b.type === 'wall') {
      // Хитиновая стена: чешуя внахлёст с живой жилой по центру.
      ctx.fillStyle = flesh;
      rr(ctx, px + 2, py + 2, w - 4, h - 4, 4); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = flesh2;
      ctx.beginPath(); ctx.ellipse(cx - 4, cy - 3, 9, 6, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 5, cy + 4, 8, 5.4, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(cx - 4, cy - 3, 9, 6, -0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 5, cy + 4, 8, 5.4, 0.3, 0, Math.PI * 2); ctx.stroke();
      // Жила светится, шипики по углам.
      ctx.shadowColor = bio; ctx.shadowBlur = 6;
      ctx.strokeStyle = bio; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(cx, py + 5); ctx.lineTo(cx, py + h - 5); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = bone;
      poly(ctx, [px + 4, py + 4, px + 8, py + 4, px + 5, py + 9]); ctx.fill();
      poly(ctx, [px + w - 4, py + h - 4, px + w - 8, py + h - 4, px + w - 5, py + h - 9]); ctx.fill();
    } else if (b.type === 'bunker') {
      // Кокон: дышащая камера — кольца пульсируют, жильцы светятся в щели.
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.strokeStyle = dark; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(cx + sx * w * 0.2, cy + sy * h * 0.2);
        ctx.quadraticCurveTo(cx + sx * w * 0.34, cy + sy * h * 0.3, cx + sx * (w / 2 - 6), cy + sy * (h / 2 - 6)); ctx.stroke();
      }
      ctx.fillStyle = flesh;
      ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.32, h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.32, h * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
      // Дыхание: кольца расходятся.
      ctx.strokeStyle = main; ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const k = 0.36 + i * 0.2 + pulse * 0.05;
        ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.32 * k * 2.2, h * 0.3 * k * 2.2, 0.4, 0, Math.PI * 2); ctx.stroke();
      }
      // Мембранная щель и жильцы внутри.
      ctx.fillStyle = maw;
      rr(ctx, cx - 3, cy - h * 0.2, 6, h * 0.4, 3); ctx.fill();
      ctx.fillStyle = bio;
      for (let i = 0; i < Math.min(4, gar); i++) {
        const yy = cy - h * 0.13 + i * h * 0.087;
        ctx.beginPath(); ctx.arc(cx, yy, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowColor = bio; ctx.shadowBlur = 7;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(cx, cy + h * 0.3 + breathe * 1.5, 2.2 + pulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (b.type === 'lab') {
      // Узел эволюции: шпиль с лучом и парящими осколками.
      ctx.strokeStyle = bio; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.3, w * 0.3, h * 0.1, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.3, w * 0.2, h * 0.065, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = flesh;
      ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.22, w * 0.26, h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.22, w * 0.26, h * 0.2, 0, 0, Math.PI * 2); ctx.stroke();
      // Шпиль с био-кольцами.
      ctx.fillStyle = flesh2;
      poly(ctx, [cx - 9, cy + h * 0.2, cx, cy - h * 0.34, cx + 9, cy + h * 0.2]); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = bio; ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const yy = cy + h * 0.1 - i * h * 0.11, ww = 7 - i * 2;
        ctx.beginPath(); ctx.moveTo(cx - ww, yy); ctx.lineTo(cx + ww, yy); ctx.stroke();
      }
      // Луч эволюции и парящие осколки.
      ctx.strokeStyle = bio; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy - h * 0.34); ctx.lineTo(cx, cy - h * 0.44); ctx.stroke();
      ctx.shadowColor = bio; ctx.shadowBlur = 8;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(cx, cy - h * 0.44, 2.6 + pulse * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      const shards = [[-0.24, -0.1, 0], [0.2, -0.2, 2.1], [0.05, 0.05, 4.2]];
      ctx.fillStyle = bio;
      for (const [fx, fy, ph] of shards) {
        const sx = cx + fx * w, sy = cy + fy * h + Math.sin(t * 1.5 + ph) * 3;
        poly(ctx, [sx - 4, sy, sx, sy - 6, sx + 4, sy, sx, sy + 6]); ctx.fill();
      }
      // Полипы у подножия.
      ctx.fillStyle = main;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(cx - 16 + i * 16, cy + h * 0.34, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    } else if (b.type === 'factory') {
      // Яма выводка: кратер с кладкой, щупальцами и светящейся топью.
      ctx.fillStyle = flesh;
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, w * 0.4, h * 0.38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, w * 0.4, h * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
      // Зубы венца.
      ctx.fillStyle = bone;
      for (let i = 0; i < 7; i++) {
        const a = (i * Math.PI * 2) / 7 + 0.3;
        const sx = cx + Math.cos(a) * w * 0.38, sy = cy + 2 + Math.sin(a) * h * 0.36;
        poly(ctx, [sx - 3, sy + 2, sx + Math.cos(a) * 7, sy + Math.sin(a) * 7, sx + 3, sy + 2]); ctx.fill();
      }
      // Топь.
      ctx.fillStyle = maw;
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, w * 0.26, h * 0.24, 0, 0, Math.PI * 2); ctx.fill();
      // Кладка по ободу топи.
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI * 2) / 6 + 0.5;
        const ph = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 1.3);
        ctx.fillStyle = i % 2 ? bio : bright;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * w * 0.27, cy + 2 + Math.sin(a) * h * 0.25, 2.4 + ph * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Щупальца покачиваются.
      ctx.strokeStyle = flesh2; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + 0.8 + Math.sin(t * 2 + i * 1.9) * 0.12;
        const sx = cx + Math.cos(a) * w * 0.34, sy = cy + 2 + Math.sin(a) * h * 0.32;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + Math.cos(a) * 10, sy + Math.sin(a) * 10 - 4, sx + Math.cos(a) * 8, sy + Math.sin(a) * 8 - 12); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.shadowColor = bio; ctx.shadowBlur = 8;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 5 + pulse * 2, 3.4 + pulse * 1.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      // Нарост-кладовая: живой склад — большой мешок с питательными зёрнами.
      ctx.strokeStyle = dark; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.2, cy + h * 0.2);
      ctx.quadraticCurveTo(cx - w * 0.3, cy + h * 0.34, cx - w * 0.42, cy + h * 0.36); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + w * 0.2, cy + h * 0.2);
      ctx.quadraticCurveTo(cx + w * 0.3, cy + h * 0.34, cx + w * 0.42, cy + h * 0.36); ctx.stroke();
      ctx.fillStyle = flesh2;
      ctx.beginPath(); ctx.ellipse(cx + w * 0.22, cy + h * 0.16, 7, 6, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(cx - w * 0.06, cy, w * 0.24 + breathe, h * 0.28 + breathe, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(cx - w * 0.06, cy, w * 0.24 + breathe, h * 0.28 + breathe, 0, 0, Math.PI * 2); ctx.stroke();
      // Складки мешка и зёрна внутри.
      ctx.strokeStyle = dark; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.2, cy - h * 0.1); ctx.quadraticCurveTo(cx - w * 0.06, cy - h * 0.02, cx + w * 0.08, cy - h * 0.1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - w * 0.2, cy + h * 0.1); ctx.quadraticCurveTo(cx - w * 0.06, cy + h * 0.18, cx + w * 0.08, cy + h * 0.1); ctx.stroke();
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(cx - w * 0.1, cy - h * 0.04, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - w * 0.02, cy + h * 0.06, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - w * 0.12, cy + h * 0.1, 1.3, 0, Math.PI * 2); ctx.fill();
      // Пупок мешка светится.
      ctx.shadowColor = bio; ctx.shadowBlur = 7;
      ctx.fillStyle = bio;
      ctx.beginPath(); ctx.arc(cx - w * 0.06, cy - h * 0.26, 2.4 + pulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  } else {
    // ---- Подиум Гелиоса: бронеплита, болты, бортовые огни ----
    ctx.fillStyle = hull;
    rr(ctx, px + 4, py + 3, w - 8, h - 8, 9); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = main; ctx.lineWidth = 1.2;
    rr(ctx, px + 7, py + 6, w - 14, h - 14, 7); ctx.stroke();
    ctx.fillStyle = hull2;
    for (const [X, Y] of [[px + 10, py + 9], [px + w - 10, py + 9], [px + 10, py + h - 9], [px + w - 10, py + h - 9]]) {
      ctx.beginPath(); ctx.arc(X, Y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.arc(px + 11, cy, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.globalAlpha *= blink(0);
    ctx.fillStyle = amber;
    ctx.beginPath(); ctx.arc(px + w - 11, cy, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (b.type === 'cc') {
      // Командный центр: штаб — купол с радаром, ядро командования, мачта.
      ctx.fillStyle = hull2;
      rr(ctx, cx - w * 0.36, cy - h * 0.3, w * 0.72, h * 0.6, 8); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.strokeStyle = main; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.32, cy - h * 0.18); ctx.lineTo(cx - w * 0.05, cy - h * 0.18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - w * 0.32, cy + h * 0.18); ctx.lineTo(cx - w * 0.05, cy + h * 0.18); ctx.stroke();
      // Купол с вращающимся радаром.
      ctx.fillStyle = hull;
      ctx.beginPath(); ctx.arc(cx - w * 0.2, cy, Math.min(w, h) * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = main; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx - w * 0.2, cy, Math.min(w, h) * 0.15, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.translate(cx - w * 0.2, cy); ctx.rotate(t * 1.4);
      ctx.fillStyle = bright;
      ctx.fillRect(-Math.min(w, h) * 0.13, -1.2, Math.min(w, h) * 0.26, 2.4);
      ctx.restore();
      // Ядро командования.
      ctx.strokeStyle = main; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx + w * 0.16, cy, Math.min(w, h) * 0.14, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowColor = main; ctx.shadowBlur = 8;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(cx + w * 0.16, cy, 3.4 + pulse * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Мачта с маяком и посадочные площадки.
      ctx.strokeStyle = hull2; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(cx + w * 0.02, cy - h * 0.3); ctx.lineTo(cx + w * 0.02, py + 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + w * 0.02 - 5, py + 11); ctx.lineTo(cx + w * 0.02 + 5, py + 11); ctx.stroke();
      ctx.save();
      ctx.globalAlpha *= blink(1);
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(cx + w * 0.02, py + 4, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      for (const sx of [-1, 1]) {
        ctx.fillStyle = hull;
        ctx.fillRect(cx + sx * w * 0.3 - 9, py + h - 22, 18, 11);
        ctx.strokeStyle = main; ctx.lineWidth = 1;
        ctx.strokeRect(cx + sx * w * 0.3 - 9, py + h - 22, 18, 11);
        ctx.fillStyle = main;
        ctx.fillRect(cx + sx * w * 0.3 - 2, py + h - 19, 4, 5);
      }
      // Ворота штаба.
      ctx.fillStyle = maw;
      rr(ctx, cx - 12, cy + h * 0.3 - 12, 24, 12, 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.fillRect(cx - 12, cy + h * 0.3 - 12, 24, 3);
    } else if (b.type === 'barracks') {
      // Казарма: ворота с шевроном, прожектор, маяк, пристрой с трубами.
      ctx.fillStyle = hull2;
      rr(ctx, cx - w * 0.36, cy - h * 0.32, w * 0.72, h * 0.64, 6); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.stroke();
      // Окна казармы.
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? main : hull;
        ctx.fillRect(cx - w * 0.3 + i * 13, cy - h * 0.32 + 5, 8, 5);
      }
      // Ворота с шевроном.
      ctx.fillStyle = maw;
      rr(ctx, cx - 14, cy - h * 0.05, 28, h * 0.37, 3); ctx.fill();
      ctx.strokeStyle = main; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 8, cy + h * 0.2); ctx.lineTo(cx, cy + h * 0.1); ctx.lineTo(cx + 8, cy + h * 0.2); ctx.stroke();
      ctx.fillStyle = amber;
      ctx.fillRect(cx - 17, cy - h * 0.05, 3, 6); ctx.fillRect(cx + 14, cy - h * 0.05, 3, 6);
      // Маяк на крыше.
      ctx.strokeStyle = hull; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx + w * 0.28, cy - h * 0.32); ctx.lineTo(cx + w * 0.28, cy - h * 0.32 - 10); ctx.stroke();
      ctx.save();
      ctx.globalAlpha *= blink(2);
      ctx.shadowColor = amber; ctx.shadowBlur = 7;
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(cx + w * 0.28, cy - h * 0.32 - 11, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
      // Прожектор слева и пристрой справа.
      ctx.strokeStyle = hull; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.36, cy + h * 0.1); ctx.lineTo(cx - w * 0.36 - 6, cy - h * 0.2); ctx.stroke();
      ctx.fillStyle = bright;
      ctx.fillRect(cx - w * 0.36 - 9, cy - h * 0.2 - 5, 6, 5);
      ctx.fillStyle = hull;
      ctx.fillRect(cx + w * 0.36 - 2, cy - 6, 10, 22);
      ctx.strokeStyle = main; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx + w * 0.36 + 1, cy - 6); ctx.lineTo(cx + w * 0.36 + 1, cy + 16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + w * 0.36 + 6, cy - 6); ctx.lineTo(cx + w * 0.36 + 6, cy + 16); ctx.stroke();
    } else if (b.type === 'turret') {
      // Турель «Скорпион»: основание на болтах, башня наводится на цель.
      ctx.fillStyle = hull2;
      ctx.beginPath(); ctx.arc(cx, cy + 1, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(cx, cy + 1, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = hull;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 10.5, cy + 1 + Math.sin(a) * 10.5, 1.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(b.angle != null ? b.angle : -Math.PI / 4);
      ctx.fillStyle = hull;
      rr(ctx, -6, -6, 13, 12, 3); ctx.fill();
      ctx.strokeStyle = main; ctx.lineWidth = 1.2;
      ctx.stroke();
      // Ствол с откатом и дульным тормозом.
      const bl = 15 - recoil * 3;
      ctx.fillStyle = '#0a1418';
      ctx.fillRect(5, -1.9, bl, 3.8);
      ctx.fillStyle = hull2;
      ctx.fillRect(5 + bl - 2.5, -2.8, 2.5, 5.6);
      if (recoil > 0.4) {
        ctx.fillStyle = heat;
        ctx.beginPath(); ctx.arc(5 + bl + 1.5, 0, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      // Барабан боепитания сбоку.
      ctx.fillStyle = hull2;
      ctx.beginPath(); ctx.arc(-3, 7.5, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(-3, 7.5, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(0, 0, 1.8 + pulse * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    } else if (b.type === 'wall') {
      // Секция стены: бронеплиты на болтах со светящимся швом.
      ctx.fillStyle = hull2;
      rr(ctx, px + 2, py + 2, w - 4, h - 4, 3); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = hull; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(px + 4, cy - 5); ctx.lineTo(px + w - 4, cy - 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px + 4, cy + 5); ctx.lineTo(px + w - 4, cy + 5); ctx.stroke();
      ctx.fillStyle = hull;
      for (const [X, Y] of [[px + 6, py + 6], [px + w - 6, py + 6], [px + 6, py + h - 6], [px + w - 6, py + h - 6]]) {
        ctx.beginPath(); ctx.arc(X, Y, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowColor = main; ctx.shadowBlur = 6;
      ctx.strokeStyle = main; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(cx, py + 4); ctx.lineTo(cx, py + h - 4); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = amber;
      poly(ctx, [px + 3, py + h - 8, px + 7, py + h - 8, px + 3, py + h - 4]); ctx.fill();
      poly(ctx, [px + w - 3, py + 8, px + w - 7, py + 8, px + w - 3, py + 4]); ctx.fill();
    } else if (b.type === 'bunker') {
      // Бункер: дот — толстые стены, бойница, по стволу на жильца.
      ctx.fillStyle = hull;
      rr(ctx, cx - w * 0.36, cy - h * 0.32, w * 0.72, h * 0.64, 6); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.stroke();
      // Крыша: люк и мешки.
      ctx.fillStyle = hull2;
      rr(ctx, cx - w * 0.3, cy - h * 0.32, w * 0.6, h * 0.2, 4); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = sand;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.ellipse(cx - w * 0.2 + i * w * 0.13, cy - h * 0.22, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = hull;
      ctx.beginPath(); ctx.arc(cx + w * 0.24, cy - h * 0.22, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = main; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx + w * 0.24, cy - h * 0.22, 3.4, 0, Math.PI * 2); ctx.stroke();
      // Бойница и стволы жильцов.
      ctx.fillStyle = maw;
      ctx.fillRect(cx - w * 0.3, cy + h * 0.08, w * 0.6, 7);
      ctx.fillStyle = '#0a1418';
      for (let i = 0; i < Math.min(4, gar); i++) {
        const bx = cx - w * 0.21 + i * w * 0.14;
        ctx.fillRect(bx - 1.5, cy + h * 0.08 + 4, 3, 9);
      }
      ctx.fillStyle = main;
      ctx.fillRect(cx - w * 0.3, cy + h * 0.08, w * 0.6, 2);
      // Дежурный огонёк.
      ctx.save();
      ctx.globalAlpha *= blink(3);
      ctx.shadowColor = amber; ctx.shadowBlur = 6;
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(cx - w * 0.28, cy - h * 0.05, 2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    } else if (b.type === 'lab') {
      // Лаборатория: купол обсерватории, тарелка, светящийся атом.
      ctx.fillStyle = hull2;
      rr(ctx, cx - w * 0.36, cy - h * 0.14, w * 0.72, h * 0.44, 6); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.stroke();
      // Полоса окон мерцает рабочим светом.
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.globalAlpha *= 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3 + i * 2.2));
        ctx.fillStyle = main;
        ctx.fillRect(cx - w * 0.3 + i * 12, cy + h * 0.02, 8, 6);
        ctx.restore();
      }
      // Купол с щелью.
      ctx.fillStyle = hull;
      ctx.beginPath(); ctx.arc(cx - w * 0.2, cy - h * 0.14, Math.min(w, h) * 0.17, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx - w * 0.2, cy - h * 0.14, Math.min(w, h) * 0.17, Math.PI, 0); ctx.stroke();
      ctx.strokeStyle = bright; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.2, cy - h * 0.14 - Math.min(w, h) * 0.17); ctx.lineTo(cx - w * 0.2, cy - h * 0.14 - 3); ctx.stroke();
      // Тарелка покачивается, следя за небом.
      ctx.save();
      ctx.translate(cx + w * 0.24, cy - h * 0.1);
      ctx.rotate(-0.5 + Math.sin(t * 0.7) * 0.15);
      ctx.strokeStyle = bright; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 9, Math.PI * 0.15, Math.PI * 0.95); ctx.stroke();
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(0, -2, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = hull; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(cx + w * 0.24, cy - h * 0.1 + 6); ctx.lineTo(cx + w * 0.24, cy - h * 0.02); ctx.stroke();
      // Атом — эмблема науки.
      ctx.strokeStyle = main; ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.ellipse(cx + w * 0.02, cy + h * 0.16, 11, 4, (i * Math.PI) / 3, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.shadowColor = bright; ctx.shadowBlur = 7;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(cx + w * 0.02, cy + h * 0.16, 2.2 + pulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Мачта с маяком.
      ctx.strokeStyle = hull; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.36 + 6, cy - h * 0.14); ctx.lineTo(cx - w * 0.36 + 6, cy - h * 0.14 - 14); ctx.stroke();
      ctx.save();
      ctx.globalAlpha *= blink(1);
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(cx - w * 0.36 + 6, cy - h * 0.14 - 15, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (b.type === 'factory') {
      // Завод техники: цех с воротами, труба, шестерни, силос.
      ctx.fillStyle = hull2;
      rr(ctx, cx - w * 0.38, cy - h * 0.3, w * 0.56, h * 0.62, 6); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.stroke();
      // Рёбра крыши цеха.
      ctx.strokeStyle = hull; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const xx = cx - w * 0.3 + i * w * 0.14;
        ctx.beginPath(); ctx.moveTo(xx, cy - h * 0.3); ctx.lineTo(xx, cy - h * 0.3 + 10); ctx.stroke();
      }
      // Ворота цеха с полосой и шевронами.
      ctx.fillStyle = maw;
      rr(ctx, cx - w * 0.28, cy + h * 0.06, w * 0.36, h * 0.26, 3); ctx.fill();
      ctx.fillStyle = main;
      ctx.fillRect(cx - w * 0.28, cy + h * 0.06, w * 0.36, 5);
      ctx.fillStyle = amber;
      for (let i = 0; i < 3; i++) {
        poly(ctx, [cx - w * 0.24 + i * 12, cy + h * 0.28, cx - w * 0.24 + i * 12 + 6, cy + h * 0.28, cx - w * 0.24 + i * 12 + 3, cy + h * 0.28 - 5]); ctx.fill();
      }
      // Шестерни крутятся вразнобой.
      const gear = (gx, gy, gr, dir, ph) => {
        ctx.save();
        ctx.translate(gx, gy); ctx.rotate(dir * t * 0.9 + ph);
        ctx.fillStyle = hull;
        for (let i = 0; i < 6; i++) { ctx.rotate(Math.PI / 3); ctx.fillRect(-gr * 0.22, -gr * 1.05, gr * 0.44, gr * 0.5); }
        ctx.restore();
        ctx.fillStyle = hull;
        ctx.beginPath(); ctx.arc(gx, gy, gr * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = main; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(gx, gy, gr * 0.62, 0, Math.PI * 2); ctx.stroke();
      };
      gear(cx - w * 0.24, cy - h * 0.12, 11, 1, 0);
      gear(cx - w * 0.24 + 19, cy - h * 0.12 + 13, 7, -1, 1);
      ctx.shadowColor = bright; ctx.shadowBlur = 6;
      ctx.fillStyle = bright;
      ctx.beginPath(); ctx.arc(cx - w * 0.24, cy - h * 0.12, 2.4 + pulse * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Труба с маяком и силос с трубоводами.
      ctx.fillStyle = hull;
      ctx.fillRect(cx + w * 0.2, cy - h * 0.38, 12, h * 0.7);
      ctx.fillStyle = hull2;
      ctx.fillRect(cx + w * 0.2 - 2, cy - h * 0.38, 16, 5);
      ctx.save();
      ctx.globalAlpha *= blink(2);
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(cx + w * 0.2 + 6, cy - h * 0.38 - 3, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = hull2;
      rr(ctx, cx + w * 0.2 + 18, cy - h * 0.05, 14, h * 0.37, 6); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.strokeStyle = main; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx + w * 0.2 + 12, cy + h * 0.1); ctx.lineTo(cx + w * 0.2 + 18, cy + h * 0.1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + w * 0.2 + 12, cy + h * 0.2); ctx.lineTo(cx + w * 0.2 + 18, cy + h * 0.2); ctx.stroke();
    } else {
      // Дом: жилой блок — тёплые окна, подъезд, шевроны, маячок.
      ctx.fillStyle = hull2;
      rr(ctx, cx - w * 0.34, cy - h * 0.3, w * 0.68, h * 0.6, 6); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.stroke();
      // Крыша: надстройка и антеннка.
      ctx.fillStyle = hull;
      ctx.fillRect(cx - w * 0.2, cy - h * 0.3 - 7, 16, 8);
      ctx.strokeStyle = hull; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx + w * 0.2, cy - h * 0.3); ctx.lineTo(cx + w * 0.2, cy - h * 0.3 - 9); ctx.stroke();
      ctx.save();
      ctx.globalAlpha *= blink(0);
      ctx.fillStyle = amber;
      ctx.beginPath(); ctx.arc(cx + w * 0.2, cy - h * 0.3 - 10, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Тёплые окна 2×3, одно моргает.
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          const flicker = r === 1 && c === 2;
          ctx.save();
          if (flicker) ctx.globalAlpha *= blink(4);
          ctx.fillStyle = amber;
          ctx.fillRect(cx - w * 0.26 + c * 12, cy - h * 0.2 + r * 11, 8, 6);
          ctx.restore();
          ctx.strokeStyle = hull; ctx.lineWidth = 1;
          ctx.strokeRect(cx - w * 0.26 + c * 12, cy - h * 0.2 + r * 11, 8, 6);
        }
      }
      // Подъезд с козырьком и шевроны.
      ctx.fillStyle = hull;
      ctx.fillRect(cx + w * 0.05, cy - h * 0.3, 14, 4);
      ctx.fillStyle = maw;
      ctx.fillRect(cx + w * 0.05 + 2, cy - h * 0.18, 10, h * 0.42);
      ctx.fillStyle = main;
      ctx.fillRect(cx + w * 0.05 + 2, cy - h * 0.18, 10, 3);
      ctx.shadowColor = main; ctx.shadowBlur = 6;
      ctx.fillStyle = main;
      ctx.fillRect(cx - w * 0.34, cy - h * 0.3, w * 0.68, 3);
      ctx.shadowBlur = 0;
      ctx.fillStyle = amber;
      poly(ctx, [cx - w * 0.3, cy + h * 0.22, cx - w * 0.3 + 7, cy + h * 0.22, cx - w * 0.3 + 3.5, cy + h * 0.22 - 5]); ctx.fill();
      poly(ctx, [cx - w * 0.3 + 10, cy + h * 0.22, cx - w * 0.3 + 17, cy + h * 0.22, cx - w * 0.3 + 13.5, cy + h * 0.22 - 5]); ctx.fill();
    }
  }

  // Трещины повреждённого здания: deterministic по b.id.
  if (b.done && !ghost && b.hp < b.maxHp * 0.5) {
    const j = (bid % 3) * 5;
    ctx.strokeStyle = 'rgba(8,4,7,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + w * 0.2 + j, py + h * 0.25);
    ctx.lineTo(px + w * 0.4, py + h * 0.5);
    ctx.lineTo(px + w * 0.32 + j, py + h * 0.72);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + w * 0.75, py + h * 0.3);
    ctx.lineTo(px + w * 0.6, py + h * 0.55);
    ctx.lineTo(px + w * 0.68 - j, py + h * 0.8);
    ctx.stroke();
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

