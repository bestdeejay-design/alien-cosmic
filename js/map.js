// ============================================================
// map.js — тайловая карта 64×64: рельеф, минералы, проходимость,
// кэш статичной отрисовки (offscreen canvas) и мини-карта.
// Карта генерируется детерминированно по seed и пресету миссии
// (позиции баз, озёра, число скал, богатство минералов) и всегда
// симметрична относительно центра — честно для обеих сторон.
// ============================================================
import { TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, BIOMES } from './config.js';

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
  //           rich, base:{x,y} — cc игрока; враг зеркалится }
  constructor(seed, preset = {}) {
    this.seed = seed >>> 0;
    this.preset = preset;
    const n = MAP_W * MAP_H;
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
  mirror(x, y) { return [MAP_W - 1 - x, MAP_H - 1 - y]; }

  computeBases() {
    const p = this.preset.base || { x: 8, y: 48 };
    const cc = { x: p.x, y: p.y };
    const zone = {
      x0: Math.max(1, cc.x - 3), y0: Math.max(1, cc.y - 3),
      x1: Math.min(MAP_W - 2, cc.x + 8), y1: Math.min(MAP_H - 2, cc.y + 8),
    };
    const [ex, ey] = this.mirror(cc.x, cc.y);
    this.bases = {
      player: { cc, zone, center: { x: cc.x + 2, y: cc.y + 2 } },
      enemy:  { cc: { x: ex, y: ey }, zone: null, center: { x: ex - 2, y: ey - 2 } },
    };
    this.bases.enemy.zone = {
      x0: Math.max(1, ex - 8), y0: Math.max(1, ey - 8),
      x1: Math.min(MAP_W - 2, ex + 3), y1: Math.min(MAP_H - 2, ey + 3),
    };
  }

  idx(x, y) { return y * MAP_W + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }

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

  addCrystal(tx, ty, amount) {
    if (!this.inBounds(tx, ty) || this.mineralGrid[this.idx(tx, ty)]) return;
    this.terrain[this.idx(tx, ty)] = T_GROUND; // под кристаллом всегда земля
    this.mineralGrid[this.idx(tx, ty)] = 1;
    this.crystals.push({
      kind: 'mineral', tx, ty, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE,
      amount, max: amount, dead: false,
    });
  }

  removeCrystal(c) {
    this.mineralGrid[this.idx(c.tx, c.ty)] = 0;
    c.dead = true;
    const i = this.crystals.indexOf(c);
    if (i >= 0) this.crystals.splice(i, 1);
  }

  // ----------------------------------------------------------
  // Генерация рельефа. Порядок важен: граница → вода → очистка
  // стартовых зон → минералы → скалы → гарантия связности.
  // ----------------------------------------------------------
  generate() {
    const R = mulberry32(this.seed ^ 0x9E3779B9);
    const T = this.terrain;
    const set = (x, y, t) => { if (this.inBounds(x, y)) T[this.idx(x, y)] = t; };
    const get = (x, y) => (this.inBounds(x, y) ? T[this.idx(x, y)] : T_ROCK);

    // 1) Непроходимая граница карты.
    for (let x = 0; x < MAP_W; x++) { set(x, 0, T_ROCK); set(x, MAP_H - 1, T_ROCK); }
    for (let y = 0; y < MAP_H; y++) { set(0, y, T_ROCK); set(MAP_W - 1, y, T_ROCK); }

    // 2) Озёра — каждая из списка рисуется парой с зеркалом.
    const lakes = Array.isArray(this.preset.lakes) ? this.preset.lakes : DEFAULT_LAKES;
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
      for (const [dx, dy] of offs) this.addCrystal(cx + dx, cy + dy, Math.round((amount + Math.floor(R() * 300)) * rich));
    };
    // Основное поле — со стороны ближнего края карты от базы игрока.
    const pb = this.bases.player.cc;
    const sx = pb.x < MAP_W / 2 ? 1 : -1;
    const sy = pb.y < MAP_H / 2 ? -1 : 1;
    field(pb.x + 2 * sx, pb.y + 7 * sy, mainOff, 1350);
    const [emx, emy] = this.mirror(pb.x + 2 * sx, pb.y + 7 * sy);
    field(emx, emy, mainOff, 1350);
    const neutral = Array.isArray(this.preset.neutral) ? this.preset.neutral : DEFAULT_NEUTRAL;
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
      let bx = 6 + Math.floor(R() * 52), by = 6 + Math.floor(R() * 52);
      const steps = 8 + Math.floor(R() * 10);
      for (let s = 0; s < steps; s++) {
        const mx = MAP_W - 1 - bx, my = MAP_H - 1 - by;
        if (!nearBase(bx, by) && !nearCrystal(bx, by) && get(bx, by) === T_GROUND) set(bx, by, T_ROCK);
        if (!nearBase(mx, my) && !nearCrystal(mx, my) && get(mx, my) === T_GROUND) set(mx, my, T_ROCK);
        bx += Math.floor(R() * 3) - 1; by += Math.floor(R() * 3) - 1;
      }
    }

    // 6) Восстанавливаем стартовые зоны и подходы к кристаллам.
    clearZone(this.bases.player.zone); clearZone(this.bases.enemy.zone);
    for (const c of this.crystals) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (get(c.tx + dx, c.ty + dy) === T_ROCK) set(c.tx + dx, c.ty + dy, T_GROUND);
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
  reachable(sx, sy, gx, gy) {
    const seen = new Uint8Array(MAP_W * MAP_H);
    const q = [this.idx(sx, sy)];
    seen[q[0]] = 1;
    const goal = this.idx(gx, gy);
    while (q.length) {
      const cur = q.pop();
      if (cur === goal) return true;
      const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (seen[ni] || this.blockedAt(nx, ny)) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    return false;
  }

  // ----------------------------------------------------------
  // Кэш рельефа: рисуем всю карту один раз на offscreen canvas
  // 2048×2048, в кадре — один drawImage видимого куска.
  // ----------------------------------------------------------
  buildTerrainCanvas() {
    const R = mulberry32(this.seed ^ 0xABCD1234);
    const B = BIOMES[this.preset.biome] || BIOMES.mars;
    const c = document.createElement('canvas');
    c.width = WORLD_W; c.height = WORLD_H;
    const g = c.getContext('2d');

    // Земля: базовый тон биома + пятна рельефа.
    g.fillStyle = B.ground;
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = B.tones[(R() * B.tones.length) | 0];
      g.globalAlpha = 0.25 + R() * 0.2;
      g.fillRect(R() * WORLD_W, R() * WORLD_H, 6 + R() * 26, 4 + R() * 14);
    }
    g.globalAlpha = 1;
    // Мелкая крошка/наросты.
    for (let i = 0; i < 500; i++) {
      const x = R() * WORLD_W, y = R() * WORLD_H;
      g.fillStyle = R() < 0.5 ? B.speck1 : B.speck2;
      g.fillRect(x, y, 2 + R() * 2, 2 + R() * 2);
    }
    // Кратеры (Марс/Луна) или кристальные наросты (пустоши улья).
    if (this.preset.biome === 'nest') {
      for (let i = 0; i < 120; i++) {
        const x = R() * WORLD_W, y = R() * WORLD_H;
        const s = 3 + R() * 6;
        g.fillStyle = 'rgba(190,120,255,0.2)';
        g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.5, y); g.lineTo(x, y + s); g.lineTo(x - s * 0.5, y); g.closePath(); g.fill();
        g.fillStyle = 'rgba(240,200,255,0.25)';
        g.fillRect(x - 1, y - s * 0.4, 2, s * 0.5);
      }
    } else {
      for (let i = 0; i < 70; i++) {
        const x = R() * WORLD_W, y = R() * WORLD_H;
        const r = 8 + R() * 22;
        g.fillStyle = 'rgba(0,0,0,0.14)';
        g.beginPath(); g.ellipse(x, y, r, r * 0.75, R() * Math.PI, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.beginPath(); g.ellipse(x - r * 0.15, y - r * 0.18, r * 0.7, r * 0.5, 0, 0, Math.PI * 2); g.fill();
      }
      // Трещины сухого грунта.
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
      for (let i = 0; i < 90; i++) {
        let x = R() * WORLD_W, y = R() * WORLD_H;
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 4; s++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 40; g.lineTo(x, y); }
        g.stroke();
      }
    }
    // Пыльные пятна у баз.
    for (const side of ['player', 'enemy']) {
      const b = this.bases[side];
      g.fillStyle = B.dust;
      g.beginPath();
      g.ellipse((b.center.x + 0.5) * TILE, (b.center.y + 0.5) * TILE, 5 * TILE, 4 * TILE, 0, 0, Math.PI * 2);
      g.fill();
    }

    // Вода/кислотные озёра: тёмная заливка + блики.
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (this.terrain[this.idx(x, y)] !== T_WATER) continue;
      g.fillStyle = B.water;
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (R() < 0.55) {
        g.fillStyle = B.waterGlint;
        g.fillRect(x * TILE + 4 + R() * 10, y * TILE + 6 + R() * 16, 8 + R() * 10, 2);
      }
    }
    // Кромка берега.
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (this.terrain[this.idx(x, y)] !== T_GROUND) continue;
      const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
        this.inBounds(x + dx, y + dy) && this.terrain[this.idx(x + dx, y + dy)] === T_WATER);
      if (nearWater) {
        g.fillStyle = B.shore;
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    // Скалы: каменные «клубы» из кругов с бликом и тенью.
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (this.terrain[this.idx(x, y)] !== T_ROCK) continue;
      const cx = x * TILE + TILE / 2 + (R() - 0.5) * 6;
      const cy = y * TILE + TILE / 2 + (R() - 0.5) * 6;
      const r = 15 + R() * 7;
      g.fillStyle = B.rock[0];
      g.beginPath(); g.arc(cx + 2, cy + 3, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = B.rock[1];
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = B.rock[2];
      g.beginPath(); g.arc(cx - r * 0.25, cy - r * 0.3, r * 0.55, 0, Math.PI * 2); g.fill();
    }

    this.terrainCanvas = c;
  }

  // Мини-карта: рельеф 2px на тайл (128×128), рисуется один раз.
  buildMiniCanvas() {
    const c = document.createElement('canvas');
    c.width = MAP_W * 2; c.height = MAP_H * 2;
    const g = c.getContext('2d');
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const t = this.terrain[this.idx(x, y)];
      const B = BIOMES[this.preset.biome] || BIOMES.mars;
      g.fillStyle = t === T_WATER ? B.water : t === T_ROCK ? B.rock[1] : B.ground;
      g.fillRect(x * 2, y * 2, 2, 2);
    }
    this.miniCanvas = c;
  }
}
