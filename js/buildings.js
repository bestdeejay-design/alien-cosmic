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
        kind: 'smoke', faction: b.faction,
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
            addEffect(st, { kind: 'muzzle', x: b.x + Math.cos(b.angle) * 16, y: b.y + Math.sin(b.angle) * 16, ang: b.angle, t: 0, life: 0.06, faction: b.faction });
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
// ------------------------------------------------------------// ============================================================
// Здания v3: 2.5D-архитектура вместо плоских «чипов».
// Свет сверху-слева: тень падает вправо-вниз, у корпуса виден
// лицевой фасад (низ) и крыша. Крыша приподнята над фундаментом,
// корпус занимает ~90% футпринта — здание читается объёмом.
// rule: не более одного shadowBlur на здание (только ключевой свет).
// ============================================================

// Мягкая падающая тень корпуса (обычный alpha-прямоугольник — дёшево).
function bshadow(ctx, x, y, w, h, dx = 7, dy = 10, a = 0.3) {
  ctx.fillStyle = 'rgba(0,0,0,' + a + ')';
  rr(ctx, x + dx, y + dy, w, h, 6); ctx.fill();
}

// Экструзия человеческого корпуса: фундамент → фасад → крыша.
// Возвращает { rx, ry, rw, rh } — прямоугольник крыши под детали,
// и { fx, fy, fw, fh } — фасад.
function hull(ctx, x, y, w, h, lift, cFound, cFace, cFaceDark, cRoof) {
  ctx.fillStyle = cFound;
  rr(ctx, x, y, w, h, 4); ctx.fill();
  // Фасад: лицевая стена + тёмный низ + шов под крышей.
  const fx = x + 2, fy = y + h - lift, fw = w - 4, fh = lift - 1;
  ctx.fillStyle = cFace;
  ctx.fillRect(fx, fy, fw, fh);
  ctx.fillStyle = cFaceDark;
  ctx.fillRect(fx, fy + fh - 3, fw, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(fx, fy, fw, 1);
  // Крыша: светлая плита, тёмный правый край (свет слева).
  const rx = x + 2, ry = y + 2 - lift, rw = w - 4, rh = h - 2;
  ctx.fillStyle = cRoof;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(rx + rw - 5, ry, 5, rh);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(rx, ry, rw, 2);
  ctx.strokeStyle = cFound; ctx.lineWidth = 1.5;
  ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
  return { rx, ry, rw, rh, fx, fy, fw, fh };
}

// Сетка швов на крыше.
function roofPanels(ctx, rx, ry, rw, rh, nx, ny, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < nx; i++) {
    ctx.moveTo(rx + (rw * i) / nx, ry + 3); ctx.lineTo(rx + (rw * i) / nx, ry + rh - 3);
  }
  for (let i = 1; i < ny; i++) {
    ctx.moveTo(rx + 3, ry + (rh * i) / ny); ctx.lineTo(rx + rw - 3, ry + (rh * i) / ny);
  }
  ctx.stroke();
}

// Ряд окон; lit[i] — горит ли i-е (детерминировано).
function winRow(ctx, x, y, n, w, h, gap, cOn, cOff, seed = 0) {
  for (let i = 0; i < n; i++) {
    const on = ((i * 7 + seed * 3 + 1) % 4) !== 0;
    ctx.fillStyle = on ? cOn : cOff;
    ctx.fillRect(x + i * (w + gap), y, w, h);
    if (on) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x + i * (w + gap), y, w, 1);
    }
  }
}

// Аварийная «зебра» на прямоугольнике.
function hazard(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#2b2e33'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#e8913a'; ctx.lineWidth = 4;
  ctx.beginPath();
  for (let d = -h; d < w + h; d += 11) {
    ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

// Стеклянный купол: градиент + блик.
function dome(ctx, x, y, r, cEdge, cMid, cHi) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, cHi); g.addColorStop(0.55, cMid); g.addColorStop(1, cEdge);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(20,22,26,0.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.32, y - r * 0.42, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
}

// Мачта с мигающим огнём. Возвращает координату огня.
function mast(ctx, x, yBase, hgt, on, cOn = '#ff5f57') {
  ctx.strokeStyle = '#3a3f46'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, yBase); ctx.lineTo(x, yBase - hgt); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 4, yBase - hgt + 4); ctx.lineTo(x + 4, yBase - hgt + 4); ctx.stroke();
  ctx.fillStyle = on ? cOn : '#5a2020';
  ctx.beginPath(); ctx.arc(x, yBase - hgt - 1, 2.4, 0, Math.PI * 2); ctx.fill();
  if (on) {
    ctx.fillStyle = 'rgba(255,95,87,0.25)';
    ctx.beginPath(); ctx.arc(x, yBase - hgt - 1, 5, 0, Math.PI * 2); ctx.fill();
  }
}

// Дым из трубы: 3 поднимающихся кольца, фаза от t.
function smoke(ctx, x, y, t, seed = 0) {
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.32 + seed + i / 3) % 1;
    const sx = x + Math.sin(ph * 6 + seed * 5) * 4 + ph * 6;
    const sy = y - ph * 26;
    ctx.fillStyle = 'rgba(205,210,216,' + (0.32 * (1 - ph)).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(sx, sy, 2.5 + ph * 6, 0, Math.PI * 2); ctx.fill();
  }
}

// --- Плоть кхарид: курган с радиальным градиентом и нижней тенью ---
function mound(ctx, cx, cy, rx, ry, cDark, cMid, cLight) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx + 5, cy + ry * 0.72 + 5, rx * 0.95, ry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.4, rx * 0.12, cx, cy, rx * 1.08);
  g.addColorStop(0, cLight); g.addColorStop(0.55, cMid); g.addColorStop(1, cDark);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,235,240,0.16)';
  ctx.beginPath(); ctx.ellipse(cx - rx * 0.3, cy - ry * 0.42, rx * 0.42, ry * 0.24, -0.25, 0, Math.PI * 2); ctx.fill();
  // Складки плоти и поры — курган не должен быть гладким шаром.
  ctx.strokeStyle = 'rgba(28,10,16,0.4)'; ctx.lineWidth = 2;
  for (let f = 0; f < 3; f++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy - ry * 0.15 + f * ry * 0.24, rx * (0.72 - f * 0.1), ry * 0.52, 0, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(25,8,14,0.45)';
  for (let f = 0; f < 6; f++) {
    const a = f * 1.9 + rx * 0.1;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * 0.58, cy + Math.sin(a) * ry * 0.5, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = cDark; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
}

// Глаз кхарид: белок, щель-зрачок, влажный блик.
function aeye(ctx, x, y, r, glow = '#a8ff9e') {
  ctx.fillStyle = '#e8f5d8';
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.55, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#101408';
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.16, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.25, Math.max(0.8, r * 0.14), 0, Math.PI * 2); ctx.fill();
}

// Шип/рог: треугольник с осветлённой левой кромкой.
function spike(ctx, x, y, wdt, hgt, cBase, cEdge) {
  ctx.fillStyle = cBase;
  poly(ctx, [x - wdt / 2, y, x + wdt / 2, y, x, y - hgt]);
  ctx.strokeStyle = cEdge; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x - wdt / 2, y); ctx.lineTo(x, y - hgt); ctx.stroke();
}

// Зубы кольцом по дуге (пасть): n клыков радиусом ringR вокруг (x,y),
// раскрытых в сторону ang ± spread.
function teethRing(ctx, x, y, ringR, toothL, ang, spread, n, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = ang - spread + (2 * spread * i) / Math.max(1, n - 1);
    const bx = x + Math.cos(a) * ringR, by = y + Math.sin(a) * ringR;
    const tx = x + Math.cos(a) * (ringR + toothL), ty = y + Math.sin(a) * (ringR + toothL);
    const px = -Math.sin(a) * toothL * 0.32, py = Math.cos(a) * toothL * 0.32;
    poly(ctx, [bx - px, by - py, bx + px, by + py, tx, ty]);
  }
}

export function drawBuilding(ctx, b, ghost = false, camX = 0, camY = 0) {
  const TILE_W = TILE;
  const px = b.tx * TILE_W - camX, py = b.ty * TILE_W - camY;
  const w = b.w * TILE_W, h = b.h * TILE_W;
  const cx = px + w / 2, cy = py + h / 2;
  const bid = b.id || 0;
  const t = performance.now() * 0.001 + bid * 1.7;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
  const breathe = 1 + 0.035 * Math.sin(t * 1.8 + bid);
  const blink = (Math.sin(t * 3.4 + bid * 2.1) > 0.55);
  const faction = b.faction || (b.side === 'enemy' ? 'alien' : 'human');
  const ang = (b.angle == null ? -Math.PI / 4 : b.angle);
  const cdMax = (b.cfg && b.cfg.cooldown) || 1;
  const recoil = b.cd ? Math.max(0, b.cd) / cdMax : 0;
  const gar = b.garrison ? b.garrison.length : 0;

  ctx.save();
  // Призрак/стройка/«запомненное»: та же логика прозрачности, что раньше.
  if (ghost || b.done === false) {
    ctx.globalAlpha = (b.done === false ? 0.35 + 0.65 * (b.progress || 0) : 1) * 0.55;
  }

  if (faction === 'human') {
    // ================= ЛЮДИ: броня, стекло, зебра =================
    const FOUND = '#23262c', FACE = '#596069', FACED = '#3b4047', ROOF = '#a7aeb6';
    if (b.type === 'cc') {
      // Командный центр 4×3: главный корпус + купол с радаром + башенки.
      bshadow(ctx, px, py, w, h);
      const R = hull(ctx, px + 3, py + 6, w - 6, h - 6, 13, FOUND, FACE, FACED, ROOF);
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 5, 3, '#7c848d');
      // Центральный купол командования + вращающийся радар.
      dome(ctx, cx, R.ry + R.rh * 0.42, 13, '#1d3a44', '#2e7d8c', '#9be8f5');
      ctx.save();
      ctx.translate(cx, R.ry + R.rh * 0.42); ctx.rotate(t * 1.4);
      ctx.fillStyle = '#d9fbff';
      ctx.fillRect(0, -1.2, 12, 2.4);
      ctx.restore();
      ctx.fillStyle = '#e8f6ff';
      ctx.beginPath(); ctx.arc(cx, R.ry + R.rh * 0.42, 2, 0, Math.PI * 2); ctx.fill();
      // Угловые башенки с красными огнями.
      for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const bx = R.rx + 6 + tx * (R.rw - 18), by = R.ry + 6 + ty * (R.rh - 14);
        ctx.fillStyle = '#7d858e'; ctx.fillRect(bx, by - 4, 12, 12);
        ctx.fillStyle = '#565c64'; ctx.fillRect(bx, by + 6, 12, 2);
        ctx.fillStyle = '#c3c9d1'; ctx.fillRect(bx, by - 4, 12, 3);
        ctx.fillStyle = blink ? '#ff5f57' : '#5a2020';
        ctx.beginPath(); ctx.arc(bx + 6, by - 6, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      // Ворота с пандусом-зеброй и окна фасада.
      hazard(ctx, cx - 13, R.fy + R.fh - 7, 26, 7);
      ctx.fillStyle = '#14171b'; ctx.fillRect(cx - 9, R.fy + 1, 18, R.fh - 7);
      winRow(ctx, R.fx + 6, R.fy + 2, 3, 7, 4, 4, '#7df3e2', '#23383c', bid);
      winRow(ctx, R.fx + R.fw - 6 - 3 * 11, R.fy + 2, 3, 7, 4, 4, '#7df3e2', '#23383c', bid + 2);
      // Мачта стоит на крыше у левого края.
      mast(ctx, R.rx + 5, R.ry + 14, 14, blink);
    } else if (b.type === 'depot') {
      // Дом 2×2: жилой блок, тёплые окна, дым из трубы, ящики.
      bshadow(ctx, px, py, w, h, 6, 8);
      const R = hull(ctx, px + 4, py + 5, w - 8, h - 5, 11, FOUND, '#8d8272', '#5c554a', '#b9ac93');
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 2, 2, '#8a7f68');
      // Труба с дымом.
      ctx.fillStyle = '#6e6759'; ctx.fillRect(R.rx + 6, R.ry - 8, 8, 14);
      ctx.fillStyle = '#4a443a'; ctx.fillRect(R.rx + 6, R.ry - 8, 8, 3);
      smoke(ctx, R.rx + 10, R.ry - 8, t, (bid % 5) * 0.2);
      // Световой люк на крыше.
      ctx.fillStyle = '#ffd489'; ctx.fillRect(R.rx + R.rw - 20, R.ry + 8, 12, 8);
      ctx.strokeStyle = '#5c554a'; ctx.lineWidth = 1.5; ctx.strokeRect(R.rx + R.rw - 20, R.ry + 8, 12, 8);
      // Тёплые окна и дверь на фасаде.
      winRow(ctx, R.fx + 5, R.fy + 2, 2, 8, 5, 5, '#ffd489', '#3a332a', bid);
      ctx.fillStyle = '#3f3a33'; ctx.fillRect(R.fx + R.fw - 13, R.fy + 1, 9, R.fh - 3);
      ctx.fillStyle = '#ffd489'; ctx.fillRect(R.fx + R.fw - 11, R.fy + 3, 2, 2);
      // Ящики у стены.
      ctx.fillStyle = '#7a6a4f'; ctx.fillRect(px + w - 16, py + h - 12, 9, 9);
      ctx.fillStyle = '#8d7c5c'; ctx.fillRect(px + w - 16, py + h - 12, 9, 2);
      ctx.strokeStyle = '#4a3f30'; ctx.lineWidth = 1; ctx.strokeRect(px + w - 16, py + h - 12, 9, 9);
    } else if (b.type === 'barracks') {
      // Казарма 3×2: длинный корпус, ворота с шевроном, флаг, прожектор.
      bshadow(ctx, px, py, w, h);
      const R = hull(ctx, px + 3, py + 6, w - 6, h - 6, 11, FOUND, FACE, FACED, ROOF);
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 4, 2, '#7c848d');
      // Вентблоки на крыше.
      for (let i = 0; i < 2; i++) {
        const vx = R.rx + 12 + i * 34;
        ctx.fillStyle = '#7d858e'; ctx.fillRect(vx, R.ry + 6, 16, 10);
        ctx.fillStyle = '#c3c9d1'; ctx.fillRect(vx, R.ry + 6, 16, 3);
        ctx.fillStyle = '#3b4047';
        for (let s = 0; s < 3; s++) ctx.fillRect(vx + 2 + s * 5, R.ry + 11, 3, 3);
      }
      // Флаг на мачте: полотнище трепещет.
      const flagX = R.rx + R.rw - 10, flagBase = R.ry + 10;
      ctx.strokeStyle = '#3a3f46'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(flagX, flagBase); ctx.lineTo(flagX, flagBase - 24); ctx.stroke();
      ctx.fillStyle = '#2e7d8c';
      const wv = Math.sin(t * 6) * 2;
      poly(ctx, [flagX, flagBase - 24, flagX + 16, flagBase - 22 + wv, flagX, flagBase - 16]);
      // Ворота с шевроном + окна.
      ctx.fillStyle = '#14171b'; ctx.fillRect(cx - 11, R.fy, 22, R.fh - 1);
      hazard(ctx, cx - 13, R.fy + R.fh - 5, 26, 5);
      ctx.strokeStyle = '#e8913a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 6, R.fy + 4); ctx.lineTo(cx, R.fy + 1); ctx.lineTo(cx + 6, R.fy + 4); ctx.stroke();
      winRow(ctx, R.fx + 5, R.fy + 2, 2, 7, 4, 4, '#7df3e2', '#23383c', bid);
      winRow(ctx, R.fx + R.fw - 5 - 2 * 11, R.fy + 2, 2, 7, 4, 4, '#7df3e2', '#23383c', bid + 1);
      // Прожекторная мачта у угла.
      ctx.strokeStyle = '#3a3f46'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(R.rx + 4, R.fy + R.fh); ctx.lineTo(R.rx + 4, R.fy - 14); ctx.stroke();
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath(); ctx.arc(R.rx + 4, R.fy - 15, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,243,196,0.18)';
      poly(ctx, [R.rx + 4, R.fy - 15, R.rx - 12, R.fy + 12, R.rx + 18, R.fy + 12]);
    } else if (b.type === 'turret') {
      // «Скорпион» 1×1: бетонный шестигранник + спаренная пушка.
      const bx = cx, by = cy + 3;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(bx + 3, by + 9, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      // Основание-шестигранник.
      ctx.fillStyle = '#7d858e';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        const vx = bx + Math.cos(a) * 13, vy = by + Math.sin(a) * 13;
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2b2e33'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#a7aeb6';
      ctx.beginPath(); ctx.arc(bx, by, 8.5, 0, Math.PI * 2); ctx.fill();
      // Башня со спаренными стволами — clearly пушка.
      ctx.save();
      ctx.translate(bx, by); ctx.rotate(ang);
      const rec = recoil * 3;
      ctx.fillStyle = '#3b4047';
      ctx.fillRect(-4 - rec, -6.5, 21, 4);
      ctx.fillRect(-4 - rec, 2.5, 21, 4);
      ctx.fillStyle = '#22252a';
      ctx.fillRect(14 - rec, -7.5, 4, 6);
      ctx.fillRect(14 - rec, 1.5, 4, 6);
      ctx.fillStyle = '#565c64';
      ctx.fillRect(-4 - rec, -6.5, 21, 1.2);
      ctx.fillRect(-4 - rec, 2.5, 21, 1.2);
      // Вспышка выстрела.
      if (recoil > 0.75) {
        ctx.fillStyle = 'rgba(255,220,140,' + (0.9 * recoil).toFixed(2) + ')';
        poly(ctx, [19 - rec, 0, 26 - rec, -4, 26 - rec, 4]);
      }
      ctx.fillStyle = '#596069';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#22252a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // Барабан и прицел.
      ctx.fillStyle = '#2e7d8c';
      ctx.beginPath(); ctx.arc(bx - Math.cos(ang) * 7, by - Math.sin(ang) * 7, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = blink ? '#ff5f57' : '#7a2a24';
      ctx.beginPath(); ctx.arc(bx, by, 1.8, 0, Math.PI * 2); ctx.fill();
    } else if (b.type === 'wall') {
      // Стена 1×1 во весь тайл: броневой сегмент стыкуется с соседями.
      ctx.fillStyle = '#4a4f57';
      ctx.fillRect(px, py + 4, w, h - 4);
      ctx.fillStyle = '#8f979f';
      ctx.fillRect(px, py + 4, w, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(px, py + 4, w, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(px, py + h - 4, w, 4);
      // Заклёпки двумя рядами и шеврон по центру.
      ctx.fillStyle = '#2b2e33';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.arc(px + 5 + i * 8, py + 9, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 5 + i * 8, py + 21, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = '#e8913a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 5, py + 24); ctx.lineTo(cx, py + 19); ctx.lineTo(cx + 5, py + 24); ctx.stroke();
      // Угловые столбы — швы между секциями.
      ctx.fillStyle = '#33373d';
      ctx.fillRect(px, py + 4, 3, h - 4);
      ctx.fillRect(px + w - 3, py + 4, 3, h - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(px, py + 4, 1, h - 4);
    } else if (b.type === 'bunker') {
      // Бункер 2×2: приземистый дот, мешки, бойница со стволами гарнизона.
      bshadow(ctx, px, py, w, h, 6, 8);
      const R = hull(ctx, px + 3, py + 7, w - 6, h - 7, 12, FOUND, '#6a6f76', '#43484f', '#989fa7');
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 3, 2, '#767c84');
      // Мешки с песком двумя рядами на крыше.
      for (let r = 0; r < 2; r++) {
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = (i + r) % 2 ? '#a08c62' : '#8f7c55';
          ctx.beginPath();
          ctx.ellipse(R.rx + 7 + i * 9, R.ry + 8 + r * 8, 4.6, 3.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Люк и перископ.
      ctx.fillStyle = '#3b4047';
      ctx.beginPath(); ctx.arc(R.rx + R.rw - 10, R.ry + R.rh - 8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#22252a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(R.rx + R.rw - 10, R.ry + R.rh - 8, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#22252a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(R.rx + 8, R.ry + R.rh - 4); ctx.lineTo(R.rx + 8, R.ry + R.rh - 14); ctx.stroke();
      ctx.fillStyle = '#7df3e2'; ctx.fillRect(R.rx + 8, R.ry + R.rh - 16, 4, 3);
      // Бойница: по стволу на бойца гарнизона.
      ctx.fillStyle = '#14171b';
      ctx.fillRect(R.fx + 4, R.fy + 2, R.fw - 8, 6);
      const n = Math.min(gar, 4);
      for (let i = 0; i < n; i++) {
        const sx = R.fx + 10 + i * ((R.fw - 20) / Math.max(1, n - 1 || 1));
        ctx.fillStyle = '#22252a';
        ctx.fillRect(sx - 1.5, R.fy + 3, 3, 8);
      }
      if (!n) {
        ctx.fillStyle = 'rgba(125,243,226,0.5)';
        ctx.fillRect(R.fx + 6, R.fy + 4, R.fw - 12, 2);
      }
    } else if (b.type === 'factory') {
      // Завод 3×3: цех с фонарями, труба с дымом, горн, кран-балка.
      bshadow(ctx, px, py, w, h, 8, 11);
      const R = hull(ctx, px + 3, py + 8, w - 6, h - 8, 13, FOUND, FACE, FACED, '#9aa1a9');
      // Световые фонари цеха — три узкие светящиеся полосы в рамах.
      for (let i = 0; i < 3; i++) {
        const sx = R.rx + 12 + i * ((R.rw - 30) / 3);
        ctx.fillStyle = '#2b2e33'; ctx.fillRect(sx, R.ry + 8, 13, R.rh - 40);
        ctx.fillStyle = 'rgba(125,243,226,' + (0.55 + 0.3 * pulse).toFixed(2) + ')';
        ctx.fillRect(sx + 2, R.ry + 10, 9, R.rh - 44);
      }
      // Вентблоки и коллекторная труба вдоль низа крыши.
      for (let i = 0; i < 2; i++) {
        const vx = R.rx + 10 + i * 26;
        ctx.fillStyle = '#6a6f76'; ctx.fillRect(vx, R.ry + R.rh - 30, 18, 10);
        ctx.fillStyle = '#a7aeb6'; ctx.fillRect(vx, R.ry + R.rh - 30, 18, 3);
      }
      ctx.fillStyle = '#565c64'; ctx.fillRect(R.rx + 6, R.ry + R.rh - 16, R.rw - 30, 5);
      ctx.fillStyle = '#7d858e'; ctx.fillRect(R.rx + 6, R.ry + R.rh - 16, R.rw - 30, 1.5);
      // Труба: высокий короб, обод, дым, красный огонь.
      const chX = R.rx + R.rw - 22;
      ctx.fillStyle = '#6a6f76'; ctx.fillRect(chX, R.ry - 34, 15, 42);
      ctx.fillStyle = '#43484f'; ctx.fillRect(chX, R.ry - 34, 15, 4);
      ctx.fillStyle = '#e8913a'; ctx.fillRect(chX, R.ry - 20, 15, 4);
      ctx.fillStyle = '#e8913a'; ctx.fillRect(chX, R.ry - 6, 15, 3);
      smoke(ctx, chX + 7, R.ry - 36, t, (bid % 7) * 0.13);
      mast(ctx, chX + 7, R.ry - 34, 7, blink);
      // Горн: оранжевые окна на фасаде + ворота.
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = 'rgba(255,' + (140 + Math.round(60 * pulse)) + ',60,0.9)';
        ctx.fillRect(R.fx + 8 + i * 16, R.fy + 2, 10, 5);
      }
      hazard(ctx, R.fx + R.fw - 30, R.fy + R.fh - 6, 24, 6);
      // Кран-балка над воротами.
      ctx.fillStyle = '#e8913a';
      ctx.fillRect(R.fx + 6, R.fy - 6, R.fw - 12, 3);
      ctx.strokeStyle = '#2b2e33'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(R.fx + 6, R.fy - 6); ctx.lineTo(R.fx + 6, R.fy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(R.fx + R.fw - 6, R.fy - 6); ctx.lineTo(R.fx + R.fw - 6, R.fy); ctx.stroke();
      const hookX = R.fx + R.fw / 2 + Math.sin(t * 0.7) * 10;
      ctx.beginPath(); ctx.moveTo(hookX, R.fy - 3); ctx.lineTo(hookX, R.fy + 2); ctx.stroke();
      ctx.fillStyle = '#2b2e33'; ctx.fillRect(hookX - 2, R.fy + 2, 4, 4);
    } else if (b.type === 'lab') {
      // Лаборатория 3×3: белый корпус, обсерватория, тарелка, чаны.
      bshadow(ctx, px, py, w, h, 8, 11);
      const R = hull(ctx, px + 3, py + 8, w - 6, h - 8, 13, FOUND, '#7d8590', '#4c525a', '#ccd2d9');
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 3, 3, '#a9b0b8');
      // Обсерватория: купол со щелью телескопа.
      dome(ctx, R.rx + 22, R.ry + 24, 14, '#274b55', '#3f9aab', '#c2f2ff');
      ctx.save();
      ctx.translate(R.rx + 22, R.ry + 24); ctx.rotate(-0.5 + Math.sin(t * 0.5) * 0.25);
      ctx.fillStyle = '#12333c'; ctx.fillRect(-2, -14, 4, 16);
      ctx.restore();
      // Тарелка: качается, следя за небом.
      const dx = R.rx + R.rw - 24, dy = R.ry + 22;
      ctx.strokeStyle = '#4c525a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(dx, dy + 12); ctx.lineTo(dx, dy); ctx.stroke();
      ctx.save();
      ctx.translate(dx, dy); ctx.rotate(-0.6 + Math.sin(t * 0.8) * 0.3);
      ctx.fillStyle = '#e8edf2';
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#4c525a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 5.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#b9c2cb';
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#4c525a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -10); ctx.stroke();
      ctx.fillStyle = '#e8913a';
      ctx.beginPath(); ctx.arc(0, -10, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Чаны с светящейся жижей.
      for (let i = 0; i < 2; i++) {
        const vx = R.rx + 14 + i * 20, vy = R.ry + R.rh - 14;
        ctx.fillStyle = '#9aa1a9'; ctx.fillRect(vx, vy - 14, 14, 16);
        ctx.fillStyle = 'rgba(126,255,190,' + (0.5 + 0.35 * pulse).toFixed(2) + ')';
        ctx.fillRect(vx + 2, vy - 12, 10, 6);
        ctx.strokeStyle = '#2b2e33'; ctx.lineWidth = 1.5; ctx.strokeRect(vx, vy - 14, 14, 16);
      }
      // Полоса окон и эмблема-атом на фасаде.
      winRow(ctx, R.fx + 6, R.fy + 2, 5, 8, 4, 5, '#7df3e2', '#23383c', bid);
      ctx.strokeStyle = '#e8913a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(R.fx + R.fw - 12, R.fy + 6, 7, 3, 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(R.fx + R.fw - 12, R.fy + 6, 7, 3, -0.5, 0, Math.PI * 2); ctx.stroke();
    }
  } else {
    // ================= КХАРИД: плоть, хитин, слизь =================
    const FD = '#3d1c26', FM = '#71334a', FL = '#ab6072';
    if (b.type === 'cc') {
      // Гнездо-улей 4×3: великий курган, венец рогов, бьющееся сердце.
      mound(ctx, cx, cy + 4, w * 0.46, h * 0.44, FD, FM, FL);
      // Венец рогов по верхней дуге.
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (1.15 + 0.7 * (i / 4));
        const hx = cx + Math.cos(a) * w * 0.32, hy = cy + 4 + Math.sin(a) * h * 0.34;
        spike(ctx, hx, hy, 9, 15 + (i % 2) * 5, '#2c141c', '#d9cfc0');
      }
      // Сердце в полости: бьётся.
      const hb = 1 + 0.1 * Math.max(0, Math.sin(t * 5));
      ctx.fillStyle = '#1c0d12';
      ctx.beginPath(); ctx.ellipse(cx, cy + 6, 17 * hb, 14 * hb, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = '#ff6e8a'; ctx.shadowBlur = 9;
      ctx.fillStyle = '#c43a54';
      ctx.beginPath(); ctx.ellipse(cx, cy + 6, 11 * hb, 9 * hb, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,180,190,0.7)';
      ctx.beginPath(); ctx.ellipse(cx - 3, cy + 3, 3.5 * hb, 2.5 * hb, -0.4, 0, Math.PI * 2); ctx.fill();
      // Глаза-стражи и дыхательные щели.
      aeye(ctx, cx - 30, cy - 6, 5);
      aeye(ctx, cx + 30, cy - 6, 5);
      for (const sx of [-1, 1]) {
        const ex = cx + sx * 24, ey = cy + 18;
        ctx.fillStyle = '#1c0d12';
        ctx.beginPath(); ctx.ellipse(ex, ey, 7, (2.5 + 2 * pulse) * breathe, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(168,255,158,0.75)';
        ctx.beginPath(); ctx.ellipse(ex, ey, 4, (1.2 + pulse) * breathe, 0, 0, Math.PI * 2); ctx.fill();
      }
      // Щупальца по углам кургана.
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const tx = cx + sx * w * 0.4, ty = cy + 4 + sy * h * 0.36;
        ctx.strokeStyle = FM; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx + sx * w * 0.22, cy + 4 + sy * h * 0.18);
        ctx.quadraticCurveTo(cx + sx * w * 0.34, cy + 4 + sy * h * 0.3 + Math.sin(t * 2 + sx) * 3, tx, ty);
        ctx.stroke();
        ctx.fillStyle = '#a8ff9e';
        ctx.beginPath(); ctx.arc(tx, ty, 2, 0, Math.PI * 2); ctx.fill();
      }
    } else if (b.type === 'depot') {
      // Нарост-кладовая 2×2: большая мешкообразная полость с зародышами.
      mound(ctx, cx, cy + 3, w * 0.44, h * 0.42, FD, FM, FL);
      // Главный мешок: полупрозрачная мембрана, внутри зёрна.
      const mx = cx - 4, my = cy + 1, mr = 15 * breathe;
      ctx.fillStyle = 'rgba(214,120,140,0.85)';
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,210,0.5)';
      ctx.beginPath(); ctx.arc(mx, my, mr * 0.7, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4 + bid;
        ctx.fillStyle = '#7d2030';
        ctx.beginPath(); ctx.arc(mx + Math.cos(a) * mr * 0.42, my + Math.sin(a) * mr * 0.42, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(mx - mr * 0.3, my - mr * 0.4, mr * 0.3, mr * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
      // Два малых мешочка и пуповина.
      for (const [ox, oy, or_] of [[16, -8, 6], [14, 12, 4.5]]) {
        ctx.fillStyle = 'rgba(214,120,140,0.9)';
        ctx.beginPath(); ctx.arc(cx + ox, cy + oy, or_ * breathe, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,220,225,0.6)';
        ctx.beginPath(); ctx.arc(cx + ox - 1.5, cy + oy - 1.5, or_ * 0.32, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = '#d68a9a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx + 8, my - 4); ctx.quadraticCurveTo(cx + 10, cy - 8, cx + 16, cy - 8); ctx.stroke();
    } else if (b.type === 'barracks') {
      // Инкубатор 3×2: родильная яма, три яйца, кольцо зубов.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(cx + 4, cy + 12, w * 0.44, h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      mound(ctx, cx, cy + 2, w * 0.46, h * 0.44, FD, FM, FL);
      // Яма выводка.
      ctx.fillStyle = '#200d14';
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.3, h * 0.26, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = '#a8ff9e'; ctx.shadowBlur = 8;
      ctx.strokeStyle = '#3f7a4a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.3, h * 0.26, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // Зубы венца вокруг ямы.
      teethRing(ctx, cx, cy + 3, w * 0.3 + 3, 6, -Math.PI / 2, Math.PI, 9, '#d9cfc0');
      // Три яйца; крайнее трескается и дрожит.
      const eggs = [[-0.17, 0.02, 9, 0], [0.02, -0.03, 11, 1], [0.2, 0.04, 8, 2]];
      for (const [ex, ey, er, k] of eggs) {
        const eex = cx + ex * w, eey = cy + 3 + ey * h;
        ctx.save();
        if (k === 2) { ctx.translate(eex, eey); ctx.rotate(Math.sin(t * 9) * 0.08); ctx.translate(-eex, -eey); }
        const g = ctx.createRadialGradient(eex - er * 0.3, eey - er * 0.35, 1, eex, eey, er);
        g.addColorStop(0, '#e8f5d8'); g.addColorStop(0.6, '#9dc98a'); g.addColorStop(1, '#4a7a4f');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(eex, eey, er * 0.78, er, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(168,255,158,' + (0.35 + 0.3 * pulse).toFixed(2) + ')';
        ctx.beginPath(); ctx.ellipse(eex, eey + er * 0.15, er * 0.4, er * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        if (k === 2) {
          ctx.strokeStyle = '#2c3a24'; ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(eex - 3, eey - er * 0.7); ctx.lineTo(eex + 1, eey - er * 0.2);
          ctx.lineTo(eex - 2, eey + er * 0.3); ctx.lineTo(eex + 2, eey + er * 0.6);
          ctx.stroke();
        }
        ctx.restore();
      }
    } else if (b.type === 'turret') {
      // Жвала 1×1: стреляющая пасть с зубами, наводится на цель.
      mound(ctx, cx, cy + 2, 14, 12, FD, FM, FL);
      // Глаза на стебельках.
      for (const sx of [-1, 1]) {
        ctx.strokeStyle = FM; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx + sx * 5, cy - 4); ctx.lineTo(cx + sx * 7, cy - 10); ctx.stroke();
        aeye(ctx, cx + sx * 7, cy - 11, 3.2);
      }
      // Пасть: тёмное жерло + зубы + огонь глотки.
      const mx = cx + Math.cos(ang) * 4, my = cy + 2 + Math.sin(ang) * 4;
      const squash = 1 - recoil * 0.35;
      ctx.fillStyle = '#160a0e';
      ctx.beginPath(); ctx.ellipse(mx, my, 11, 9 * squash, ang, 0, Math.PI * 2); ctx.fill();
      teethRing(ctx, mx, my, 10, 6, ang, 1.25, 8, '#d9cfc0');
      ctx.save();
      ctx.shadowColor = '#a8ff9e'; ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(140,255,150,' + (0.7 + 0.3 * Math.max(pulse, recoil)).toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(mx + Math.cos(ang) * 2, my + Math.sin(ang) * 2, 6, 4.5 * squash, ang, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Плевок в полёте сразу после выстрела.
      if (recoil > 0.55) {
        const px2 = mx + Math.cos(ang) * (12 + (1 - recoil) * 14);
        const py2 = my + Math.sin(ang) * (12 + (1 - recoil) * 14);
        ctx.fillStyle = 'rgba(168,255,158,' + (recoil * 0.9).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(px2, py2, 3, 0, Math.PI * 2); ctx.fill();
      }
    } else if (b.type === 'wall') {
      // Хитиновая стена 1×1 во весь тайл: крупная чешуя, живая жила.
      ctx.fillStyle = '#401f2a';
      ctx.fillRect(px, py + 3, w, h - 3);
      // Два ряда крупной чешуи со светлой верхней кромкой.
      for (let r = 0; r < 2; r++) {
        for (let i = 0; i < 3; i++) {
          const sx = px + 6 + i * 10 + (r % 2) * 5, sy = py + 12 + r * 9;
          ctx.fillStyle = r % 2 ? FL : '#8a4560';
          ctx.beginPath(); ctx.ellipse(sx, sy, 7, 5.5, 0, Math.PI, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#e0a0b0'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.ellipse(sx, sy, 7, 5.5, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
          ctx.strokeStyle = FD; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(sx - 7, sy); ctx.lineTo(sx + 7, sy); ctx.stroke();
        }
      }
      // Жила по центру + шипики сверху.
      ctx.fillStyle = 'rgba(168,255,158,' + (0.65 + 0.3 * pulse).toFixed(2) + ')';
      ctx.fillRect(px, cy - 1.5, w, 3);
      for (let i = 0; i < 4; i++) spike(ctx, px + 5 + i * 8, py + 6, 4, 5, '#2c141c', '#d9cfc0');
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px, py + h - 4, w, 4);
    } else if (b.type === 'bunker') {
      // Кокон 2×2: плетёное гнездо, щель с глазами гарнизона.
      mound(ctx, cx, cy + 3, w * 0.44, h * 0.42, '#4a2030', '#7d3a52', '#b96a80');
      // Плетение: дуги волокон.
      ctx.strokeStyle = 'rgba(217,207,192,0.5)'; ctx.lineWidth = 1.6;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy + 3, w * 0.36 - k * 6, (h * 0.34 - k * 5) * breathe, 0.3, Math.PI * 1.7, Math.PI * 2.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy + 3, w * 0.36 - k * 6, (h * 0.34 - k * 5) * breathe, 0, Math.PI * 0.7, Math.PI * 1.5);
        ctx.stroke();
      }
      // Щель выводка: по глазу на каждого сидящего внутри.
      ctx.fillStyle = '#1c0d12';
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
      const n = Math.min(gar, 4);
      for (let i = 0; i < n; i++) {
        const ex = cx - 12 + i * (24 / Math.max(1, n - 1 || 1));
        aeye(ctx, ex, cy + 4, 3);
      }
      if (!n) {
        ctx.fillStyle = 'rgba(168,255,158,0.4)';
        ctx.beginPath(); ctx.ellipse(cx, cy + 4, 12, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      }
      // Капля слизи.
      ctx.fillStyle = 'rgba(150,230,170,0.75)';
      ctx.beginPath(); ctx.ellipse(cx + 14, cy + 18 + Math.sin(t * 2) * 1.5, 2.5, 4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (b.type === 'factory') {
      // Яма выводка 3×3: кратер с кладкой, щупальца, светящаяся топь.
      mound(ctx, cx, cy + 3, w * 0.47, h * 0.45, FD, FM, FL);
      // Кратер.
      ctx.fillStyle = '#1c0d12';
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, w * 0.28, h * 0.24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = '#a8ff9e'; ctx.shadowBlur = 9;
      ctx.fillStyle = 'rgba(120,220,130,' + (0.5 + 0.35 * pulse).toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, w * 0.2, h * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Кладка в топи.
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4 + 0.5;
        const ex = cx + Math.cos(a) * w * 0.13, ey = cy + 2 + Math.sin(a) * h * 0.1;
        ctx.fillStyle = '#cfe8b8';
        ctx.beginPath(); ctx.ellipse(ex, ey, 4, 5, a, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(168,255,158,0.6)';
        ctx.beginPath(); ctx.ellipse(ex, ey + 1, 2, 2.6, a, 0, Math.PI * 2); ctx.fill();
      }
      // Зубы венца и щупальца.
      teethRing(ctx, cx, cy + 2, w * 0.28 + 2, 7, -Math.PI / 2, Math.PI, 10, '#d9cfc0');
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * (0.15 + 0.35 * i) + (i === 1 ? Math.PI * 0.7 : 0);
        const bx = cx + Math.cos(a) * w * 0.3, by = cy + 3 + Math.sin(a) * h * 0.28;
        const tipX = cx + Math.cos(a) * w * 0.48, tipY = cy + 3 + Math.sin(a) * h * 0.46;
        ctx.strokeStyle = FM; ctx.lineWidth = 4 - i * 0.5;
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + Math.sin(t * 2.2 + i * 2) * 8, by - 8, tipX, tipY);
        ctx.stroke();
        ctx.fillStyle = '#a8ff9e';
        ctx.beginPath(); ctx.arc(tipX, tipY, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    } else if (b.type === 'lab') {
      // Узел эволюции 3×3: витой шпиль, парящие осколки, полипы.
      mound(ctx, cx, cy + 8, w * 0.46, h * 0.4, FD, FM, FL);
      // Шпиль: широкие сужающиеся сегменты.
      const segs = 5, baseW = 34, segH = 12;
      let tipX = cx, tipY = cy;
      for (let i = 0; i < segs; i++) {
        const sw = baseW * (1 - i / (segs + 0.5));
        const sy = cy + 18 - i * segH;
        const lean = Math.sin(i * 1.2) * 2;
        const g = ctx.createLinearGradient(cx - sw / 2, 0, cx + sw / 2, 0);
        g.addColorStop(0, '#c07a8c'); g.addColorStop(0.45, FM); g.addColorStop(1, FD);
        ctx.fillStyle = g;
        poly(ctx, [cx - sw / 2 + lean, sy, cx + sw / 2 + lean, sy, cx + sw * 0.32 + lean + 2, sy - segH, cx - sw * 0.32 + lean + 2, sy - segH]);
        ctx.strokeStyle = '#e0a0b0'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(cx - sw / 2 + lean, sy); ctx.lineTo(cx - sw * 0.32 + lean + 2, sy - segH); ctx.stroke();
        if (i === segs - 1) { tipX = cx + lean + 2; tipY = sy - segH; }
      }
      // Навершие со свечением — на вершине шпиля, не в воздухе.
      ctx.fillStyle = FM;
      ctx.fillRect(tipX - 2, tipY - 4, 4, 5);
      ctx.save();
      ctx.shadowColor = '#c99aff'; ctx.shadowBlur = 9;
      ctx.fillStyle = '#e3c8ff';
      ctx.beginPath(); ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Осколки на орбите.
      for (let i = 0; i < 3; i++) {
        const a = t * 0.9 + i * (Math.PI * 2 / 3);
        const ox = cx + Math.cos(a) * 30, oy = cy - 8 + Math.sin(a) * 12;
        const s = 3.5 + Math.sin(a) * 1.2;
        ctx.fillStyle = '#c99aff';
        poly(ctx, [ox, oy - s, ox + s * 0.6, oy, ox, oy + s, ox - s * 0.6, oy]);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(ox - 1, oy - s * 0.5, 2, s * 0.6);
      }
      // Полипы у подножия.
      for (const [ox, s] of [[-24, 4], [-16, 3], [20, 3.5], [27, 2.6]]) {
        ctx.fillStyle = FM;
        ctx.fillRect(cx + ox - 1.5, cy + 14 - s * 2, 3, s * 2);
        ctx.fillStyle = 'rgba(168,255,158,' + (0.55 + 0.3 * pulse).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(cx + ox, cy + 12 - s * 2, s, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Призрак: цветная вуаль поверх силуэта.
  if (ghost || b.done === false) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = ghost ? 'rgba(143,255,226,0.35)' : 'rgba(243,197,121,0.4)';
    rr(ctx, px + 5, py + 4, w - 10, h - 10, 8); ctx.fill();
  }
  ctx.restore();

  // --- Стройплощадка / прогресс / HP / flash (без изменений) ---
  ctx.save();
  if (b.done === false) {
    const under = 0.35 + 0.65 * (b.progress || 0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(243,197,121,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -performance.now() * 0.02;
    ctx.strokeRect(px + 3, py + 3, w - 6, h - 6);
    ctx.setLineDash([]);
    if (!ghost) {
      ctx.fillStyle = 'rgba(10,10,12,0.72)';
      ctx.fillRect(px + 4, py + h - 12, w - 8, 8);
      ctx.fillStyle = '#f3c579';
      ctx.fillRect(px + 5, py + h - 11, (w - 10) * Math.min(1, b.progress || 0), 6);
      ctx.fillStyle = '#0d0e12';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.round((b.progress || 0) * 100) + '%', px + w / 2, py + h - 7);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    void under;
  }

  // Трещины урона: тёмные рваные линии по корпусу.
  if (b.done !== false && !ghost && b.hp < b.maxHp * 0.5) {
    const frac = 1 - b.hp / b.maxHp;
    const n = 2 + Math.round(frac * 5);
    ctx.strokeStyle = faction === 'human' ? 'rgba(15,16,20,0.75)' : 'rgba(20,5,10,0.8)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < n; i++) {
      const sx = px + 6 + ((bid * 37 + i * 53) % Math.max(1, (w - 12) | 0));
      let yy = py + 4 + ((bid * 61 + i * 29) % Math.max(1, (h - 8) | 0));
      let xx = sx;
      ctx.beginPath(); ctx.moveTo(xx, yy);
      for (let s = 0; s < 3; s++) {
        xx += ((bid * 17 + i * 11 + s * 23) % 13) - 6;
        yy += 4 + ((bid * 13 + i * 7 + s * 5) % 7);
        ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
  }

  // Полоска HP — только у повреждённых (целая не шумит).
  if (b.hp < b.maxHp && b.done !== false) {
    const frac = Math.max(0, b.hp / b.maxHp);
    ctx.fillStyle = 'rgba(8,10,12,0.7)';
    ctx.fillRect(px, py - 11, w, 6);
    ctx.fillStyle = frac > 0.55 ? '#7BE495' : frac > 0.28 ? '#f3c579' : '#ff6e5f';
    ctx.fillRect(px + 1, py - 10, (w - 2) * frac, 4);
  }

  // Красная вспышка попадания.
  if (b.flashT > 0 && !ghost) {
    ctx.globalAlpha = Math.min(1, b.flashT * 6) * 0.45;
    ctx.fillStyle = '#ff5a4e';
    rr(ctx, px + 5, py + 4, w - 10, h - 10, 8); ctx.fill();
  }
  ctx.restore();
}

