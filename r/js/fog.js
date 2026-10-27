// ============================================================
// fog.js — туман войны с тремя состояниями клетки:
//   0) неисследовано — чёрное;
//   1) исследовано  — приглушено, рельеф виден, юниты — нет;
//   2) видно сейчас — обычная отрисовка.
// Данные — два Uint8Array w×h. Отрисовка — ImageData w×h,
// растянутая на вьюпорт со сглаживанием (мягкие края).
// ============================================================
import { MAP_W, MAP_H, TILE } from './config.js?v=10271841';

// Кэш кругов обзора: радиус → список смещений тайлов.
const circleCache = new Map();
function circleOffsets(r) {
  let off = circleCache.get(r);
  if (off) return off;
  const list = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r + r * 0.5) list.push(dx, dy);
  off = Int32Array.from(list);
  circleCache.set(r, off);
  return off;
}

export class Fog {
  // C/П7: размеры — от карты; без аргументов — дефолт 64.
  constructor(w = MAP_W, h = MAP_H) {
    this.w = w; this.h = h;
    const n = w * h;
    this.visible = new Uint8Array(n);  // видно сейчас
    this.explored = new Uint8Array(n); // исследовано когда-либо
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(this.w, this.h);
    // Чёрный цвет заранее, меняется только альфа.
    const d = this.img.data;
    for (let i = 0; i < n; i++) { d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; d[i * 4 + 3] = 252; }
    this.dirty = true;
  }

  mark(cx, cy, r) {
    const off = circleOffsets(r);
    for (let i = 0; i < off.length; i += 2) {
      const x = cx + off[i], y = cy + off[i + 1];
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const idx = y * this.w + x;
      this.visible[idx] = 1;
      this.explored[idx] = 1;
    }
  }

  // Пересчёт видимости по всем сущностям игрока (юниты + здания).
  // Вызывается раз в 3 тика (~10 раз/сек) — этого достаточно.
  recompute(st) {
    this.visible.fill(0);
    for (const u of st.units) {
      if (u.dead || u.side !== 'player') continue;
      this.mark((u.x / TILE) | 0, (u.y / TILE) | 0, u.cfg.sightTiles);
    }
    for (const b of st.buildings) {
      if (b.dead || b.side !== 'player') continue;
      this.mark(b.tx + (b.w >> 1), b.ty + (b.h >> 1), b.cfg.sightTiles);
    }
    // Видимость врагов + «запоминание» однажды увиденных зданий.
    for (const u of st.units) {
      if (u.side !== 'enemy') continue;
      u.visible = this.visible[((u.y / TILE) | 0) * this.w + ((u.x / TILE) | 0)] === 1;
    }
    for (const b of st.buildings) {
      if (b.side !== 'enemy' || b.dead) continue;
      const tx = b.tx + (b.w >> 1), ty = b.ty + (b.h >> 1);
      if (this.visible[ty * this.w + tx] === 1) b.spotted = true;
    }
    this.dirty = true;
  }

  tileVisible(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.visible[ty * this.w + tx] === 1;
  }

  tileExplored(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.explored[ty * this.w + tx] === 1;
  }

  // Перенести состояния в ImageData (вызывается из рендера при dirty).
  paint() {
    const d = this.img.data;
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      d[i * 4 + 3] = this.visible[i] ? 0 : (this.explored[i] ? 148 : 252);
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.dirty = false;
  }
}
