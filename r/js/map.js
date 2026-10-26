// ============================================================
// map.js — тайловая карта переменного размера (48–96, дефолт 64): рельеф,
// кэш статичной отрисовки (offscreen canvas) и мини-карта.
// Карта генерируется детерминированно по seed и пресету миссии
// (позиции баз, озёра, число скал, богатство минералов) и всегда
// симметрична относительно центра — честно для обеих сторон.
// ============================================================
import { TILE, MAP_W, MAP_H, BIOMES } from './config.js?v=10262518';

export const T_GROUND = 0;
export const T_WATER = 1;
export const T_ROCK = 2;

// Детерминированный ГПСЧ mulberry32 — одинаковый seed даёт одинаковую карту.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// hex-цвет + альфа → строка rgba (для градиентов террейна).
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

// Озёра по умолчанию: зеркальные пары эллипсов [cx, cy, rx, ry].
const DEFAULT_LAKES = [
  [21, 21, 4.8, 3.6], [42, 42, 4.8, 3.6],
  [45, 20, 2.4, 1.8], [18, 43, 2.4, 1.8],
];
// Нейтральные минеральные поля по умолчанию (каждое зеркалится).
const DEFAULT_NEUTRAL = [[14, 13], [49, 50], [46, 19], [17, 44]];

// Стартовые смещения рабочих вокруг командного центра (в тайлах).
export const CC_WORKER_OFFS = [[0, 4], [2, 4], [4, 4], [1, 5]];

export class GameMap {
  // preset: { seed, lakes:'default'|[[cx,cy,rx,ry]...], rocks,
  //           rich, base:{x,y} — cc игрока; враг зеркалится,
  //           w,h — размер в тайлах (32–96, дефолт 64) }
  // C/П7: размер — свойство экземпляра; миссия без w/h играет как раньше.
  constructor(seed, preset = {}) {
    this.seed = seed >>> 0;
    this.preset = preset;
    const clampSize = (v, d) => Math.max(32, Math.min(96, Math.round(v) || d)); // G.5: 3:2 от 48/64 дают 32/42
    this.w = clampSize(preset.w, MAP_W);
    this.h = clampSize(preset.h, MAP_H);
    this.pxW = this.w * TILE; this.pxH = this.h * TILE; // размер мира, px
    const n = this.w * this.h;
    this.terrain = new Uint8Array(n);      // T_GROUND / T_WATER / T_ROCK
    this.mineralGrid = new Uint8Array(n);  // 1 — на тайле стоит кристалл
    this.buildingGrid = new Uint8Array(n); // 1 — тайл занят зданием
    this.crystals = [];                    // кластеры минералов
    this.computeBases();
    this.generate();
    this.buildTerrainCanvas();
    this.buildMiniCanvas();
  }

  // Центральная симметрия: враг зеркален игроку.
  mirror(x, y) { return [this.w - 1 - x, this.h - 1 - y]; }

  // G.5: футпринт КЦ 4×3 + центр базы (цель путей) + тайлы стартовых
  // рабочих (обе базы) — кристаллам тут не место.
  inStartFootprint(x, y) {
    for (const side of ['player', 'enemy']) {
      const cc = this.bases[side].cc;
      if (x >= cc.x && x < cc.x + 4 && y >= cc.y && y < cc.y + 3) return true;
      if (x === this.bases[side].center.x && y === this.bases[side].center.y) return true;
      for (const [dx, dy] of CC_WORKER_OFFS) {
        if (x === cc.x + dx && y === cc.y + dy) return true;
      }
    }
    return false;
  }

  computeBases() {
    const p = this.preset.base || { x: 8, y: this.h - 16 }; // G.5: дефолт в bounds и на малых картах (64→48 как раньше)
    const cc = { x: p.x, y: p.y };
    const zone = {
      x0: Math.max(1, cc.x - 3), y0: Math.max(1, cc.y - 3),
      x1: Math.min(this.w - 2, cc.x + 8), y1: Math.min(this.h - 2, cc.y + 8),
    };
    const [ex, ey] = this.mirror(cc.x, cc.y);
    this.bases = {
      player: { cc, zone, center: { x: cc.x + 2, y: cc.y + 2 } },
      enemy:  { cc: { x: ex, y: ey }, zone: null, center: { x: ex - 2, y: ey - 2 } },
    };
    this.bases.enemy.zone = {
      x0: Math.max(1, ex - 8), y0: Math.max(1, ey - 8),
      x1: Math.min(this.w - 2, ex + 3), y1: Math.min(this.h - 2, ey + 3),
    };
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  // Проходим ли тайл для пути (рельеф + кристаллы + здания).
  blockedAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    const i = this.idx(tx, ty);
    return this.terrain[i] !== T_GROUND || this.mineralGrid[i] !== 0 || this.buildingGrid[i] !== 0;
  }

  markBuilding(b) {
    for (let y = b.ty; y < b.ty + b.h; y++)
      for (let x = b.tx; x < b.tx + b.w; x++)
        if (this.inBounds(x, y)) this.buildingGrid[this.idx(x, y)] = 1;
  }

  unmarkBuilding(b) {
    for (let y = b.ty; y < b.ty + b.h; y++)
      for (let x = b.tx; x < b.tx + b.w; x++)
        if (this.inBounds(x, y)) this.buildingGrid[this.idx(x, y)] = 0;
  }

  addCrystal(tx, ty, amount, fieldId = 0) {
    if (!this.inBounds(tx, ty) || this.mineralGrid[this.idx(tx, ty)]) return;
    this.terrain[this.idx(tx, ty)] = T_GROUND; // под кристаллом всегда земля
    this.mineralGrid[this.idx(tx, ty)] = 1;
    this.crystals.push({
      kind: 'mineral', tx, ty, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE,
      amount, max: amount, dead: false, fieldId, // F.1: месторождение-группа
    });
  }

  removeCrystal(c) {
    this.mineralGrid[this.idx(c.tx, c.ty)] = 0;
    c.dead = true;
    const i = this.crystals.indexOf(c);
    if (i >= 0) this.crystals.splice(i, 1);
  }

  // ----------------------------------------------------------
  // Генерация рельефа. Порядок важен: вода → очистка
  // стартовых зон → минералы → скалы → гарантия связности.
  // ----------------------------------------------------------
  generate() {
    const R = mulberry32(this.seed ^ 0x9E3779B9);
    const T = this.terrain;
    const set = (x, y, t) => { if (this.inBounds(x, y)) T[this.idx(x, y)] = t; };
    const get = (x, y) => (this.inBounds(x, y) ? T[this.idx(x, y)] : T_ROCK);

    // G.6: жёсткая скальная рамка по периметру убрана (жалоба владельца:
    // «не даёт довести войска до края») — земля идёт до самого края карты,
    // юниты доезжают до любой границы. Безопасность выхода за мир держит
    // get(): вне границ он возвращает T_ROCK, пути наружу не строятся.

    // 2) Озёра — каждая из списка рисуется парой с зеркалом.
    // Дефолтные озёра/нейтралы заданы для 64×64 — масштабируем под размер.
    // Явные lakes/neutral в пресете — как есть (ручная работа пакета C).
    const kx = this.w / MAP_W, ky = this.h / MAP_H;
    const lakes = Array.isArray(this.preset.lakes) ? this.preset.lakes
      : DEFAULT_LAKES.map(([cx, cy, rx, ry]) => [cx * kx, cy * ky, rx * kx, ry * ky]);
    const ellipse = (cx, cy, rx, ry) => {
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y, T_WATER);
    };
    for (const [cx, cy, rx, ry] of lakes) {
      ellipse(cx, cy, rx, ry);
      const [mx, my] = this.mirror(cx, cy);
      ellipse(mx, my, rx, ry);
    }

    // 3) Плоские стартовые зоны.
    const clearZone = (z) => {
      for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) set(x, y, T_GROUND);
    };
    clearZone(this.bases.player.zone); clearZone(this.bases.enemy.zone);

    // 4) Минеральные поля: основное у базы + нейтральные расширения.
    const rich = this.preset.rich || 1;
    const mainOff = [[-2, -1], [-1, -1], [0, -1], [1, -1], [-2, 0], [1, 0], [-2, 1], [1, 1]];
    const neutralOff = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [0, 1]];
    const field = (cx, cy, offs, amount) => {
      // F.1: каждый штамп — одно месторождение (полнота по построению).
      const fid = (this._fieldSeq = (this._fieldSeq || 0) + 1);
      for (const [dx, dy] of offs) {
        // G.5: на малых/узких картах масштабированные нейтралы могут сесть
        // на футпринт КЦ — такие кристаллы пропускаем (на кампаниях гард
        // не срабатывает никогда: пресеты разведены заранее, A11 зелёный).
        if (this.inStartFootprint(cx + dx, cy + dy)) continue;
        this.addCrystal(cx + dx, cy + dy, Math.round((amount + Math.floor(R() * 300)) * rich), fid);
      }
    };
    // Основное поле — со стороны ближнего края карты от базы игрока.
    const pb = this.bases.player.cc;
    const sx = pb.x < this.w / 2 ? 1 : -1;
    const sy = pb.y < this.h / 2 ? -1 : 1;
    field(pb.x + 2 * sx, pb.y + 7 * sy, mainOff, 1350);
    const [emx, emy] = this.mirror(pb.x + 2 * sx, pb.y + 7 * sy);
    field(emx, emy, mainOff, 1350);
    const neutral = Array.isArray(this.preset.neutral) ? this.preset.neutral
      : DEFAULT_NEUTRAL.map(([cx, cy]) => [Math.round(cx * kx), Math.round(cy * ky)]);
    for (const [cx, cy] of neutral) {
      field(cx, cy, neutralOff, 950);
      const [mx, my] = this.mirror(cx, cy);
      field(mx, my, neutralOff, 950);
    }

    // 5) Скальные гряды — случайные блуждания, всегда зеркальной парой.
    const nearBase = (x, y) =>
      Math.hypot(x - this.bases.player.center.x, y - this.bases.player.center.y) < 10 ||
      Math.hypot(x - this.bases.enemy.center.x, y - this.bases.enemy.center.y) < 10;
    const nearCrystal = (x, y) => this.crystals.some(
      (c) => Math.abs(c.tx - x) <= 1 && Math.abs(c.ty - y) <= 1
    );
    const rocks = this.preset.rocks == null ? 7 : this.preset.rocks;
    for (let i = 0; i < rocks; i++) {
      let bx = 6 + Math.floor(R() * (this.w - 12)), by = 6 + Math.floor(R() * (this.h - 12));
      const steps = 8 + Math.floor(R() * 10);
      for (let s = 0; s < steps; s++) {
        const mx = this.w - 1 - bx, my = this.h - 1 - by;
        if (!nearBase(bx, by) && !nearCrystal(bx, by) && get(bx, by) === T_GROUND) set(bx, by, T_ROCK);
        if (!nearBase(mx, my) && !nearCrystal(mx, my) && get(mx, my) === T_GROUND) set(mx, my, T_ROCK);
        bx += Math.floor(R() * 3) - 1; by += Math.floor(R() * 3) - 1;
      }
    }

    // 6) Восстанавливаем стартовые зоны и подходы к кристаллам.
    clearZone(this.bases.player.zone); clearZone(this.bases.enemy.zone);
    for (const c of this.crystals) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]])
        if (get(c.tx + dx, c.ty + dy) === T_ROCK) set(c.tx + dx, c.ty + dy, T_GROUND);
    }

    // 6b) Чистка «карманов»: скальные блуждания иногда строят вогнутые
    // углы и диагональные калитки, в которых вязнет движение (вопрос
    // владельца «может, причина в карте?» — частично да: карта такие
    // ловушки создавать умеет). Правила дешёвые и симметрию не ломают,
    // т.к. применяются к обеим половинам одинаково:
    //  а) земля с 3+ стенами по ортогонали (тупик-карман 1×1) —
    //     вскрываем одну соседнюю СКАЛУ обратно в землю;
    //  б) диагональная калитка: два земляных тайла по диагонали, а оба
    //     ортогональных соседа между ними — скалы (A* без среза углов
    //     там не пройдёт, хотя BFS-4 это одобрял) — вскрываем одну скалу.
    const isRock = (x, y) => this.inBounds(x, y) && get(x, y) === T_ROCK;
    const isGroundFree = (x, y) =>
      this.inBounds(x, y) && get(x, y) === T_GROUND && !this.mineralGrid[this.idx(x, y)];
    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        if (!isGroundFree(x, y)) continue;
        // а) карман-тупик?
        const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .filter(([dx, dy]) => !isGroundFree(x + dx, y + dy)).length;
        if (walls >= 3) {
          const cand = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => isRock(x + dx, y + dy));
          if (cand) {
            set(x + cand[0], y + cand[1], T_GROUND);
            const [mx, my] = this.mirror(x + cand[0], y + cand[1]);
            if (isRock(mx, my)) set(mx, my, T_GROUND);
          }
        }
        // б) диагональная калитка вправо-вниз?
        if (isGroundFree(x + 1, y + 1) && isRock(x + 1, y) && isRock(x, y + 1)) {
          set(x + 1, y, T_GROUND);
          const [mx, my] = this.mirror(x + 1, y);
          if (isRock(mx, my)) set(mx, my, T_GROUND);
        }
      }
    }

    // 7) Гарантия связности: BFS от базы игрока к базе врага; если пути нет —
    //    прорубаем коридор по прямой (редко, но страхует от запертой базы).
    if (!this.reachable(this.bases.player.center.x, this.bases.player.center.y,
                        this.bases.enemy.center.x, this.bases.enemy.center.y)) {
      let x0 = this.bases.player.center.x, y0 = this.bases.player.center.y;
      const x1 = this.bases.enemy.center.x, y1 = this.bases.enemy.center.y;
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx2 = x0 < x1 ? 1 : -1, sy2 = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const tx = x0 + ox, ty = y0 + oy;
          if (this.inBounds(tx, ty) && !this.mineralGrid[this.idx(tx, ty)]) set(tx, ty, T_GROUND);
        }
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx2; }
        if (e2 < dx) { err += dx; y0 += sy2; }
      }
    }
  }

  // BFS по заблокированной сетке — проверка достижимости базы врага.
  // Важно: те же правила, что у боевого A* (8 направлений без среза
  // углов), иначе генерация одобряет проходы, в которые A* не войдёт.
  reachable(sx, sy, gx, gy) {
    const seen = new Uint8Array(this.w * this.h);
    const q = [this.idx(sx, sy)];
    seen[q[0]] = 1;
    const goal = this.idx(gx, gy);
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (q.length) {
      const cur = q.pop();
      if (cur === goal) return true;
      const cx = cur % this.w, cy = (cur / this.w) | 0;
      for (const [dx, dy] of D) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (seen[ni] || this.blockedAt(nx, ny)) continue;
        if (dx && dy && (this.blockedAt(cx + dx, cy) || this.blockedAt(cx, cy + dy))) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    return false;
  }

  // Сколько из 8 соседей тайла свободны (0..8). Нужно движению:
  // тесные щели ( openness <= 2 ) — повод не срезать угол и держать
  // строй подальше от стен.
  opennessAt(tx, ty) {
    let n = 0;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        if (!this.blockedAt(tx + ox, ty + oy)) n++;
      }
    return n;
  }

  // ----------------------------------------------------------
  // Кэш рельефа: рисуем всю карту один раз на offscreen canvas
  // (w×h тайлов), в кадре — один drawImage видимого куска.
  // ----------------------------------------------------------
  buildTerrainCanvas() {
    const R = mulberry32(this.seed ^ 0xABCD1234);
    const B = BIOMES[this.preset.biome] || BIOMES.mars;
    const c = document.createElement('canvas');
    c.width = this.pxW; c.height = this.pxH;
    const g = c.getContext('2d');
    const terr = (x, y) => (this.inBounds(x, y) ? this.terrain[this.idx(x, y)] : T_ROCK);
    const isW = (x, y) => terr(x, y) === T_WATER;
    const polyG = (pts) => {
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.closePath(); g.fill();
    };

    // 0) База биома.
    g.fillStyle = B.ground;
    g.fillRect(0, 0, this.pxW, this.pxH);

    // 1) Мягкие пятна — объём грунта большими радиальными градиентами.
    for (let i = 0; i < 60; i++) {
      const x = R() * this.pxW, y = R() * this.pxH, r = 90 + R() * 260;
      const col = B.blotch[(R() * B.blotch.length) | 0];
      g.save();
      g.translate(x, y); g.scale(1, 0.55 + R() * 0.3); g.translate(-x, -y);
      const gr = g.createRadialGradient(x, y, r * 0.08, x, y, r);
      gr.addColorStop(0, hexA(col, 0.5));
      gr.addColorStop(0.6, hexA(col, 0.28));
      gr.addColorStop(1, hexA(col, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // 2) Потайловый шум значения: ±5% яркости по хешу координат.
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const hh = ((x * 73856093) ^ (y * 19349663) ^ this.seed) >>> 0;
      const v = (hh % 100) / 100;
      g.fillStyle = v < 0.5
        ? 'rgba(0,0,0,' + (0.042 * (1 - v * 2)).toFixed(3) + ')'
        : 'rgba(255,255,255,' + (0.034 * (v * 2 - 1)).toFixed(3) + ')';
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
    }

    // 3) Крошка и галька с бликом.
    for (let i = 0; i < 500; i++) {
      g.fillStyle = R() < 0.5 ? B.speck1 : B.speck2;
      g.fillRect(R() * this.pxW, R() * this.pxH, 2 + R() * 2, 2 + R() * 2);
    }
    for (let i = 0; i < 240; i++) {
      const x = R() * this.pxW, y = R() * this.pxH, r = 1.5 + R() * 2.5;
      g.fillStyle = B.pebble;
      g.beginPath(); g.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath(); g.arc(x - r * 0.3, y - r * 0.25, Math.max(0.7, r * 0.3), 0, Math.PI * 2); g.fill();
    }

    // 4) Рельеф биома.
    if (this.preset.biome === 'nest') {
      // Светящиеся жилы улья — волнистые полилинии.
      for (let i = 0; i < 12; i++) {
        let x = R() * this.pxW, y = R() * this.pxH;
        g.strokeStyle = B.floraGlow; g.globalAlpha = 0.3; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 130; y += (R() - 0.5) * 130; g.lineTo(x, y); }
        g.stroke(); g.globalAlpha = 1;
      }
      // Кусты кристаллов: 3 ромба + точки спор · V-5: только на проходимой
      // земле (куст в озере или на скале читается мусором и путается с
      // преградой) + тень у корня, чтобы куст стоял на грунте.
      for (let i = 0; i < 130; i++) {
        const x = R() * this.pxW, y = R() * this.pxH, st = 2 + R() * 4;
        if (terr((x / TILE) | 0, (y / TILE) | 0) !== T_GROUND) continue;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath(); g.ellipse(x, y + 2, 6, 2, 0, 0, Math.PI * 2); g.fill();
        for (let k = 0; k < 3; k++) {
          const ox = (R() - 0.5) * 14, oy = (R() - 0.5) * 10, s2 = st * (0.6 + R() * 0.7);
          g.fillStyle = B.flora;
          g.fillRect(x + ox - 1, y + oy, 2, 4);
          g.fillStyle = B.floraGlow;
          g.beginPath();
          g.moveTo(x + ox, y + oy - s2); g.lineTo(x + ox + s2 * 0.55, y + oy);
          g.lineTo(x + ox, y + oy + s2 * 0.7); g.lineTo(x + ox - s2 * 0.55, y + oy);
          g.closePath(); g.fill();
        }
        g.fillStyle = B.floraGlow;
        for (let k = 0; k < 3; k++) g.fillRect(x + (R() - 0.5) * 22, y + (R() - 0.5) * 16, 1.5, 1.5);
      }
    } else {
      // Кратеры с валом: тёмная чаша + светлая дуга сверху-слева.
      for (let i = 0; i < 30; i++) {
        const x = R() * this.pxW, y = R() * this.pxH, r = 10 + R() * 26;
        g.fillStyle = 'rgba(0,0,0,0.2)';
        g.beginPath(); g.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.beginPath(); g.ellipse(x + r * 0.12, y + r * 0.16, r * 0.62, r * 0.42, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = B.craterRim; g.lineWidth = 2.5;
        g.beginPath(); g.ellipse(x, y, r, r * 0.72, 0, Math.PI * 0.95, Math.PI * 1.85); g.stroke();
        g.fillStyle = B.pebble;
        for (let k = 0; k < 5; k++) {
          g.beginPath();
          g.arc(x + (R() - 0.5) * r * 2.6, y + (R() - 0.5) * r * 2, 1 + R() * 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
      // Трещины сухого грунта.
      g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1;
      for (let i = 0; i < 90; i++) {
        let x = R() * this.pxW, y = R() * this.pxH;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 40; g.lineTo(x, y); }
        g.stroke();
      }
      // Сухие кусты (марс) / стеклянные осколки (луна) · V-5: куст стал
      // читаемым растением (тёмные задние ветви + светлые передние +
      // контактная тень + плоды), а не бледными штрихами. Флора — только
      // на проходимой земле: куст в озере или на скале читается мусором и
      // путается с преградой. Кусты НЕ блокируют постройку — они мелкие,
      // без обводки и не занимают тайл (в отличие от скал).
      const nBush = this.preset.biome === 'moon' ? 45 : 95;
      for (let i = 0; i < nBush; i++) {
        const x = R() * this.pxW, y = R() * this.pxH;
        if (terr((x / TILE) | 0, (y / TILE) | 0) !== T_GROUND) continue;
        // Тень у корня — куст стоит на грунте.
        g.fillStyle = 'rgba(0,0,0,0.32)';
        g.beginPath(); g.ellipse(x, y + 1.5, 5.5, 2, 0, 0, Math.PI * 2); g.fill();
        for (let k = 0; k < 5; k++) {
          const a = -Math.PI / 2 + (k - 2) * 0.5 + (R() - 0.5) * 0.3;
          const L = 6 + R() * 7;
          // Задняя ветвь — тёмная, для объёма.
          g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1.8;
          g.beginPath(); g.moveTo(x, y);
          g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
          g.stroke();
          // Передняя ветвь — цвет флоры биома.
          g.strokeStyle = B.flora; g.lineWidth = 1.3;
          g.beginPath(); g.moveTo(x, y);
          g.lineTo(x + Math.cos(a) * (L - 1.5), y + Math.sin(a) * (L - 1.5));
          g.stroke();
        }
        // Плоды/кончики — мелкие точки спереди.
        g.fillStyle = B.floraGlow;
        for (let k = 0; k < 3; k++) {
          g.globalAlpha = 0.5;
          g.beginPath();
          g.arc(x + (R() - 0.5) * 9, y - 1 - R() * 7, 1.1, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
    }

    // 5) Пыль у баз — мягкий радиальный градиент без колец.
    for (const side of ['player', 'enemy']) {
      const b = this.bases[side];
      const bx = (b.center.x + 0.5) * TILE, by = (b.center.y + 0.5) * TILE;
      g.save();
      g.translate(bx, by); g.scale(1, 0.8); g.translate(-bx, -by);
      const dg = g.createRadialGradient(bx, by, 10, bx, by, 5 * TILE);
      dg.addColorStop(0, hexA(B.dustHex, 0.2));
      dg.addColorStop(0.7, hexA(B.dustHex, 0.12));
      dg.addColorStop(1, hexA(B.dustHex, 0));
      g.fillStyle = dg;
      g.beginPath(); g.arc(bx, by, 5 * TILE, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // 6) Вода со скруглённой береговой линией: каждый водный тайл
    // строится с учётом 4 соседей — общие рёбра flush, внешние
    // углы круглые. Проходы: берег-расширение → гладь → глубина.
    const waterPath = (x, y, pad, r) => {
      const x0 = x * TILE - pad, y0 = y * TILE - pad;
      const x1 = (x + 1) * TILE + pad, y1 = (y + 1) * TILE + pad;
      const n = isW(x, y - 1), s2 = isW(x, y + 1), w2 = isW(x - 1, y), e2 = isW(x + 1, y);
      g.beginPath();
      g.moveTo(x0, w2 ? y0 : y0 + r);
      if (!w2 && !n) g.quadraticCurveTo(x0, y0, n ? x0 : x0 + r, y0);
      else g.lineTo(n ? x0 : x0 + r, y0);
      g.lineTo(e2 ? x1 : x1 - r, y0);
      if (!e2 && !n) g.quadraticCurveTo(x1, y0, x1, n ? y0 : y0 + r);
      else g.lineTo(x1, n ? y0 : y0 + r);
      g.lineTo(x1, e2 ? y1 : y1 - r);
      if (!e2 && !s2) g.quadraticCurveTo(x1, y1, s2 ? x1 : x1 - r, y1);
      else g.lineTo(s2 ? x1 : x1 - r, y1);
      g.lineTo(w2 ? x0 : x0 + r, y1);
      if (!w2 && !s2) g.quadraticCurveTo(x0, y1, x0, s2 ? y1 : y1 - r);
      else g.lineTo(x0, s2 ? y1 : y1 - r);
      g.closePath();
    };
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!isW(x, y)) continue;
      waterPath(x, y, 3, 10);
      g.fillStyle = B.shore; g.fill();
    }
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!isW(x, y)) continue;
      waterPath(x, y, 0, 9);
      g.fillStyle = B.water; g.fill();
    }
    // Глубина в середине больших озёр.
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!isW(x, y)) continue;
      let all = true;
      for (let oy = -1; oy <= 1 && all; oy++)
        for (let ox = -1; ox <= 1 && all; ox++)
          if (!isW(x + ox, y + oy)) all = false;
      if (!all) continue;
      waterPath(x, y, 0, 9);
      g.globalAlpha = 0.55; g.fillStyle = B.deep; g.fill(); g.globalAlpha = 1;
    }
    // Пена вдоль открытых сторон + блики.
    g.strokeStyle = B.foam; g.lineWidth = 2.5; g.lineCap = 'round';
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!isW(x, y)) continue;
      const x0 = x * TILE, y0 = y * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
      g.beginPath();
      if (!isW(x, y - 1)) { g.moveTo(x0 + 7, y0 + 3); g.lineTo(x1 - 7, y0 + 3); }
      if (!isW(x, y + 1)) { g.moveTo(x0 + 7, y1 - 3); g.lineTo(x1 - 7, y1 - 3); }
      if (!isW(x - 1, y)) { g.moveTo(x0 + 3, y0 + 7); g.lineTo(x0 + 3, y1 - 7); }
      if (!isW(x + 1, y)) { g.moveTo(x1 - 3, y0 + 7); g.lineTo(x1 - 3, y1 - 7); }
      g.stroke();
      if (R() < 0.5) {
        g.fillStyle = B.waterGlint;
        g.fillRect(x0 + 5 + R() * 10, y0 + 7 + R() * 16, 8 + R() * 10, 2);
      }
    }
    g.lineCap = 'butt';

    // 7) Скалы · V-5 (вопрос владельца «не видно преграду»): скальный тайл
    // должен читаться как ЗАНЯТЫЙ целиком, а не как мелкий камешек где-то в
    // середине клетки. Поэтому у скалы два слоя:
    //   7.1 щебневая подошва — неровный многоугольник во весь тайл
    //       (тайл явно занят, край обведён тёмным контуром);
    //   7.2 гранёный валун на ней — тёмное основание, средняя грань,
    //       светлый скол, верхнее ребро, трещины.
    // Свет — сверху-слева (канон DESIGN_SYSTEM §1): световая грань и блик
    // слева-сверху, тень и обводка справа-снизу. Палитра биома остаётся
    // базой, свет/тень накладываются поверх — работает на марсе, в гнезде
    // и на луне без правки конфига.
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (terr(x, y) !== T_ROCK) continue;
      const cx = x * TILE + TILE / 2 + (R() - 0.5) * 3;
      const cy = y * TILE + TILE / 2 + (R() - 0.5) * 3;
      // 7.1 Подошва во весь тайл.
      const pl = [];
      for (let k = 0; k < 7; k++) {
        const a = k * Math.PI * 2 / 7 + R() * 0.6;
        const rr2 = TILE * (0.43 + R() * 0.06);
        pl.push(x * TILE + TILE / 2 + Math.cos(a) * rr2,
                y * TILE + TILE / 2 + Math.sin(a) * rr2 * 0.97);
      }
      g.save();
      g.translate(1.5, 2.5);                 // тень подошвы — приподнятость
      g.fillStyle = 'rgba(0,0,0,0.5)'; polyG(pl);
      g.restore();
      // Подошва — средний тон биома (не самый тёмный: самый тёмный уходит
      // валуну), чтобы масса читается выходом породы со светлым венцом,
      // а не дыркой в грунте.
      g.fillStyle = B.rock[1]; polyG(pl);
      // Нижняя половина подошвы чуть темнее — объём.
      g.save();
      g.beginPath(); g.rect(x * TILE, y * TILE + TILE / 2, TILE, TILE / 2);
      g.clip();
      g.fillStyle = 'rgba(0,0,0,0.22)'; polyG(pl);
      g.restore();
      g.strokeStyle = 'rgba(0,0,0,0.62)'; g.lineWidth = 2; g.stroke();
      // Кромка света сверху-слева: без неё тёмная подошва тонет в грунте
      // того же тона (марс: коричневый грунт / серый камень).
      g.strokeStyle = 'rgba(255,255,255,0.24)'; g.lineWidth = 1.6;
      g.beginPath();
      for (let k = 0; k < 7; k++) {
        const ax = pl[k * 2], ay = pl[k * 2 + 1];
        const bx2 = pl[((k + 1) % 7) * 2], by2 = pl[((k + 1) % 7) * 2 + 1];
        const mx = (ax + bx2) / 2 - (x * TILE + TILE / 2), my = (ay + by2) / 2 - (y * TILE + TILE / 2);
        if (my < 1 && mx < 3) { g.moveTo(ax, ay); g.lineTo(bx2, by2); }
      }
      g.stroke();
      // Щебень на подошве: внутренняя светлая кромка + камешки.
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.beginPath(); g.ellipse(cx - 1, cy - 2, TILE * 0.30, TILE * 0.24, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.28)';
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.arc(cx + (R() - 0.5) * TILE * 0.5, cy + (R() - 0.5) * TILE * 0.5, 1 + R() * 1.6, 0, Math.PI * 2);
        g.fill();
      }
      // 7.2 Валун.
      const r = 12 + R() * 4;
      g.fillStyle = 'rgba(0,0,0,0.42)';
      g.beginPath(); g.ellipse(cx + 2, cy + r * 0.6, r * 1.0, r * 0.45, 0, 0, Math.PI * 2); g.fill();
      // Основание — тёмный шестигранник со сдвигом.
      const base = [];
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 + R() * 0.5;
        const rr2 = r * (0.85 + R() * 0.2);
        base.push(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2 * 0.9);
      }
      g.fillStyle = B.rock[0]; polyG(base);
      g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.8; g.stroke();
      // Средняя грань — пятигранник вверх-влево.
      const mid = [];
      for (let k = 0; k < 5; k++) {
        const a = k * Math.PI * 2 / 5 - 0.6 + R() * 0.4;
        const rr2 = r * 0.68 * (0.85 + R() * 0.3);
        mid.push(cx - 2 + Math.cos(a) * rr2, cy - 3 + Math.sin(a) * rr2 * 0.85);
      }
      g.fillStyle = B.rock[1]; polyG(mid);
      // Световая грань сверху-слева (общий язык света).
      g.fillStyle = 'rgba(255,255,255,0.15)';
      polyG([cx - r * 0.78, cy - r * 0.18, cx - r * 0.12, cy - r * 0.8,
             cx + r * 0.5, cy - r * 0.58, cx + r * 0.16, cy - r * 0.04]);
      // Светлый скол — треугольник.
      const sa = R() * Math.PI * 2;
      g.fillStyle = B.rock[2];
      polyG([cx + Math.cos(sa) * r * 0.55, cy + Math.sin(sa) * r * 0.45,
             cx + Math.cos(sa + 2.2) * r * 0.5, cy + Math.sin(sa + 2.2) * r * 0.42,
             cx - 3, cy - r * 0.42]);
      // Тень на нижне-правом склоне — объём.
      g.fillStyle = 'rgba(0,0,0,0.22)';
      polyG([cx + r * 0.2, cy + r * 0.1, cx + r * 0.72, cy + r * 0.3,
             cx + r * 0.35, cy + r * 0.72]);
      // Верхнее ребро бликует.
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(cx - r * 0.5, cy - r * 0.34); g.lineTo(cx + r * 0.1, cy - r * 0.52);
      g.stroke();
      // Трещины.
      g.strokeStyle = 'rgba(0,0,0,0.32)'; g.lineWidth = 1;
      for (let k = 0; k < 2; k++) {
        const a = Math.PI * (0.3 + R() * 0.7);
        g.beginPath();
        g.moveTo(cx + (R() - 0.5) * r, cy + (R() - 0.5) * r * 0.6);
        g.lineTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.45);
        g.stroke();
      }
    }

    this.terrainCanvas = c;
  }

  // Мини-карта: рельеф 2px на тайл, рисуется один раз.
  buildMiniCanvas() {
    const c = document.createElement('canvas');
    c.width = this.w * 2; c.height = this.h * 2;
    const g = c.getContext('2d');
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const t = this.terrain[this.idx(x, y)];
      const B = BIOMES[this.preset.biome] || BIOMES.mars;
      g.fillStyle = t === T_WATER ? B.water : t === T_ROCK ? B.rock[1] : B.ground;
      g.fillRect(x * 2, y * 2, 2, 2);
    }
    // Осветляем: тёмный биом + туман съедали читаемость мини-карты.
    g.globalAlpha = 0.17;
    g.fillStyle = '#bfe8e2';
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 1;
    this.miniCanvas = c;
  }
}
