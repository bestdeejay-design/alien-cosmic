// ============================================================
// squad.js — ПРИКАЗЫ ОТРЯДАМ ОТ КОМАНДИРА (Э7, часть 2).
//
// Владелец просил, чтобы командир управлял не только автобоем на базе, но и
// отрядами: «держать сектор» и «отойти к КЦ». Оба приказа — обычные приказы
// движка (move/attack), поэтому не ломают ни физику, ни баланс: squad.js
// только периодически поправляет поведение юнитов, у которых стоит «пост».
//
// МОДЕЛЬ: у юнита u.hold = { x, y, r, kind: 'hold' | 'cc' }.
//   • враг вошёл в радиус, а юнит свободен  → атакуем его;
//   • врагов нет, юнит ушёл от поста      → возвращаем на пост;
//   • приказ игрока (ПКМ/атака) НЕ отменяется: пост лишь ждёт, когда юнит
//     освободится (u.order.kind === 'idle').
// Приказы снимаются «Снять удержание» или при уходе с базы (вылазка/бой).
// ============================================================
import { TILE } from './config.js?v=10271840';
import { orderAttack, orderMove } from './units.js?v=10271840';

export const HOLD_RADIUS = TILE * 5;
export const CC_RADIUS = TILE * 4;
const TICK_EVERY = 0.35; // как часто поправляем посты (не каждый кадр)

// Бойцы, которым можно дать пост (в отсеке/гарнизоне — нельзя).
export function combatUnits(st, units) {
  const list = units || (st && st.selection) || [];
  return list.filter((u) => u && u.kind === 'unit' && u.side === 'player'
    && !u.dead && !u.garrison && !u.hidden && u.cfg && u.cfg.dmg > 0);
}

export function squadHoldCount(st) {
  return (st.units || []).filter((u) => u && !u.dead && u.hold).length;
}

function clampToMap(st, x, y) {
  return {
    x: Math.max(TILE, Math.min((st.map.w - 1) * TILE, x)),
    y: Math.max(TILE, Math.min((st.map.h - 1) * TILE, y)),
  };
}

// «Держать сектор»: юниты встают на пост вокруг точки и не бегут за врагом.
export function issueHold(st, x, y, units = null, radius = HOLD_RADIUS) {
  if (!st) return 0;
  const list = combatUnits(st, units);
  if (!list.length) return 0;
  const p = clampToMap(st, x, y);
  let n = 0;
  for (const u of list) {
    u.hold = { x: p.x, y: p.y, r: radius, kind: 'hold', px: p.x, py: p.y };
    orderMove(st, u, p.x, p.y);
    n++;
  }
  return n;
}

// «КЦ» игрока на текущей карте: на базе — командный центр, на вылазке —
// Дом-шаттл (канон: в рейде Дом И ЕСТЬ КЦ, поэтому и приказы, и сдача эрга
// идут к нему).
export function ccAnchor(st) {
  if (!st) return null;
  const cc = (st.buildings || []).find((b) => b && !b.dead && b.done && b.side === 'player' && b.type === 'cc');
  if (cc) return cc;
  if (st.raidMode === 'expedition' && st.raidHouse && !st.raidHouse.dead) return st.raidHouse;
  return null;
}

// «Отойти к КЦ»: собираем отряд у командного центра и держим периметр.
export function issueRetreatToCC(st, units = null) {
  if (!st) return 0;
  const cc = ccAnchor(st);
  if (!cc) return 0;
  const list = combatUnits(st, units);
  if (!list.length) return 0;
  let n = 0;
  const baseR = CC_RADIUS;
  for (const u of list) {
    const a = (n * 2.399963229728653) % (Math.PI * 2);
    const dist = TILE * (1.6 + (n % 3) * 0.7);
    const tx = cc.x + Math.cos(a) * dist;
    const ty = cc.y + Math.sin(a) * dist;
    u.hold = { x: cc.x, y: cc.y, r: baseR, kind: 'cc', px: tx, py: ty };
    orderMove(st, u, tx, ty);
    n++;
  }
  return n;
}

export function clearHold(st, units = null) {
  if (!st) return 0;
  const list = units && units.length ? units : (st.units || []);
  let n = 0;
  for (const u of list) {
    if (u && u.hold) { u.hold = null; n++; }
  }
  return n;
}

function nearestEnemy(st, u, radius) {
  let best = null;
  let bestD = radius * radius;
  for (const e of st.units || []) {
    if (!e || e.dead || e.side === 'player' || e.hidden) continue;
    const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
    if (d <= bestD) { bestD = d; best = e; }
  }
  return best;
}

// Тик постов. Возвращает число действий (для симов/отладки).
export function updateSquad(st, dt, force = false) {
  if (!st) return 0;
  st._squadT = (st._squadT || 0) + (dt || 0);
  if (!force && st._squadT < TICK_EVERY) return 0;
  st._squadT = 0;
  let acts = 0;
  for (const u of st.units || []) {
    if (!u || u.dead || !u.hold || u.garrison || u.hidden) continue;
    const h = u.hold;
    const busy = u.order && u.order.kind !== 'idle';
    if (busy) continue; // у юнита свой приказ — пост не лезет
    const enemy = nearestEnemy(st, u, h.r);
    if (enemy) {
      orderAttack(st, u, enemy);
      acts++;
      continue;
    }
    // Точка возврата: свой пост ('hold') или своё место в кольце у КЦ ('cc').
    const hx = Number.isFinite(h.px) ? h.px : h.x;
    const hy = Number.isFinite(h.py) ? h.py : h.y;
    const dx = u.x - hx;
    const dy = u.y - hy;
    if (dx * dx + dy * dy > (h.r * 0.55) ** 2) {
      orderMove(st, u, hx, hy);
      acts++;
    }
  }
  return acts;
}

// Кольца постов: пунктир + ромб-флажок. Рисуем только в поле зрения.
export function drawSquadZones(ctx, st, cam, inView) {
  if (!st || !st.units) return;
  const seen = new Set();
  ctx.save();
  for (const u of st.units) {
    if (!u || u.dead || !u.hold) continue;
    const key = u.hold.kind === 'cc'
      ? `cc${Math.round(u.hold.r)}`
      : `${Math.round(u.hold.x)},${Math.round(u.hold.y)},${Math.round(u.hold.r)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sx = u.hold.x - cam.x;
    const sy = u.hold.y - cam.y;
    if (inView && !inView(u.hold.x, u.hold.y, u.hold.r + 40)) continue;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = u.hold.kind === 'cc' ? 'rgba(255,209,138,0.55)' : 'rgba(125,243,226,0.5)';
    ctx.beginPath();
    ctx.arc(sx, sy, u.hold.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Флажок поста.
    ctx.fillStyle = u.hold.kind === 'cc' ? '#ffd98a' : '#7df3e2';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 2);
    ctx.lineTo(sx + 7, sy + 3);
    ctx.lineTo(sx, sy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
