// ============================================================
// buildings.js — здания: размещение, строительство рабочими,
// очереди производства, население (supply), оборона (турели),
// гарнизоны (бункеры), отрисовка.
// ============================================================
import { TILE, BUILDINGS, UNITS, SUPPLY_MAX, BUILDERS_PER_SITE, BULLET_SPEED, COLORS, UPGRADES, fname, glevel, gradeRange, gradeRate, gradeQueue, gradeGar, GRADE_ROMAN } from './config.js?v=10262513';
import { canGradeBuilding, MAX_LEVEL, ccGate, ccGateProgress } from './economy.js?v=10262513';
import { drawGradeTrim, drawCommanderMark } from './skins.js?v=10262513';
import { nearestFreeTileAround } from './pathfinding.js?v=10262513';
import { orderBuild, orderGather, orderMove, spawnUnit, addEffect, shoot, acquireTarget, releaseGarrison, atkBonus } from './units.js?v=10262513';
import { icon } from './ui.js?v=10262513'; // Пакет E.2: иконки для бейджей (циклов нет: ui не импортирует buildings)
import { distToRectPx } from './pathfinding.js?v=10262513';
import { message } from './i18n.js?v=10262513';

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
    this.level = 1;                      // F.2: грейд здания (1–3)
    this.gradeUp = null;                 // F.2: идущий грейд {to, t, total}
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

// M0: зона стройки игрока. Без зон в миссии — всё разрешено; иначе
// футпринт обязан ЦЕЛИКОМ лежать внутри хотя бы одной зоны.
export function zoneAllows(st, tx, ty, w, h) {
  const zones = st.buildZone;
  if (!zones || !zones.length) return true;
  for (const z of zones) {
    if (tx >= z.x && ty >= z.y && tx + w <= z.x + z.w && ty + h <= z.y + z.h) return true;
  }
  return false;
}

// Общая команда постройки (для игрока и ИИ): списывает минералы,
// создаёт недострой, выселяет юнитов с площадки, раздаёт приказ рабочим.
export function placeBuildingCmd(st, side, type, tx, ty, builders) {
  const cfg = BUILDINGS[type];
  if (!canPlace(st.map, tx, ty, cfg.w, cfg.h)) return null;
  if (side === 'player' && !zoneAllows(st, tx, ty, cfg.w, cfg.h)) return null; // ИИ не ограничен
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
  // Рабочие получают приказ строить — не больше BUILDERS_PER_SITE
  // (П3): из пула берём ближайших живых, остальные сохраняют приказы.
  if (builders && builders.length) {
    const crew = builders.filter((w) => !w.dead && !w.garrison && w.side === side)
      .sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))
      .slice(0, BUILDERS_PER_SITE);
    for (const w of crew) orderBuild(st, w, b);
  }
  return b;
}

// Поставить юнит в очередь производства. Коды: ok | money | queue | wrong.
export function enqueueUnit(st, b, type) {
  if (!b || b.dead || !b.done) return 'wrong';
  const list = Array.isArray(b.cfg.produces) ? b.cfg.produces : [b.cfg.produces];
  if (!list.includes(type)) return 'wrong';
  if (b.queue.length >= gradeQueue(b.type, b.level || 1)) return 'queue'; // F.2
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

// Запустить исследование улучшения. Коды: ok | money | busy | max | grade | wrong.
export function startResearch(st, b, key) {
  const u = UPGRADES[key];
  if (!u || !b || b.dead || !b.done || !b.cfg.research) return 'wrong';
  if (b.res) return 'busy';
  const lvl = (st.tech[b.side] && st.tech[b.side][key]) || 0;
  if (lvl >= u.max) return 'max';
  // H.1: ресерч за грейдом (авторемонт — за КЦ Г2). ИИ затвор не проходит.
  const ccl = bestCCLevel(st, b.side);
  if (u.requiresGrade && ccl < u.requiresGrade.level) return 'grade';
  // Э1 (правило R3): ранг юнита не может обогнать уровень КЦ.
  if (lvl + 1 > ccl) return 'grade';
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

// F.2/Э1: запустить грейд здания (1→20). Все правила — в economy.js:
//   R1 цель ≤ уровня КЦ; R2 у КЦ своё условие «L зданий уровня L−1».
// Коды: ok | money | busy | max | wrong | cclow | gate (cclow/gate несут
// подробности в .need — панель команд показывает их игроку).
export function startGrade(st, b) {
  const gate = canGradeBuilding(st, b.side, b);
  if (!gate.ok) return gate;
  const g = gate.entry;
  st.minerals.player -= g.cost;
  b.gradeUp = { to: gate.to, t: g.time, total: g.time, cost: g.cost };
  return { ...gate, code: 'ok' };
}

// F.2: отменить грейд (возврат минералов).
export function cancelGrade(st, b) {
  if (!b.gradeUp) return;
  const refund = Number(b.gradeUp.cost);
  if (Number.isFinite(refund) && refund > 0) st.minerals[b.side] += refund;
  else {
    const g = glevel(b.type, b.gradeUp.to);
    if (g) st.minerals[b.side] += g.cost;
  }
  b.gradeUp = null;
}

// F.2: завершить грейд: уровень + применение статов.
function completeGrade(st, b) {
  const to = b.gradeUp.to;
  b.level = to;
  b.gradeUp = null;
  const g = glevel(b.type, to);
  if (g && g.hpMul) { // бункер/КЦ/Дом: прочность растёт с добором HP
    const nm = Math.round(b.cfg.hp * g.hpMul);
    b.hp = Math.max(1, Math.min(nm, b.hp + (nm - b.maxHp)));
    b.maxHp = nm;
  }
  if (b.side === 'player') {
    st.game.ui.toast(message('gradeDone', b.faction) + fname(b.cfg, b.faction) + ' · ' + GRADE_ROMAN[to]);
    st.game.sound.ready();
  }
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
      // Э1: грейд лаборатории ускоряет ранги юнитов (gradeRate 'lab')
      b.res.t -= dt * (b.cfg.research ? gradeRate('lab', b.level || 1) : 1);
      if (b.res.t <= 0) {
        const key = b.res.key;
        st.tech[b.side][key] = b.res.lvl;
        b.res = null;
        if (b.side === 'player') {
          const u = UPGRADES[key];
          st.game.ui.toast(message('resDone', b.faction) + fname(u, b.faction) + message('lvlWord', b.faction) + st.tech.player[key]);
          st.game.sound.ready();
        }
      }
    }

    // --- F.2: грейд тикает, здание при этом работает ---
    if (b.gradeUp) {
      b.gradeUp.t -= dt;
      if (b.gradeUp.t <= 0) completeGrade(st, b);
    }

    // --- Производство ---
    if (b.queue.length) {
      const q = b.queue[0];
      q.t -= dt * gradeRate(b.type, b.level || 1); // F.2: темп найма от грейда
      if (q.t <= 0) {
        // Юнит «готов», но ждёт свободного населения.
        if (st.supply[b.side].used + UNITS[q.type].supply > st.supply[b.side].cap) {
          q.hold = true;
          q.t = 0;
          if (b.side === 'player' && st.time - st.lastSupplyToast > 6) {
            st.lastSupplyToast = st.time;
            st.game.ui.toast(message('needSupply', b.faction), 'error');
          }
        } else {
          q.hold = false;
          // Нет свободной точки выхода — юнит ждёт у ворот, но не
          // появляется внутри корпуса здания (анти-застревание).
          if (trySpawnTrained(st, b, q.type)) b.queue.shift();
          else q.t = 0;
        }
      }
    }

    // --- Турель: сама ищет и обстреливает врагов ---
    if (b.cfg.attack) {
      b.cd = Math.max(0, b.cd - dt);
      b.scanT -= dt;
      // Проверяем актуальность цели: жива и в радиусе.
      if (b.target && (b.target.dead ||
          distToRectPx(b.target.x, b.target.y, b.tx * TILE, b.ty * TILE, b.w * TILE, b.h * TILE) > gradeRange(b.type, b.level || 1, b.cfg.range) + TILE)) { // F.2
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
              target: t, speed: BULLET_SPEED, dmg: m.cfg.dmg + atkBonus(st, m), src: b, dead: false,
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
  if (best) b.lastSpawn = { x: (best.x + 0.5) * TILE, y: (best.y + 0.5) * TILE };
  return best;
}

// Пытается выпустить обученного юнита; false — выход заперт, ждём.
function trySpawnTrained(st, b, type) {
  const spot = findSpawnSpot(st, b) || nearestFreeTileAround(st.map, b.tx, b.ty, b.w, b.h);
  if (!spot) return false;
  spawnTrainedUnit(st, b, type, (spot.x + 0.5) * TILE, (spot.y + 0.5) * TILE);
  return true;
}

// H: лучший грейд живого КЦ стороны (0 — нет КЦ). Проверки «есть ли Г2/Г3».
export function bestCCLevel(st, side) {
  let best = 0;
  for (const b of st.buildings) {
    if (!b.dead && b.side === side && b.type === 'cc') best = Math.max(best, b.level || 1);
  }
  return best;
}

// H.4: точка кольца разброса (выделено из спавна G.1 — та же формула).
export function rallySpot(st, b) {
  if (!b.rally) return { x: b.x, y: b.y }; // H.4: без точки сбора — сам КЦ
  const seq = (b.rallySeq = (b.rallySeq || 0) + 1);
  const a = seq * 2.39996, r = 20 + 9 * Math.sqrt(seq);
  const gx = b.rally.x + Math.cos(a) * r, gy = b.rally.y + Math.sin(a) * r;
  const bad = st.map.blockedAt((gx / TILE) | 0, (gy / TILE) | 0);
  return bad ? { x: b.rally.x, y: b.rally.y } : { x: gx, y: gy };
}

function spawnTrainedUnit(st, b, type, x, y) {
  const u = spawnUnit(st, b.side, type, x, y, true);
  // Точка сбора на кристалле: новый рабочий сразу встаёт на добычу;
  // на землю — идёт туда (формационные точки не нужны: спавн уже разнесён).
  if (b.rally) {
    const rc = b.rally.crystal;
    if (type === 'worker' && rc && !rc.dead && rc.amount > 0) orderGather(st, u, rc);
    else {
      // G.1: точка сбора раздаёт строй, а не стек (кольцо rallySpot).
      const spot = rallySpot(st, b);
      orderMove(st, u, spot.x, spot.y);
    }
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
// Свет сверху-слева: у крыши яркая кромка сверху и световая грань слева,
// справа и снизу — тень. Без этого корпус читается плоским «чипом».
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
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fillRect(rx + rw - 5, ry, 5, rh);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(rx, ry, rw, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.26)';
  ctx.fillRect(rx, ry, 2, rh);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(rx, ry + rh - 2, rw, 2);
  ctx.strokeStyle = cFound; ctx.lineWidth = 1.5;
  ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
  return { rx, ry, rw, rh, fx, fy, fw, fh };
}

// Гелиос: приподнятый блок на крыше (второй этап/руб) — тот же свет,
// что и у hull, но компактнее: корпус + фасад + крышка.
function roofBlock(ctx, x, y, w, h, lift, cFound, cFace, cFaceDark, cRoof) {
  const R = hull(ctx, x, y, w, h, lift, cFound, cFace, cFaceDark, cRoof);
  roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 3, 2, 'rgba(255,255,255,0.16)');
  return R;
}

// Сетка швов на крыше: тёмный шов + световая грань — панель читается
// объёмом, а крыша не выглядит плоской заливкой.
function roofPanels(ctx, rx, ry, rw, rh, nx, ny, color) {
  ctx.save();
  ctx.lineWidth = 1;
  const seam = (c, d) => {
    ctx.strokeStyle = c;
    ctx.beginPath();
    for (let i = 1; i < nx; i++) {
      const x = rx + (rw * i) / nx + d;
      ctx.moveTo(x, ry + 3); ctx.lineTo(x, ry + rh - 3);
    }
    for (let i = 1; i < ny; i++) {
      const y = ry + (rh * i) / ny + d;
      ctx.moveTo(rx + 3, y); ctx.lineTo(rx + rw - 3, y);
    }
    ctx.stroke();
  };
  seam(color, 0.5);
  seam('rgba(255,255,255,0.25)', -0.5);
  ctx.restore();
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
  ctx.fill();                                   // было: без fill() рог не рисовался вовсе
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
    ctx.fill();   // было: без fill() клыки не рисовались вовсе; fill() обязан
  }               // быть в цикле — poly() сбрасывает путь через beginPath()
}

// ------------------------------------------------------------
// Общие детали «продуктового» вида (шлифовка #31).
// Свет сверху-слева — канон DESIGN_SYSTEM.md §1: у всего объёмного
// есть кромка света и притемнённый низ, иначе корпус читается плоским.
// ------------------------------------------------------------

// Кромка света: белая линия по верху плиты + тень по низу.
function rim(ctx, x, y, w, h, a = 0.5) {
  ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
  ctx.fillRect(x, y, w, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(x, y + h - 1.5, w, 1.5);
}

// Гелиос: светящееся окно «Рубежа» — подложка, teal-свечение, блик сверху.
function glowWin(ctx, x, y, w, h, on, t, seed) {
  ctx.fillStyle = 'rgba(8,18,22,0.85)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  const k = on ? 0.72 + 0.28 * Math.sin(t * 2.2 + seed) : 0.22;
  ctx.save();
  ctx.shadowColor = '#7df3e2';
  ctx.shadowBlur = 6;
  ctx.globalAlpha = k;
  ctx.fillStyle = '#7df3e2';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(x, y, w, 1);
}

// Гелиос: ховер-подиум — плита со струями тяги, выглядывающими из-под корпуса.
// Техника Гелиоса «висит»: без этого корпус выглядит приклеенным к земле.
function hoverPad(ctx, cx, cy, rx, ry, color, t, seed) {
  ctx.fillStyle = 'rgba(6,14,18,0.6)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 1, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(cx, cy + 1, rx, ry, 0, Math.PI, Math.PI * 2); ctx.stroke();
  const k = 0.55 + 0.45 * Math.sin(t * 3 + seed);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.globalAlpha = 0.35 + 0.35 * k;
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const jx = cx - rx * 0.62 + i * rx * 0.62;
    ctx.beginPath(); ctx.ellipse(jx, cy + 4, 3.4, 2 + k, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Кхарид: жилы — дуги от центра кургана к краю (сосущая сеть плоти).
function veins(ctx, cx, cy, rx, ry, n, seed, color) {
  ctx.strokeStyle = color || 'rgba(26,7,15,0.5)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rx * 0.24, cy + Math.sin(a) * ry * 0.24);
    ctx.quadraticCurveTo(
      cx + Math.cos(a + 0.38) * rx * 0.68, cy + Math.sin(a + 0.38) * ry * 0.68,
      cx + Math.cos(a) * rx * 0.94, cy + Math.sin(a) * ry * 0.94);
    ctx.stroke();
  }
}

// Кхарид: капля слизи — свисает и дрожит (живое, а не нарисованное).
function slime(ctx, x, y, s, t, seed) {
  const d = Math.sin(t * 1.8 + seed) * 1.2;
  ctx.fillStyle = 'rgba(168,255,158,0.7)';
  ctx.beginPath();
  ctx.ellipse(x, y + d, s * 0.55, s + d * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.arc(x - s * 0.18, y + d - s * 0.3, Math.max(0.7, s * 0.16), 0, Math.PI * 2);
  ctx.fill();
}

// Пакет E.2: бейджи над зданием (иконка 20px + полоса прогресса 44px),
// гарнизон — бейдж «N/M» в правом верхнем углу корпуса. Слоты идут вверх
// от HP-полосы, друг друга не перекрывают.
// С3/П7: лаборатория врага показывает ЗАКРЫТЫЕ уровни (st.tech) — финал
// чувствуется с первой минуты. Идёт через drawStatusBadges, слоты те же.
const ENEMY_TECH_ORDER = ['infAtk', 'vehAtk', 'infArm', 'vehArm'];
// F.2: шевроны грейда (II/III) + окантовка. Враг не грейдится, но рисуем
// defensively — любой b.level >= 2 виден обеим сторонам.
function drawGradeMarks(ctx, b, px, py, w) {
  const lv = b.level || 1;
  if (lv < 2 || b.done === false) return;
  const col = lv >= 3 ? '#f3c579' : '#9fb6c3';
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 2.5, py + 2.5, w - 5, (b.h || 1) * TILE - 5);
  ctx.fillStyle = col;
  const n = lv >= 3 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const x = px + w / 2 + (i - (n - 1) / 2) * 10;
    ctx.beginPath();
    ctx.moveTo(x - 4, py - 4); ctx.lineTo(x, py - 9); ctx.lineTo(x + 4, py - 4);
    ctx.closePath(); ctx.fill();
  }
  ctx.textAlign = 'left';
}

function drawStatusBadges(ctx, b, px, py, w, st = null) {
  let sy = py - 16;
  const slot = (iconType, frac, accent) => {
    ctx.drawImage(icon(iconType), px, sy - 20, 20, 20);
    ctx.fillStyle = 'rgba(8,10,12,0.7)';
    ctx.fillRect(px + 23, sy - 13, 44, 6);
    ctx.fillStyle = accent;
    ctx.fillRect(px + 24, sy - 12, 42 * Math.max(0, Math.min(1, frac)), 4);
    sy -= 24;
  };
  if (b.side === 'player' && b.queue && b.queue.length) {
    const item = b.queue[0];
    slot(b.faction === 'alien' ? 'a_' + item.type : item.type,
      item.total ? 1 - item.t / item.total : 0, '#8ff5e2');
    if (b.queue.length > 1) {
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillStyle = '#e8f4f1';
      ctx.textAlign = 'left';
      ctx.fillText('\u00d7' + b.queue.length, px + 70, sy + 12);
    }
  }
  if (b.side === 'player' && b.res) {
    slot('u_' + b.res.key, b.res.total ? 1 - b.res.t / b.res.total : 0, '#f3c579');
  }
  // F.2: идущий грейд — слот языком E.2-бейджей.
  if (b.side === 'player' && b.gradeUp) {
    slot('grade', b.gradeUp.total ? 1 - b.gradeUp.t / b.gradeUp.total : 0, '#ffd27f');
  }
  // С3/П7: закрытые исследования врага — полные слоты (прогресс скрыт).
  if (st && b.side === 'enemy' && b.cfg && b.cfg.research && st.tech && st.tech[b.side]) {
    for (const key of ENEMY_TECH_ORDER) {
      if ((st.tech[b.side][key] || 0) > 0) slot('u_' + key, 1, '#b9a7e6');
    }
  }
  if (b.side === 'player' && b.cfg.garrisonCap && Array.isArray(b.garrison)) {
    const t = b.garrison.length + '/' + gradeGar(b.type, b.level || 1, b.cfg.garrisonCap); // F.2
    const bx = px + w - 38, by = py + 4;
    ctx.fillStyle = 'rgba(8,10,12,0.75)';
    ctx.fillRect(bx, by, 36, 16);
    ctx.strokeStyle = 'rgba(143,255,226,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, 35, 15);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillStyle = '#e8f4f1';
    ctx.textAlign = 'center';
    ctx.fillText(t, bx + 18, by + 12);
    ctx.textAlign = 'left';
  }
  drawGradeMarks(ctx, b, px, py, w);
}

export function drawBuilding(ctx, b, ghost = false, camX = 0, camY = 0, st = null) {
  const TILE_W = TILE;
  const px = b.tx * TILE_W - camX + (b.visX || 0), py = b.ty * TILE_W - camY + (b.visY || 0);
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
    // ================= ГЕЛИОС: гранёная сталь, teal-окна, янтарь =================
    // Один язык на все 8 зданий: свет сверху-слева (кромка света + тёмный
    // низ), teal-окна «Рубежа», янтарные акценты и «зебра», корпус ~90%
    // футпринта, под корпусом — ховер-подиум со струями тяги.
    const FOUND = '#23262c', FACE = '#596069', FACED = '#3b4047', ROOF = '#a7aeb6';
    const STEEL = '#7d858e', STEEL_D = '#565c64', STEEL_L = '#c3c9d1';
    const WIN = '#7df3e2', AMBER = '#f3c579', ORANGE = '#e8913a';

    if (b.type === 'cc') {
      // Командный центр 4×3: подиум → корпус → рубов на крыше → купол-радар.
      bshadow(ctx, px, py, w, h, 8, 12, 0.4);
      hoverPad(ctx, cx, py + h - 3, w * 0.52, 7, COLORS.playerBright, t, bid);
      const R = hull(ctx, px + 3, py + 6, w - 6, h - 6, 13, FOUND, FACE, FACED, ROOF);
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 5, 3, '#7c848d');
      rim(ctx, R.rx, R.ry, R.rw, 2);
      // Флигели по бокам: teal-полоса окон + янтарная кромка под ней.
      for (const s of [-1, 1]) {
        const wx = cx + s * (w * 0.33) - 9, wy = R.ry + R.rh * 0.56;
        glowWin(ctx, wx, wy, 18, 5, true, t, bid + s);
        ctx.fillStyle = AMBER;
        ctx.fillRect(wx, wy + 7, 18, 2);
      }
      // Руб на крыше: команда сидит выше цеха — силуэт читается с дальности.
      const B2 = roofBlock(ctx, cx - 26, R.ry + 6, 52, 26, 9, FOUND, FACE, FACED, ROOF);
      glowWin(ctx, cx - 17, B2.fy + 3, 14, 4, true, t, bid);
      glowWin(ctx, cx + 3, B2.fy + 3, 14, 4, true, t, bid + 1);
      // Центральный купол командования + вращающийся радар.
      const domeX = cx, domeY = B2.ry - 2;
      ctx.fillStyle = STEEL_D;
      ctx.beginPath(); ctx.arc(domeX, domeY + 4, 17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(domeX, domeY + 4, 17, Math.PI, Math.PI * 2); ctx.fill();
      dome(ctx, domeX, domeY, 15, '#1d3a44', '#2e7d8c', '#9be8f5');
      ctx.save();
      ctx.translate(domeX, domeY);
      ctx.rotate(t * 1.4);
      ctx.fillStyle = '#d9fbff';
      ctx.fillRect(0, -1.2, 12, 2.4);
      ctx.restore();
      ctx.fillStyle = '#e8f6ff';
      ctx.beginPath(); ctx.arc(domeX, domeY, 2, 0, Math.PI * 2); ctx.fill();
      // Угловые башенки с красными огнями.
      for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const bx = R.rx + 6 + tx * (R.rw - 18), by = R.ry + 6 + ty * (R.rh - 14);
        ctx.fillStyle = STEEL; ctx.fillRect(bx, by - 4, 12, 12);
        ctx.fillStyle = STEEL_L; ctx.fillRect(bx, by - 4, 12, 3);
        ctx.fillStyle = STEEL_D; ctx.fillRect(bx, by + 6, 12, 2);
        ctx.fillStyle = blink ? '#ff5f57' : '#5a2020';
        ctx.beginPath(); ctx.arc(bx + 6, by - 6, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      // Ворота с пандусом-зеброй и окна фасада.
      hazard(ctx, cx - 13, R.fy + R.fh - 7, 26, 7);
      ctx.fillStyle = '#14171b'; ctx.fillRect(cx - 9, R.fy + 1, 18, R.fh - 7);
      winRow(ctx, R.fx + 6, R.fy + 2, 3, 7, 4, 4, WIN, '#23383c', bid);
      winRow(ctx, R.fx + R.fw - 6 - 3 * 11, R.fy + 2, 3, 7, 4, 4, WIN, '#23383c', bid + 2);
      // Мачта с маяком стоит на крыше у левого края.
      mast(ctx, R.rx + 5, R.ry + 14, 14, blink);
    } else if (b.type === 'depot') {
      // Дом 2×2 · V-4 «мобильный дом-шаттл», доводка под референс
      // house-helios.png: модульный корпус с янтарной «зеброй», крупные
      // сложенные крылья с панелями, купол-кабина и открытый грузовой отсек
      // со стеком граней. Функции те же: медленный ход (подиум + струи),
      // шаттл (крылья + кабина), склад вылазки (отсек с ресурсом).
      bshadow(ctx, px, py, w, h, 6, 8);
      hoverPad(ctx, cx, py + h - 2, w * 0.5, 6, COLORS.playerBright, t, bid);
      // Струи тяги: дом едет медленно, но едет — конусы выглядывают из-под
      // подиума. Без shadowBlur: свечение подиума уже есть, второе не надо.
      const jk = 0.55 + 0.45 * Math.sin(t * 4.2 + bid);
      ctx.globalAlpha = 0.3 + 0.28 * jk;
      ctx.fillStyle = '#9beeff';
      for (const jx of [cx - w * 0.2, cx + w * 0.2]) {
        ctx.beginPath();
        ctx.moveTo(jx - 3.2, py + h - 3);
        ctx.lineTo(jx + 3.2, py + h - 3);
        ctx.lineTo(jx + 1.4, py + h + 4 + jk * 3);
        ctx.lineTo(jx - 1.4, py + h + 4 + jk * 3);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const R = hull(ctx, px + 4, py + 5, w - 8, h - 5, 11, FOUND, '#8d8272', '#5c554a', '#b9ac93');
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 2, 2, '#8a7f68');
      rim(ctx, R.rx, R.ry, R.rw, 2, 0.4);
      // «Зебра» Гелиоса: янтарная кромка-пояс над фасадом + тёмный шов под
      // ней. Без неё корпус читается неокрашенным ящиком.
      ctx.fillStyle = AMBER; ctx.fillRect(R.rx, R.ry + R.rh - 9, R.rw, 2.6);
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(R.rx, R.ry + R.rh - 6.4, R.rw, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(R.rx, R.ry + R.rh - 9, R.rw, 1);
      // Крылья: крупные дельты у бортов на полках-держателях. Передняя
      // (внешняя) кромка светлая, внутри — панель и янтарная полоса.
      for (const s of [-1, 1]) {
        const wx = s < 0 ? R.rx - 5 : R.rx + R.rw + 5;
        const wy = R.ry + 15;
        ctx.fillStyle = STEEL_D;
        poly(ctx, [wx - s * 2, wy - 2, wx + s * 5, wy - 2, wx + s * 5, wy + 24, wx - s * 2, wy + 24]);
        ctx.fill();
        ctx.fillStyle = STEEL;
        poly(ctx, [wx, wy, wx + s * 19, wy + 3, wx + s * 15, wy + 25, wx, wy + 20]);
        ctx.fill();
        ctx.strokeStyle = '#3b4047'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        poly(ctx, [wx, wy, wx + s * 19, wy + 3, wx + s * 17.5, wy + 5.5, wx, wy + 2.5]);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        poly(ctx, [wx + s * 15, wy + 25, wx, wy + 20, wx, wy + 15, wx + s * 13, wy + 22]);
        ctx.fill();
        ctx.fillStyle = AMBER;
        ctx.fillRect(wx + s * 7, wy + 15, 6, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(wx + s * 7, wy + 15, 6, 0.8);
      }
      // Купол-кабина: стекло «Рубежа» с ободком, бликом и пилотом —
      // дом управляется вручную, а не автопилотом.
      const bx = R.rx + R.rw * 0.33, by = R.ry + 14;
      ctx.fillStyle = '#5c554a'; rr(ctx, bx - 12, by - 7, 24, 16, 7); ctx.fill();
      ctx.fillStyle = '#7df3e2'; rr(ctx, bx - 10, by - 5, 20, 12, 6); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(bx - 10, by - 5, 20, 2.4);
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(bx + 4, by - 5, 6, 12);
      ctx.fillStyle = 'rgba(20,30,34,0.55)';
      ctx.beginPath(); ctx.arc(bx + 1, by + 2, 3, 0, Math.PI * 2); ctx.fill();
      // Маячок на мачте вместо трубы: дом не курит, он летает.
      const mx = R.rx + 7, my = R.ry + 3;
      ctx.strokeStyle = '#5c554a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, my - 11); ctx.stroke();
      ctx.fillStyle = (Math.sin(t * 3 + bid) > 0.4) ? AMBER : '#6b6152';
      ctx.beginPath(); ctx.arc(mx, my - 12.5, 1.9, 0, Math.PI * 2); ctx.fill();
      // Грузовой отсек со складом граней (режим вылазки): открытая ниша с
      // приоткрытой дверцей и стеком кристаллов — ресурс виден снаружи,
      // это закрывает жалобу #28 о невидимой добыче.
      const gx = R.rx + R.rw - 32, gy = R.ry + 26;
      ctx.fillStyle = '#221f1a'; rr(ctx, gx, gy, 26, 22, 3); ctx.fill();
      ctx.strokeStyle = '#6e6759'; ctx.lineWidth = 1.4;
      ctx.strokeRect(gx + 0.5, gy + 0.5, 25, 21);
      // Приоткрытая дверца отсека — светлая плита у верхней кромки.
      ctx.fillStyle = '#8d8272'; ctx.fillRect(gx + 2, gy - 2.5, 22, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(gx + 2, gy - 2.5, 22, 1);
      // Стек граней 2×2.
      for (let i = 0; i < 4; i++) {
        const sx = gx + 6 + (i % 2) * 9, sy = gy + 15 - Math.floor(i / 2) * 7;
        const sk = 0.82 + 0.18 * Math.sin(t * 2.6 + i + bid);
        ctx.fillStyle = 'rgba(126,217,231,0.22)';
        ctx.beginPath(); ctx.arc(sx, sy - 2, 5 * sk, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#7ed9e7';
        poly(ctx, [sx - 3.8, sy, sx + 3.8, sy, sx, sy - 9.5 * sk]);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillRect(sx - 1.1, sy - 7, 1.5, 3.2);
      }
      // Тёплые окна и дверь на фасаде: «Дом» остаётся домом.
      winRow(ctx, R.fx + 5, R.fy + 2, 2, 8, 5, 5, '#ffd489', '#3a332a', bid);
      ctx.fillStyle = '#3f3a33'; ctx.fillRect(R.fx + R.fw - 13, R.fy + 1, 9, R.fh - 3);
      ctx.fillStyle = '#ffd489'; ctx.fillRect(R.fx + R.fw - 11, R.fy + 3, 2, 2);
    } else if (b.type === 'barracks') {
      // Казарма 3×2: длинный корпус, ворота с шевроном, флаг, прожектор.
      bshadow(ctx, px, py, w, h);
      hoverPad(ctx, cx, py + h - 2, w * 0.5, 6, COLORS.playerBright, t, bid);
      const R = hull(ctx, px + 3, py + 6, w - 6, h - 6, 11, FOUND, FACE, FACED, ROOF);
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 4, 2, '#7c848d');
      rim(ctx, R.rx, R.ry, R.rw, 2);
      // Вентблоки на крыше.
      for (let i = 0; i < 2; i++) {
        const vx = R.rx + 12 + i * 34;
        ctx.fillStyle = STEEL; ctx.fillRect(vx, R.ry + 6, 16, 10);
        ctx.fillStyle = STEEL_L; ctx.fillRect(vx, R.ry + 6, 16, 3);
        ctx.fillStyle = FACED;
        for (let s = 0; s < 3; s++) ctx.fillRect(vx + 2 + s * 5, R.ry + 11, 3, 3);
      }
      // Флаг на мачте: полотнище трепещет.
      const flagX = R.rx + R.rw - 10, flagBase = R.ry + 10;
      ctx.strokeStyle = '#3a3f46'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(flagX, flagBase); ctx.lineTo(flagX, flagBase - 24); ctx.stroke();
      ctx.fillStyle = '#2e7d8c';
      const wv = Math.sin(t * 6) * 2;
      poly(ctx, [flagX, flagBase - 24, flagX + 16, flagBase - 22 + wv, flagX, flagBase - 16]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(flagX, flagBase - 24); ctx.lineTo(flagX + 16, flagBase - 22 + wv); ctx.stroke();
      // Ворота с шевроном + окна.
      ctx.fillStyle = '#14171b'; ctx.fillRect(cx - 11, R.fy, 22, R.fh - 1);
      ctx.fillStyle = 'rgba(125,243,226,0.5)';
      ctx.fillRect(cx - 11, R.fy + R.fh - 9, 22, 2);
      hazard(ctx, cx - 13, R.fy + R.fh - 5, 26, 5);
      ctx.strokeStyle = ORANGE; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 6, R.fy + 4); ctx.lineTo(cx, R.fy + 1); ctx.lineTo(cx + 6, R.fy + 4); ctx.stroke();
      winRow(ctx, R.fx + 5, R.fy + 2, 2, 7, 4, 4, WIN, '#23383c', bid);
      winRow(ctx, R.fx + R.fw - 5 - 2 * 11, R.fy + 2, 2, 7, 4, 4, WIN, '#23383c', bid + 1);
      // Прожекторная мачта у угла.
      ctx.strokeStyle = '#3a3f46'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(R.rx + 4, R.fy + R.fh); ctx.lineTo(R.rx + 4, R.fy - 14); ctx.stroke();
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath(); ctx.arc(R.rx + 4, R.fy - 15, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,243,196,0.18)';
      poly(ctx, [R.rx + 4, R.fy - 15, R.rx - 12, R.fy + 12, R.rx + 18, R.fy + 12]); ctx.fill();
    } else if (b.type === 'turret') {
      // «Гадюка» 1×1: бетонный шестигранник + спаренная пушка-клыки.
      const bx = cx, by = cy + 3;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(bx + 3, by + 9, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      // Основание-шестигранник.
      ctx.fillStyle = STEEL;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        const vx = bx + Math.cos(a) * 13, vy = by + Math.sin(a) * 13;
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2b2e33'; ctx.lineWidth = 2; ctx.stroke();
      // Кромка света по верхней грани + teal-огонь по основанию.
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(bx - 11, by - 12, 22, 1.5);
      ctx.save();
      ctx.shadowColor = WIN; ctx.shadowBlur = 6;
      ctx.globalAlpha = 0.5 + 0.3 * pulse;
      ctx.fillStyle = WIN;
      ctx.fillRect(bx - 9, by + 8, 18, 2);
      ctx.restore();
      ctx.fillStyle = '#a7aeb6';
      ctx.beginPath(); ctx.arc(bx, by, 8.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2b2e33'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx, by, 8.5, 0, 0, Math.PI * 2); ctx.stroke();
      // Башня со спаренными стволами — явно пушка.
      ctx.save();
      ctx.translate(bx, by); ctx.rotate(ang);
      const rec = recoil * 3;
      ctx.fillStyle = FACED;
      ctx.fillRect(-4 - rec, -6.5, 21, 4);
      ctx.fillRect(-4 - rec, 2.5, 21, 4);
      ctx.fillStyle = '#22252a';
      ctx.fillRect(14 - rec, -7.5, 4, 6);
      ctx.fillRect(14 - rec, 1.5, 4, 6);
      ctx.fillStyle = STEEL_D;
      ctx.fillRect(-4 - rec, -6.5, 21, 1.2);
      ctx.fillRect(-4 - rec, 2.5, 21, 1.2);
      // Вспышка выстрела.
      if (recoil > 0.75) {
        ctx.fillStyle = 'rgba(255,220,140,' + (0.9 * recoil).toFixed(2) + ')';
        poly(ctx, [19 - rec, 0, 26 - rec, -4, 26 - rec, 4]); ctx.fill();
      }
      ctx.fillStyle = '#596069';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#22252a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, 0, Math.PI * 2); ctx.stroke();
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
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(px, py + 4, w, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(px, py + h - 4, w, 4);
      // Верхний прилив: светлая грань брони — стена читается с дальности.
      ctx.fillStyle = '#c3c9d1';
      ctx.fillRect(px, py + 4, w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(px, py + 4, w, 1.5);
      // Заклёпки двумя рядами и шеврон по центру.
      ctx.fillStyle = '#2b2e33';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.arc(px + 5 + i * 8, py + 10, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 5 + i * 8, py + 22, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = ORANGE; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(cx - 6, py + 26); ctx.lineTo(cx, py + 19); ctx.lineTo(cx + 6, py + 26); ctx.stroke();
      ctx.fillStyle = 'rgba(125,243,226,0.55)';
      ctx.fillRect(cx - 2, py + 27, 4, 2);
      // Угловые столбы — швы между секциями.
      ctx.fillStyle = '#33373d';
      ctx.fillRect(px, py + 4, 3, h - 4);
      ctx.fillRect(px + w - 3, py + 4, 3, h - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(px, py + 4, 1, h - 4);
    } else if (b.type === 'bunker') {
      // Бункер 2×2: приземистый дот, мешки, бойница со стволами гарнизона.
      bshadow(ctx, px, py, w, h, 6, 8);
      hoverPad(ctx, cx, py + h - 2, w * 0.5, 5, COLORS.playerBright, t, bid);
      const R = hull(ctx, px + 3, py + 7, w - 6, h - 7, 12, FOUND, '#6a6f76', '#43484f', '#989fa7');
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 3, 2, '#767c84');
      rim(ctx, R.rx, R.ry, R.rw, 2);
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
      ctx.fillStyle = FACED;
      ctx.beginPath(); ctx.arc(R.rx + R.rw - 10, R.ry + R.rh - 8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#22252a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(R.rx + R.rw - 10, R.ry + R.rh - 8, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#22252a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(R.rx + 8, R.ry + R.rh - 4); ctx.lineTo(R.rx + 8, R.ry + R.rh - 14); ctx.stroke();
      ctx.fillStyle = WIN; ctx.fillRect(R.rx + 8, R.ry + R.rh - 16, 4, 3);
      // Бойница: по стволу на бойца гарнизона.
      ctx.fillStyle = '#14171b';
      ctx.fillRect(R.fx + 4, R.fy + 2, R.fw - 8, 6);
      const n = Math.min(gar, 4);
      for (let i = 0; i < n; i++) {
        const sx = R.fx + 10 + i * ((R.fw - 20) / Math.max(1, n - 1 || 1));
        ctx.fillStyle = '#22252a';
        ctx.fillRect(sx - 1.5, R.fy + 3, 3, 8);
        ctx.fillStyle = '#565c64';
        ctx.fillRect(sx - 1.5, R.fy + 3, 3, 1.5);
      }
      if (!n) {
        ctx.fillStyle = 'rgba(125,243,226,0.5)';
        ctx.fillRect(R.fx + 6, R.fy + 4, R.fw - 12, 2);
      }
    } else if (b.type === 'factory') {
      // Завод 3×3: цех с фонарями, труба с дымом, горн, кран-балка.
      bshadow(ctx, px, py, w, h, 8, 11);
      hoverPad(ctx, cx, py + h - 3, w * 0.52, 7, COLORS.playerBright, t, bid);
      const R = hull(ctx, px + 3, py + 8, w - 6, h - 8, 13, FOUND, FACE, FACED, '#9aa1a9');
      rim(ctx, R.rx, R.ry, R.rw, 2);
      // Световые фонари цеха — три узкие светящиеся полосы в рамах.
      for (let i = 0; i < 3; i++) {
        const sx = R.rx + 12 + i * ((R.rw - 30) / 3);
        ctx.fillStyle = '#2b2e33'; ctx.fillRect(sx, R.ry + 8, 13, R.rh - 40);
        ctx.fillStyle = 'rgba(125,243,226,' + (0.55 + 0.3 * pulse).toFixed(2) + ')';
        ctx.fillRect(sx + 2, R.ry + 10, 9, R.rh - 44);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(sx + 2, R.ry + 10, 9, 1.5);
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
      ctx.fillStyle = '#a7aeb6'; ctx.fillRect(chX, R.ry - 34, 15, 1.5);
      ctx.fillStyle = ORANGE; ctx.fillRect(chX, R.ry - 20, 15, 4);
      ctx.fillStyle = ORANGE; ctx.fillRect(chX, R.ry - 6, 15, 3);
      smoke(ctx, chX + 7, R.ry - 36, t, (bid % 7) * 0.13);
      mast(ctx, chX + 7, R.ry - 34, 7, blink);
      // Горн: оранжевые окна на фасаде + ворота.
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = 'rgba(255,' + (140 + Math.round(60 * pulse)) + ',60,0.9)';
        ctx.fillRect(R.fx + 8 + i * 16, R.fy + 2, 10, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(R.fx + 8 + i * 16, R.fy + 2, 10, 1);
      }
      hazard(ctx, R.fx + R.fw - 30, R.fy + R.fh - 6, 24, 6);
      ctx.fillStyle = 'rgba(243,197,121,0.75)';
      ctx.fillRect(R.fx, R.fy + R.fh - 3, R.fw, 2);
      // Кран-балка над воротами.
      ctx.fillStyle = ORANGE;
      ctx.fillRect(R.fx + 6, R.fy - 6, R.fw - 12, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(R.fx + 6, R.fy - 6, R.fw - 12, 1);
      ctx.strokeStyle = '#2b2e33'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(R.fx + 6, R.fy - 6); ctx.lineTo(R.fx + 6, R.fy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(R.fx + R.fw - 6, R.fy - 6); ctx.lineTo(R.fx + R.fw - 6, R.fy); ctx.stroke();
      const hookX = R.fx + R.fw / 2 + Math.sin(t * 0.7) * 10;
      ctx.beginPath(); ctx.moveTo(hookX, R.fy - 3); ctx.lineTo(hookX, R.fy + 2); ctx.stroke();
      ctx.fillStyle = '#2b2e33'; ctx.fillRect(hookX - 2, R.fy + 2, 4, 4);
    } else if (b.type === 'lab') {
      // Лаборатория 3×3: белый корпус, обсерватория, тарелка, чаны.
      bshadow(ctx, px, py, w, h, 8, 11);
      hoverPad(ctx, cx, py + h - 3, w * 0.52, 7, COLORS.playerBright, t, bid);
      const R = hull(ctx, px + 3, py + 8, w - 6, h - 8, 13, FOUND, '#7d8590', '#4c525a', '#ccd2d9');
      roofPanels(ctx, R.rx, R.ry, R.rw, R.rh, 3, 3, '#a9b0b8');
      rim(ctx, R.rx, R.ry, R.rw, 2, 0.6);
      // Обсерватория: купол со щелью телескопа.
      dome(ctx, R.rx + 22, R.ry + 24, 14, '#274b55', '#3f9aab', '#c2f2ff');
      ctx.save();
      ctx.translate(R.rx + 22, R.ry + 24); ctx.rotate(-0.5 + Math.sin(t * 0.5) * 0.25);
      ctx.fillStyle = '#12333c'; ctx.fillRect(-2, -14, 4, 16);
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(-2, -14, 1.5, 16);
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
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.arc(0, -10, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Чаны со светящейся жижей.
      for (let i = 0; i < 2; i++) {
        const vx = R.rx + 14 + i * 20, vy = R.ry + R.rh - 14;
        ctx.fillStyle = '#9aa1a9'; ctx.fillRect(vx, vy - 14, 14, 16);
        ctx.fillStyle = '#c3c9d1'; ctx.fillRect(vx, vy - 14, 14, 2);
        ctx.fillStyle = 'rgba(126,255,190,' + (0.5 + 0.35 * pulse).toFixed(2) + ')';
        ctx.fillRect(vx + 2, vy - 12, 10, 6);
        ctx.strokeStyle = '#2b2e33'; ctx.lineWidth = 1.5; ctx.strokeRect(vx, vy - 14, 14, 16);
      }
      // Полоса окон и эмблема-атом на фасаде.
      winRow(ctx, R.fx + 6, R.fy + 2, 5, 8, 4, 5, WIN, '#23383c', bid);
      ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(R.fx + R.fw - 12, R.fy + 6, 7, 3, 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(R.fx + R.fw - 12, R.fy + 6, 7, 3, -0.5, 0, Math.PI * 2); ctx.stroke();
    }
  } else {
    // ================= КХАРИД: плоть, хитин, слизь =================
    // Один язык на все 8 зданий: курган плоти с радиальным градиентом
    // (свет сверху-слева), жилы, мембраны-мешки, костяные шипы, глаза-стражи,
    // капли слизи. Ничего прямолинейного — только эллипсы и дуги.
    const FD = '#3d1c26', FM = '#71334a', FL = '#ab6072';
    if (b.type === 'cc') {
      // Гнездо-улей 4×3: великий курган, венец рогов, бьющееся сердце.
      mound(ctx, cx, cy + 4, w * 0.46, h * 0.44, FD, FM, FL);
      veins(ctx, cx, cy + 4, w * 0.42, h * 0.4, 7, bid * 0.7);
      // Венец рогов по верхней дуге: чем дальше от центра, тем длиннее.
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (1.15 + 0.7 * (i / 4));
        const hx = cx + Math.cos(a) * w * 0.33, hy = cy + 4 + Math.sin(a) * h * 0.35;
        spike(ctx, hx, hy, 11, 18 + (i % 2) * 7, '#2c141c', '#d9cfc0');
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
      aeye(ctx, cx - 25, cy - 6, 5);
      aeye(ctx, cx + 25, cy - 6, 5);
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
      // Слизь на рогах — улей «плачет» эргом.
      slime(ctx, cx - w * 0.3, cy - h * 0.3, 2.4, t, bid);
      slime(ctx, cx + w * 0.3, cy - h * 0.28, 2, t, bid + 1);
    } else if (b.type === 'depot') {
      // Нарост-кладовая 2×2 · V-4 «живой склад на ходу», доводка под
      // референс house-kharid.png: сегментированное тело с пульсирующим
      // сердцем, крупные мембранные крылья с жилками, толстые щупальца и
      // светящиеся наросты-грани. Функции те же: медленный ход, шаттл,
      // склад вылазки; зародыши в мембране остаются — это про население.
      // Курган-подошва: то, на чём кладовая стоит, когда стоит.
      mound(ctx, cx, cy + 9, w * 0.4, h * 0.24, FD, FM, FL);
      veins(ctx, cx, cy + 9, w * 0.36, h * 0.2, 5, bid * 0.9);
      // Щупальца-ноги: четыре толстых, в два звена, с когтем-подошвой —
      // тело поднято над землёй, кладовая ходит.
      ctx.lineCap = 'round';
      for (const s of [-1.5, -0.5, 0.5, 1.5]) {
        const a = Math.PI / 2 + s * 0.36;
        const kx = cx + Math.cos(a) * 18, ky = cy + 8;
        const sx = cx + Math.cos(a) * 12, sy = cy - 5 + Math.sin(a) * 12;
        const ex = cx + Math.cos(a) * 25, ey = cy + 19 + Math.abs(s) * 1.5;
        ctx.strokeStyle = '#2a1113'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(217,207,192,0.4)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(sx + 1.4, sy); ctx.lineTo(kx + 1.4, ky); ctx.stroke();
        ctx.fillStyle = '#d9cfc0';            // коготь-подошва
        ctx.beginPath(); ctx.arc(ex, ey, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(45,20,30,0.6)'; // складка в колене
        ctx.beginPath(); ctx.arc(kx, ky, 3.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.lineCap = 'butt';
      // Крылья-мембраны за спиной: крупные, с тремя жилками, взмах на t —
      // полётная конфигурация шаттла.
      for (const s of [-1, 1]) {
        const wx = cx + s * 12, wy = cy - 18;
        const flap = Math.sin(t * 1.6 + s + bid) * 2.5;
        ctx.fillStyle = 'rgba(201,154,255,0.28)';
        ctx.beginPath(); ctx.ellipse(wx + s * 14, wy + flap, 18, 10, s * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(217,207,192,0.8)'; ctx.lineWidth = 1.3;
        for (const k of [-4, 1, 6]) {
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.lineTo(wx + s * 28, wy + k + flap);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(45,20,30,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + s * 14, wy + flap); ctx.stroke();
      }
      // Рога: костяные шипы по верху — склад читается чужим и живым.
      spike(ctx, cx - 9, cy - 19, 8, 15, '#d9cfc0', '#8d7f6a');
      spike(ctx, cx + 9, cy - 19, 8, 15, '#d9cfc0', '#8d7f6a');
      // Главный мешок: полупрозрачная мембрана, внутри зёрна-зародыши.
      const mx = cx - 2, my = cy - 5, mr = 15 * breathe;
      ctx.fillStyle = 'rgba(214,120,140,0.85)';
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
      // Хитин-складки: тело сегментировано, а не гладкий шар.
      ctx.strokeStyle = 'rgba(45,20,30,0.45)'; ctx.lineWidth = 1.8;
      for (let f = 0; f < 3; f++) {
        ctx.beginPath();
        ctx.ellipse(mx, my - mr * 0.45 + f * mr * 0.45, mr * 0.92, mr * 0.3, 0, Math.PI * 1.08, Math.PI * 1.92);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,200,210,0.5)';
      ctx.beginPath(); ctx.arc(mx, my, mr * 0.7, 0, Math.PI * 2); ctx.fill();
      // Сердце кладовой: пульс тем же красным, что у всех кхарид.
      const hb = 0.6 + 0.4 * Math.sin(t * 2.6 + bid);
      ctx.fillStyle = 'rgba(196,58,84,' + (0.55 + 0.35 * hb).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(mx, my + 1, 4.4 + hb * 1.4, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4 + bid;
        ctx.fillStyle = '#7d2030';
        ctx.beginPath(); ctx.arc(mx + Math.cos(a) * mr * 0.42, my + Math.sin(a) * mr * 0.42, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(mx - mr * 0.3, my - mr * 0.4, mr * 0.3, mr * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
      // Наросты-грани: склад вылазки — ресурс видно снаружи, крупнее и
      // с заметным свечением.
      for (const [ox, oy, orr] of [[-18, 4, 6], [17, 10, 5], [-14, 16, 4.2]]) {
        const k = 0.72 + 0.28 * Math.sin(t * 2.4 + ox);
        const pxr = cx + ox, pyr = my + oy;
        ctx.fillStyle = 'rgba(168,255,158,' + (0.3 * k).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(pxr, pyr, orr * 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a8ff9e';
        poly(ctx, [pxr - orr, pyr + orr * 0.5, pxr + orr, pyr + orr * 0.4, pxr + orr * 0.2, pyr - orr]);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(pxr - orr * 0.3, pyr - orr * 0.3, 1.3, 0, Math.PI * 2); ctx.fill();
      }
      // Два малых мешочка и пуповина.
      for (const [ox, oy, or_] of [[16, -8, 6], [14, 12, 4.5]]) {
        ctx.fillStyle = 'rgba(214,120,140,0.9)';
        ctx.beginPath(); ctx.arc(cx + ox, cy + oy, or_ * breathe, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,220,225,0.6)';
        ctx.beginPath(); ctx.arc(cx + ox - 1.5, cy + oy - 1.5, or_ * 0.32, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = '#d68a9a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx + 8, my - 4); ctx.quadraticCurveTo(cx + 10, cy - 8, cx + 16, cy - 8); ctx.stroke();
      slime(ctx, cx + 18, cy + 14, 2, t, bid + 2);
    } else if (b.type === 'barracks') {
      // Инкубатор 3×2 · V-4: компактное «стоячее» гнездо (а не широкая
      // низкая яма — это силуэт фабрики), три яйца, кольцо зубов.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(cx + 4, cy + 12, w * 0.40, h * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      mound(ctx, cx, cy + 2, w * 0.38, h * 0.46, FD, FM, FL);
      veins(ctx, cx, cy + 2, w * 0.34, h * 0.42, 6, bid * 0.5);
      // Яма выводка.
      ctx.fillStyle = '#200d14';
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.26, h * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = '#a8ff9e'; ctx.shadowBlur = 8;
      ctx.strokeStyle = '#3f7a4a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.26, h * 0.28, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // Мембранная бахрома по краю ямы.
      ctx.strokeStyle = 'rgba(217,207,192,0.35)'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (0.1 + 0.8 * (i / 6));
        const ex = cx + Math.cos(a) * w * 0.26, ey = cy + 3 + Math.sin(a) * h * 0.28;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(a) * 5 + Math.sin(t * 2 + i) * 1.5, ey + Math.sin(a) * 4 + 2);
        ctx.stroke();
      }
      // Зубы венца вокруг ямы.
      teethRing(ctx, cx, cy + 3, w * 0.26 + 3, 6, -Math.PI / 2, Math.PI, 9, '#d9cfc0');
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
      veins(ctx, cx, cy + 2, 12, 10, 5, bid * 0.6);
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
      // Слизь на жерлах.
      slime(ctx, cx - 12, cy + 12, 1.8, t, bid);
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
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(px, cy - 1.5, w, 1);
      for (let i = 0; i < 4; i++) spike(ctx, px + 5 + i * 8, py + 6, 4, 5, '#2c141c', '#d9cfc0');
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px, py + h - 4, w, 4);
    } else if (b.type === 'bunker') {
      // Кокон 2×2 · V-4: СТОЯЧИЙ кокон вместо шара — свой силуэт «стоячее
      // яйцо», чтобы семейство кхарид не читалось четырьмя одинаковыми
      // каплями (КЦ — шар с шипами, фабрика — низкая яма, лаб — башня,
      // бункер — стоячий кокон).
      // Ножка: кокон поднят над землёй и слегка качается.
      const sway = Math.sin(t * 1.3 + bid) * 0.03;
      ctx.save();
      ctx.translate(cx, cy + 6);
      ctx.rotate(sway);
      ctx.translate(-cx, -(cy + 6));
      ctx.strokeStyle = '#3b1a26'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(cx - 7, cy + 14); ctx.lineTo(cx - 4, cy + 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 7, cy + 14); ctx.lineTo(cx + 4, cy + 22); ctx.stroke();
      // Тело кокона: вертикальный овал (выше, чем шире).
      ctx.fillStyle = '#4a2030';
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 17, 21 * breathe, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7d3a52';
      ctx.beginPath(); ctx.ellipse(cx - 1, cy, 14, 18 * breathe, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b96a80';
      ctx.beginPath(); ctx.ellipse(cx - 3, cy - 4, 8, 10 * breathe, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,235,240,0.3)';
      ctx.beginPath(); ctx.ellipse(cx - 5, cy - 8, 4.5, 6, -0.4, 0, Math.PI * 2); ctx.fill();
      // Плетение: волокна поперёк кокона.
      ctx.strokeStyle = 'rgba(217,207,192,0.5)'; ctx.lineWidth = 1.6;
      for (let k = 0; k < 4; k++) {
        const yy = cy - 10 + k * 7;
        ctx.beginPath();
        ctx.ellipse(cx, yy, 15 - Math.abs(k - 1.5) * 2, 3.5, 0, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }
      veins(ctx, cx, cy + 2, 13, 17, 5, bid * 0.8, 'rgba(30,8,18,0.4)');
      // Щель выводка — ВЕРТИКАЛЬНАЯ (как у стоячего кокона), по глазу на
      // каждого сидящего внутри.
      ctx.fillStyle = '#1c0d12';
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 5.5, 13, 0, 0, Math.PI * 2); ctx.fill();
      const n = Math.min(gar, 4);
      for (let i = 0; i < n; i++) {
        aeye(ctx, cx, cy - 7 + i * 5.5, 3);
      }
      if (!n) {
        ctx.fillStyle = 'rgba(168,255,158,0.4)';
        ctx.beginPath(); ctx.ellipse(cx, cy + 2, 2.5, 9, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      // Капля слизи у основания.
      slime(ctx, cx + 16, cy + 20, 2.2, t, bid);
    } else if (b.type === 'factory') {
      // Яма выводка 3×3 · V-4: НИЗКАЯ ШИРОКАЯ яма вместо капли — силуэт
      // «разверзтая пасть у самой земли», чтобы отличаться от круглого КЦ,
      // башни-лаба и стоячего бункера.
      // Тело: плоская широкая линза.
      mound(ctx, cx, cy + 6, w * 0.50, h * 0.30, FD, FM, FL);
      veins(ctx, cx, cy + 6, w * 0.46, h * 0.26, 8, bid * 0.4);
      // Губы ямы: приподнятые валики слева и справа.
      ctx.fillStyle = FL;
      ctx.beginPath(); ctx.ellipse(cx - w * 0.34, cy + 6, w * 0.10, h * 0.10, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + w * 0.34, cy + 6, w * 0.10, h * 0.10, 0.3, 0, Math.PI * 2); ctx.fill();
      // Кратер: широкая тёмная пасть.
      ctx.fillStyle = '#1c0d12';
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.34, h * 0.17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = '#a8ff9e'; ctx.shadowBlur = 9;
      ctx.fillStyle = 'rgba(120,220,130,' + (0.5 + 0.35 * pulse).toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.25, h * 0.10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Кладка в топи: ряд яиц по всей ширине пасти.
      for (let i = 0; i < 5; i++) {
        const ex = cx - w * 0.24 + i * (w * 0.12);
        const ey = cy + 4 + (i % 2 ? 2 : 0);
        ctx.fillStyle = '#cfe8b8';
        ctx.beginPath(); ctx.ellipse(ex, ey, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(168,255,158,0.6)';
        ctx.beginPath(); ctx.ellipse(ex, ey + 1, 2, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      }
      // Зубы: два ряда на губах пасти (сверху вниз и снизу вверх), яйца —
      // между ними.
      ctx.fillStyle = '#d9cfc0';
      for (let i = 0; i < 7; i++) {
        const tx = cx - w * 0.30 + i * (w * 0.10);
        poly(ctx, [tx - 2.4, cy - 10, tx + 2.4, cy - 10, tx, cy - 3]); ctx.fill();
        poly(ctx, [tx - 2.4, cy + 17, tx + 2.4, cy + 17, tx, cy + 10]); ctx.fill();
      }
      // Щупальца у краёв ямы.
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
      slime(ctx, cx - w * 0.36, cy + h * 0.30, 2.4, t, bid + 3);
    } else if (b.type === 'lab') {
      // Узел эволюции 3×3 · V-4: БАШНЯ — узкий пьедестал + высокий витой
      // шпиль, чтобы силуэт читался «высокая башня», а не «ещё одна капля»
      // рядом с круглым КЦ, низкой фабрикой и стоячим бункером.
      // Пьедестал: маленький вертикальный узел, башня доминирует.
      mound(ctx, cx, cy + 8, w * 0.26, h * 0.30, FD, FM, FL);
      veins(ctx, cx, cy + 8, w * 0.22, h * 0.26, 5, bid * 0.3);
      // Шпиль: сужающиеся сегменты — выше и уже прежнего, но влезает в
      // футпринт 3×3 (TILE=30): при segs=7/segH=13 шпиль вылезал на 31
      // единицу над клеткой и срезался камерой у верхней кромки карты.
      const segs = 6, baseW = 26, segH = 12;
      let tipX = cx, tipY = cy;
      for (let i = 0; i < segs; i++) {
        const sw = baseW * (1 - i / (segs + 0.5));
        const sy = cy + 18 - i * segH;
        const lean = Math.sin(i * 1.2) * 2;
        const g = ctx.createLinearGradient(cx - sw / 2, 0, cx + sw / 2, 0);
        g.addColorStop(0, '#c07a8c'); g.addColorStop(0.45, FM); g.addColorStop(1, FD);
        ctx.fillStyle = g;
        poly(ctx, [cx - sw / 2 + lean, sy, cx + sw / 2 + lean, sy, cx + sw * 0.32 + lean + 2, sy - segH, cx - sw * 0.32 + lean + 2, sy - segH]);
        ctx.fill();   // было: без fill() весь шпиль был невидим — видны
        //             только штрихи кромок, и лаб читался «летящими чёрточками»
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
        ctx.fill();   // было: без fill() осколки не рисовались — только блик
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
      slime(ctx, cx + w * 0.38, cy + h * 0.36, 2.2, t, bid + 5);
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
  }

  // Э5: визуальная эволюция уровня (фазы сталь → золото → графит → неон →
  // призма) — по одному взгляду видно, насколько здание прокачано.
  if (!ghost && b.done !== false && (b.level || 1) > 1) {
    drawGradeTrim(ctx, b, px, py, w, h, performance.now() * 0.001);
  }
  // Э7: вымпел командира над КЦ (уровень ставит движок: b.commanderLevel).
  if (!ghost && b.type === 'cc' && b.commanderLevel) {
    drawCommanderMark(ctx, b, px, py, w, h, b.commanderLevel, performance.now() * 0.001);
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

  // П2: контур выделения + полоска HP у выделенного (целого тоже —
  // иначе клик по зданию не даёт обратной связи). Свои — бирюза Рубежа,
  // чужие на осмотре — красный.
  if (b.selected) {
    ctx.strokeStyle = b.side === 'player' ? '#8ff5e2' : '#ff6e5f';
    ctx.lineWidth = 2;
    ctx.strokeRect(px - 3, py - 3, w + 6, h + 6);
    if (b.hp >= b.maxHp && b.done !== false) {
      ctx.fillStyle = 'rgba(8,10,12,0.7)';
      ctx.fillRect(px, py - 11, w, 6);
      ctx.fillStyle = b.side === 'player' ? '#7BE495' : '#ff6e5f';
      ctx.fillRect(px + 1, py - 10, w - 2, 4);
    }
  }

  // Пакет E.2: мировые статусы своих настоящих зданий — производство,
  // исследование, гарнизон числом. Только свои достроенные: чужие заказы —
  // разведданные, им в мире не место. У превью/фейков нет id — молчим.
  // С3/П7: исключение — лаборатория врага показывает закрытые tech (тоже
  // только достроенная настоящая; прогресс текущих скрыт).
  if (!ghost && b.done !== false && typeof b.id === 'number' &&
      (b.side === 'player' || (b.side === 'enemy' && b.cfg && b.cfg.research))) {
    drawStatusBadges(ctx, b, px, py, w, st);
  }

  // Красная вспышка попадания.
  if (b.flashT > 0 && !ghost) {
    ctx.globalAlpha = Math.min(1, b.flashT * 6) * 0.45;
    ctx.fillStyle = '#ff5a4e';
    rr(ctx, px + 5, py + 4, w - 10, h - 10, 8); ctx.fill();
  }
  ctx.restore();
}

