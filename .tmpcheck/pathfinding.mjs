// ============================================================
// pathfinding.js — поиск пути A* по тайловой сетке 64×64.
// 8 направлений, без «среза углов» по диагонали; при полном
// исчерпании бюджета возвращается частичный путь (юнит идёт
// максимально близко к цели). Плюс сглаживание по видимости.
// ============================================================
import { TILE, MAP_W, MAP_H } from './config.js';

const SQRT2 = Math.SQRT2;
// Смещения соседей: [dx, dy, стоимость шага].
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

// Минимальная двоичная куча по значению f.
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(i, f) {
    const a = this.a;
    a.push({ i, f });
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (a[p].f <= a[n].f) break;
      [a[p], a[n]] = [a[n], a[p]];
      n = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return -1;
    const top = a[0].i;
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1, r = l + 1;
        let m = n;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n], a[m]];
        n = m;
      }
    }
    return top;
  }
}

// Восьмиугольная эвристика (допустимая для 8 направлений).
function octile(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  return Math.max(ax, ay) + 0.41421356 * Math.min(ax, ay);
}

// ------------------------------------------------------------
// Основной A*. goalTest(x,y) — достигли ли клетки; heur(x,y) —
// нижняя оценка расстояния до цели. Возвращает путь тайлами
// (без стартовой клетки) или [].
// ------------------------------------------------------------
export function findPath(map, sx, sy, goalTest, heur, maxExpand = 8000) {
  sx = Math.max(0, Math.min(MAP_W - 1, sx));
  sy = Math.max(0, Math.min(MAP_H - 1, sy));
  const N = MAP_W * MAP_H;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new MinHeap();

  const si = sy * MAP_W + sx;
  g[si] = 0;
  open.push(si, heur(sx, sy));
  if (goalTest(sx, sy)) return [];

  let best = si, bestH = heur(sx, sy), expanded = 0, found = false;

  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;

    if (goalTest(cx, cy)) { best = cur; found = true; break; }
    const h = heur(cx, cy);
    if (h < bestH) { bestH = h; best = cur; } // запоминаем самый близкий узел
    if (++expanded > maxExpand) break;

    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (closed[ni] || map.blockedAt(nx, ny)) continue;
      // Диагональ запрещена, если срезает угол между двумя стенами.
      if (dx && dy && (map.blockedAt(cx + dx, cy) || map.blockedAt(cx, cy + dy))) continue;
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ni, ng + heur(nx, ny));
      }
    }
  }

  if (best === si && !found) return [];
  // Восстановление пути от цели к старту.
  const pts = [];
  let c = best;
  while (c !== -1 && c !== si) { pts.push({ x: c % MAP_W, y: (c / MAP_W) | 0 }); c = came[c]; }
  pts.reverse();
  return pts;
}

// Линия видимости по тайлам (алгоритм Брезенхэма).
export function hasLos(map, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (map.blockedAt(x0, y0)) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

// Сглаживание: выбрасываем промежуточные точки, если конец виден напрямую.
export function smoothPath(map, pts) {
  if (pts.length <= 2) return pts;
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    for (; j > i + 1; j--) if (hasLos(map, pts[i].x, pts[i].y, pts[j].x, pts[j].y)) break;
    out.push(pts[j]);
    i = j; // j всегда > i, либо j === i + 1 — цикл гарантированно завершается
  }
  return out;
}

function toWorldPts(tilePts) {
  return tilePts.map((p) => ({ x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE }));
}

// ------------------------------------------------------------
// Путь к прямоугольнику (здание/кристалл): цель — любая свободная
// клетка, соседняя с прямоугольником. rect в тайлах {x,y,w,h}.
// Возвращает мировой путь или [] если юнит уже рядом.
// ------------------------------------------------------------
export function pathToRect(map, sx, sy, rect) {
  const adj = [];
  for (let y = rect.y - 1; y <= rect.y + rect.h; y++)
    for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      if (inside || !map.inBounds(x, y) || map.blockedAt(x, y)) continue;
      adj.push(y * MAP_W + x);
    }
  if (!adj.length) return null; // прямоугольник полностью заперт
  const adjSet = new Set(adj);
  const ex0 = rect.x - 1, ey0 = rect.y - 1, ex1 = rect.x + rect.w, ey1 = rect.y + rect.h;
  const heur = (x, y) => {
    const dx = Math.max(ex0 - x, 0, x - ex1);
    const dy = Math.max(ey0 - y, 0, y - ey1);
    return octile(dx, dy);
  };
  const tiles = findPath(map, sx, sy, (x, y) => adjSet.has(y * MAP_W + x), heur);
  return toWorldPts(smoothPath(map, tiles));
}

// Путь к точке мира. Если клетка цели занята — идём на соседнюю.
// Если занята и вся соседняя зона (цель внутри контура здания или в
// кристаллах) — расширяем спираль: путь к ближайшей открытой клетке.
// Так приказ «идти/атаковать» никогда не умирает на запертой точке —
// раньше юнит в этом случае просто замирал (followPath(null) = «пришёл»).
export function pathToPoint(map, sx, sy, wx, wy) {
  const tx = Math.max(0, Math.min(MAP_W - 1, (wx / TILE) | 0));
  const ty = Math.max(0, Math.min(MAP_H - 1, (wy / TILE) | 0));
  if (!map.blockedAt(tx, ty)) {
    const tiles = findPath(map, sx, sy, (x, y) => x === tx && y === ty,
      (x, y) => octile(tx - x, ty - y));
    return toWorldPts(smoothPath(map, tiles));
  }
  // Спираль от цели наружу: ближайшая открытая клетка к (tx, ty).
  for (let r = 1; r <= 8; r++) {
    let best = null, bd = Infinity;
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!map.inBounds(x, y) || map.blockedAt(x, y)) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (d < bd) { bd = d; best = { x, y }; }
      }
    }
    if (best) {
      const tiles = findPath(map, sx, sy, (x, y) => x === best.x && y === best.y,
        (x, y) => octile(best.x - x, best.y - y));
      if (tiles.length) return toWorldPts(smoothPath(map, tiles));
    }
  }
  return pathToRect(map, sx, sy, { x: tx, y: ty, w: 1, h: 1 });
}

// Расстояние от точки (px) до прямоугольника (px).
export function distToRectPx(px, py, rx, ry, rw, rh) {
  const dx = Math.max(rx - px, 0, px - (rx + rw));
  const dy = Math.max(ry - py, 0, py - (ry + rh));
  return Math.hypot(dx, dy);
}

// Ближайшая свободная клетка вокруг прямоугольника (спавн юнитов,
// выселение со стройплощадки). Возвращает {x,y} в тайлах или null.
export function nearestFreeTileAround(map, tx, ty, w, h) {
  for (let r = 1; r <= 8; r++) {
    for (let y = ty - r; y <= ty + h - 1 + r; y++) {
      for (let x = tx - r; x <= tx + w - 1 + r; x++) {
        const onEdge = x === tx - r || x === tx + w - 1 + r || y === ty - r || y === ty + h - 1 + r;
        if (!onEdge) continue;
        if (map.inBounds(x, y) && !map.blockedAt(x, y)) return { x, y };
      }
    }
  }
  return null;
}
